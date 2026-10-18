# Track Log

Is file me is project ke saare AI-assisted changes log hote hain.
Format: [YYYY-MM-DD HH:MM] [Claude/Gemini/Codex] [short line]
Naye entries neeche add hote hain. Purani lines edit mat karo.

---

[2026-10-17 18:26] [Claude] [Fix: rollover ab repeating/on_leave students ko carry karta hai, enrol preview jaisa]
[2026-10-17 18:26] [Claude] [Fix: academic session delete ab current/data wale session par 409 deta hai]
[2026-10-17 18:26] [Claude] [Add: test_session_rollover.py (rollover carry-over + delete guard tests)]
[2026-10-17 18:29] [Claude] [Add: migration 029 unique index, ek hi current academic session]
[2026-10-17 18:29] [Claude] [Fix: rollover execute row lock, double-run/populated-target 409, undo flush order]
[2026-10-17 18:29] [Claude] [Update: rollover tests ke liye double-execute + single-current checks]
[2026-10-17 18:45] [Claude] [Fix: rollover undo cached fields revert, sirf run ke enrollments, latest-run guard]
[2026-10-17 18:45] [Claude] [Refactor: rollover plan/execute bulk queries, fixed query count; migration 030 enrollment tag]
[2026-10-17 21:17] [Claude] [Remove: subject auto-enrol (rollover + add-student), UI preview card aur label]
[2026-10-17 22:06] [Claude] [Add: admin role (replaces program_admin) with per-area view/edit/full access set by Super Admin]
[2026-10-17 22:06] [Claude] [Fix: only Super Admin can edit/delete admin accounts or promote roles]
[2026-10-17 22:06] [Claude] [Update: migration 031 dev DB par applied, frontend nav/accounts UI/proxy access-aware]
[2026-10-17 22:33] [Claude] [Remove: saare passwords; sign-in sirf email se, APP_ENV=production refuse]
[2026-10-17 22:33] [Claude] [Remove: forgot/reset/change password, temp passwords, reset emails, password columns (migration 032)]
[2026-10-17 22:33] [Claude] [Update: login UI, settings, admin pages, e2e, scripts, docs email-only]
[2026-10-18 06:58] [Claude] [Add: backend/seed_dev.py demo data (3 programs, 6 teachers, 54 students) seeded in dev DB]
[2026-10-18 07:00] [Claude] [Fix: seed_dev.py now fills teachers' assignments so courses show in UI]
[2026-10-18 07:13] [Claude] [Update: UI polish - motion, shared StatTile/IconAction/table styles, students+teachers tables, dashboard grid]
[2026-10-18 07:15] [Claude] [Fix: date range filter bars misaligned; add shared DateField]
[2026-10-18 07:18] [Claude] [Fix: header and sidebar top bar same height and border colour]
[2026-10-18 07:27] [Claude] [Update: defer GitHub extraction to deadline or teacher evaluation start; one final job per student]
[2026-10-18 07:44] [Claude] [Add: create-assignment context gate (program>batch>section>subject), strict teacher allocation check, context-options API]
[2026-10-18 07:49] [Claude] [Add: AI prompt API takes IDs, builds names server-side, signed draft_ref; stepper dialog]
[2026-10-18 07:55] [Claude] [Add: strict AI proposal validation (/validate, per-field errors, signed draft token); removed silent rescale import]
[2026-10-18 08:20] [Claude] [Fix: AI JSON paste tolerates invalid backslash escapes and raw newlines in strings]
