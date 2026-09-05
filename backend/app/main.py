from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from . import exports, investigator, llm  # noqa: E402
from .integrations import prism, regodit  # noqa: E402
from .schemas import (  # noqa: E402
    AuditEvent,
    CaseCreate,
    CaseSnapshot,
    Citation,
    Fact,
    IntegrationReceipt,
    InvestigateRequest,
    Message,
    MessageCreate,
    MissingSlot,
    Question,
    QuestionnaireImport,
    RegoditRequest,
    Source,
    SourceCreate,
)
from .seed import make_case, utc_now  # noqa: E402
from .store import (  # noqa: E402
    CaseNotFoundError,
    SQLiteStore,
    StaleRevisionError,
)


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


app = FastAPI(
    title="SAUL — Security Assurance & Understanding Layer",
    version="1.0.0",
)
store = SQLiteStore()


def _error(status: int, code: str, message: str) -> APIError:
    return APIError(status, code, message)


@app.exception_handler(APIError)
async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    location = ".".join(str(item) for item in first.get("loc", []) if item != "body")
    detail = first.get("msg", "Request validation failed")
    message = f"{location}: {detail}" if location else detail
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": message}},
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, CaseNotFoundError):
        return JSONResponse(
            status_code=404,
            content={
                "error": {"code": "CASE_NOT_FOUND", "message": "Case was not found."}
            },
        )
    if isinstance(exc, StaleRevisionError):
        return JSONResponse(
            status_code=409,
            content={
                "error": {
                    "code": "STALE_REVISION",
                    "message": "The case changed during this request. Refresh and try again.",
                }
            },
        )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "The server could not complete the request.",
            }
        },
    )


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "modelConfigured": llm.configured(),
        "prismConfigured": prism.configured(),
        "regoditMode": regodit.configured_mode(),
    }


@app.get("/api/cases")
async def list_cases() -> dict[str, object]:
    return {"cases": store.list_cases()}


@app.post("/api/cases", response_model=CaseSnapshot)
async def create_case(request: CaseCreate) -> CaseSnapshot:
    if request.seedDemo and request.companyName != "AcmePay":
        raise _error(
            422,
            "INVALID_DEMO_COMPANY",
            "The synthetic demo fixture is available only for AcmePay.",
        )
    snapshot = make_case(
        request.companyName,
        request.seedDemo,
        prism.configured(),
        regodit.configured_mode(),
    )
    return store.create_case(snapshot)


@app.get("/api/cases/{case_id}", response_model=CaseSnapshot)
async def get_case(case_id: str) -> CaseSnapshot:
    return store.get_case(case_id)


def _save(snapshot: CaseSnapshot, expected_revision: int) -> CaseSnapshot:
    try:
        return store.compare_and_swap(snapshot, expected_revision)
    except StaleRevisionError as exc:
        raise _error(
            409,
            "STALE_REVISION",
            "The case changed during this request. Refresh and try again.",
        ) from exc


@app.post("/api/cases/{case_id}/sources", response_model=CaseSnapshot)
async def add_source(case_id: str, request: SourceCreate) -> CaseSnapshot:
    snapshot = store.get_case(case_id)
    if len(snapshot.sources) >= 20:
        raise _error(413, "SOURCE_LIMIT", "A case can contain at most 20 sources.")
    if sum(len(source.content) for source in snapshot.sources) + len(request.content) > 100_000:
        raise _error(
            413,
            "CORPUS_LIMIT",
            "Adding this source would exceed the 100,000-character case limit.",
        )
    now = utc_now()
    updated = snapshot.model_copy(deep=True)
    updated.sources.append(
        Source(
            id=str(uuid4()),
            name=request.name,
            kind=request.kind,
            scope=request.scope,
            content=request.content,
            observedAt=request.observedAt,
            createdAt=now,
            author=None,
        )
    )
    updated.needsInvestigation = True
    updated.events.append(
        AuditEvent(
            id=str(uuid4()),
            kind="source_added",
            questionId=None,
            summary=f"Added {request.kind} source: {request.name}.",
            createdAt=now,
        )
    )
    return _save(updated, snapshot.revision)


def _parse_questionnaire(request: QuestionnaireImport) -> list[tuple[str, str]]:
    try:
        if request.format == "csv":
            reader = csv.DictReader(io.StringIO(request.content))
            if not reader.fieldnames or not {"id", "question"}.issubset(reader.fieldnames):
                raise ValueError("CSV must contain id and question columns")
            rows = [(row.get("id", ""), row.get("question", "")) for row in reader]
        else:
            body = json.loads(request.content)
            if not isinstance(body, list):
                raise ValueError("JSON questionnaire must be an array")
            rows = []
            for item in body:
                if not isinstance(item, dict):
                    raise ValueError("Each JSON questionnaire item must be an object")
                rows.append((item.get("id", ""), item.get("question", "")))
    except (csv.Error, json.JSONDecodeError, ValueError) as exc:
        raise _error(422, "INVALID_QUESTIONNAIRE", str(exc)) from exc

    cleaned: list[tuple[str, str]] = []
    for raw_id, raw_question in rows:
        if not isinstance(raw_id, str) or not isinstance(raw_question, str):
            raise _error(
                422,
                "INVALID_QUESTIONNAIRE",
                "Question IDs and question text must be strings.",
            )
        question_id = raw_id.strip()
        question = raw_question.strip()
        if not question_id or not question:
            raise _error(
                422,
                "INVALID_QUESTIONNAIRE",
                "Question IDs and question text must not be empty.",
            )
        if len(question_id) > 100 or len(question) > 1_000:
            raise _error(
                422,
                "INVALID_QUESTIONNAIRE",
                "Question IDs are limited to 100 characters and text to 1,000.",
            )
        cleaned.append((question_id, question))
    if not cleaned:
        raise _error(422, "INVALID_QUESTIONNAIRE", "Questionnaire is empty.")
    if len(cleaned) > 12:
        raise _error(413, "QUESTION_LIMIT", "A questionnaire can contain at most 12 questions.")
    identifiers = [item[0] for item in cleaned]
    if len(identifiers) != len(set(identifiers)):
        raise _error(
            422, "DUPLICATE_QUESTION_ID", "Question IDs must be unique."
        )
    return cleaned


@app.post("/api/cases/{case_id}/questionnaire", response_model=CaseSnapshot)
async def import_questionnaire(
    case_id: str, request: QuestionnaireImport
) -> CaseSnapshot:
    snapshot = store.get_case(case_id)
    if snapshot.questions:
        raise _error(
            409,
            "QUESTIONNAIRE_EXISTS",
            "This case already has questions; destructive replacement is not allowed.",
        )
    rows = _parse_questionnaire(request)
    now = utc_now()
    updated = snapshot.model_copy(deep=True)
    updated.questions = [
        Question(
            id=question_id,
            text=text,
            priority=2,
            scope="Imported questionnaire scope",
            answer="Unknown — investigation has not run.",
            status="unknown",
            provenance="needs_confirmation",
            citations=[],
            missingSlots=[],
            conflicts=[],
            followUp=None,
            updatedAt=now,
        )
        for question_id, text in rows
    ]
    updated.needsInvestigation = True
    updated.events.append(
        AuditEvent(
            id=str(uuid4()),
            kind="questionnaire_imported",
            questionId=None,
            summary=f"Imported {len(rows)} questions from {request.format.upper()}.",
            createdAt=now,
        )
    )
    return _save(updated, snapshot.revision)


async def _run_investigation(snapshot: CaseSnapshot) -> CaseSnapshot:
    if not snapshot.questions:
        raise _error(
            422,
            "NO_QUESTIONS",
            "Import a questionnaire before running an investigation.",
        )
    try:
        computed = await investigator.investigate(store, snapshot)
    except llm.ModelNotConfiguredError as exc:
        raise _error(
            503,
            "MODEL_NOT_CONFIGURED",
            "The model is not configured. Stored case data is unchanged.",
        ) from exc
    except investigator.ContextBudgetError as exc:
        raise _error(413, "MODEL_CONTEXT_LIMIT", str(exc)) from exc
    except investigator.ModelOutputError as exc:
        raise _error(
            502,
            "INVALID_MODEL_OUTPUT",
            "The model did not return fully supported, valid evidence updates.",
        ) from exc
    except llm.ModelProviderError as exc:
        raise _error(502, "MODEL_PROVIDER_ERROR", str(exc)) from exc
    return _save(computed.snapshot, snapshot.revision)


@app.post("/api/cases/{case_id}/investigate", response_model=CaseSnapshot)
async def investigate_case(
    case_id: str, _: InvestigateRequest
) -> CaseSnapshot:
    return await _run_investigation(store.get_case(case_id))


def _append_bound_fact(
    snapshot: CaseSnapshot,
    source: Source,
    question_id: str,
    slot_key: str,
    text: str,
    now: str,
) -> None:
    normalized = text.strip().lower().replace("’", "'")
    deferred = normalized in {"i don't know", "i do not know", "don't know", "unknown"}
    question = next(item for item in snapshot.questions if item.id == question_id)
    slot = next((item for item in question.missingSlots if item.key == slot_key), None)
    if slot is not None:
        slot.state = "deferred" if deferred else "answered"
    question.followUp = None
    if deferred:
        return
    if slot_key.endswith(".exists.production_db") or slot_key.endswith(
        ".automated.production_db"
    ):
        if normalized in {"yes", "yes.", "true"}:
            value = "Yes"
        elif normalized in {"no", "no.", "false"}:
            value = "No"
        else:
            value = text.strip()
    else:
        value = text.strip()
    active = next(
        (
            fact
            for fact in reversed(snapshot.facts)
            if fact.active and fact.key == slot_key and fact.scope == question.scope
        ),
        None,
    )
    if active and active.value.casefold() == value.casefold():
        return
    if active:
        active.active = False
    snapshot.facts.append(
        Fact(
            id=str(uuid4()),
            key=slot_key,
            scope=question.scope,
            value=value,
            provenance="user_confirmation",
            citations=[Citation(sourceId=source.id, quote=text.strip())],
            updatedAt=now,
            supersedesFactId=active.id if active else None,
            active=True,
        )
    )


@app.post("/api/cases/{case_id}/messages", response_model=CaseSnapshot)
async def add_message(case_id: str, request: MessageCreate) -> CaseSnapshot:
    snapshot = store.get_case(case_id)
    existing = next(
        (
            message
            for message in snapshot.messages
            if message.clientMessageId == request.clientMessageId
        ),
        None,
    )
    if existing is not None:
        return snapshot
    question = next(
        (item for item in snapshot.questions if item.id == request.questionId), None
    )
    if question is None:
        raise _error(404, "QUESTION_NOT_FOUND", "The selected question was not found.")
    follow_up = None
    if request.replyToFollowUpId is not None:
        if (
            question.followUp is None
            or question.followUp.id != request.replyToFollowUpId
        ):
            raise _error(
                409,
                "STALE_FOLLOW_UP",
                "That follow-up is stale or belongs to another question. Refresh and try again.",
            )
        follow_up = question.followUp
    if len(snapshot.sources) >= 20:
        raise _error(413, "SOURCE_LIMIT", "A case can contain at most 20 sources.")

    now = utc_now()
    updated = snapshot.model_copy(deep=True)
    source = Source(
        id=str(uuid4()),
        name=f"Employee statement from {request.employeeName}",
        kind="employee",
        scope=(
            f"question:{request.questionId};slot:{follow_up.slotKey}"
            if follow_up
            else f"question:{request.questionId};unsolicited correction"
        ),
        content=request.text,
        observedAt=now,
        createdAt=now,
        author=f"{request.employeeName} — {request.employeeRole}",
    )
    if sum(len(item.content) for item in updated.sources) + len(source.content) > 100_000:
        raise _error(
            413,
            "CORPUS_LIMIT",
            "Adding this message would exceed the 100,000-character case limit.",
        )
    updated.sources.append(source)
    updated.messages.append(
        Message(
            id=str(uuid4()),
            clientMessageId=request.clientMessageId,
            questionId=request.questionId,
            role="user",
            text=request.text,
            employeeName=request.employeeName,
            employeeRole=request.employeeRole,
            createdAt=now,
        )
    )
    if follow_up is not None:
        _append_bound_fact(
            updated,
            source,
            request.questionId,
            follow_up.slotKey,
            request.text,
            now,
        )
    updated.needsInvestigation = True
    updated.events.append(
        AuditEvent(
            id=str(uuid4()),
            kind="employee_statement_saved",
            questionId=request.questionId,
            summary=(
                f"Saved attributed employee testimony for {request.questionId}"
                + (f" bound to {follow_up.slotKey}." if follow_up else ".")
            ),
            createdAt=now,
        )
    )
    persisted = _save(updated, snapshot.revision)
    return await _run_investigation(persisted)


@app.get("/api/cases/{case_id}/export")
async def export_case(
    case_id: str, format: Literal["csv", "json"]
) -> Response:
    snapshot = store.get_case(case_id)
    if format == "csv":
        if snapshot.needsInvestigation:
            raise _error(
                409,
                "INVESTIGATION_REQUIRED",
                "Evidence changed. Run investigation before exporting the questionnaire CSV.",
            )
        content = exports.questionnaire_csv(snapshot)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="saul-{snapshot.id}-questionnaire.csv"'
                )
            },
        )
    content = exports.case_json(snapshot)
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="saul-{snapshot.id}-case.json"'
        },
    )


@app.post(
    "/api/cases/{case_id}/integrations/regodit",
    response_model=IntegrationReceipt,
)
async def integrate_regodit(
    case_id: str, request: RegoditRequest
) -> IntegrationReceipt:
    snapshot = store.get_case(case_id)
    if request.mode == "api":
        try:
            await regodit.submit_api(snapshot)
        except regodit.RegoditUnavailableError as exc:
            raise _error(503, "REGODIT_API_UNAVAILABLE", str(exc)) from exc
        raise _error(
            502,
            "REGODIT_INVALID_RESPONSE",
            "Regodit did not return a usable external reference.",
        )
    if regodit.configured_mode() != "manual":
        raise _error(
            503,
            "REGODIT_NOT_CONFIGURED",
            "Set REGODIT_MODE=manual only after confirming a supported UI workflow.",
        )
    now = utc_now()
    updated = snapshot.model_copy(deep=True)
    receipt = IntegrationReceipt(
        provider="regodit",
        state="manual_recorded",
        reference=(request.reference or "").strip(),
        url=request.url,
        lastAttemptAt=now,
        lastSuccessAt=now,
        message=(
            "Operator-recorded manual Regodit submission. This receipt is not API verified."
        ),
    )
    updated.integrations.regodit = receipt
    updated.events.append(
        AuditEvent(
            id=str(uuid4()),
            kind="regodit_manual_receipt",
            questionId=None,
            summary=(
                "Recorded an operator-provided Regodit reference after manual submission."
            ),
            createdAt=now,
        )
    )
    saved = _save(updated, snapshot.revision)
    return saved.integrations.regodit
