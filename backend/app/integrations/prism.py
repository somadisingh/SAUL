from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

import httpx

from ..store import SQLiteStore


@dataclass
class PrismDeliveryResult:
    state: str
    reference: str | None
    message: str


PII_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "phone": re.compile(r"(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\w)"),
    "ssn": re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
    "payment_card": re.compile(r"(?<!\d)(?:\d[ -]*?){13,19}(?!\d)"),
}


def configured() -> bool:
    return all(
        os.getenv(name, "").strip()
        for name in ("PRISMTRACE_HOST", "PRISMTRACE_PROJECT_ID", "PRISMTRACE_API_KEY")
    )


def pii_access_audit(input_messages: list[dict[str, str]]) -> dict[str, Any]:
    """Describe PII categories exposed to the model without copying PII values."""
    categories = sorted(
        category
        for category, pattern in PII_PATTERNS.items()
        if any(pattern.search(message.get("content", "")) for message in input_messages)
    )
    return {
        "logged": True,
        "pii_detected": bool(categories),
        "categories": categories,
        "message_count": len(input_messages),
        "raw_values_logged": False,
    }


def build_payload(
    *,
    model: str,
    input_messages: list[dict[str, str]],
    output_message: str,
    latency_ms: int,
    case_id: str,
    trace_id: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return {
        "project_id": os.getenv("PRISMTRACE_PROJECT_ID", "").strip(),
        "model": model,
        "input_messages": input_messages,
        "output_message": output_message,
        "latency_ms": latency_ms,
        "session_id": case_id,
        "trace_id": trace_id,
        "agent_id": "saul",
        "agent_name": "SAUL",
        "metadata": metadata,
    }


async def deliver(
    store: SQLiteStore,
    case_id: str,
    trace_id: str,
    payload: dict[str, Any],
) -> PrismDeliveryResult:
    store.record_prism_delivery(trace_id, case_id, payload, "pending")
    if not configured():
        return PrismDeliveryResult(
            state="not_configured",
            reference=None,
            message="PRISM is not configured; the trace payload remains pending.",
        )

    host = os.getenv("PRISMTRACE_HOST", "https://prism.blockconvey.com").rstrip("/")
    api_key = os.getenv("PRISMTRACE_API_KEY", "").strip()
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.post(
                f"{host}/api/traces",
                headers={
                    "Content-Type": "application/json",
                    "X-PRISMtrace-Key": api_key,
                },
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
            reference = body.get("id")
            if not isinstance(reference, str) or not reference.strip():
                raise ValueError("PRISM response did not include a usable trace id")
    except (httpx.HTTPError, ValueError) as exc:
        message = f"PRISM delivery failed: {type(exc).__name__}"
        store.record_prism_delivery(
            trace_id, case_id, payload, "error", error_message=message
        )
        return PrismDeliveryResult(state="error", reference=None, message=message)

    store.record_prism_delivery(
        trace_id, case_id, payload, "sent", reference=reference
    )
    return PrismDeliveryResult(
        state="sent",
        reference=reference,
        message="PRISM accepted the model exchange.",
    )


async def retry_pending(
    store: SQLiteStore, case_id: str
) -> PrismDeliveryResult | None:
    if not configured():
        return None
    result: PrismDeliveryResult | None = None
    for item in store.pending_prism_deliveries(case_id, limit=1):
        result = await deliver(store, case_id, item["traceId"], item["payload"])
    return result
