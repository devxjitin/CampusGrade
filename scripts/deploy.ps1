<#
.SYNOPSIS
  Deploys a published CampusGrade version on this machine's Docker.

.DESCRIPTION
  1. pulls the requested images from GHCR (skipped with -NoPull for local images)
  2. takes a backup (database + files) when a version is already deployed, so a
     bad migration can be undone with scriptsestore.ps1 (skipped with -NoBackup)
  3. starts the stack; the one-shot `migrate` container must succeed before any
     API replica starts, and `up --wait` blocks until every service is healthy
  4. smoke-tests /api/ready and the login page through the HTTPS proxy
  5. on any failure, redeploys the previously deployed version

.EXAMPLE
  scripts\deploy.ps1 -Version v0.1.0
  scripts\deploy.ps1 -Version local-test -NoPull     # locally built images
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$EnvFile = ".env.prod",
  [switch]$NoPull,
  [switch]$NoBackup,
  [switch]$NoRollback
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stateFile = Join-Path $root ".deployed-version"
$historyFile = Join-Path $root ".deployed-history"

function Test-Prerequisites {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed or not on PATH." }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop and try again." }
  foreach ($name in "secret_key", "postgres_password", "database_url", "private_s3_secret_key", "github_token") {
    if (-not (Test-Path (Join-Path $root "secrets\$name.txt"))) {
      throw "Missing secrets\$name.txt. Run scripts\init-secrets.ps1 first."
    }
  }
  if (-not (Test-Path $EnvFile)) {
    Write-Host "No $EnvFile found; copying .env.prod.example (edit it for a custom domain)."
    Copy-Item ".env.prod.example" $EnvFile
  }
}

function Get-SiteAddress {
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*SITE_ADDRESS\s*=" } | Select-Object -First 1
  if ($line) { return ($line -split "=", 2)[1].Trim() }
  return "campusgrade.localhost"
}

function Invoke-Compose([string[]]$ComposeArgs) {
  & docker compose --env-file $EnvFile -f compose.yaml -f compose.prod.yaml @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed (exit $LASTEXITCODE)" }
}

function Test-Url([string]$Url, [string]$Site) {
  # curl.exe ships with Windows 10+. Browsers resolve *.localhost on their own,
  # but Windows' resolver does not, so pin the name to this machine; -k accepts
  # Caddy's local CA certificate for the check.
  $code = & curl.exe -sk --max-time 15 -o NUL -w "%{http_code}" --resolve "${Site}:443:127.0.0.1" $Url
  return ($code -eq "200")
}

function Invoke-SmokeTest {
  $site = Get-SiteAddress
  $checks = @("https://$site/api/ready", "https://$site/login")
  foreach ($url in $checks) {
    $ok = $false
    for ($attempt = 1; $attempt -le 10 -and -not $ok; $attempt++) {
      $ok = Test-Url $url $site
      if (-not $ok) { Start-Sleep -Seconds 3 }
    }
    if (-not $ok) { throw "Smoke test failed: $url" }
    Write-Host "smoke ok  $url"
  }
}

function Start-Version([string]$Target, [switch]$Backup) {
  $env:CAMPUSGRADE_VERSION = $Target
  if ($NoPull) { $env:CAMPUSGRADE_PULL_POLICY = "never" } else { $env:CAMPUSGRADE_PULL_POLICY = "always" }
  if (-not $NoPull) { Invoke-Compose @("pull", "--quiet", "--ignore-buildable") }
  Invoke-Compose @("build", "--quiet", "backup")
  if ($Backup) {
    Write-Host "Backing up before migrating ..."
    # Brings up postgres and storage if needed; runs before the new migrations.
    Invoke-Compose @("run", "--rm", "-T", "backup", "once")
  }
  Invoke-Compose @("up", "-d", "--wait", "--remove-orphans")
  Invoke-SmokeTest
  Set-Content -Path $stateFile -Value $Target -NoNewline
  Add-Content -Path $historyFile -Value $Target
}

Test-Prerequisites
$previous = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { $null }

Write-Host "Deploying CampusGrade $Version (previous: $(if ($previous) { $previous } else { 'none' }))"
try {
  Start-Version $Version -Backup:($previous -and -not $NoBackup)
  Write-Host ""
  Write-Host "CampusGrade $Version is running at https://$(Get-SiteAddress)"
} catch {
  Write-Host "Deploy failed: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $NoRollback -and $previous -and $previous -ne $Version) {
    Write-Host "Rolling back to $previous ..." -ForegroundColor Yellow
    try {
      Start-Version $previous
      Write-Host "Rolled back to $previous." -ForegroundColor Yellow
    } catch {
      Write-Host "Rollback also failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  exit 1
}
