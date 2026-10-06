from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException

from .models import DocumentImportRequest, JobCreated, JobView
from .store import create_job, get_job, init_db
from .worker import start_worker, stop_worker


def verify_key(x_processing_key: str | None = Header(default=None)) -> None:
    configured = os.getenv("PROCESSING_SHARED_SECRET", "")
    if not configured:
        return
    if not x_processing_key or not hmac.compare_digest(configured, x_processing_key):
        raise HTTPException(status_code=401, detail="Invalid processing key")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    start_worker()
    yield
    stop_worker()


app = FastAPI(
    title="FluentForge Processing Service",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post(
    "/v1/jobs/document-import",
    response_model=JobCreated,
    dependencies=[Depends(verify_key)],
)
def submit_document_import(request: DocumentImportRequest):
    job_id = create_job("document_import", request.model_dump(mode="json"))
    return JobCreated(job_id=job_id, status="queued")


@app.get(
    "/v1/jobs/{job_id}",
    response_model=JobView,
    dependencies=[Depends(verify_key)],
)
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = job.get("result") or {}
    return JobView(
        job_id=job["id"],
        status=job["status"],
        progress=job["progress"],
        extraction_method=job.get("extraction_method"),
        error=job.get("error"),
        stats=result.get("stats") or {},
        items=result.get("items") or [],
    )
