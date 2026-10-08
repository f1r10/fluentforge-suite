from __future__ import annotations

import hmac
import os
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Response

from .models import DocumentImportRequest, JobCreated, JobView, PdfReportRequest, TranscriptionRequest, YouTubeImportRequest
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





@app.post(
    "/v1/jobs/transcription",
    response_model=JobCreated,
    dependencies=[Depends(verify_key)],
)
def submit_transcription(request: TranscriptionRequest):
    job_id = create_job("transcription", request.model_dump(mode="json"))
    return JobCreated(job_id=job_id, status="queued")

@app.post(
    "/v1/jobs/youtube-import",
    response_model=JobCreated,
    dependencies=[Depends(verify_key)],
)
def submit_youtube_import(request: YouTubeImportRequest):
    job_id = create_job("youtube_import", request.model_dump(mode="json"))
    return JobCreated(job_id=job_id, status="queued")


@app.post(
    "/v1/reports/pdf",
    dependencies=[Depends(verify_key)],
)
def render_pdf_report(request: PdfReportRequest):
    with tempfile.TemporaryDirectory(prefix="fluentforge-pdf-") as temp_dir:
        temp_path = Path(temp_dir)
        source_path = temp_path / "report.html"
        source_path.write_text(request.html, encoding="utf-8")

        command = [
            "libreoffice",
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            "--norestore",
            "--convert-to",
            "pdf:writer_pdf_Export",
            "--outdir",
            str(temp_path),
            str(source_path),
        ]

        try:
            completed = subprocess.run(
                command,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=90,
                env={
                    **os.environ,
                    "HOME": temp_dir,
                },
            )
        except subprocess.TimeoutExpired as error:
            raise HTTPException(
                status_code=504,
                detail="PDF conversion timed out",
            ) from error

        pdf_path = temp_path / "report.pdf"
        if completed.returncode != 0 or not pdf_path.exists():
            stderr = completed.stderr.decode("utf-8", errors="replace")
            stdout = completed.stdout.decode("utf-8", errors="replace")
            detail = (stderr or stdout or "PDF conversion failed")[:2000]
            raise HTTPException(status_code=500, detail=detail)

        payload = pdf_path.read_bytes()
        if not payload.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=500,
                detail="PDF converter returned an invalid document",
            )
        if len(payload) > 64 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail="Rendered PDF exceeds the 64 MB safety limit",
            )

        return Response(
            content=payload,
            media_type="application/pdf",
            headers={
                "cache-control": "no-store",
                "content-disposition": 'attachment; filename="report.pdf"',
            },
        )


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
        result=result,
    )
