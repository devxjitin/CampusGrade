<#
.SYNOPSIS
  Restores a backup made by the `backup` service.

.DESCRIPTION
  -From is a backup folder name (e.g. 20261017-020000) inside BACKUP_DIR, or a full
  path to one. Without -ScratchDb this REPLACES the live database and all stored
  files with the backup: api, worker and web are stopped, the data restored, and
  the stack started again. With -ScratchDb <name> only the database is restored,
  into a separate database of that name, and nothing else is touched (use it to
  inspect last night's data safely).

.EXAMPLE
  scripts\restore.ps1 -From 20261017-020000 -ScratchDb restore_check
  scripts\restore.ps1 -From D:\CampusGradeBackups\20261017-020000
#>
param(
  [Parameter(Mandatory = $true)][string]$From,
  [string]$ScratchDb,
  [string]$EnvFile = ".env.prod",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:CAMPUSGRADE_VERSION) {
  $stateFile = Join-Path $root ".deployed-version"
  $env:CAMPUSGRADE_VERSION = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { "restore" }
}

function Invoke-Compose([string[]]$ComposeArgs) {
  & docker compose --env-file $EnvFile -f compose.yaml -f compose.prod.yaml @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed (exit $LASTEXITCODE)" }
}

# A full path points BACKUP_DIR at the folder's parent; a bare name is looked up in BACKUP_DIR.
$backupName = $From
if (Test-Path -LiteralPath $From) {
  $full = (Resolve-Path -LiteralPath $From).Path.TrimEnd("\")
  $backupName = Split-Path -Leaf $full
  $env:BACKUP_DIR = Split-Path -Parent $full   # overrides BACKUP_DIR from the env file
}

Invoke-Compose @("build", "--quiet", "backup")

if ($ScratchDb) {
  Invoke-Compose @("run", "--rm", "-T", "backup", "restore", "--from", $backupName, "--db", $ScratchDb)
  Write-Host "Restored into database '$ScratchDb'. Inspect it with:"
  Write-Host "  docker compose --env-file $EnvFile -f compose.yaml -f compose.prod.yaml exec postgres psql -U campusgrade -d $ScratchDb"
  exit 0
}

if (-not $Yes) {
  $answer = Read-Host "This replaces ALL current data with backup $backupName. Type 'restore' to continue"
  if ($answer -ne "restore") { Write-Host "Cancelled."; exit 1 }
}

Write-Host "Stopping web, api and worker ..."
Invoke-Compose @("stop", "web", "api", "worker")
Invoke-Compose @("run", "--rm", "-T", "backup", "restore", "--from", $backupName)
Write-Host "Starting the stack ..."
Invoke-Compose @("up", "-d", "--wait")
Write-Host "Restore complete."
