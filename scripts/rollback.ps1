<#
.SYNOPSIS
  Redeploys the version that ran before the current one.

.DESCRIPTION
  Reads .deployed-history (one version per successful deploy, newest last) and
  runs deploy.ps1 for the entry before the current one, without taking a new
  backup. The database schema is NOT downgraded: migrations are written to stay
  compatible with the previous release (expand -> migrate -> contract), so the
  older code runs on the newer schema. If a release contained a contract
  migration (dropped a table or column) and the old code needs it, restore the
  pre-deploy backup instead:  scripts\restore.ps1 -From <backup folder>

.EXAMPLE
  scripts\rollback.ps1
  scripts\rollback.ps1 -To v0.2.0
#>
param(
  [string]$To,
  [string]$EnvFile = ".env.prod",
  [switch]$NoPull
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$historyFile = Join-Path $root ".deployed-history"
if (-not $To) {
  if (-not (Test-Path $historyFile)) { throw "No deploy history (.deployed-history); pass -To <version>." }
  $history = @(Get-Content $historyFile | Where-Object { $_ })
  $current = $history[-1]
  $older = @($history | Where-Object { $_ -ne $current })
  if ($older.Count -eq 0) { throw "No earlier version in .deployed-history; pass -To <version>." }
  $To = $older[-1]
  Write-Host "Rolling back $current -> $To"
}

& "$PSScriptRoot\deploy.ps1" -Version $To -EnvFile $EnvFile -NoBackup -NoRollback -NoPull:$NoPull
exit $LASTEXITCODE
