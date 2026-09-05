# SAUL local demo runbook

SAUL is the Security Assurance & Understanding Layer. It is an evidence
investigator, not legal advice, a formal certification, or a guarantee of
accuracy. The bundled AcmePay case is entirely synthetic.

## Verified local environment

- macOS with Python 3.14.2 (the application supports Python 3.10 or newer)
- FastAPI 0.116.1
- Pydantic 2.13.5
- Uvicorn 0.35.0
- HTTPX 0.28.1
- python-dotenv 1.1.1

The exact direct dependency versions are pinned in `backend/requirements.txt`.

## Backend

From the repository root:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# Fill server-side credentials in .env locally.
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Server environment names (never put their values in the frontend or Git):

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `DATABASE_PATH` (optional)
- `PRISMTRACE_HOST`
- `PRISMTRACE_PROJECT_ID`
- `PRISMTRACE_API_KEY`
- `REGODIT_MODE`

`LLM_BASE_URL` must be an operator-validated OpenAI-compatible base ending at
the provider's `/v1` level as applicable. Confirm the configured model ID and
chat-completions request format in that provider's documentation before the
demo. Missing model variables leave health/case storage available and make
investigation return `503 MODEL_NOT_CONFIGURED`; no canned verdict replaces the
model.

By default SQLite is created at
`backend/data/bettercallsaul.sqlite3`. A relative `DATABASE_PATH` is resolved
from `backend/`, not from the shell's current directory. The store enables WAL,
creates its tables at import/startup, and keeps immutable case revisions.

## Frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Keep both Uvicorn on port 8000 and Vite on port 5173 running. The Vite
development proxy supplies `/api`; a production frontend build alone does not
run the API.

## Sponsor setup

### PRISM

The implementation follows the official HTTP documentation at
<https://blockconvey.com/docs>:

- host: `https://prism.blockconvey.com`
- ingest: `POST /api/traces`
- authentication: `X-PRISMtrace-Key`
- required payload fields: `project_id`, `model`, `input_messages`,
  `output_message`, and `latency_ms`
- SAUL also sends case `session_id`, stable `trace_id`, `agent_id: "saul"`,
  evidence IDs, pre-call statuses, a deterministic compliance-gate result,
  and a category-only PII-access audit (never raw detected values)

Set the three `PRISMTRACE_*` variables, run a genuine investigation, and open
the PRISM Traces dashboard to confirm the returned trace reference. Delivery
has a short timeout and does not block a valid questionnaire update. Failed or
unconfigured payloads remain in SQLite for a later investigation retry.
The frontend prevents investigations while the model is unconfigured. For each
completed model exchange, the backend validates schema, question coverage,
exact citations, and semantic guardrails before applying any output. PRISM
receives the pass/fail result, review requirement, output-release decision, and
PII category audit in trace metadata.
PRISM's HTTP trace records exchanges; it is not an automatic SDK trajectory and
its evaluator output is not a formal security certification.

No PRISM credentials were present during implementation, so no genuine
dashboard trace or evaluator result is claimed in this handoff.

### Regodit

The public product page is not an API specification. No sponsor API/import
instructions or supported account workflow were supplied, so API mode is
intentionally unavailable rather than guessed.

After the operator confirms a supported manual Regodit UI workflow, set
`REGODIT_MODE=manual`. The JSON export includes `regoditPacket`, with the case
revision, descriptive local controls (explicitly unmapped), scoped facts,
company citations, testimony, gaps, conflicts, and superseded history. The
operator must actually create/upload the evidence in Regodit and then submit
the real reference to the manual receipt action in SAUL. That produces
`manual_recorded` and is labeled operator-recorded, not API verified. Merely
downloading the packet does not complete the integration.

Regodit remains an outstanding mandatory sponsor dependency until that access
and workflow are supplied and rehearsed.

## Demo rehearsal

1. Open the frontend and create a seeded `AcmePay` case.
2. Run Investigate. Confirm:
   - Q2 and Q3 cite the scoped production configuration.
   - Q1 remains conflicted because policy requires MFA while the current
     `legacy-deploy` account has MFA disabled.
   - Q8 remains unknown.
3. Select Q4 and answer its current follow-up in order: `Yes`, `Daily`, `Yes`.
   Use a new stable client message ID for each turn. Refresh and confirm all
   three employee facts remain and Q4 is employee-confirmed.
4. Send the explicit Q4 correction `Weekly, not daily` with no reply-to ID.
   Confirm the old Daily fact is inactive and the Weekly fact supersedes it.
5. For Q8 answer `I don't know`. Confirm its slot becomes deferred and is not
   immediately asked again.
6. For Q1, the statement `legacy-deploy was disabled` remains employee
   testimony and does not resolve the configuration conflict.
7. Upload `backend/demo/mfa-remediation.json` as:
   - name: `MFA remediation configuration export`
   - kind: `configuration`
   - scope: `Google Workspace, GitHub, and every human AWS production account`
   - observed at: `2026-09-05T13:00:00Z`
8. Run Investigate again. Confirm the matching newer configuration resolves
   Q1, updates Q6, and preserves the earlier source and resolved conflict.
9. Confirm a real PRISM trace in its dashboard. Complete the confirmed Regodit
   workflow and record its real external reference.
10. Export CSV and JSON. CSV must contain all eight rows and is blocked whenever
    evidence still needs investigation. JSON remains available for recovery and
    includes source/fact/conflict history plus the Regodit packet.

## Current limitations

- One local operator and one backend process; employee names/roles are
  self-reported demo attribution, not authentication.
- Text evidence only (`.txt`, `.md`, `.json`, `.csv` read as UTF-8 by the UI);
  no PDF, OCR, DOCX, or XLSX parsing.
- Lexical ranking is used for the bounded corpus; the full bounded corpus is
  still sent so top-k ranking cannot hide contradictory evidence.
- Semantic validation reduces demonstrated unsupported-citation, policy versus
  enforcement, scope, and conflict-resolution failures. It does not
  mathematically eliminate model error.
- Genuine model, PRISM, and Regodit behavior depends on operator-supplied
  server credentials and confirmed sponsor access. Missing access is shown
  honestly rather than simulated.
