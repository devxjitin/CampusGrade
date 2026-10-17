#!/bin/sh
# Linux/macOS twin of scripts/deploy.ps1 (same steps, same behaviour).
#
#   scripts/deploy.sh v0.1.0
#   NO_PULL=1 scripts/deploy.sh local-test     # locally built images
set -eu

VERSION="${1:?usage: scripts/deploy.sh <version, e.g. v0.1.0>}"
ENV_FILE="${ENV_FILE:-.env.prod}"
cd "$(dirname "$0")/.."
STATE_FILE=".deployed-version"

for name in secret_key postgres_password database_url private_s3_secret_key github_token; do
  [ -f "secrets/$name.txt" ] || { echo "Missing secrets/$name.txt (run scripts/init-secrets.ps1 or create the files)." >&2; exit 1; }
done
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE; copying .env.prod.example"; cp .env.prod.example "$ENV_FILE"; }

site="$(sed -n 's/^[[:space:]]*SITE_ADDRESS[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | head -n1)"
site="${site:-campusgrade.localhost}"

compose() { docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.prod.yaml "$@"; }

smoke() {
  for path in /api/ready /login; do
    ok=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsSk --max-time 15 --resolve "$site:443:127.0.0.1" "https://$site$path" -o /dev/null; then ok=1; break; fi
      sleep 3
    done
    [ "$ok" = 1 ] || { echo "Smoke test failed: https://$site$path" >&2; return 1; }
    echo "smoke ok  https://$site$path"
  done
}

start() {
  export CAMPUSGRADE_VERSION="$1"
  if [ "${NO_PULL:-0}" = 1 ]; then export CAMPUSGRADE_PULL_POLICY=never; else export CAMPUSGRADE_PULL_POLICY=always; compose pull --quiet --ignore-buildable; fi
  compose build --quiet backup
  # Back up (database + files) before the new migrations run, when upgrading.
  if [ "${2:-}" = backup ]; then echo "Backing up before migrating ..."; compose run --rm -T backup once; fi
  compose up -d --wait --remove-orphans
  smoke
  printf '%s' "$1" > "$STATE_FILE"
  echo "$1" >> .deployed-history
}

previous=""
[ -f "$STATE_FILE" ] && previous="$(cat "$STATE_FILE")"
echo "Deploying CampusGrade $VERSION (previous: ${previous:-none})"
do_backup=""
[ -n "$previous" ] && [ "${NO_BACKUP:-0}" != 1 ] && do_backup=backup
if start "$VERSION" "$do_backup"; then
  echo "CampusGrade $VERSION is running at https://$site"
else
  echo "Deploy failed." >&2
  if [ -n "$previous" ] && [ "$previous" != "$VERSION" ] && [ "${NO_ROLLBACK:-0}" != 1 ]; then
    echo "Rolling back to $previous ..." >&2
    start "$previous" && echo "Rolled back to $previous." >&2
  fi
  exit 1
fi
