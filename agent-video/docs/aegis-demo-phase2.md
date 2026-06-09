# AEGIS demo — Phase 2 (CritiX Admin multi-page tour)

Phase 1 demos the **teacher Playground** at `http://localhost:5333` with no login.
Phase 2 targets the **CritiX Admin** panel at `http://localhost:5173` with multiple
URL routes.

## URLs (from `admin-panel/src/App.jsx`)

| Route | Purpose |
|-------|---------|
| `/login` | Admin sign-in |
| `/dashboard` | Overview |
| `/users` | User management |
| `/submissions` | Submission list |
| `/security` | Email whitelist |
| `/rubrix` | CritiX ↔ RubriX integration |

Manifest entries live in [`aegis-demo.json`](../aegis-demo.json) under `phase2.pages`.

## Credentials

Admin username and password are created during `./quickstart.sh` and stored locally in:

```
/Users/youwen/Projects/AEGIS/evalguide_client/.aegis/state.env
```

Never commit this file. Load credentials at runtime only when implementing Phase 2 automation.

## Pipeline status (post Phase 1.5)

Phase 1.5 added an **action-capable, scene-based** pipeline (see
[`agent-video/README.md`](../README.md) "Scenes & actions"). The pipeline can now:

- Click, type, fill, press, and `find` elements by role/text/placeholder
- Re-snapshot after each scene's actions (narration grounds on the post-action state)
- `enableAccessibility` to unlock the Flutter semantics tree
- `waitFor` / `wait` for async results in the trimmed inter-scene gap (no audio desync)
- `reuseTab` to advance state on the same URL without reloading

So login form fill and tab clicks are no longer blocked by the pipeline. The remaining Phase 2
work is mostly **credentials + verification**, not new primitives:

1. **Login scene** — `entryActions` that `find` the email/password fields and `fill` + submit
   on `:5173`, then `waitFor` the dashboard. Load credentials at runtime (never commit them).
2. **`agent-browser` auth vault** — optionally persist session cookies after one login so
   later routes skip re-auth.
3. **Per-route scenes** — `/dashboard`, `/security`, `/rubrix` as additional scenes (each a
   navigation `entryAction` or a fresh `url`), narrated in one recording.
4. **`run_demo_actions` MCP tool** — already available to script/verify a route's actions
   before recording.

## RubriX Admin

RubriX Admin runs at `http://localhost:5174/admin/` (sibling repo). Same login
blockers apply. Include in Phase 2 only after CritiX Admin flow is solved.
