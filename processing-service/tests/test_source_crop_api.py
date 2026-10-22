from pathlib import Path

import fitz
from fastapi.testclient import TestClient
from PIL import Image
import io

from app import main


def make_pdf(path: Path):
    with fitz.open() as doc:
        page = doc.new_page(width=400, height=300)
        page.draw_rect(fitz.Rect(50, 60, 200, 200), color=(0, 0, 0), fill=(1, 0, 0))
        doc.save(path)


def test_private_source_crop_renders_bounded_png(tmp_path, monkeypatch):
    file = tmp_path / "fixture.pdf"
    make_pdf(file)
    monkeypatch.setattr(main, "_download_source", lambda _url, _name: file)
    monkeypatch.setenv("PROCESSING_SHARED_SECRET", "test-shared-secret")
    client = TestClient(main.app)
    payload = {
        "source_url": "https://example.com/signed/document.pdf",
        "filename": "fixture.pdf",
        "page": 1,
        "crop": {"x": 0.1, "y": 0.15, "width": 0.5, "height": 0.6},
    }
    assert client.post("/v1/documents/pdf-crop", json=payload).status_code == 401
    response = client.post("/v1/documents/pdf-crop", json=payload,
                           headers={"x-processing-key": "test-shared-secret"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/png")
    image = Image.open(io.BytesIO(response.content))
    assert image.width > 100 and image.height > 100
    assert response.headers["cache-control"] == "no-store"


def test_invalid_pdf_crop_does_not_fetch_source(monkeypatch):
    def reject_fetch(*_args):
        raise AssertionError("Invalid crop should not download source")
    monkeypatch.setattr(main, "_download_source", reject_fetch)
    monkeypatch.delenv("PROCESSING_SHARED_SECRET", raising=False)
    client = TestClient(main.app)
    response = client.post("/v1/documents/pdf-crop", json={
        "source_url": "https://example.com/document.pdf",
        "filename": "fixture.pdf", "page": 1,
        "crop": {"x": 0.9, "y": 0.2, "width": 0.5, "height": 0.1},
    })
    assert response.status_code == 422
