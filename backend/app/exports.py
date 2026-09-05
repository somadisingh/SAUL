from __future__ import annotations

import csv
import io
import json

from .integrations.regodit import build_packet
from .schemas import CaseSnapshot


PROVENANCE_LABELS = {
    "company_information": "Verified from company information",
    "user_confirmation": "Confirmed by user",
    "needs_confirmation": "Unknown / needs confirmation",
}


def _safe_cell(value: object) -> str:
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"
    return text


def questionnaire_csv(case: CaseSnapshot) -> str:
    sources = {source.id: source for source in case.sources}
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    columns = [
        "question_id",
        "question",
        "answer",
        "status",
        "provenance",
        "evidence",
        "remaining_questions",
        "updated_at",
    ]
    writer.writerow(columns)
    for question in case.questions:
        evidence = " | ".join(
            f'{sources[citation.sourceId].name}: "{citation.quote}"'
            for citation in question.citations
            if citation.sourceId in sources
        )
        remaining = " | ".join(
            f"{slot.label} ({slot.state})"
            for slot in question.missingSlots
            if slot.state != "answered"
        )
        writer.writerow(
            [
                _safe_cell(question.id),
                _safe_cell(question.text),
                _safe_cell(question.answer),
                _safe_cell(question.status),
                _safe_cell(PROVENANCE_LABELS[question.provenance]),
                _safe_cell(evidence),
                _safe_cell(remaining),
                _safe_cell(question.updatedAt),
            ]
        )
    return stream.getvalue()


def case_json(case: CaseSnapshot) -> str:
    payload = case.model_dump()
    payload["regoditPacket"] = build_packet(case)
    return json.dumps(payload, ensure_ascii=False, indent=2)
