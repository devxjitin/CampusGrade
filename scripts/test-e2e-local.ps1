<#
.SYNOPSIS
  Builds both images and runs the whole Playwright suite against a throwaway production-like stack
  in Docker Desktop. This is the local replacement for the CI "stack" job.

.DESCRIPTION
  1. Builds the api and web images (tag :ci).
  2. Stops the running campusgrade stack (if any). Your data is kept: the containers are only stopped.
  3. Starts a separate stack (project "cgtest") on its own volumes with Mailpit, creates test accounts
     with random passwords, and runs every Playwright spec (login, session, password reset, external-AI
     evaluation, axe accessibility and 360 px checks).
  4. Tears the test stack down (including its volumes) and starts your stack again.

  Needs Docker Desktop, Node (for Playwright) and `npx playwright install chromium` once.
  Takes about 5 minutes. Use -SkipBuild to reuse images from the last run, -Spec to run one file.

.EXAMPLE
  scripts\test-e2e-local.ps1
  scripts\test-e2e-local.ps1 -SkipBuild -Spec e2e/password-reset.spec.ts
#>
param(
  [switch]$SkipBuild,
  [string]$Spec = "",
  [string]$EnvFile = ".env.prod"
)

# Docker writes progress to stderr, which Windows PowerShell 5.1 turns into errors under "Stop".
# Native commands are checked through $LASTEXITCODE instead, so cleanup always runs.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function New-Password { "E2e-" + [guid]::NewGuid().ToString("N").Substring(0, 16) + "!x9" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed or not on PATH." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop and try again." }
if (-not (Test-Path $EnvFile)) { Copy-Item ".env.prod.example" $EnvFile }
foreach ($name in "secret_key", "postgres_password", "database_url", "private_s3_secret_key", "github_token", "smtp_password") {
  $path = Join-Path $root "secrets\$name.txt"
  if (-not (Test-Path $path)) {
    if ($name -in "github_token", "smtp_password") { [System.IO.File]::WriteAllText($path, "", (New-Object System.Text.UTF8Encoding($false))) }
    else { throw "Missing secrets\$name.txt. Run scripts\init-secrets.ps1 first." }
  }
}

$registry = "ghcr.io/devxjitin"
$override = Join-Path $root ".local-throwaway.yaml"
$backups = Join-Path $root ".local-test-backups"
$env:CAMPUSGRADE_VERSION = "ci"
$env:CAMPUSGRADE_PULL_POLICY = "never"
$env:BACKUP_DIR = "./.local-test-backups"

if (-not $SkipBuild) {
  Write-Host "=== Building images" -ForegroundColor Cyan
  docker build -q -f backend/Dockerfile -t "$registry/campusgrade-api:ci" .
  if ($LASTEXITCODE -ne 0) { throw "api image build failed" }
  docker build -q -f frontend/Dockerfile -t "$registry/campusgrade-web:ci" .
  if ($LASTEXITCODE -ne 0) { throw "web image build failed" }
}

@"
# Written by scripts\test-e2e-local.ps1 and deleted afterwards: separate volumes so nothing touches real data.
volumes:
  postgres_data:
    name: cgtest_postgres
  storage_data:
    name: cgtest_storage
  caddy_data:
    name: cgtest_caddy
"@ | Set-Content -Path $override -Encoding utf8
New-Item -ItemType Directory -Force -Path $backups | Out-Null

function Invoke-Test-Compose {
  docker compose -p cgtest --env-file $EnvFile -f compose.yaml -f compose.prod.yaml -f compose.ci.yaml -f $override @args
}

$previous = @(docker ps -q --filter "label=com.docker.compose.project=campusgrade")
$exit = 1
try {
  if ($previous.Count -gt 0) {
    Write-Host "=== Stopping your running stack ($($previous.Count) containers; data is kept)" -ForegroundColor Cyan
    docker stop $previous | Out-Null
  }

  Write-Host "=== Starting the test stack" -ForegroundColor Cyan
  Invoke-Test-Compose up -d --wait
  if ($LASTEXITCODE -ne 0) { throw "The test stack did not become healthy." }

  $adminPassword = New-Password
  $resetPassword = New-Password
  $seedPassword = New-Password
  Invoke-Test-Compose run --rm -T -e BOOTSTRAP_ADMIN_EMAIL=e2e-admin@campusgrade.dev -e "BOOTSTRAP_ADMIN_PASSWORD=$adminPassword" api python bootstrap_admin.py
  if ($LASTEXITCODE -ne 0) { throw "Creating the admin account failed." }
  Invoke-Test-Compose run --rm -T -e BOOTSTRAP_ADMIN_EMAIL=e2e-reset@campusgrade.dev -e "BOOTSTRAP_ADMIN_PASSWORD=$resetPassword" api python bootstrap_admin.py
  if ($LASTEXITCODE -ne 0) { throw "Creating the reset account failed." }
  Invoke-Test-Compose run --rm -T -e "E2E_SEED_PASSWORD=$seedPassword" api python seed_e2e.py
  if ($LASTEXITCODE -ne 0) { throw "Seeding the test fixtures failed." }

  Write-Host "=== Running Playwright" -ForegroundColor Cyan
  $env:E2E_BASE_URL = "https://campusgrade.localhost"
  $env:E2E_SUPER_ADMIN_EMAIL = "e2e-admin@campusgrade.dev"
  $env:E2E_SUPER_ADMIN_PASSWORD = $adminPassword
  $env:E2E_RESET_EMAIL = "e2e-reset@campusgrade.dev"
  $env:E2E_RESET_PASSWORD = $resetPassword
  $env:E2E_SEED_PASSWORD = $seedPassword
  Push-Location (Join-Path $root "frontend")
  try {
    if ($Spec) { npx playwright test $Spec --workers=2 } else { npx playwright test --workers=2 }
    $exit = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  Write-Host "=== Tearing down the test stack" -ForegroundColor Cyan
  Invoke-Test-Compose down -v 2>&1 | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $override
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $backups
  if ($previous.Count -gt 0) {
    Write-Host "=== Restarting your stack" -ForegroundColor Cyan
    docker start $previous | Out-Null
    Write-Host "(your stack is starting; give it about 30 seconds)"
  }
}

if ($exit -eq 0) { Write-Host "All end-to-end tests passed." -ForegroundColor Green } else { Write-Host "End-to-end tests failed (exit $exit)." -ForegroundColor Red }
exit $exit
