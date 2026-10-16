# CampusGrade

CampusGrade is a local FastAPI, React, and PostgreSQL application for assignment authoring, submissions, evaluation, and grading.

## Local setup

Requirements: Python 3.10–3.12, `uv`, Node.js, npm, and PostgreSQL.

### 1. Create the PostgreSQL database

Use an existing local PostgreSQL server, or create a project-local development cluster on port `5433` (the current `.env.example` default):

```bash
mkdir -p .local
/usr/lib/postgresql/18/bin/initdb -D .local/postgres \
  --username=campusgrade --auth-local=trust --auth-host=trust
/usr/lib/postgresql/18/bin/pg_ctl -D .local/postgres \
  -l .local/postgres.log -o "-p 5433 -h 127.0.0.1 -k /tmp" start
/usr/lib/postgresql/18/bin/createdb -h 127.0.0.1 -p 5433 \
  -U campusgrade campusgrade_db
```

The trust authentication above is limited to this loopback-only development server. Do not use it for a shared or production database. If PostgreSQL is installed in another versioned directory, replace `/usr/lib/postgresql/18/bin` with the output of `pg_config --bindir`.

### 2. Install backend dependencies and migrate

From the project root:

```bash
uv sync
cd backend
uv run --project .. alembic upgrade head
```

To create the local test administrator:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@campusgrade.dev \
BOOTSTRAP_ADMIN_PASSWORD='CampusGradeTestAdmin2026!' \
BOOTSTRAP_ADMIN_NAME='CampusGrade Test Admin' \
uv run --project .. python bootstrap_admin.py
```

### 3. Start the backend

From `backend/`:

```bash
uv run --project .. python main.py
```

The API runs at `http://localhost:5001`. Redis is optional in local development; repository analysis falls back to FastAPI background tasks when Redis is unavailable.

### 4. Start the frontend

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5174`. Vite proxies `/api` requests to the backend on port `5001`.

## Azure OpenAI assignment drafts

To enable the separate AI Draft Studio, add the following values to `backend/.env` (or the process environment) and restart the backend:

```dotenv
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com
AZURE_OPENAI_API_KEY=YOUR_AZURE_OPENAI_KEY
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
AZURE_OPENAI_API_VERSION=2024-10-21
```

`AZURE_OPENAI_DEPLOYMENT` is the deployment name created in Azure AI Foundry, not the underlying model name. The backend sends requests to Azure's deployment-based chat-completions endpoint using the `api-key` header. Keep the key out of source control.

## Repository synchronization

Students link one public GitHub repository per assignment. After pushing commits, the student selects **Update repository** on the assignment page. CampusGrade archives and analyzes that exact commit, and the teacher portal reflects it after processing. Teachers freeze the latest synchronized commit when evaluation starts; any still-live repositories freeze at the deadline.

Run the RQ assignment worker in production so immutable repository analysis is not performed by an API process.

## Checks

```bash
uv run --group dev --project . pytest -q backend/tests
cd frontend && npm run lint && npm run build
```
