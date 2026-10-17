#!/bin/sh
# CI check for S3-11: seed -> back up -> wipe -> restore -> data matches.
# Runs against the production-like stack that is already up (compose.prod.yaml).
set -eu
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.prod}"
export CAMPUSGRADE_VERSION="${CAMPUSGRADE_VERSION:-ci}"
compose() { docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.prod.yaml -f compose.ci.yaml "$@"; }
sql() { compose exec -T postgres psql -U campusgrade -d campusgrade_db -tAc "$1"; }
s3() { compose run --rm -T --entrypoint python3 backup -c "$1"; }

S3_PRELUDE='
import boto3, os
from botocore.config import Config
c = boto3.client("s3", endpoint_url=os.environ["PRIVATE_S3_ENDPOINT"], region_name="us-east-1",
    aws_access_key_id=os.environ["PRIVATE_S3_ACCESS_KEY"],
    aws_secret_access_key=open("/run/secrets/private_s3_secret_key").read().strip(),
    config=Config(s3={"addressing_style": "path"}))
B = os.environ["PRIVATE_S3_BUCKET"]
'

echo "== seed"
s3 "$S3_PRELUDE
c.put_object(Bucket=B, Key='attachments/ci/restore-check.txt', Body=b'restore-check')"
users_before="$(sql 'select count(*) from users')"
[ "$users_before" -ge 1 ] || { echo "expected at least one user to exist" >&2; exit 1; }

echo "== back up"
compose run --rm -T backup once
backup="$(ls -1 "${BACKUP_DIR:-./backups}" | grep -v partial | tail -n 1)"
echo "backup folder: $backup"

echo "== wipe"
compose stop web api worker
compose exec -T postgres psql -U campusgrade -d campusgrade_db -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
s3 "$S3_PRELUDE
c.delete_object(Bucket=B, Key='attachments/ci/restore-check.txt')"

echo "== restore"
compose run --rm -T backup restore --from "$backup"
compose up -d --wait

echo "== verify"
users_after="$(sql 'select count(*) from users')"
[ "$users_before" = "$users_after" ] || { echo "users: $users_before before, $users_after after" >&2; exit 1; }
s3 "$S3_PRELUDE
body = c.get_object(Bucket=B, Key='attachments/ci/restore-check.txt')['Body'].read()
assert body == b'restore-check', body
print('restored object matches')"
echo "backup/restore round trip OK ($users_after users)"
