from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("PROCESSING_DB_PATH", "/data/processing.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
_LOCK = threading.Lock()


def _connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _LOCK, _connection() as conn:
        conn.execute(
            """
            create table if not exists jobs (
              id text primary key,
              kind text not null,
              status text not null,
              progress integer not null default 0,
              request_json text not null,
              result_json text,
              extraction_method text,
              error text,
              created_at text not null,
              updated_at text not null
            )
            """
        )
        conn.execute(
            "create index if not exists jobs_status_created_idx on jobs(status, created_at)"
        )
        conn.commit()


def create_job(kind: str, request: dict[str, Any]) -> str:
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with _LOCK, _connection() as conn:
        conn.execute(
            """
            insert into jobs(id, kind, status, progress, request_json, created_at, updated_at)
            values (?, ?, 'queued', 0, ?, ?, ?)
            """,
            (job_id, kind, json.dumps(request, ensure_ascii=False), now, now),
        )
        conn.commit()
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    with _LOCK, _connection() as conn:
        row = conn.execute("select * from jobs where id = ?", (job_id,)).fetchone()
    if not row:
        return None
    result = dict(row)
    result["request"] = json.loads(result.pop("request_json"))
    raw_result = result.pop("result_json")
    result["result"] = json.loads(raw_result) if raw_result else None
    return result


def claim_next_job() -> dict[str, Any] | None:
    with _LOCK, _connection() as conn:
        conn.execute("begin immediate")
        row = conn.execute(
            "select id from jobs where status = 'queued' order by created_at limit 1"
        ).fetchone()
        if not row:
            conn.commit()
            return None
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "update jobs set status='processing', progress=1, updated_at=? where id=?",
            (now, row["id"]),
        )
        conn.commit()
    return get_job(row["id"])


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    progress: int | None = None,
    result: dict[str, Any] | None = None,
    extraction_method: str | None = None,
    error: str | None = None,
) -> None:
    fields: list[str] = ["updated_at=?"]
    values: list[Any] = [datetime.now(timezone.utc).isoformat()]

    if status is not None:
        fields.append("status=?")
        values.append(status)
    if progress is not None:
        fields.append("progress=?")
        values.append(max(0, min(100, progress)))
    if result is not None:
        fields.append("result_json=?")
        values.append(json.dumps(result, ensure_ascii=False))
    if extraction_method is not None:
        fields.append("extraction_method=?")
        values.append(extraction_method)
    if error is not None:
        fields.append("error=?")
        values.append(error[:8000])

    values.append(job_id)
    with _LOCK, _connection() as conn:
        conn.execute(f"update jobs set {', '.join(fields)} where id=?", values)
        conn.commit()
