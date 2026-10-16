#!/bin/sh
set -e
echo "Applying database migrations..."
alembic upgrade head
if [ -n "$BOOTSTRAP_ADMIN_EMAIL" ] && [ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
  python bootstrap_admin.py || echo "Admin bootstrap skipped"
fi
exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-5001}"
