from __future__ import annotations

import os
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .extractors import detect_candidates, extract_document
from .store import claim_next_job, update_job


_STOP = threading.Event()


def start_worker() -> threading.Thread:
    thread = threading.Thread(target=_loop, name="processing-worker", daemon=True)
    thread.start()
    return thread


def stop_worker() -> None:
    _STOP.set()


def _loop() -> None:
    while not _STOP.is_set():
        job = claim_next_job()
        if not job:
            time.sleep(0.5)
            continue

        try:
            if job["kind"] != "document_import":
                raise ValueError(f"Unsupported job kind: {job['kind']}")
            _process_document_import(job)
        except Exception as exc:  # worker boundary: persist failures, never crash loop
            update_job(
                job["id"],
                status="failed",
                progress=100,
                error=f"{type(exc).__name__}: {exc}",
            )


def _process_document_import(job: dict) -> None:
    request = job["request"]
    update_job(job["id"], progress=5)

    source_url = str(request["source_url"])
    _validate_source_url(source_url)

    suffix = Path(request["filename"]).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        temp_path = Path(handle.name)

    try:
        with httpx.stream("GET", source_url, timeout=120, follow_redirects=True) as response:
            response.raise_for_status()
            max_bytes = int(os.getenv("PROCESSING_MAX_SOURCE_BYTES", str(1024 * 1024 * 1024)))
            total = 0
            with temp_path.open("wb") as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("Source file exceeds processing size limit")
                    output.write(chunk)

        update_job(job["id"], progress=25)
        extraction = extract_document(
            temp_path,
            request["filename"],
            request.get("mime_type"),
        )
        update_job(
            job["id"],
            progress=65,
            extraction_method=extraction.method,
        )

        items = detect_candidates(extraction)
        profile = request.get("profile") or {}
        _apply_profile(items, profile)

        auto_threshold = float(profile.get("auto_approve_confidence", 0.95))
        needs_review = (
            request.get("mode") != "auto"
            or any(item["confidence"] < auto_threshold for item in items)
            or any(
                item["item_type"] == "question"
                and _question_missing_answer(item["payload"])
                for item in items
            )
        )

        stats = {
            **extraction.stats,
            "items": len(items),
            "questions": sum(1 for item in items if item["item_type"] == "question"),
            "low_confidence": sum(1 for item in items if item["confidence"] < 0.9),
        }
        update_job(
            job["id"],
            status="needs_review" if needs_review else "completed",
            progress=100,
            result={"items": items, "stats": stats},
            extraction_method=extraction.method,
        )
    finally:
        temp_path.unlink(missing_ok=True)




def _apply_profile(items: list[dict], profile: dict) -> None:
    learning_language = profile.get("learning_language")
    level = profile.get("level")
    status = profile.get("status") or "draft"
    expected_content = profile.get("expected_content") or "auto"

    for item in items:
        if expected_content == "questions" and item["item_type"] != "question":
            item["confidence"] = min(float(item["confidence"]), 0.4)
        if item["item_type"] != "question":
            continue

        payload = item.get("payload") or {}
        if learning_language and not payload.get("learning_language"):
            payload["learning_language"] = learning_language
        if level and not payload.get("level"):
            payload["level"] = level
        payload["status"] = status
        item["payload"] = payload


def _question_missing_answer(payload: dict) -> bool:
    answer = payload.get("answer_key") or {}
    if "correct" in answer:
        return not bool(answer["correct"])
    if "blanks" in answer:
        return not all(bool(slot) for slot in answer["blanks"])
    return False


def _validate_source_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only HTTP(S) source URLs are accepted")

    allowed = {
        host.strip().lower()
        for host in os.getenv("PROCESSING_ALLOWED_SOURCE_HOSTS", "").split(",")
        if host.strip()
    }
    if allowed and (parsed.hostname or "").lower() not in allowed:
        raise ValueError("Source URL host is not allow-listed")
