# CampusGrade local setup script (Windows / PowerShell)
# Run from the repo root: powershell -ExecutionPolicy Bypass -File setup.ps1
#
# What this does:
#   1. Checks for / installs PostgreSQL via winget
#   2. Creates the campusgrade DB role and database (matching backend/.env)
#   3. Installs backend deps with uv and runs Alembic migrations
#   4. Installs frontend deps with npm
#
# Safe to re-run: DB creation and migrations are idempotent.

$ErrorActionPreference = "Stop"

$PgUser = "canvasgrade"
$PgPassword = "canvas-postgres-local-password"
$PgDb = "canvasgrade_db"
$PgPort = 5433

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
Write-Step "Checking for PostgreSQL"

$pgBin = $null
$candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
if ($candidates) {
    $pgBin = Join-Path $candidates[0].FullName "bin"
}

if (-not $pgBin -or -not (Test-Path (Join-Path $pgBin "psql.exe"))) {
    Write-Host "PostgreSQL not found. Installing via winget (unattended, superuser password set to 'postgres')..."
    winget install --id PostgreSQL.PostgreSQL --silent --accept-package-agreements --accept-source-agreements `
        --override "--unattendedmodeui minimal --mode unattended --superpassword postgres --servicename postgresql-x64 --serverport $PgPort"
    Start-Sleep -Seconds 8
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    if (-not $candidates) {
        Write-Host "Could not find PostgreSQL install after winget. Install it manually from https://www.postgresql.org/download/windows/ then re-run this script." -ForegroundColor Red
        exit 1
    }
    $pgBin = Join-Path $candidates[0].FullName "bin"
}

Write-Host "Using PostgreSQL binaries at $pgBin"

# ---------------------------------------------------------------------------
Write-Step "Checking PostgreSQL service is running"

$service = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service) {
    if ($service.Status -ne "Running") {
        Start-Service $service.Name
    }
    Write-Host "Service '$($service.Name)' is running."
} else {
    Write-Host "No PostgreSQL Windows service found. If you installed manually, make sure the server is running on port $PgPort before continuing." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
Write-Step "Detecting which port PostgreSQL is actually listening on"

$psql = Join-Path $pgBin "psql.exe"
$env:PGPASSWORD = "2005"  # your PostgreSQL superuser password

$actualPort = $null
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
foreach ($tryPort in @($PgPort, 5432)) {
    & $psql -U postgres -h 127.0.0.1 -p $tryPort -tAc "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $actualPort = $tryPort
        break
    }
}
$ErrorActionPreference = $prevEap

if (-not $actualPort) {
    Write-Host "Could not connect to PostgreSQL on port $PgPort or 5432 as user 'postgres'." -ForegroundColor Red
    Write-Host "If your existing install uses a different superuser password, set it below and re-run:" -ForegroundColor Yellow
    Write-Host '  $env:PGPASSWORD = "your-actual-postgres-password"' -ForegroundColor Yellow
    exit 1
}

if ($actualPort -ne $PgPort) {
    Write-Host "PostgreSQL is listening on port $actualPort, not $PgPort (the port backend/.env expects)." -ForegroundColor Yellow
    Write-Host "Updating backend/.env to use port $actualPort instead." -ForegroundColor Yellow
    $envPath = "backend\.env"
    (Get-Content $envPath) -replace ':5433/', ":$actualPort/" | Set-Content $envPath
    $PgPort = $actualPort
}

# ---------------------------------------------------------------------------
Write-Step "Creating role and database (skips if they already exist)"

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$checkRole = & $psql -U postgres -h 127.0.0.1 -p $PgPort -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PgUser'" 2>$null
if ($checkRole -ne "1") {
    & $psql -U postgres -h 127.0.0.1 -p $PgPort -c "CREATE USER $PgUser WITH PASSWORD '$PgPassword' SUPERUSER;"
} else {
    Write-Host "Role '$PgUser' already exists."
}

$checkDb = & $psql -U postgres -h 127.0.0.1 -p $PgPort -tAc "SELECT 1 FROM pg_database WHERE datname='$PgDb'" 2>$null
if ($checkDb -ne "1") {
    & $psql -U postgres -h 127.0.0.1 -p $PgPort -c "CREATE DATABASE $PgDb OWNER $PgUser;"
} else {
    Write-Host "Database '$PgDb' already exists."
}

$ErrorActionPreference = $prevEap
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
Write-Step "Installing backend dependencies (uv sync)"
uv sync

Write-Step "Running Alembic migrations"
Push-Location backend
uv run alembic upgrade head
Pop-Location

# ---------------------------------------------------------------------------
Write-Step "Installing frontend dependencies (npm install)"
Push-Location frontend
npm install
Pop-Location

# ---------------------------------------------------------------------------
Write-Step "Done"
Write-Host "Start the backend:  cd backend; python app.py"
Write-Host "Start the frontend: cd frontend; npm run dev"
