from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


AnswerStatus = Literal[
    "verified", "employee_confirmed", "partially_verified", "conflicted", "unknown"
]
Provenance = Literal["company_information", "user_confirmation", "needs_confirmation"]
SourceKind = Literal["policy", "configuration", "message", "report", "employee"]
SlotState = Literal["answered", "missing", "deferred"]
IntegrationState = Literal[
    "not_configured", "ready", "sent", "manual_required", "manual_recorded", "error"
]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(WireModel):
    sourceId: str
    quote: str


class Source(WireModel):
    id: str
    name: str
    kind: SourceKind
    scope: str
    content: str
    observedAt: str | None
    createdAt: str
    author: str | None


class Fact(WireModel):
    id: str
    key: str
    scope: str
    value: str
    provenance: Provenance
    citations: list[Citation]
    updatedAt: str
    supersedesFactId: str | None
    active: bool


class MissingSlot(WireModel):
    key: str
    label: str
    state: SlotState


class Conflict(WireModel):
    id: str
    summary: str
    citations: list[Citation]
    state: Literal["open", "resolved"]
    resolution: str | None
    resolvedAt: str | None


class FollowUp(WireModel):
    id: str
    slotKey: str
    text: str
    reason: str
    suggestedOwner: str


class Question(WireModel):
    id: str
    text: str
    priority: int = Field(ge=1, le=3)
    scope: str
    answer: str
    status: AnswerStatus
    provenance: Provenance
    citations: list[Citation]
    missingSlots: list[MissingSlot]
    conflicts: list[Conflict]
    followUp: FollowUp | None
    updatedAt: str


class Message(WireModel):
    id: str
    clientMessageId: str | None
    questionId: str
    role: Literal["assistant", "user"]
    text: str
    employeeName: str | None
    employeeRole: str | None
    createdAt: str


class AuditEvent(WireModel):
    id: str
    kind: str
    questionId: str | None
    summary: str
    createdAt: str


class IntegrationReceipt(WireModel):
    provider: Literal["prism", "regodit"]
    state: IntegrationState
    reference: str | None
    url: str | None
    lastAttemptAt: str | None
    lastSuccessAt: str | None
    message: str


class Integrations(WireModel):
    prism: IntegrationReceipt
    regodit: IntegrationReceipt


class CaseSnapshot(WireModel):
    id: str
    companyName: str
    title: str
    revision: int = Field(ge=1)
    needsInvestigation: bool
    createdAt: str
    updatedAt: str
    sources: list[Source]
    questions: list[Question]
    facts: list[Fact]
    messages: list[Message]
    events: list[AuditEvent]
    integrations: Integrations


class CaseCreate(WireModel):
    companyName: str = Field(min_length=1, max_length=100)
    seedDemo: bool

    @field_validator("companyName")
    @classmethod
    def clean_company(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("companyName must not be blank")
        return value


class SourceCreate(WireModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["policy", "configuration", "message", "report"]
    scope: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1)
    observedAt: str | None

    @field_validator("name", "scope")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        if not value.strip():
            raise ValueError("content must not be blank")
        return value

    @field_validator("observedAt")
    @classmethod
    def valid_observed_at(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("observedAt must be an ISO-8601 timestamp") from exc
        if parsed.tzinfo is None:
            raise ValueError("observedAt must include a timezone")
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class QuestionnaireImport(WireModel):
    format: Literal["csv", "json"]
    content: str = Field(min_length=1)


class InvestigateRequest(WireModel):
    pass


class MessageCreate(WireModel):
    questionId: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4_000)
    employeeName: str = Field(min_length=1, max_length=100)
    employeeRole: str = Field(min_length=1, max_length=100)
    replyToFollowUpId: str | None
    clientMessageId: str = Field(min_length=1, max_length=200)

    @field_validator("text", mode="before")
    @classmethod
    def normalize_message_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.replace("\r\n", "\n").replace("\r", "\n")
        return value

    @field_validator("questionId", "text", "employeeName", "employeeRole", "clientMessageId")
    @classmethod
    def clean_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value


class RegoditRequest(WireModel):
    mode: Literal["api", "manual"]
    reference: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_mode(self) -> "RegoditRequest":
        if self.mode == "manual" and not (self.reference or "").strip():
            raise ValueError("reference is required for manual mode")
        if self.mode == "api" and (self.reference is not None or self.url is not None):
            raise ValueError("api mode does not accept reference or url")
        if self.url is not None:
            parsed = urlparse(self.url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("url must be an absolute http(s) URL")
        return self


class ErrorDetail(WireModel):
    code: str
    message: str


class ErrorEnvelope(WireModel):
    error: ErrorDetail
