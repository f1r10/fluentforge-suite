from __future__ import annotations

import hashlib
import mimetypes
import os
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yt_dlp

from .extractors import detect_candidates, extract_document
from .store import claim_next_job, update_job
from .transcriber import transcribe


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
            if job["kind"] == "document_import":
                _process_document_import(job)
            elif job["kind"] == "transcription":
                _process_transcription(job)
            elif job["kind"] == "youtube_import":
                _process_youtube_import(job)
            else:
                raise ValueError(f"Unsupported job kind: {job['kind']}")
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

    temp_path = _download_source(
        str(request["source_url"]),
        request["filename"],
    )

    try:
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

        profile = request.get("profile") or {}
        items = detect_candidates(extraction, profile=profile)
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




def _process_transcription(job: dict) -> None:
    request = job["request"]
    update_job(job["id"], progress=5)

    temp_path = _download_source(
        str(request["source_url"]),
        request["filename"],
    )

    try:
        update_job(job["id"], progress=25)
        result = transcribe(
            temp_path,
            language=request.get("language"),
        )
        update_job(
            job["id"],
            status="completed",
            progress=100,
            result=result,
            extraction_method="faster_whisper",
        )
    finally:
        temp_path.unlink(missing_ok=True)


def _process_youtube_import(job: dict) -> None:
    request = job["request"]
    source_url = str(request["source_url"])
    upload_url = str(request["upload_url"])
    max_bytes = int(request["max_bytes"])
    preferred_height = int(request.get("preferred_height") or 1080)

    _validate_youtube_url(source_url)
    _validate_upload_url(upload_url)
    update_job(job["id"], progress=5)

    with tempfile.TemporaryDirectory(prefix="fluentforge-youtube-") as temp_dir:
        output_template = str(Path(temp_dir) / "download.%(ext)s")
        cookies_file = os.getenv("YTDLP_COOKIES_FILE") or None

        ydl_opts = {
            "format": (
                f"bestvideo[height<={preferred_height}]+bestaudio/"
                f"best[height<={preferred_height}]/best"
            ),
            "merge_output_format": "mp4",
            "outtmpl": output_template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "max_filesize": max_bytes,
            "socket_timeout": 30,
            "retries": 3,
            "fragment_retries": 3,
            "overwrites": False,
        }
        if cookies_file:
            ydl_opts["cookiefile"] = cookies_file

        update_job(job["id"], progress=15)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)

        if not isinstance(info, dict):
            raise ValueError("YouTube extractor returned no media metadata")

        files = [
            path
            for path in Path(temp_dir).iterdir()
            if path.is_file()
            and path.suffix.lower() not in {".part", ".ytdl", ".json"}
        ]
        if not files:
            raise ValueError("YouTube download produced no media file")

        media_path = max(files, key=lambda path: path.stat().st_size)
        size_bytes = media_path.stat().st_size
        if size_bytes <= 0:
            raise ValueError("Downloaded media is empty")
        if size_bytes > max_bytes:
            raise ValueError("Downloaded YouTube media exceeds configured size limit")

        update_job(job["id"], progress=75)
        checksum = _sha256_file(media_path)
        mime_type = (
            mimetypes.guess_type(media_path.name)[0]
            or "video/mp4"
        )
        _upload_file(
            upload_url,
            media_path,
            mime_type,
            max_bytes,
        )

        update_job(
            job["id"],
            status="completed",
            progress=100,
            extraction_method="yt_dlp",
            result={
                "title": str(info.get("title") or "YouTube video")[:500],
                "source_id": str(info.get("id") or "")[:200],
                "webpage_url": str(info.get("webpage_url") or source_url)[:2000],
                "uploader": str(info.get("uploader") or "")[:500] or None,
                "channel": str(info.get("channel") or "")[:500] or None,
                "duration_seconds": _number_or_none(info.get("duration")),
                "width": _int_or_none(info.get("width")),
                "height": _int_or_none(info.get("height")),
                "thumbnail": str(info.get("thumbnail") or "")[:2000] or None,
                "filename": _safe_media_filename(
                    str(info.get("title") or "youtube-video"),
                    media_path.suffix,
                ),
                "mime_type": mime_type,
                "size_bytes": size_bytes,
                "checksum_sha256": checksum,
                "extractor": str(info.get("extractor_key") or "Youtube")[:200],
            },
        )


def _validate_youtube_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only HTTP(S) YouTube URLs are accepted")

    host = (parsed.hostname or "").lower().rstrip(".")
    allowed = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
    }
    if host not in allowed:
        raise ValueError("Only YouTube URLs are accepted")

    if "list" in dict(
        item.split("=", 1) if "=" in item else (item, "")
        for item in parsed.query.split("&")
        if item
    ):
        raise ValueError("Playlist imports are not allowed; import one video URL")


def _validate_upload_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only HTTP(S) upload URLs are accepted")

    allowed = {
        host.strip().lower()
        for host in (
            os.getenv("PROCESSING_ALLOWED_UPLOAD_HOSTS", "")
            or os.getenv("PROCESSING_ALLOWED_SOURCE_HOSTS", "")
        ).split(",")
        if host.strip()
    }
    if allowed and (parsed.hostname or "").lower() not in allowed:
        raise ValueError("Upload URL host is not allow-listed")


def _upload_file(
    url: str,
    media_path: Path,
    mime_type: str,
    max_bytes: int,
) -> None:
    size = media_path.stat().st_size
    if size > max_bytes:
        raise ValueError("Media exceeds configured upload size limit")

    def chunks():
        with media_path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

    timeout = httpx.Timeout(900.0, connect=30.0)
    headers = {
        "content-type": mime_type,
        "cache-control": "max-age=3600",
        "x-upsert": "false",
    }
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.put(url, content=chunks(), headers=headers)
        response.raise_for_status()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _safe_media_filename(title: str, suffix: str) -> str:
    cleaned = "".join(
        char if char.isalnum() or char in {" ", "-", "_", "."} else "-"
        for char in title
    )
    cleaned = "-".join(cleaned.split()).strip("-_.")[:180] or "youtube-video"
    extension = suffix.lower() if suffix.startswith(".") else f".{suffix}"
    return f"{cleaned}{extension or '.mp4'}"


def _number_or_none(value):
    try:
        number = float(value)
        return number if number >= 0 else None
    except (TypeError, ValueError):
        return None


def _int_or_none(value):
    try:
        number = int(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def _download_source(url: str, filename: str) -> Path:
    _validate_source_url(url)
    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        temp_path = Path(handle.name)

    try:
        with httpx.stream("GET", url, timeout=120, follow_redirects=True) as response:
            response.raise_for_status()
            max_bytes = int(
                os.getenv(
                    "PROCESSING_MAX_SOURCE_BYTES",
                    str(1024 * 1024 * 1024),
                )
            )
            total = 0
            with temp_path.open("wb") as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("Source file exceeds processing size limit")
                    output.write(chunk)
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _apply_profile(items: list[dict], profile: dict) -> None:
    learning_language = profile.get("learning_language")
    level = profile.get("level")
    status = profile.get("status") or "draft"
    expected_content = profile.get("expected_content") or "auto"

    for item in items:
        item_type = item["item_type"]
        if expected_content == "questions" and item_type != "question":
            item["confidence"] = min(float(item["confidence"]), 0.4)
        elif expected_content == "readings" and item_type not in {"reading", "question"}:
            item["confidence"] = min(float(item["confidence"]), 0.4)
        elif expected_content == "listenings" and item_type not in {"listening", "question"}:
            item["confidence"] = min(float(item["confidence"]), 0.4)

        if item_type not in {"question", "reading", "listening"}:
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
