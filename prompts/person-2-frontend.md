# Copy everything below into Person 2's coding agent

You are implementing the frontend for **BetterCallSaul**, a two-person, two-hour hackathon. Build the interface now, not another plan. Person 1 independently owns the Python backend, AI, memory, sponsor integrations, sample data, and final merge. You own the React application and frontend handoff. Do not spawn additional agents unless I explicitly request them.

## Start and boundaries

Repository: https://github.com/somadisingh/bettercallsaul

Read `README.md` and **all of `docs/CONTRACT.md`** before writing code. Implement its exact JSON fields, routes, statuses, timeouts, upload constraints, and interaction semantics. If needed clone this repository into a local workspace. Inspect existing files and applicable instructions; preserve existing changes. Use a separate clone from Person 1. Start from current main and create/use `build/frontend`.

Own only `frontend/**` and `docs/UI-HANDOFF.md`. Do not modify backend, README, the frozen contract, prompt files, or root manifests/lockfiles. Create the app in frontend/, never over the repository root. Do not invent alternate routes. Do not wait for the backend before building against the contract. Commit only your files and push build/frontend at minutes 25, 45, and 80. Person 1 performs the final merge and push to main; do not compete for main or force push.

We have 120 minutes. Deliver a usable live interface by minute 65, a production build by minute 80, then help integrate and rehearse. Skip automated tests, test framework setup, E2E tooling, and elaborate animations. Typecheck/build and manually use the product in a browser.

## Stack and setup

Use React + TypeScript + Vite with ordinary CSS and optionally lucide-react for icons. Minimal dependencies; no UI-library setup or Tailwind configuration unless already present and working. Create separate frontend package.json and lockfile. Configure Vite port 5173 and proxy `/api` to `http://127.0.0.1:8000`. Calls use relative `/api`; optional `VITE_API_BASE_URL` is a nonsecret override only. No model or sponsor keys in browser code.

Use a small structure:

```text
frontend/
  package.json
  package-lock.json
  index.html
  vite.config.ts
  tsconfig.json
  src/main.tsx
  src/App.tsx
  src/types.ts
  src/api.ts
  src/styles.css
  src/components/CaseSidebar.tsx
  src/components/QuestionDetail.tsx
  src/components/InterviewPanel.tsx
  src/components/EvidenceDrawer.tsx
  src/components/QuestionnaireTable.tsx
  src/components/UploadDialog.tsx
  src/components/IntegrationsPanel.tsx
docs/UI-HANDOFF.md
```

Copy the wire types from the contract into types.ts without changing names. One API client handles JSON/error envelopes, per-request timeouts, and response checks. JSON exports/CSV use fetch-to-Blob so failures can be shown, then trigger a download and revoke object URLs. Do not use localStorage as the actual security profile; persist only activeCaseId and optional demo employee identity. Always fetch the case from the backend after reload.

For early layout you may use a hardcoded contract-valid snapshot behind explicit `VITE_DEMO_MODE=true`. Show a permanent “UI mock — not a live investigation” banner. Default is live mode. Backend failures must never silently trigger mock results. Do not commit any credential or claim mock events were sent to sponsors.

## Design direction

Build a polished investigation workspace, not a marketing landing page. Original BetterCallSaul wordmark, warm off-white paper panels, dark charcoal text/sidebar, muted burgundy accent, small amber/red/green status chips with text. A briefcase or simple initials are sufficient branding. No actor photograph, voice clone, TV footage, or asset download needed. Keep Saul's personality to concise empty states and messages; questionnaire answers remain professional.

Desktop layout: a compact top bar, 260px question sidebar, central answer/evidence panel, and 340px employee interview panel. At narrower widths use tabs/panels without clipping. A top-level view switch exposes Investigation, Questionnaire, and Integrations; no routing package needed. App must work at a laptop presentation resolution around 1366×768 with sensible internal scrolling.

All statistics derive from the current server snapshot. Show counts of verified, user-confirmed, partial, conflicted, and unknown. Do not call a percentage a compliance score. Status colors describe evidence state, not a certification or security pass. Every important state has a text label, keyboard-accessible control, loading indicator, and recoverable error message.

## Work sequence

### Minutes 0–25: scaffold and first live case

1. Create Vite app and types/API client. Health request indicates backend availability and model configuration without blocking case inspection.
2. Empty state offers “Load AcmePay demo” (`POST /cases` seedDemo true) and “Create blank case” (seedDemo false). Reuse existing cases through the case list; do not seed a new case on every reload.
3. Persist activeCaseId. On startup fetch it; if 404 clear it and return to case selection. Network failure shows Retry without destroying the saved ID.
4. Render the three-panel workspace using actual Question/Source fields. Select Q1 initially if present, otherwise first question. Handle an empty question list.
5. Push the first frontend checkpoint. If the local backend is not available, explicitly report the connection state and continue UI development; do not invent an API.

### Minutes 25–45: investigation, evidence, and table

“Investigate evidence” calls the case investigate endpoint. Disable case mutations and show “Saul is reviewing the evidence…” while waiting. No fake streaming steps or progress percentages. Use the 75-second client timeout; once complete replace the entire snapshot from the response.

When needsInvestigation is true, show “Evidence changed — investigate again.” Existing answers remain inspectable but are visibly pending review; disable CSV export until re-investigated. Show unknown states before the first run instead of creating optimistic answers.

Sidebar lists question text, status, and open-conflict indicator. Sort next-action suggestions by priority and ID. Clicking a question selects its answer and interview context.

Central panel contains the exact question, scoped answer, readable status/provenance, missing facts, open/resolved conflicts, and source citations. An EvidenceDrawer opens the cited Source by ID and shows source name, kind, scope, observed date or “Date not supplied,” author where relevant, and full text. Highlight the **exact quote** using text segments; do not render untrusted HTML or use dangerouslySetInnerHTML. Show citations from both sides of a conflict. Employee sources must say “Employee statement.”

Questionnaire view is a real table of all current rows with question, answer, status, evidence count, and remaining action. Row selection opens its investigation. Partial, conflicted, and unknown answers use the needs-confirmation provenance label. Render every question, including unknowns.

### Minutes 45–65: employee conversation and uploads

InterviewPanel shows only messages for selected questionId, while the profile stays shared on the backend. Display current followUp text and reason if present. Avoid duplicating it when it already exists in messages; match IDs/text according to returned data. Do not append assistant messages merely because React rendered again.

Employee name and role are required input before sending, with a visible note that this is demo attribution. Use configurable defaults such as Alex / Engineering for speed but never imply authenticated identity. Message payload includes selected questionId, text, employeeName, employeeRole, current followUp.id or null, and crypto.randomUUID() clientMessageId. “Correction” mode sends null for replyToFollowUpId with the selected question. Tell the user to enter a complete correction.

Keep unsent text if the request fails. On timeout/502/503 refetch the case: the server may have saved the message before the AI failed. Match the pending clientMessageId against returned messages to identify an already-saved reply; avoid submitting a duplicate. If saved, offer re-investigation rather than sending again. A Retry of an unsaved attempt reuses its clientMessageId. On stale follow-up 409, refetch and show the updated question before resending. Disable sends during any case mutation; do not let switching questions change the payload of an already initiated send.

Use the returned case to display newly learned frequency/automation and next follow-up. Do not implement your own response generator, status promotion, “Yes means daily” inference, or question-selection logic beyond the contract queue. “I don't know” is an ordinary employee message; backend handles deferral. If followUp is null, allow an explicit correction but do not invent a next question.

UploadDialog supports UTF-8 `.txt`, `.md`, `.json`, `.csv` and a paste-text field. Read as text with FileReader/file.text, gather name, source kind, scope, and optional observedAt (null when unknown), then POST /sources. Browser checks match backend limits; error text names supported formats. Default source kind should require meaningful selection or use message with an obvious label; do not label every uploaded document authoritative configuration. Never auto-fill observation date with upload date.

On blank cases, import questionnaire CSV/JSON via its contract endpoint, sending original content and selected format. In seeded/nonempty cases, disable replacement and explain that a new blank case is needed. No PDF/DOCX/XLSX support claims. For the demo remediation upload the operator selects backend/demo/mfa-remediation.json and supplies its stated scope/observation date.

### Minutes 65–80: sponsor actions, exports, polish

IntegrationsPanel reads the two receipt objects from the case. Show each actual state, message, reference and attempt/success timestamps. A configured key is not a successful sync. PRISM emits automatically server-side; provide a safe link to the dashboard when no deep link is supplied, clearly labeled dashboard. Do not invent trace detail paths or platform scores.

Regodit offers the contract's API submission action only when health reports API mode. If mode manual, offer JSON packet download and a small form to record an actual submission reference plus optional URL **after the operator has submitted inside Regodit**. Label success “Manual submission recorded.” Missing access states say setup required and never display green synced status. Validate link URLs as http(s), use noopener/noreferrer, and display a server-supplied reference as plain text if no verified URL exists. After sponsor mutation refetch the case.

CSV and JSON export actions fetch the correct endpoints and use the returned downloads. Present CSV failures, especially needsInvestigation 409. JSON stays available for manual sponsor work and recovery. Use filenames containing case ID; do not make the frontend regenerate a different version of the answers.

Render an audit-history section from server events, including corrections and conflict resolution, without claiming it is tamper-proof. If time allows, make source panels and table filters nicer; do not add voice, animations, authentication, or another workflow.

## Integration and manual verification

By minute 80 commit and push build/frontend. Write docs/UI-HANDOFF.md with start/build commands, files owned, API routes used, any unresolved mismatch, whether mock mode was used, and the exact working live flow. Include no secrets. Person 1 will fetch and merge your branch. For local live verification, you may read/fetch backend code from their branch and run it after saving your work, but never overwrite or modify their backend files; ask Person 1 to fix backend issues. Continue to push frontend fixes only.

Run `npm run build` and fix TypeScript/build errors. Manually check backend disconnected, loading investigation, source quote click, unknown question, conflict view, three backup replies, refresh, correction, source upload, export, and real receipt display. These are manual checks, not a request to create test files.

The final demo runs Vite on 5173 with its API proxy and FastAPI on 8000. A static dist folder without a backend is not a deployed product. Preserve the dev server for presentation. Freeze features at minute 110 and help rehearse the README's three-minute narrative.

End with branch/commit, frontend startup command, build result, actual live features, and remaining dependency issues. Never report sponsor integration success or AI accuracy based on mock data.
