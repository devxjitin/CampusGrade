<#
.SYNOPSIS
  Makes this PC's browsers trust the local HTTPS certificate Caddy issues.

.DESCRIPTION
  With CADDY_TLS=internal (the default) Caddy signs the certificate for
  https://campusgrade.localhost with its own private certificate authority, which
  browsers don't know. This copies that CA's public certificate out of the proxy
  container and adds it to YOUR Windows user certificate store (no admin rights).
  Only run it on a machine you trust, and only for this local CA. Windows asks
  you to confirm the import. Restart the browser afterwards.

  Not needed when CADDY_TLS is an email address (real domain + Let's Encrypt).
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$out = Join-Path $root "caddy-local-root.crt"
docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml cp proxy:/data/caddy/pki/authorities/local/root.crt $out
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) {
  throw "Could not copy the CA certificate. Is the stack running (scripts\deploy.ps1)?"
}
Write-Host "Importing $out into your user 'Trusted Root Certification Authorities' store..."
certutil -user -addstore Root $out
Write-Host "Done. Restart your browser, then open https://campusgrade.localhost"
