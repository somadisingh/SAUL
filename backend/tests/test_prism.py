from backend.app.integrations.prism import pii_access_audit


def test_pii_access_audit_logs_categories_without_values() -> None:
    audit = pii_access_audit(
        [
            {"role": "system", "content": "Review bounded evidence."},
            {
                "role": "user",
                "content": "Contact analyst@example.com or 212-555-0199.",
            },
        ]
    )

    assert audit == {
        "logged": True,
        "pii_detected": True,
        "categories": ["email", "phone"],
        "message_count": 2,
        "raw_values_logged": False,
    }
    assert "analyst@example.com" not in repr(audit)


def test_pii_access_audit_records_clean_access() -> None:
    audit = pii_access_audit([{"role": "user", "content": "No personal data here."}])

    assert audit["logged"] is True
    assert audit["pii_detected"] is False
    assert audit["categories"] == []
