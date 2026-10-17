<#
.SYNOPSIS
  Runs CampusGrade natively on this PC for fast development. Only Postgres runs in Docker.

.DESCRIPTION
  The Docker dev stack mounts the source into containers and proxies every request, which is
  slow on Windows. This starts the same app as plain local processes instead:

    Postgres  Docker (compose.dev.yaml), published on 127.0.0.1:5433
    API       uv run uvicorn --reload      http://localhost:5001
    Worker    uv run python -m worker      (restart it after changing worker/job code)
    Web       npm run dev (Turbopack)      http://localhost:3000

  Files are stored on disk under .local\storage (not RustFS). Logs go to .local\logs.
  Secrets are read from secrets\*.txt and passed to the processes as environment variables;
  your backend\.env is not touched.

.EXAMPLE
  scripts\dev-local.ps1            # start everything
  scripts\dev-local.ps1 -Status    # what is running
  scripts\dev-local.ps1 -Stop      # stop API, worker and web (Postgres keeps running)
#>
param(
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$localDir = Join-Path $root ".local"
$logDir = Join-Path $localDir "logs"
$pidFile = Join-Path $localDir "dev-local.pids"
$compose = @("compose", "-f", "compose.yaml", "-f", "compose.dev.yaml", "-f", "compose.local.yaml")

# Windows PowerShell 5.1 turns a native command's stderr output (docker progress, alembic logs)
# into terminating errors under $ErrorActionPreference = "Stop". Run native commands through
# this so only a non-zero exit code counts as failure.
function Invoke-Native([scriptblock]$Block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $Block } finally { $ErrorActionPreference = $previous }
}

function Stop-LocalProcesses {
  if (-not (Test-Path $pidFile)) { return }
  foreach ($line in Get-Content $pidFile) {
    if ($line -match "^(\w+)=(\d+)$") {
      Invoke-Native { taskkill.exe /T /F /PID $Matches[2] *> $null }
      Write-Host "stopped $($Matches[1]) (pid $($Matches[2]))"
    }
  }
  Remove-Item $pidFile -Force
}

function Test-Url([string]$Url) {
  try { return ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) } catch { return $false }
}

function Wait-Url([string]$Url, [string]$Name, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url $Url) { Write-Host "ready   $Name  $Url"; return }
    Start-Sleep -Seconds 2
  }
  throw "$Name did not become ready in $Seconds s. See $logDir"
}

if ($Status) {
  foreach ($check in @(@("API", "http://127.0.0.1:5001/ready"), @("Web", "http://127.0.0.1:3000/login"))) {
    $state = if (Test-Url $check[1]) { "up" } else { "down" }
    Write-Host ("{0,-4} {1}  {2}" -f $check[0], $state, $check[1])
  }
  if (Test-Path $pidFile) { Get-Content $pidFile }
  exit 0
}

if ($Stop) {
  Stop-LocalProcesses
  Write-Host "Postgres is still running in Docker. Stop it with: docker compose -f compose.yaml -f compose.dev.yaml -f compose.local.yaml stop postgres"
  exit 0
}

# --- prerequisites -------------------------------------------------------------------------
foreach ($tool in "docker", "uv", "node", "npm") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}
Invoke-Native { docker info *> $null }
if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop and try again." }
foreach ($name in "secret_key", "postgres_password") {
  if (-not (Test-Path (Join-Path $root "secrets\$name.txt"))) { throw "Missing secrets\$name.txt. Run scripts\init-secrets.ps1 first." }
}

Stop-LocalProcesses
New-Item -ItemType Directory -Force $logDir, (Join-Path $localDir "storage") | Out-Null

# --- Postgres (Docker) ---------------------------------------------------------------------
# The containerized app would fight for ports 3000/5001, so stop it; its data is kept.
Invoke-Native { docker @compose stop api web worker *> $null }
Invoke-Native { docker @compose up -d postgres *> $null }
if ($LASTEXITCODE -ne 0) { throw "Could not start Postgres." }
$mapping = Invoke-Native { docker @compose port postgres 5432 2>$null }
if (-not $mapping) {
  Write-Host "Postgres is not published on the host yet; recreating the container (data volume is kept)..."
  Invoke-Native { docker @compose up -d --force-recreate postgres *> $null }
  if ($LASTEXITCODE -ne 0) { throw "Could not recreate Postgres." }
}
$deadline = (Get-Date).AddSeconds(60)
do {
  Invoke-Native { docker @compose exec -T postgres pg_isready -U campusgrade -d campusgrade_db *> $null }
  $healthy = ($LASTEXITCODE -eq 0)
  if (-not $healthy) { Start-Sleep -Seconds 2 }
} while (-not $healthy -and (Get-Date) -lt $deadline)
if (-not $healthy) { throw "Postgres did not become ready." }
Write-Host "ready   Postgres  127.0.0.1:5433"

# --- environment for the native processes ---------------------------------------------------
function Read-Secret([string]$Name) {
  $path = Join-Path $root "secrets\$Name.txt"
  if (Test-Path $path) {
    $text = Get-Content $path -Raw   # $null for an empty file (for example an unset github_token)
    if ($text) { return $text.Trim() }
  }
  return ""
}
$dbPassword = [uri]::EscapeDataString((Read-Secret "postgres_password"))
$env:DATABASE_URL = "postgresql+psycopg://campusgrade:$dbPassword@127.0.0.1:5433/campusgrade_db"
$env:SECRET_KEY = Read-Secret "secret_key"
$githubToken = Read-Secret "github_token"
if ($githubToken) { $env:GITHUB_TOKEN = $githubToken }
$env:APP_ENV = "development"
$env:COOKIE_SECURE = "false"
$env:ALLOWED_ORIGINS = "http://localhost:3000"
# Do not set PORT: Next.js reads it too. The API gets its port from --port below.
$env:PRIVATE_STORAGE_BACKEND = "local"
$env:PRIVATE_STORAGE_PATH = Join-Path $localDir "storage"
$env:BACKEND_ORIGIN = "http://127.0.0.1:5001"

# --- dependencies and migrations -------------------------------------------------------------
Invoke-Native { uv sync --quiet }
if ($LASTEXITCODE -ne 0) { throw "uv sync failed." }
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
  Write-Host "Installing frontend dependencies (first run only)..."
  Push-Location (Join-Path $root "frontend")
  try { Invoke-Native { npm ci --no-audit --no-fund }; if ($LASTEXITCODE -ne 0) { throw "npm ci failed." } } finally { Pop-Location }
}
Push-Location (Join-Path $root "backend")
try { Invoke-Native { uv run alembic upgrade head 2>&1 | Select-Object -Last 1 }; if ($LASTEXITCODE -ne 0) { throw "Migrations failed." } } finally { Pop-Location }

# --- start the three processes ---------------------------------------------------------------
function Start-Logged([string]$Name, [string]$File, [string[]]$Arguments, [string]$WorkDir) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "$Name.log") -RedirectStandardError (Join-Path $logDir "$Name.err.log")
  Add-Content -Path $pidFile -Value "$Name=$($process.Id)"
  return $process
}
$backendDir = Join-Path $root "backend"
Start-Logged "api" "uv" @("run", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "5001", "--reload") $backendDir | Out-Null
Start-Logged "worker" "uv" @("run", "python", "-m", "worker") $backendDir | Out-Null
Start-Logged "web" "npm.cmd" @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000") (Join-Path $root "frontend") | Out-Null

Wait-Url "http://127.0.0.1:5001/ready" "API"
Wait-Url "http://127.0.0.1:3000/login" "Web"

Write-Host ""
Write-Host "CampusGrade is running locally:"
Write-Host "  App   http://localhost:3000"
Write-Host "  API   http://localhost:5001"
Write-Host "  Logs  $logDir"
Write-Host "Stop with: scripts\dev-local.ps1 -Stop"
