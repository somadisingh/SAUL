from __future__ import annotations

import os
from typing import Any

from ..schemas import CaseSnapshot


class RegoditUnavailableError(Exception):
    pass


def configured_mode() -> str:
    # API mode stays disabled until the sponsor supplies an actual API specification.
    return "manual" if os.getenv("REGODIT_MODE", "").strip().lower() == "manual" else "unconfigured"


def build_packet(case: CaseSnapshot) -> dict[str, Any]:
    sources = {source.id: source for source in case.sources}

    def citation_detail(citation: Any) -> dict[str, Any]:
        source = sources.get(citation.sourceId)
        return {
            "sourceId": citation.sourceId,
            "sourceName": source.name if source else None,
            "sourceKind": source.kind if source else None,
            "observedAt": source.observedAt if source else None,
            "quote": citation.quote,
        }

    questions = []
    for question in case.questions:
        questions.append(
            {
                "questionId": question.id,
                "localControlName": question.text,
                "externalControlId": None,
                "scope": question.scope,
                "answer": question.answer,
                "status": question.status,
                "provenance": question.provenance,
                "companyCitations": [
                    citation_detail(citation)
                    for citation in question.citations
                    if sources.get(citation.sourceId)
                    and sources[citation.sourceId].kind != "employee"
                ],
                "testimonyCitations": [
                    citation_detail(citation)
                    for citation in question.citations
                    if sources.get(citation.sourceId)
                    and sources[citation.sourceId].kind == "employee"
                ],
                "unresolvedGaps": [
                    {"key": slot.key, "label": slot.label, "state": slot.state}
                    for slot in question.missingSlots
                    if slot.state != "answered"
                ],
                "conflicts": [conflict.model_dump() for conflict in question.conflicts],
            }
        )

    return {
        "packetType": "saul_regodit_manual_evidence_packet",
        "mappingStatus": "unmapped",
        "mappingNote": (
            "Local descriptive control names are not sponsor control IDs. "
            "Map them in the supported Regodit workflow."
        ),
        "caseId": case.id,
        "caseRevision": case.revision,
        "companyName": case.companyName,
        "questions": questions,
        "scopedFacts": [fact.model_dump() for fact in case.facts],
        "unresolvedRisks": [
            {
                "questionId": question.id,
                "status": question.status,
                "answer": question.answer,
            }
            for question in case.questions
            if question.status in {"unknown", "partially_verified", "conflicted"}
        ],
        "history": {
            "supersededFacts": [
                fact.model_dump() for fact in case.facts if not fact.active
            ],
            "events": [event.model_dump() for event in case.events],
        },
    }


async def submit_api(_: CaseSnapshot) -> None:
    raise RegoditUnavailableError(
        "Regodit API mode is unavailable because no sponsor API specification "
        "or account capability has been supplied."
    )
