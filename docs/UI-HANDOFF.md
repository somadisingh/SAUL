# BetterCallSaul frontend handoff

## Start and build

From the repository root, with the FastAPI backend already running on `127.0.0.1:8000`:

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Production typecheck/build:

```bash
cd frontend
npm ci
npm run build
```

Vite proxies relative `/api` requests to `http://127.0.0.1:8000`. `VITE_API_BASE_URL` is supported as an optional, nonsecret API prefix override. No server-side keys belong in frontend environment files.

## Files owned by Person 2

- `frontend/**`
- `docs/UI-HANDOFF.md`

No backend, frozen contract, prompt, README, or root manifest files were changed.

## API routes used

- `GET /api/health`
- `GET /api/cases`
- `POST /api/cases`
- `GET /api/cases/{id}`
- `POST /api/cases/{id}/sources`
- `POST /api/cases/{id}/questionnaire`
- `POST /api/cases/{id}/investigate`
- `POST /api/cases/{id}/messages`
- `GET /api/cases/{id}/export?format=csv`
- `GET /api/cases/{id}/export?format=json`
- `POST /api/cases/{id}/integrations/regodit`

Investigation and message requests use a 75-second client timeout. All mutations replace the in-memory case with the returned full snapshot, except Regodit submission, after which the UI refetches the case. Exports are fetched as blobs so error envelopes can be displayed before any download begins.

## Working live flow

1. Start the backend and frontend, then load the fictional AcmePay demo or open an existing backend case. The active case ID is restored after refresh; a missing saved case is cleared only on a 404.
2. Run **Investigate evidence**. While evidence review is in progress, case mutations are disabled and the UI shows no invented percentage or streaming steps.
3. Select a question in the left sidebar. The centre panel shows the scoped answer, status, human-readable provenance, missing slots, conflicts, and citations. Selecting a citation opens the stored source and highlights the exact quote with text segments.
4. Use the right interview panel for the selected question. Name and role are editable, self-reported demo attribution. A reply sends the current follow-up ID; Correction mode sends `null`. Failed attempts keep the draft and retry with the same `clientMessageId`.
5. If a message call times out or fails after persistence, the UI refetches the case. When the returned messages contain the pending `clientMessageId`, the UI reports that testimony was saved and directs the operator to investigate again instead of resending.
6. Use **Upload / import** for UTF-8 `.txt`, `.md`, `.json`, or `.csv` evidence. Observation time remains blank unless supplied. Questionnaire CSV/JSON import is enabled only for a blank case and checked for the 12-question limit and unique nonempty IDs.
7. The Questionnaire view retains every row, including partial, conflicted, and unknown answers. CSV stays disabled while `needsInvestigation` is true; JSON remains available for recovery and manual sponsor work.
8. The Integrations view displays only server receipt state, messages, references, safe HTTP(S) links, and timestamps. API/manual Regodit controls follow health mode. Manual recording requires an operator acknowledgement and real reference after submission inside Regodit.

## Verification performed

- `npm run build` passes with TypeScript and Vite.
- The disconnected-backend screen was checked in a browser and exposes a Retry action without destroying a saved case ID.
- The UI was run against the backend from remote branch `soma` at commit `117524f` without modifying its files.
- Live case creation returned all eight seeded unknown questions; the 1366×768 three-panel layout, questionnaire table, seeded/nonempty questionnaire lockout, paste-text source upload, audit receipt, and status counts were checked.
- A correction was sent while the model was unconfigured. The backend saved it before returning 503; the frontend refetched, matched its `clientMessageId`, prevented a duplicate retry, and retained the message after a full browser refresh.
- JSON export returned HTTP 200 through the Vite proxy. CSV correctly remained unavailable while investigation was required.
- PRISM and Regodit both displayed their actual `not_configured` receipts as **Setup required**, never as successful delivery.

## Remaining integration dependencies

The checked backend reported `modelConfigured: false`, `prismConfigured: false`, and `regoditMode: "unconfigured"`. Therefore model-produced citations/conflicts, the exact-quote click after a completed investigation, the three-step backup follow-up, CSV after investigation, and genuine sponsor delivery could not be completed locally. These paths are implemented against the frozen contract but require Person 1's server-side model and sponsor configuration for final rehearsal.

Mock mode was not used or implemented. Backend failures never substitute mock answers.
