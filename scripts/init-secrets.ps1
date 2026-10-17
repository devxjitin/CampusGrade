<#
.SYNOPSIS
  Generates the Docker secret files in ./secrets (never committed to git).

.DESCRIPTION
  Creates strong random values for every secret the stack needs. Existing files
  are kept unless -Force is given, so re-running is safe. Rotating a database or
  storage password on an existing deployment needs extra steps; see docs/runbook.md.

.EXAMPLE
  scripts\init-secrets.ps1
  scripts\init-secrets.ps1 -GithubToken ghp_xxx
#>
param(
  [string]$GithubToken = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "secrets"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function New-RandomSecret([int]$Bytes = 48) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  # URL-safe alphabet: no characters that need escaping in a database URL.
  return ([Convert]::ToBase64String($buffer)).Replace("+", "A").Replace("/", "B").Replace("=", "")
}

# Write without a trailing newline and without a BOM: containers read these verbatim.
function Write-Secret([string]$Name, [string]$Value) {
  $path = Join-Path $dir "$Name.txt"
  if ((Test-Path $path) -and -not $Force) {
    Write-Host "kept     $Name.txt"
    return
  }
  [System.IO.File]::WriteAllText($path, $Value, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "created  $Name.txt"
}

$postgresPassword = $null
$postgresFile = Join-Path $dir "postgres_password.txt"
if ((Test-Path $postgresFile) -and -not $Force) {
  $postgresPassword = [System.IO.File]::ReadAllText($postgresFile)
} else {
  $postgresPassword = New-RandomSecret 32
}

Write-Secret "secret_key" (New-RandomSecret 48)
Write-Secret "postgres_password" $postgresPassword
Write-Secret "database_url" "postgresql+psycopg://campusgrade:$postgresPassword@postgres:5432/campusgrade_db"
Write-Secret "private_s3_secret_key" (New-RandomSecret 32)

# The GitHub token is optional (unauthenticated GitHub requests are heavily rate limited).
$tokenPath = Join-Path $dir "github_token.txt"
if ($GithubToken) {
  [System.IO.File]::WriteAllText($tokenPath, $GithubToken, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "created  github_token.txt"
} elseif (-not (Test-Path $tokenPath)) {
  [System.IO.File]::WriteAllText($tokenPath, "", (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "created  github_token.txt (empty - set it later with -GithubToken)"
} else {
  Write-Host "kept     github_token.txt"
}

# The SMTP password is optional too (leave it empty until SMTP_HOST is set in .env.prod).
$smtpPath = Join-Path $dir "smtp_password.txt"
if (-not (Test-Path $smtpPath)) {
  [System.IO.File]::WriteAllText($smtpPath, "", (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "created  smtp_password.txt (empty - fill it in when you configure SMTP)"
} else {
  Write-Host "kept     smtp_password.txt"
}

Write-Host ""
Write-Host "Secrets are in $dir (git-ignored). Back this folder up somewhere safe:"
Write-Host "losing secret_key signs every user out; losing the database password locks you out of the data."
