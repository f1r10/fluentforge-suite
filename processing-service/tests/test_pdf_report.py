from types import SimpleNamespace

from app.main import render_docx_report, render_pdf_report
from app.models import DocxReportRequest, PdfReportRequest


def test_render_pdf_report_returns_pdf(monkeypatch):
    def fake_run(command, **_kwargs):
        outdir = command[command.index("--outdir") + 1]
        with open(f"{outdir}/report.pdf", "wb") as handle:
            handle.write(b"%PDF-1.4\n% fluentforge test\n")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr("app.main.subprocess.run", fake_run)

    response = render_pdf_report(
        PdfReportRequest(
            html="<html><body><h1>FluentForge</h1></body></html>"
        )
    )

    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF-")


def test_render_pdf_report_rejects_invalid_converter_output(monkeypatch):
    def fake_run(command, **_kwargs):
        outdir = command[command.index("--outdir") + 1]
        with open(f"{outdir}/report.pdf", "wb") as handle:
            handle.write(b"not a pdf")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr("app.main.subprocess.run", fake_run)

    try:
        render_pdf_report(
            PdfReportRequest(
                html="<html><body>Broken converter output</body></html>"
            )
        )
    except Exception as error:
        assert getattr(error, "status_code", None) == 500
    else:
        raise AssertionError("Expected invalid PDF output to be rejected")



def test_render_docx_report_returns_docx(monkeypatch):
    def fake_run(command, **_kwargs):
        outdir = command[command.index("--outdir") + 1]
        with open(f"{outdir}/report.docx", "wb") as handle:
            handle.write(b"PK\x03\x04fluentforge-docx-test")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr("app.main.subprocess.run", fake_run)

    response = render_docx_report(
        DocxReportRequest(
            html="<html><body><h1>FluentForge Readings</h1></body></html>"
        )
    )

    assert response.status_code == 200
    assert response.media_type == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.body.startswith(b"PK\x03\x04")
