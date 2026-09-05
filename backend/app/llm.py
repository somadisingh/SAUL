from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx


class ModelNotConfiguredError(Exception):
    pass


class ModelProviderError(Exception):
    pass


@dataclass
class ModelExchange:
    model: str
    input_messages: list[dict[str, str]]
    output_message: str
    latency_ms: int
    finish_reason: str


def configured() -> bool:
    return all(
        os.getenv(name, "").strip()
        for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
    )


def _content_from_response(body: dict[str, Any]) -> str:
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelProviderError(
            "The model provider returned an unsupported chat-completions response."
        ) from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        )
        if text:
            return text
    raise ModelProviderError("The model provider returned no text response.")


def _finish_reason_from_response(body: dict[str, Any]) -> str:
    try:
        finish_reason = body["choices"][0].get("finish_reason")
    except (KeyError, IndexError, TypeError, AttributeError):
        return "unknown"
    return finish_reason if isinstance(finish_reason, str) else "unknown"


def _max_output_tokens() -> int:
    raw = os.getenv("LLM_MAX_OUTPUT_TOKENS", "8192").strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ModelNotConfiguredError("LLM_MAX_OUTPUT_TOKENS must be an integer.") from exc
    if not 1_024 <= value <= 32_768:
        raise ModelNotConfiguredError(
            "LLM_MAX_OUTPUT_TOKENS must be between 1024 and 32768."
        )
    return value


async def chat(
    system_prompt: str,
    user_prompt: str,
    *,
    timeout_seconds: float,
) -> ModelExchange:
    if not configured():
        raise ModelNotConfiguredError(
            "Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL on the server."
        )

    base_url = os.environ["LLM_BASE_URL"].strip().rstrip("/")
    model = os.environ["LLM_MODEL"].strip()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    request_body = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": _max_output_tokens(),
    }
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ['LLM_API_KEY'].strip()}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            response.raise_for_status()
            body = response.json()
    except httpx.TimeoutException as exc:
        raise ModelProviderError("The model provider timed out.") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        raise ModelProviderError(
            f"The model provider rejected the request (HTTP {status})."
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise ModelProviderError("The model provider request failed.") from exc
    latency_ms = round((time.monotonic() - started) * 1000)
    return ModelExchange(
        model=model,
        input_messages=messages,
        output_message=_content_from_response(body),
        latency_ms=latency_ms,
        finish_reason=_finish_reason_from_response(body),
    )
