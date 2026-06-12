# AEGIS accessibility and automation hooks

AEGIS web UIs expose stable identifiers for agentic automation (DemoClaw,
Playwright, `agent-browser`). Use **accessibility snapshots** (`role` + `name`)
for narration and scrolling; use **CSS selectors** for click/fill in Phase 2.

## Identifier conventions

| Surface | Prefix | DOM attribute |
|---------|--------|---------------|
| CritiX teacher UI (`:5333`) | `aegis-critix-` | `flt-semantics-identifier` |
| CritiX Admin (`:5173`) | `aegis-critix-admin-` | `data-testid` |
| RubriX frontend (`:3001`) | `aegis-rubrix-` | `data-testid` |
| RubriX Admin (`:5174/admin/`) | `aegis-rubrix-admin-` | `data-testid` |

Ref IDs from `agent-browser snapshot` (`@e1`, `@e13`, …) are **session-specific**.
Never hardcode them. Use `role` + `name` or the stable IDs below.

## CritiX Playground (`http://localhost:5333`)

| Control | `flt-semantics-identifier` | Snapshot name (label) |
|---------|---------------------------|------------------------|
| Playground shell | `aegis-critix-playground` | Playground |
| Question input | `aegis-critix-question-input` | Essay question (optional) |
| Essay input | `aegis-critix-essay-input` | Essay content |
| Grading Criteria | `aegis-critix-grading-criteria` | Grading Criteria |
| Upload Document | `aegis-critix-upload-document` | Upload Document |
| Submit / grade | `aegis-critix-submit-essay` | Submit essay for grading |
| Character count | `aegis-critix-character-count` | Character count |
| Results tabs container | `aegis-critix-results-tabs` | Results tabs |
| Statistics tab | `aegis-critix-tab-statistics` | Statistics |
| AI Writing tab | `aegis-critix-tab-ai-writing` | AI Writing |
| Plagiarism tab | `aegis-critix-tab-plagiarism` | Plagiarism |
| Assessment tab | `aegis-critix-tab-assessment` | Assessment |
| Grammar tab | `aegis-critix-tab-grammar` | Grammar |
| Summary tab | `aegis-critix-tab-summary` | Summary |
| Top nav: Playground | `aegis-critix-nav-playground` | Playground |
| Top nav: Database | `aegis-critix-nav-database` | Database |
| Sign In | `aegis-critix-sign-in` | Sign In |

### Rubric dialog

| Control | Identifier | Label |
|---------|------------|-------|
| Dialog | `aegis-critix-rubric-dialog` | Manage Rubrics |
| Search | `aegis-critix-rubric-search` | Search rubrics |
| Close | `aegis-critix-rubric-close` | Close rubric dialog |
| Rubric row | `aegis-critix-rubric-item-{id}` | (rubric name) |

### CSS selector examples (CritiX)

```bash
# Flutter web semantics nodes
agent-browser get box "[flt-semantics-identifier='aegis-critix-submit-essay']" --json
agent-browser get box "[flt-semantics-identifier='aegis-critix-grading-criteria']" --json
```

## CritiX Admin (`http://localhost:5173/admin/`)

| Control | `data-testid` |
|---------|---------------|
| Username | `aegis-critix-admin-login-username` |
| Password | `aegis-critix-admin-login-password` |
| Login button | `aegis-critix-admin-login-submit` |
| Main content (post-login) | `aegis-critix-admin-main-content` |
| Nav: Dashboard | `aegis-critix-admin-nav-dashboard` |
| Nav: Users | `aegis-critix-admin-nav-users` |
| Nav: Submissions | `aegis-critix-admin-nav-submissions` |
| Nav: Security | `aegis-critix-admin-nav-security` |
| Nav: RubriX | `aegis-critix-admin-nav-rubrix` |

```bash
agent-browser fill "[data-testid='aegis-critix-admin-login-username']" "admin"
agent-browser fill "[data-testid='aegis-critix-admin-login-password']" "$PASSWORD"
agent-browser click "[data-testid='aegis-critix-admin-login-submit']"
```

Security sub-tabs use accessible names (e.g. `clickName` **Email Whitelist** — emoji prefix
breaks plain `find text`).

## RubriX Assessment (`http://localhost:3001/playground`)

| Control | `data-testid` |
|---------|---------------|
| Rubric picker | `aegis-rubrix-rubric-select` |
| Model picker | `aegis-rubrix-model-select` |
| Essay question | `aegis-rubrix-essay-question` |
| Essay content | `aegis-rubrix-essay-content` |
| Evaluate button | `aegis-rubrix-evaluate-submit` |
| Results panel | `aegis-rubrix-results-panel` |

## RubriX Admin (`http://localhost:5174/admin/`)

| Control | `data-testid` |
|---------|---------------|
| Email | `aegis-rubrix-admin-login-username` |
| Password | `aegis-rubrix-admin-login-password` |
| Sign In | `aegis-rubrix-admin-login-submit` |
| Nav: Dashboard | `aegis-rubrix-admin-nav-dashboard` |
| Nav: Rubrics | `aegis-rubrix-admin-nav-rubrics` |

## Phase 2 `entryActions` sketch

```json
{
  "loginScene": true,
  "url": "http://localhost:5173/admin/login",
  "entryActions": []
}
```

Credentials are injected at runtime by `aegisCredentials.js` (not stored in JSON). Equivalent manual steps:

```json
{
  "entryActions": [
    { "type": "fill", "selector": "[data-testid='aegis-critix-admin-login-username']", "text": "<from-state.env>" },
    { "type": "fill", "selector": "[data-testid='aegis-critix-admin-login-password']", "text": "<from-state.env>" },
    { "type": "click", "selector": "[data-testid='aegis-critix-admin-login-submit']" },
    { "type": "waitFor", "selector": "[data-testid='aegis-critix-admin-main-content']", "timeoutMs": 45000 }
  ]
}
```

For CritiX Playground interactions after Phase 2 click support:

```json
{
  "preActions": [
    "click \"[flt-semantics-identifier='aegis-critix-grading-criteria']\"",
    "click \"[flt-semantics-identifier='aegis-critix-rubric-item-1']\"",
    "click \"[flt-semantics-identifier='aegis-critix-submit-essay']\""
  ]
}
```

## Verification

From the AEGIS repo:

```bash
./scripts/verify-a11y-hooks.sh
```

This builds all four web frontends in release mode and greps dist output for
expected hook strings.
