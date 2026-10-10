from __future__ import annotations

import os
from pathlib import Path
from typing import Any


_MODEL = None
_MODEL_KEY: tuple[str, str, str, bool] | None = None


def transcribe(path: Path, language: str | None = None) -> dict[str, Any]:
    model = _get_model()
    beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

    segments, info = model.transcribe(
        str(path),
        language=language or None,
        beam_size=beam_size,
        vad_filter=os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true",
        condition_on_previous_text=True,
    )

    out_segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        out_segments.append(
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
            }
        )
        text_parts.append(text)

    return {
        "transcript": " ".join(text_parts).strip(),
        "segments": out_segments,
        "language": getattr(info, "language", language),
        "language_probability": float(
            getattr(info, "language_probability", 0.0) or 0.0
        ),
        "duration": float(getattr(info, "duration", 0.0) or 0.0),
        "model": _model_name(),
    }


def _model_name() -> str:
    return os.getenv("WHISPER_MODEL_PATH") or os.getenv("WHISPER_MODEL", "small")


def _get_model():
    global _MODEL, _MODEL_KEY

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Build the processing Docker image "
            "with requirements-whisper.txt."
        ) from exc

    model_name = _model_name()
    device = os.getenv("WHISPER_DEVICE", "auto")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
    local_only = os.getenv("WHISPER_LOCAL_FILES_ONLY", "false").lower() == "true"
    key = (model_name, device, compute_type, local_only)

    if _MODEL is None or _MODEL_KEY != key:
        _MODEL = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=local_only,
            download_root=os.getenv("WHISPER_MODEL_CACHE", "/models/whisper"),
        )
        _MODEL_KEY = key

    return _MODEL
