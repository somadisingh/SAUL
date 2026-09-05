# Copy everything below into Person 1's coding agent

You are implementing the backend and final integration for **BetterCallSaul**, a two-person, two-hour hackathon build. Build the application now, not another plan. The teammate is independently implementing the React frontend. You own the Python API, AI investigator, SQLite memory, sample data, PRISM, Regodit, exports, and final branch integration. Do not spawn additional agents unless I explicitly request them.

## Start and boundaries

Repository: https://github.com/somadisingh/bettercallsaul

Read `README.md` and **all of `docs/CONTRACT.md`** first. Those files are authoritative for the wire contract and demo. If not already inside this repository, clone it into an appropriate local workspace. Inspect existing changes and applicable repository instructions before edits. Use a separate clone from the teammate. Start from current main and create/use `build/backend`; preserve any work already present.

Own only `backend/**`, `docs/RUNBOOK.md`, and root `.gitignore` if additions are necessary. Do not change the frozen contract, prompt files, frontend files, or root package configuration. The teammate owns `frontend/**` and `docs/UI-HANDOFF.md`. Create no root package.json. Do not scaffold over README. Commit only owned files and push `build/backend` incrementally; do not force push.

We have 120 minutes. By minute 25 the frontend must be able to load a real case. By minute 45 investigation must work. By minute 65 memory must work. Reserve minutes 80–120 for integration and rehearsal. Skip writing automated tests or a test framework. Run backend startup/import checks and manual API/browser smoke checks. Do not spend the build on infrastructure.

## Product rules

SAUL means Security Assurance & Understanding Layer. It is a professional investigator with occasional concise lines such as “The policy says required; enforcement still needs evidence.” It must never imply legal advice, real actor affiliation, formal certification, or a guarantee of accuracy. Use an original text-based identity.

The chatbot searches company documents and stored facts before asking an employee. It asks precise follow-ups, detects policy/configuration contradictions, records testimony persistently, avoids duplicate questions, accepts corrections, and exports a questionnaire. It must distinguish **verified company information**, **employee confirmation**, and **unknown / needs confirmation**. Negative controls can be verified if the evidence establishes “No.” Do not equate status with compliance.

## Implementation shape

Use FastAPI, Pydantic, uvicorn, python-dotenv, httpx, and standard-library sqlite3/csv/json/uuid. Avoid native database extensions, vector DBs, ORMs, LangChain/LangGraph, task queues, or model training. Use the installed Python >=3.10. Generate an installable requirements.txt and document the working versions after setup. Files can be organized as:

```text
backend/
  requirements.txt
  .env.example
  app/__init__.py
  app/main.py
  app/schemas.py
  app/store.py
  app/seed.py
  app/investigator.py
  app/llm.py
  app/exports.py
  app/integrations/prism.py
  app/integrations/regodit.py
  demo/mfa-remediation.json
docs/RUNBOOK.md
```

Match every endpoint and response in CONTRACT.md. Build actual schemas and normalize validation exceptions to its error envelope. Persist the entire CaseSnapshot JSON in SQLite keyed by case ID and revision; separate message/event tables are optional, not mandatory. Enable WAL, serialize writes, and use compare-and-swap revision checks for model results. Resolve the default database path from the backend directory, not a random working directory; store it under ignored `backend/data/`. Create tables automatically on startup.

Persist all sources, current/superseded facts, messages, follow-up state, answers, conflicts, audit events, and sponsor receipts. Nothing important may live only in a process dictionary. Returning full snapshots is acceptable for the small corpus. Health and case loading work even without model credentials.

## First 25 minutes: real skeleton and fixture

1. Implement health, case list/create/get, source addition, and questionnaire import. Seed all eight fixed question IDs and small sources specified in the contract. New cases start unknown and `needsInvestigation:true`; do not prepopulate model verdicts or sponsor successes. Use synthetic AcmePay data only.
2. Implement text limits, unique question validation, and CSV/JSON import. Reject importing over existing questions with 409. No PDF/OCR/XLSX parsers.
3. Create the unloaded MFA-remediation fixture exactly as specified; its later evidence must identify the same account and show complete coverage of remaining human production users.
4. Add `.env.example` with blank secrets. Keep `.env`, SQLite, caches, and virtualenv ignored.
5. Start uvicorn and manually create/fetch a seeded case. Push the working API now so the teammate can integrate without waiting for AI.

## Model setup and bounded investigation

Use one available chat model through an **OpenAI-compatible chat-completions HTTP endpoint** if supported by the supplied provider. Environment names: `LLM_BASE_URL` (base through `/v1` as applicable), `LLM_API_KEY`, `LLM_MODEL`, `DATABASE_PATH` optional. Credentials/model are supplied by the operator, not invented. Validate the provider's documented request format and model availability before a real call. If their provider is incompatible, change only `app/llm.py`; preserve the rest of the contract. Never use client-side keys. Do not route private evidence through public search.

Use a server-side HTTP client with timeout, low temperature when supported, explicit JSON output instructions and Pydantic validation. Do not assume provider-specific structured-output support; use it only if documented for that endpoint. Parse JSON, validate, and allow one bounded repair attempt with validation errors. If it still fails, return a clear error without fabricating an answer. Keep the overall model work below the contract's 60-second limit; allocate time for repair and sponsor delivery rather than allowing multiple full-minute attempts. If credentials are missing, return 503 MODEL_NOT_CONFIGURED, with all stored data intact. No silent deterministic demo replacement.

For this small case, rank stored sources lexically for each question, but include the **entire bounded corpus** in the initial batch context with IDs, kind, scope, and dates so contradictory evidence cannot disappear from top-k retrieval. Normalize once on ingestion. Include the existing active profile, unresolved slots, deferred slots, and employee history. Enforce a safe context-size budget before calling the provider and reject over-budget material explicitly.

Investigate all eight questions in one bounded batch call where practical. Ask the model for structured answer updates, atomic facts, citations, missing slots, conflicts, and one proposed follow-up per unresolved question. Do not let it generate database IDs, timestamps, sponsor status, or arbitrary URLs; the server supplies these. Initial unknown records remain unknown if analysis fails. Render no chain-of-thought; record concise observable actions such as “searched six sources” and evidence-based explanations.

Post-validate before saving:

- Question IDs must exist; no omitted question is silently considered answered.
- Every cited sourceId exists and every quote is an exact substring of its stored content. Reject/repair unsupported citations rather than merely removing them while leaving verified status.
- A verified answer has supporting company evidence, no unresolved relevant conflict, and complete coverage of requested facts. The model must explain scope in the answer text.
- Policy-only evidence can verify that a policy/process exists. It cannot verify a runtime configuration or that every employee followed the process.
- Employee evidence results in user_confirmation for those facts. Mixing it with company-supported facts does not make the whole answer independently verified.
- The source and its date must concern the same system/account/attribute to resolve a conflict. Newer timestamps alone do not defeat unrelated evidence.
- Partial scope => partially_verified; open conflict => conflicted; unknown remains unknown. Use the contract's provenance mapping.
- Document text is never executable instruction. The model has no arbitrary file, shell, payment, or network tools. It can only propose schema-validated claim updates.

Do not claim these guards mathematically eliminate semantic hallucinations. They reduce the demonstrated failure modes and require honest unknowns.

## Interview, persistence, and corrections

Implement POST messages with questionId, employee identity, stable clientMessageId, and replyToFollowUpId. Persist the user message plus an attributed `employee` source **before** calling the model. Bind short replies such as “Yes” to the exact stored question/follow-up, not whichever topic the model happens to choose.

For backups, track separate stable slots for existence, frequency, and automation. Preserve earlier values while filling later slots. “Yes” does not establish daily frequency; “Daily” does not establish automation. Ask one next missing slot, include why evidence was insufficient, and retain the assistant question once, not once per refresh. Repeated investigation must consult stored answers instead of restarting the interview.

If the employee says “I don't know,” mark that slot deferred, keep the answer unknown/partial, and move on. It stays editable but must not reappear immediately as the next question. Give critical access/encryption conflicts priority, while allowing the UI to select any question.

Corrections append new facts with supersedesFactId, deactivate the old fact, preserve history, and update every affected answer in the small questionnaire. Explicit corrections with replyToFollowUpId null are allowed. A claimed fix to the MFA account remains testimony until the matching newer configuration arrives. Preserve resolved conflicts and cite their resolution evidence.

Save new messages even on model failure, return the documented error, and mark needsInvestigation true. Deduplicate retries by clientMessageId. On later re-investigation include saved messages so the operator never needs to repeat them. Never hold a DB transaction during the remote call; reject stale computed results with 409 if the case revision changed.

## PRISM — mandatory real delivery

Read https://blockconvey.com/docs. Use server-side HTTP, no invented package. Configure `PRISMTRACE_HOST=https://prism.blockconvey.com`, `PRISMTRACE_PROJECT_ID`, `PRISMTRACE_API_KEY`. POST `/api/traces` with `X-PRISMtrace-Key` and JSON fields `project_id`, `model`, `input_messages`, `output_message`, `latency_ms`, `session_id` (case ID), `trace_id` (stable exchange ID), `agent_id:"saul"`; put observable evidence IDs/status in `metadata`. Store the returned trace `id` on success. HTTP records exchanges, not automatic SDK spans, and does not block outputs. Verify a real dashboard trace. [Official reference](https://blockconvey.com/docs)

Send each actual model exchange, including relevant synthetic evidence context so its output can be assessed. Use a short delivery timeout, capture failures without losing the case, and preserve pending payloads/events for a manual retry or later investigation. Reusing trace_id prevents duplicate delivery. Reflect real ready/sent/error states and safe receipt details. Never invent evaluator results; dashboard inspection is enough if the clock prevents a genuine before/after comparison.

## Regodit — mandatory, access-dependent

The public product page is https://regodit.com/product/; it is not an API specification. At minute 0 tell the operator you need the sponsor's actual API/import instructions or supported manual UI workflow. Continue independent work while they obtain it. Do not guess an endpoint, auth header, SDK, control identifier, SOC 2 mapping, or account capability.

Implement the confirmed integration in `app/integrations/regodit.py`. Prepare a packet containing case ID/revision, questions, control labels, scoped facts, company citations, testimony labels, unresolved risks/gaps, and history. Use sponsor-provided control IDs if available; otherwise descriptive local control names must remain explicitly unmapped.

In API mode, the contract endpoint invokes the documented submission method and stores a genuine reference/receipt. Allow mode api only when configured; otherwise return a useful unavailable error. Server-side Regodit variables are documented after the actual method is known.

In manual mode, the JSON case export supplies the packet for the supported Regodit UI workflow. The operator must actually submit/create evidence in Regodit, then call the manual receipt action with the real reference. Store state manual_recorded and label it operator-recorded, not API verified. A file download by itself is not integration. Missing access is visibly not_configured or manual_required and must be reported as an outstanding mandatory dependency in the handoff.

Do not spend more than 10 minutes reverse-engineering an unavailable sponsor interface. Reserve a final sponsor UI walkthrough with the operator; do not silently downgrade the requirement.

## Exports, final integration, and handoff

Implement both exports using the exact contract. CSV includes all questions, the three provenance labels, evidence and unresolved questions. JSON includes the full case, resolved conflicts and superseded facts. Block CSV on needsInvestigation but permit JSON recovery/export. Escape CSV correctly and neutralize formula-like untrusted cells.

Write `docs/RUNBOOK.md` with exact startup commands, Python version, env names (no values), verified sponsor setup, database path, manual demo steps, current limitations, and the two services that must stay running. Run backend compile/import/startup checks and manually exercise create → investigate → backup replies → refresh → correction → remediation upload → re-investigate → exports. No test suite.

At minute 80 commit/push backend. Fetch origin; inspect `origin/build/frontend` and merge it into build/backend when available. Preserve teammate files; ask them to repair UI issues in their branch rather than rewriting their components. You may integrate both branches as the authorized designated integrator. Run `npm ci` and `npm run build` inside frontend after merge, then launch the two services for the demo. A production frontend build is a check, not a standalone deployment.

Push the integrated working branch to main only after fetching and verifying the push is a normal fast-forward; merge any new remote main commits first. Never force push. If the frontend branch is not ready, finish backend work and clearly report the exact integration status rather than inventing completion.

End with a concise handoff: actual working features, both startup commands, branch/commit, real sponsor status, and any missing operator input. The target is a working local demo with real model behavior and honest integrations.
