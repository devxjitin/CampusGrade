# Backend FastAPI (PostgreSQL)

This backend now runs as native FastAPI on PostgreSQL (no Flask bridge, no MongoDB runtime).

## Files

- `app.py`: FastAPI entrypoint (`app` ASGI object).
- `main.py`: Optional runner for `python main.py`.
- `routes_fastapi/admin_settings.py`: Assignment audit-log routes.
- `routes_fastapi/auth_routes.py`: Email-only sign-in, token refresh and logout.
- `routes_fastapi/assignment_routes.py`: Assignment creation, submission, grading, and analytics.
- `routes_fastapi/user_routes.py`: Account profile, preferences, and session routes.
- `models/database.py` + `models/sql_models.py`: PostgreSQL connection and SQL models.
- `models/auth_store.py`: PostgreSQL-backed user repository.

## Run

```bash
python app.py
```

Or:

```bash
python main.py
```

Set `FASTAPI_RELOAD=true` for local auto-reload.

Set `DATABASE_URL` to enable PostgreSQL-backed persistence.

