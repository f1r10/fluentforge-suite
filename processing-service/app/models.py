from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


JobStatus = Literal["queued", "processing", "needs_review", "completed", "failed"]


class DocumentImportRequest(BaseModel):
    source_file_id: str
    source_url: HttpUrl
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str | None = Field(default=None, max_length=255)
    mode: Literal["review", "auto"] = "review"
    profile: dict[str, Any] | None = None


class JobCreated(BaseModel):
    job_id: str
    status: JobStatus


class ImportCandidate(BaseModel):
    item_type: Literal["question", "vocabulary", "reading", "listening", "raw_text"]
    page: int | None = None
    sheet: str | None = None
    payload: dict[str, Any]
    crop: dict[str, float] | None = None
    confidence: float = Field(ge=0, le=1)


class JobView(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    extraction_method: str | None = None
    error: str | None = None
    stats: dict[str, Any] = Field(default_factory=dict)
    items: list[ImportCandidate] = Field(default_factory=list)
