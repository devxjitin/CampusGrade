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
