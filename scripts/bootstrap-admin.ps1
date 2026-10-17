<#
.SYNOPSIS
  Creates the first Super Admin in the running production stack.

.DESCRIPTION
  Prompts for the email (accounts have no passwords; sign-in is by email only).
  Run once per environment; it refuses to create a second account with the same email.

.EXAMPLE
  scripts\bootstrap-admin.ps1
  scripts\bootstrap-admin.ps1 -Email principal@college.edu
#>
param(
  [string]$Email = "",
  [string]$Name = "CampusGrade Administrator",
  [string]$EnvFile = ".env.prod"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Email) { $Email = Read-Host "Admin email" }

if (-not $env:CAMPUSGRADE_VERSION) {
  $stateFile = Join-Path $root ".deployed-version"
  if (-not (Test-Path $stateFile)) { throw "Nothing is deployed yet. Run scripts\deploy.ps1 first." }
  $env:CAMPUSGRADE_VERSION = (Get-Content $stateFile -Raw).Trim()
}
$env:CAMPUSGRADE_PULL_POLICY = "never"
$env:BOOTSTRAP_ADMIN_EMAIL = $Email
$env:BOOTSTRAP_ADMIN_NAME = $Name
try {
  docker compose --env-file $EnvFile -f compose.yaml -f compose.prod.yaml run --rm -T `
    -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_NAME `
    api python bootstrap_admin.py
} finally {
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
}
