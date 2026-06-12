# AEGIS demo — Phase 2 (CritiX Admin multi-page tour)

Phase 1 demos the **teacher Playground** at `http://localhost:5333` with no login.
Phase 2 targets the **CritiX Admin** panel at `http://localhost:5173/admin/` with multiple
URL routes (Vite `VITE_BASE_PATH=/admin`).

## URLs

| Route | Purpose |
|-------|---------|
| `/admin/login` | Admin sign-in |
| `/admin/dashboard` | Overview |
| `/admin/users` | User management |
| `/admin/submissions` | Submission list |
| `/admin/security` | Security (Email Whitelist tab in demo) |
| `/admin/rubrix` | CritiX ↔ RubriX integration |

Manifest entries live in [`aegis-demo.json`](../aegis-demo.json) under `phase2.pages`.
Login `entryActions` are injected at runtime from credentials (never committed to JSON).

## Credentials

Admin username and password are created during `./quickstart.sh` and stored locally in:

```
/Users/youwen/Projects/AEGIS/evalguide_client/.aegis/state.env
```

Keys: `CRITIX_ADMIN_USERNAME`, `ADMIN_PASSWORD`.

Never commit this file. DemoClaw loads credentials via [`mcp-server/src/aegisCredentials.js`](../mcp-server/src/aegisCredentials.js).
Optional env overrides: `CRITIX_ADMIN_USERNAME`, `ADMIN_PASSWORD`.

## Run Phase 2

```bash
cd agent-video/mcp-server
AEGIS_DEMO_PHASE=2 npm run ensure-aegis   # probes :5173 (localhost, IPv6-safe)
npm run verify-phase2                   # login + sidebar nav smoke test
npm run aegis-demo:phase2               # standalone admin tour mp4
npm run aegis-demo:combined             # Playground grading + admin tour
```

Combined mode prepends the Phase 1.5 Playground scenes and a transition line, then runs the
admin tour with the same login injection.

## Verification

`npm run verify-phase2` exercises:

1. Login via `data-testid` selectors
2. Sidebar nav → Users, Submissions, Security (+ Email Whitelist tab via `clickName`), RubriX

Use the **`run_demo_actions`** MCP tool to debug a single scene's actions before recording.

## Auth vault (optional)

If headed recording loses session state between steps:

```bash
npm run setup-critix-admin-auth   # saves profile "critix-admin" in agent-browser
```

Then add `{ "type": "authLogin", "profile": "critix-admin" }` to a scene's `entryActions`
instead of manual fill/click (see [`actions.js`](../mcp-server/src/actions.js)).

## RubriX Admin

RubriX Admin runs at `http://localhost:5174/admin/` (sibling repo). Same login
blockers apply. Out of scope until CritiX Admin tour is stable.
