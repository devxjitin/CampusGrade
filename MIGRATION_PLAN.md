# CampusGrade Migration Plan

Target stack:

- **Backend:** FastAPI + PostgreSQL + SQLAlchemy + Alembic *(already in place)*
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS + TanStack Query

> **No pgvector / no internal AI.** CampusGrade's AI is entirely **external and human-in-the-loop**: the app *generates a prompt / exports a repository bundle*, a person takes it to an outside AI, and *pastes the result back* to be validated and saved. There is no internal embedding model, no RAG, no semantic search, and no vector database. So there is **nothing to build with pgvector** — the earlier Phase 5 (pgvector for Agentic AI / RAG / semantic search) is removed, and Phase 5 is now the port + verification of the existing external-AI evaluation workflow. Similarity/plagiarism detection stays as it is today: deterministic **code-fingerprint** comparison in `services/github_repository_service.py`, not embeddings.

Strategy chosen: **incremental (strangler)** migration, App Router, new Next.js app replaces `frontend/` in the same repo, old app kept as `frontend-legacy/` until cutover.

---

## 1. What actually changes

The important realization up front: **your backend is already the target stack.** FastAPI + PostgreSQL + SQLAlchemy + Alembic is what you run today. So this is **not a backend rewrite** — it is a frontend rewrite. And because the AI is external, there is **no new AI/data infrastructure to add either** (no pgvector, no embeddings). The backend is essentially unchanged.

| Area | Today | Target | Effort |
|------|-------|--------|--------|
| Backend framework | FastAPI | FastAPI | none (keep) |
| DB + ORM + migrations | PostgreSQL + SQLAlchemy + Alembic | same | none (keep) |
| AI | external, human-in-the-loop (prompt out → paste result in) | same | none (keep) |
| Similarity / plagiarism | code-fingerprint comparison | same | none (keep) |
| Frontend framework | React 18 + Vite 7 (SPA) | Next.js (App Router) | **large** |
| Language | JavaScript (JSX) | TypeScript | **large** |
| Styling | Tailwind 3 | Tailwind (unchanged) | small (config port) |
| Data fetching | 98 hand-written axios functions in `services/api.js` (564 lines); **TanStack Query is installed but unused** | TanStack Query hooks | **large (net-new adoption)** |
| Routing | `react-router-dom` v6, all routes in `App.jsx` | App Router file-based routing | **medium** |

So the bulk of the work is: rewrite ~21 pages from JSX to TSX under Next.js, wrap the axios layer in TanStack Query, add types, and re-do auth for a framework that renders on the server.

---

## 2. Current state audit (facts the plan relies on)

**Frontend (`frontend/`)**

- React 18, Vite 7, `react-router-dom` 6, Tailwind 3, axios, `@tanstack/react-query` (installed, **not used** — no `useQuery`/`useMutation`/`QueryClient` anywhere).
- 21 page components in `src/pages/` (flat, not nested by feature).
- Single axios instance in `src/services/api.js`: attaches bearer token from `localStorage`, transparently refreshes on 401 via `/auth/refresh` (deduped with a shared promise), normalizes FastAPI `{detail}` errors onto `.message`.
- Auth state lives in `localStorage` (`campusgrade_token`, `campusgrade_user`) — read by `components/ProtectedRoute.jsx` and the axios layer. No global store (zustand is a dep but unused for auth).
- Routing + role guards centralized in `App.jsx` (`<ProtectedRoute allowedRoles={[...]}>`). Menu structure/role visibility is separate, in `routes/navigation.js`.
- Heavy client-only libraries in use: `@monaco-editor/react` + `monaco-editor`, `mermaid`, `recharts`, `framer-motion`, `jspdf` / `jspdf-autotable`. These need `ssr: false` / dynamic import under Next.js.
- Dev proxy: Vite rewrites `/api/*` → `http://127.0.0.1:5001/*` (strips `/api`). Env base is `VITE_API_URL` (default `/api`).

**Backend (`backend/`)**

- FastAPI ASGI `app` in `app.py`; routers: `auth_routes`, `user_routes`, `notification_routes`, `institution_routes`, `assignment_routes` (~1900 lines, central), `admin/` package (mounted under `/admin`), plus older `admin_routes.py` / `admin_settings.py`, and an `exam/` package.
- JWT auth in `routes_fastapi/deps.py`; short-lived access tokens + refresh-session (`sid`) + `session_version` for server-side revocation. Refresh endpoint is cookie-capable (`withCredentials: true` on the client).
- Two SQLAlchemy layers coexist: sync `engine`/`SessionLocal` (most code + Alembic) and async `async_engine`/`get_db()` (intended for new code).
- Alembic config in `backend/alembic.ini`, live scripts in `backend/migrations/` — **`backend/alembic/` is a stale leftover** and should be removed as housekeeping.
- AI is external and human-in-the-loop (see the note under the target stack). `ai/assignment_ai.py` extracts document text and helps *draft* an external-AI prompt; grading itself happens outside the app and results are pasted back. No embeddings, no vector store.
- Python pin: `>=3.10,<3.13`.

---

## 3. Target folder & project structure

Repo stays a single repository with backend and frontend side by side. During migration both frontends exist; after cutover only `frontend/` (Next.js) remains.

**During migration:**

```
CampusGrade/
├── backend/                     # UNCHANGED — no new files, no schema/AI additions
│   ├── app.py
│   ├── main.py
│   ├── alembic.ini
│   ├── migrations/              # live Alembic scripts (keep)
│   ├── models/                  # sql_models.py, assignment.py (unchanged)
│   ├── routes_fastapi/          # incl. existing external-AI evaluation endpoints
│   ├── services/                # incl. github_repository_service (code-fingerprint similarity)
│   ├── ai/                      # assignment_ai.py — external-prompt drafting only
│   └── tests/
├── frontend-legacy/             # the current Vite app, renamed, kept running
│   └── (unchanged src/)
├── frontend/                    # NEW Next.js app (becomes the only frontend at cutover)
│   ├── app/                     # App Router
│   ├── components/
│   ├── lib/
│   ├── hooks/
│   ├── types/
│   ├── next.config.mjs
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── package.json
├── CLAUDE.md
└── MIGRATION_PLAN.md
```

**Next.js internal structure (target):**

```
frontend/
├── app/
│   ├── layout.tsx               # root layout, providers (TanStack Query, Toast, ConfirmDialog)
│   ├── globals.css              # Tailwind entry
│   ├── login/page.tsx
│   ├── (dashboard)/             # route group: shared DashboardLayout chrome
│   │   ├── layout.tsx           # sidebar/topbar; role-aware nav
│   │   ├── assignments/
│   │   │   ├── page.tsx
│   │   │   ├── create/page.tsx
│   │   │   ├── records/page.tsx
│   │   │   ├── [id]/page.tsx
│   │   │   ├── [id]/edit/page.tsx
│   │   │   ├── [id]/review/page.tsx
│   │   │   ├── [id]/workspace/page.tsx
│   │   │   └── admin/[id]/page.tsx
│   │   ├── admin/
│   │   │   ├── students/page.tsx
│   │   │   ├── teachers/page.tsx
│   │   │   ├── users/[userId]/page.tsx
│   │   │   ├── departments/page.tsx
│   │   │   ├── programs/page.tsx
│   │   │   ├── batches/page.tsx
│   │   │   ├── sections/page.tsx
│   │   │   ├── subjects/page.tsx
│   │   │   └── audit-log/page.tsx
│   │   ├── profile/page.tsx
│   │   └── settings/page.tsx
│   └── not-found.tsx
├── components/                  # ported UI: Dialog, Toast, MarkdownPreview, etc.
│   └── ui/
├── hooks/                       # TanStack Query hooks (useAssignments, useProfile, ...)
├── lib/
│   ├── api.ts                   # fetch/axios client (token + refresh + error normalize)
│   ├── auth.ts                  # session helpers
│   └── query-client.ts          # QueryClient factory
├── types/
│   └── api.d.ts                 # generated from FastAPI OpenAPI schema
├── middleware.ts                # route protection (role/session gate)
├── next.config.mjs              # rewrites /api → FastAPI; transpile/allow client libs
├── tsconfig.json
├── tailwind.config.ts
└── package.json
```

**Route mapping (react-router → App Router):**

| Current path | Component | App Router file |
|---|---|---|
| `/login` | Login | `app/login/page.tsx` |
| `/assignments` | AssignmentDashboard | `app/(dashboard)/assignments/page.tsx` |
| `/assignments/create` | CreateAssignment | `app/(dashboard)/assignments/create/page.tsx` |
| `/assignments/records` | AssignmentRecords | `app/(dashboard)/assignments/records/page.tsx` |
| `/assignments/:id` | StudentAssignmentDetail | `app/(dashboard)/assignments/[id]/page.tsx` |
| `/assignments/:id/edit` | CreateAssignment | `app/(dashboard)/assignments/[id]/edit/page.tsx` |
| `/assignments/:id/review` | AssignmentReview | `app/(dashboard)/assignments/[id]/review/page.tsx` |
| `/assignments/:id/workspace` | AssignmentWorkspace | `app/(dashboard)/assignments/[id]/workspace/page.tsx` |
| `/assignments/admin/:id` | AdminAssignmentDetail | `app/(dashboard)/assignments/admin/[id]/page.tsx` |
| `/admin/*` | Admin* pages | `app/(dashboard)/admin/*/page.tsx` |
| `/profile`, `/settings` | Profile, Settings | `app/(dashboard)/profile,settings/page.tsx` |
| `*` | NotFound | `app/not-found.tsx` |

Views currently driven by an `initialView` prop (e.g. `AssignmentDashboard initialView="subjects"`) become either real sub-routes or a `?view=` search param handled in the page.

---

## 4. Guiding principles

1. **Backend stays live and unchanged in shape.** Both frontends talk to the same FastAPI API. No breaking API changes during the migration; additions only.
2. **Pre-compat files remain.** The current app is renamed to `frontend-legacy/` and keeps running until every page is ported and verified. Nothing in `frontend-legacy/` is deleted until the cutover step. The old `VITE_API_URL` behavior is preserved there.
3. **Strangler pattern.** Port page-by-page. A reverse proxy (or Next.js rewrites) can route already-migrated paths to Next.js and the rest to the legacy app if you want an overlapping live period; otherwise run them on separate ports and flip DNS/proxy at cutover.
4. **Types from the source of truth.** Generate TypeScript types from FastAPI's OpenAPI schema (`/openapi.json`) with `openapi-typescript`, rather than hand-writing them — they stay correct as Pydantic models change.
5. **The external-AI workflow is preserved exactly.** Prompt generation, repo-bundle export, proposal/evaluation import, validation and save are ported to Next.js unchanged in behavior. No AI logic moves into the frontend, and no internal AI/vector infrastructure is introduced.

---

## 5. Phased implementation

### Phase 0 — Preparation (0.5 day)

- [ ] Create a long-lived `migration/nextjs` branch.
- [ ] Rename `frontend/` → `frontend-legacy/`; confirm it still builds/runs (`npm run dev`, `npm run build`).
- [ ] Update any repo scripts/`CLAUDE.md` references that point at `frontend/`.
- [ ] Housekeeping: delete the stale `backend/alembic/` directory (live scripts are in `backend/migrations/`). Confirm `alembic upgrade head` still resolves.
- [ ] Confirm FastAPI serves `/openapi.json` (it does by default) — needed for type generation.

### Phase 1 — Backend readiness (0.5 day)

No stack change and no new AI/vector work; just the couple of enablers the new frontend needs.

- [ ] Ensure CORS `ALLOWED_ORIGINS` includes the Next.js dev origin (`http://localhost:3000`) alongside the legacy `5174`.
- [ ] Decide the auth transport for SSR (see §6). Recommended: make `/auth/refresh` (and login) able to set an **httpOnly refresh cookie**; keep the existing `localStorage` access-token flow working for `frontend-legacy/`.
- [ ] No API contract changes. The external-AI endpoints (`/teacher-tools/external-ai-prompt`, `/teacher-tools/external-ai-proposal/import`, `/teacher/{id}/external-evaluation/{export,validate,save-evaluations}`) stay exactly as they are.

### Phase 2 — Next.js scaffold alongside (1 day)

- [ ] Scaffold new `frontend/` (Next.js App Router, TypeScript, Tailwind, ESLint).
- [ ] Port `tailwind.config.js` → `tailwind.config.ts` (keep the `primary-*` palette and existing tokens); port `index.css` → `app/globals.css`.
- [ ] `next.config.mjs`: add `rewrites()` mapping `/api/:path*` → `http://127.0.0.1:5001/:path*` to mirror the current Vite proxy; add `transpilePackages` / dynamic-import strategy for Monaco, mermaid.
- [ ] Env: introduce `NEXT_PUBLIC_API_URL` (default `/api`) replacing `VITE_API_URL`.
- [ ] Root `app/layout.tsx` with providers: TanStack Query `QueryClientProvider`, Toast, ConfirmDialog (port `ErrorBoundary`, `ToastProvider`, `ConfirmDialogProvider`).
- [ ] `npm run build` of the empty shell passes in CI.

### Phase 3 — Shared foundation (2–3 days)

- [ ] Generate `types/api.d.ts` from `/openapi.json` (`npx openapi-typescript http://localhost:5001/openapi.json -o types/api.d.ts`); add an npm script `gen:types`.
- [ ] Port `services/api.js` → `lib/api.ts` in TypeScript: bearer-token attach, single-flight refresh on 401, `{detail}`→`.message` normalization. Make it work in both client components and (where needed) server components/route handlers.
- [ ] Stand up TanStack Query properly (the missing piece today): a `hooks/` module wrapping the 98 API calls as `useQuery`/`useMutation` hooks, with query keys and cache invalidation. Migrate hooks lazily as each page needs them, not all at once.
- [ ] Port cross-cutting UI: `components/ui/*` (Dialog, ConfirmDialog), `Toast`, `MarkdownPreview`, `LoadingSkeleton`, `DateTimeFields`, `utils/datetime`, `content/labels`.
- [ ] Rebuild auth gating: `middleware.ts` + a client session hook replacing `ProtectedRoute` (role checks, must-change-password redirect, session-expired redirect).
- [ ] Port `layouts/DashboardLayout.jsx` → `app/(dashboard)/layout.tsx`; port `routes/navigation.js` → typed `lib/navigation.ts`.

### Phase 4 — Page-by-page migration (bulk of the work, ~2–4 weeks)

Port in dependency order, lowest-risk first. After each page: verify against `frontend-legacy/` behavior, wire its TanStack Query hooks, remove `any` where practical.

The external-AI pieces are **not a separate track** — they are UI that lives inside these teacher/admin pages. Port them like any other page here; Phase 5 then verifies the round-trip end to end.

Suggested order:

1. [ ] `Login` (validates auth end-to-end under Next.js). ✅ *done in the current pass*
2. [ ] `Profile`, `Settings` (simple, exercise sessions/preferences endpoints). ✅ *Profile done*
3. [ ] Admin CRUD pages: Departments, Programs, Batches, Sections, Subjects (repetitive, good for establishing the CRUD hook pattern).
4. [ ] Admin People: Students, Teachers, UserDetails, AuditLog.
5. [ ] Assignment core: Dashboard, CreateAssignment (+ edit — includes the **external-AI prompt generator + proposal import**), Records, StudentAssignmentDetail, StudentTeachers.
6. [ ] Assignment heavy/client-only: AssignmentReview (**includes `BulkExternalEvaluationDialog` — the export / paste-back / validate / save UI**), **AssignmentWorkspace** (Monaco editor — `dynamic(() => ..., { ssr: false })`), AdminAssignmentDetail.
7. [ ] `NotFound` → `not-found.tsx`.

Client-only libraries checklist per page: Monaco, mermaid → `ssr: false` dynamic import; recharts, framer-motion → mark files `"use client"`; jspdf → client-only handlers. The external-AI dialogs use `navigator.clipboard`, `Blob` download, and `FormData` — all client-only, so those components must be `"use client"` and never rendered on the server.

### Phase 5 — External-AI evaluation workflow: port verification & hardening (2–4 days)

Replaces the old pgvector phase. **Nothing is built on the backend** — this phase makes sure the human-in-the-loop external-AI round-trip that already exists still works, byte-for-byte, once it's running under Next.js. It is frontend-only and can start as soon as the Phase 4 pages that host these controls (CreateAssignment, AssignmentReview) are ported.

The four touch points to verify:

- [ ] **Prompt generation** — `generateExternalAIPrompt` posts **`multipart/form-data`** to `/teacher-tools/external-ai-prompt`. Confirm the FormData is built and sent correctly (Next.js/axios must not force a JSON content-type), the returned prompt renders, and copy-to-clipboard works.
- [ ] **Proposal import** — a teacher pastes the external AI's JSON back; `importExternalAIProposal` posts it to `/teacher-tools/external-ai-proposal/import`. Verify the fenced-code-block stripping (```` ```json ... ``` ````) and `JSON.parse` error handling behave as in `BulkExternalEvaluationDialog`/legacy.
- [ ] **Repository bundle export** — `exportAssignmentExternalEvaluation` returns the full-repo export the teacher hands to the external AI. Verify the text download (`Blob` + object URL) and clipboard copy work under Next.js.
- [ ] **Validate + save** — pasted evaluation JSON goes through `validateAssignmentExternalEvaluation` then `saveAssignmentExternalEvaluations`. Verify validation errors surface via the toast layer and a successful save invalidates the right TanStack Query keys so the grade view refreshes.

- [ ] End-to-end manual test: create an assignment with the AI prompt generator → export a submission bundle → (simulate the external AI) → paste a proposal/evaluation back → validate → save → confirm the grade appears. Do this side by side against `frontend-legacy/` and confirm identical results.
- [ ] Confirm the code-fingerprint **similarity/plagiarism** view (backend-computed, no change) still renders correctly on the ported AssignmentReview/AdminAssignmentDetail pages.

### Phase 6 — Cutover & decommission (1–2 days)

- [ ] Full QA parity pass: every route in the mapping table verified in Next.js against legacy, including the Phase 5 external-AI round-trip.
- [ ] Point the production proxy / hosting at the Next.js app; set prod `NEXT_PUBLIC_API_URL` and `ALLOWED_ORIGINS`.
- [ ] Soak period with quick rollback to `frontend-legacy/` available (backend is untouched, so rollback is just repointing the proxy).
- [ ] Delete `frontend-legacy/`; remove legacy-only backend auth branches if you fully moved to cookie sessions; update `CLAUDE.md` (frontend section now describes Next.js).

---

## 6. Key risks & decisions (read before Phase 3)

- **Auth + SSR is the sharpest edge.** Today the access token lives in `localStorage`, which does not exist during server rendering. Two options:
  - *(A) Keep it client-side* — mark authed pages/components `"use client"`, read token in the browser as today. Fastest, least backend change, but you forfeit most SSR benefits and `middleware.ts` can only see cookies, not `localStorage`.
  - *(B) Move to httpOnly cookies* (recommended long-term) — refresh/access via httpOnly cookies so `middleware.ts` and server components can authenticate. Requires the backend refresh/login endpoints to set cookies (the client already sends `withCredentials`). Do this behind a flag so `frontend-legacy/` keeps working.
- **TanStack Query is a genuine new adoption**, not a swap — budget for designing query keys, invalidation, and optimistic updates, not just find-and-replace.
- **Monaco / mermaid** must be dynamically imported with `ssr: false`; `AssignmentWorkspace` is the riskiest page.
- **`initialView` prop pattern** (Dashboard) must be re-expressed as routes or `?view=` params.
- **Type generation** depends on `/openapi.json` being complete; any loosely-typed FastAPI responses will surface as `unknown`/`any` and are worth tightening as you go.
- **Two coexisting frontends** means duplicated Tailwind config and shared assets (`public/krmu-logo-*.webp`) — copy assets into the new `frontend/public/`.
- **External-AI FormData** — `generateExternalAIPrompt` sends `multipart/form-data`. When axios is handed a `FormData` object it sets the boundary content-type itself; don't override it with a global JSON default, or the endpoint will reject the request. This is the one non-obvious gotcha in the external-AI port.

---

## 7. Rollback

Because `frontend-legacy/` is untouched and the backend contract is unchanged, rollback at any point before Phase 6 deletion is: repoint the proxy/host back to the legacy app. There is no backend schema or AI-infrastructure change anywhere in this plan, so a rollback is purely a frontend switch — nothing to migrate down.

---

## 8. Rough sequencing

| Phase | Scope | Est. |
|---|---|---|
| 0 | Prep, rename, housekeeping | 0.5 d |
| 1 | Backend readiness (CORS, auth transport) — no AI/vector work | 0.5 d |
| 2 | Next.js scaffold + Tailwind/config port | 1 d |
| 3 | API client, TanStack Query, types, auth gate, shared UI | 2–3 d |
| 4 | 21 pages ported (external-AI UI included) | 2–4 wk |
| 5 | External-AI evaluation round-trip: verify + harden | 2–4 d |
| 6 | Cutover + decommission | 1–2 d |

Phase 5 overlaps the tail of Phase 4 — it can begin as soon as CreateAssignment and AssignmentReview (the pages that host the external-AI controls) are ported. Removing the old pgvector phase takes ~1–2 weeks of backend work off the total.
