<#
.SYNOPSIS
  Runs all checks on this PC (there is no hosted CI).

.DESCRIPTION
  Backend:  ruff (whole backend), mypy, pytest
  Frontend: eslint, tsc, vitest, and optionally the production build
  Types:    api.d.ts freshness, when the API is running on localhost:5001

  Every step runs even if an earlier one fails, then a summary is printed. Exit code 1 if any
  step failed. pytest needs Docker (it starts a throwaway Postgres).

.EXAMPLE
  scripts\check-local.ps1            # everything except the production build
  scripts\check-local.ps1 -Quick     # skip pytest (fast loop while editing)
  scripts\check-local.ps1 -Build     # also run `npm run build`
#>
param(
  [switch]$Quick,
  [switch]$Build
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:SECRET_KEY) { $env:SECRET_KEY = "test-secret-of-at-least-thirty-two-characters-ok" }

$results = New-Object System.Collections.Generic.List[object]

function Invoke-Step([string]$Name, [scriptblock]$Action, [string]$WorkDir = $root) {
  Write-Host ""
  Write-Host "=== $Name" -ForegroundColor Cyan
  $started = Get-Date
  Push-Location $WorkDir
  try {
    $global:LASTEXITCODE = 0
    & $Action
    $ok = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $ok = $false
  } finally {
    Pop-Location
  }
  $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  $results.Add([pscustomobject]@{ Step = $Name; Result = $(if ($ok) { "pass" } else { "FAIL" }); Seconds = $seconds })
}

Invoke-Step "backend: ruff" { & uv run ruff check backend }
Invoke-Step "backend: mypy" { & uv run mypy }
if (-not $Quick) {
  Invoke-Step "backend: pytest" { & uv run pytest backend/tests -q }
} else {
  Write-Host "`n(skipping pytest: -Quick)" -ForegroundColor DarkGray
}

$frontend = Join-Path $root "frontend"
Invoke-Step "frontend: eslint" { & npm run lint } $frontend
Invoke-Step "frontend: tsc" { & npx tsc --noEmit } $frontend
Invoke-Step "frontend: vitest" { & npx vitest run --passWithNoTests } $frontend
if ($Build) { Invoke-Step "frontend: build" { & npm run build } $frontend }

# CI fails when src/types/api.d.ts differs from the backend's OpenAPI schema.
$apiUp = $false
try { $apiUp = ((Invoke-WebRequest -Uri "http://127.0.0.1:5001/ready" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) } catch { $apiUp = $false }
if ($apiUp) {
  Invoke-Step "types: api.d.ts is current" {
    & npm run gen:types --silent
    if ($LASTEXITCODE -eq 0) { & git diff --exit-code --quiet -- src/types/api.d.ts }
  } $frontend
} else {
  Write-Host "`n(skipping api.d.ts check: the API is not running on localhost:5001; start scripts\dev-local.ps1 to include it)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Summary" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($results | Where-Object { $_.Result -eq "FAIL" }) {
  Write-Host "Some checks failed. Fix them before pushing." -ForegroundColor Red
  exit 1
}
Write-Host "All checks passed. Safe to push." -ForegroundColor Green
