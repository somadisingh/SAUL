import pytest

from backend.app import llm


def test_finish_reason_is_preserved() -> None:
    assert llm._finish_reason_from_response(
        {"choices": [{"finish_reason": "length"}]}
    ) == "length"


def test_missing_finish_reason_is_unknown() -> None:
    assert llm._finish_reason_from_response({"choices": [{}]}) == "unknown"


def test_output_token_budget_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MAX_OUTPUT_TOKENS", "100")
    with pytest.raises(llm.ModelNotConfiguredError):
        llm._max_output_tokens()
