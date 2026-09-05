from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .schemas import CaseSnapshot
from .seed import utc_now


class CaseNotFoundError(Exception):
    pass


class StaleRevisionError(Exception):
    pass


def resolve_database_path() -> Path:
    backend_dir = Path(__file__).resolve().parents[1]
    configured = os.getenv("DATABASE_PATH", "").strip()
    if not configured:
        return backend_dir / "data" / "bettercallsaul.sqlite3"
    path = Path(configured).expanduser()
    if not path.is_absolute():
        path = backend_dir / path
    return path.resolve()


class SQLiteStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or resolve_database_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS case_versions (
                    case_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (case_id, revision)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS prism_deliveries (
                    trace_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    reference TEXT,
                    error_message TEXT,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def create_case(self, snapshot: CaseSnapshot) -> CaseSnapshot:
        serialized = snapshot.model_dump_json()
        with self._write_lock, self._connect() as connection:
            try:
                connection.execute(
                    "INSERT INTO cases(id, revision, snapshot_json, updated_at) VALUES(?,?,?,?)",
                    (snapshot.id, snapshot.revision, serialized, snapshot.updatedAt),
                )
                connection.execute(
                    """
                    INSERT INTO case_versions(case_id, revision, snapshot_json, created_at)
                    VALUES(?,?,?,?)
                    """,
                    (snapshot.id, snapshot.revision, serialized, snapshot.updatedAt),
                )
            except sqlite3.IntegrityError as exc:
                raise StaleRevisionError("Case already exists") from exc
        return snapshot

    def get_case(self, case_id: str) -> CaseSnapshot:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT snapshot_json FROM cases WHERE id=?", (case_id,)
            ).fetchone()
        if row is None:
            raise CaseNotFoundError(case_id)
        return CaseSnapshot.model_validate_json(row["snapshot_json"])

    def list_cases(self) -> list[dict[str, str]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT snapshot_json FROM cases ORDER BY updated_at DESC"
            ).fetchall()
        cases = []
        for row in rows:
            snapshot = json.loads(row["snapshot_json"])
            cases.append(
                {
                    "id": snapshot["id"],
                    "companyName": snapshot["companyName"],
                    "title": snapshot["title"],
                    "updatedAt": snapshot["updatedAt"],
                }
            )
        return cases

    def compare_and_swap(
        self, snapshot: CaseSnapshot, expected_revision: int
    ) -> CaseSnapshot:
        updated = snapshot.model_copy(deep=True)
        updated.revision = expected_revision + 1
        updated.updatedAt = utc_now()
        serialized = updated.model_dump_json()
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT revision FROM cases WHERE id=?", (updated.id,)
            ).fetchone()
            if row is None:
                connection.rollback()
                raise CaseNotFoundError(updated.id)
            if row["revision"] != expected_revision:
                connection.rollback()
                raise StaleRevisionError(
                    f"Expected revision {expected_revision}, found {row['revision']}"
                )
            cursor = connection.execute(
                """
                UPDATE cases
                SET revision=?, snapshot_json=?, updated_at=?
                WHERE id=? AND revision=?
                """,
                (
                    updated.revision,
                    serialized,
                    updated.updatedAt,
                    updated.id,
                    expected_revision,
                ),
            )
            if cursor.rowcount != 1:
                connection.rollback()
                raise StaleRevisionError("Case changed during update")
            connection.execute(
                """
                INSERT INTO case_versions(case_id, revision, snapshot_json, created_at)
                VALUES(?,?,?,?)
                """,
                (updated.id, updated.revision, serialized, updated.updatedAt),
            )
            connection.commit()
        return updated

    def record_prism_delivery(
        self,
        trace_id: str,
        case_id: str,
        payload: dict[str, Any],
        state: str,
        reference: str | None = None,
        error_message: str | None = None,
    ) -> None:
        now = utc_now()
        with self._write_lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO prism_deliveries(
                    trace_id, case_id, payload_json, state, reference, error_message, updated_at
                ) VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(trace_id) DO UPDATE SET
                    state=excluded.state,
                    reference=excluded.reference,
                    error_message=excluded.error_message,
                    updated_at=excluded.updated_at
                """,
                (
                    trace_id,
                    case_id,
                    json.dumps(payload, separators=(",", ":")),
                    state,
                    reference,
                    error_message,
                    now,
                ),
            )

    def pending_prism_deliveries(
        self, case_id: str, limit: int = 5
    ) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT trace_id, payload_json
                FROM prism_deliveries
                WHERE case_id=? AND state IN ('pending', 'error')
                ORDER BY updated_at ASC LIMIT ?
                """,
                (case_id, limit),
            ).fetchall()
        return [
            {"traceId": row["trace_id"], "payload": json.loads(row["payload_json"])}
            for row in rows
        ]

    def database_info(self) -> dict[str, str]:
        return {"path": str(self.path), "initializedAt": utc_now()}
