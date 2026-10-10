from __future__ import annotations

import csv
import io
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
import openpyxl
import pytesseract
import xlrd
from docx import Document
from PIL import Image


@dataclass
class Extraction:
    method: str
    pages: list[dict[str, Any]]
    sheets: list[dict[str, Any]]
    full_text: str
    stats: dict[str, Any]


QUESTION_RE = re.compile(r"^\s*(\d{1,4})[\.)](?:\s+|(?=[A-Z]))(.+?)\s*$")
QUESTION_NUMBER_ONLY_RE = re.compile(r"^\s*(\d{1,4})[\.)]\s*$")
OPTION_RE = re.compile(r"^\s*([A-Ha-h])[\.)]\s+(.+?)\s*$")
INLINE_OPTION_RE = re.compile(
    r"(?<!\w)([A-Ha-h])[\.)]\s*(.*?)(?=(?:\s+[A-Ha-h][\.)]\s*)|$)"
)
ANSWER_RE = re.compile(
    r"^\s*(answer\s*key|answers?|cavab(?:lar)?|cevap(?:lar)?|ответы?)\s*[:\-]\s*(.*)$",
    re.IGNORECASE,
)
ANSWER_SECTION_HEADING_RE = re.compile(
    r"^\s*(?:answer\s*key|answers?|cavablar|cevaplar|ответы?|answers?\s+to\s+.{0,120}\b(?:test|exercise|questions?)\b)\s*:?[\s\-]*$",
    re.IGNORECASE,
)
ANSWER_PAIR_RE = re.compile(r"(\d{1,4})\s*[-.:)]?\s*([A-H]|True|False|Yes|No|Not Given)", re.IGNORECASE)
LISTENING_TASK_RE = re.compile(r"^\s*Listening\s+Task\s+(\d+)\s*:?\s*$", re.IGNORECASE | re.MULTILINE)


def extract_document(path: Path, filename: str, mime_type: str | None) -> Extraction:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf" or mime_type == "application/pdf":
        return _extract_pdf(path)
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix in {".doc", ".rtf"}:
        return _extract_legacy_word(path)
    if suffix == ".xlsx":
        return _extract_xlsx(path)
    if suffix == ".xls":
        return _extract_xls(path)
    if suffix in {".csv", ".tsv"}:
        return _extract_delimited(path, "\t" if suffix == ".tsv" else ",")
    if suffix in {".txt", ".md", ".rtf"} or (mime_type or "").startswith("text/"):
        text = path.read_text("utf-8", errors="replace")
        return Extraction("native_text", [{"page": 1, "text": text}], [], text, {"pages": 1})
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"} or (mime_type or "").startswith("image/"):
        return _extract_image(path)
    raise ValueError(f"Unsupported document type: {suffix or mime_type or 'unknown'}")


def _extract_pdf(path: Path) -> Extraction:
    doc = fitz.open(path)
    pages: list[dict[str, Any]] = []
    used_ocr = False
    chunks: list[str] = []
    total_tables = 0
    total_images = 0

    for index, page in enumerate(doc):
        rect = page.rect
        blocks = _page_blocks(page)
        native_text = page.get_text("text", sort=False).strip()
        if not native_text:
            native_text = "\n".join(
                block["text"] for block in blocks if block["text"]
            ).strip()
        text = native_text
        method = "native"

        if len(text) < 40:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.open(io.BytesIO(pix.tobytes("png")))
            ocr_text = pytesseract.image_to_string(image, lang=_ocr_languages()).strip()
            if len(ocr_text) > len(text):
                text = ocr_text
                method = "ocr"
                used_ocr = True

        tables = _page_tables(page)
        images = _page_images(page)
        total_tables += len(tables)
        total_images += len(images)

        pages.append(
            {
                "page": index + 1,
                "text": text,
                "method": method,
                "width": float(rect.width),
                "height": float(rect.height),
                "blocks": blocks,
                "tables": tables,
                "images": images,
            }
        )
        chunks.append(text)

    return Extraction(
        "pdf_layout_ocr" if used_ocr else "pdf_layout_native",
        pages,
        [],
        "\n\n".join(chunks),
        {
            "pages": len(pages),
            "ocr_pages": sum(1 for p in pages if p["method"] == "ocr"),
            "tables": total_tables,
            "image_regions": total_images,
        },
    )


def _page_blocks(page: fitz.Page) -> list[dict[str, Any]]:
    rect = page.rect
    raw = page.get_text("blocks")
    blocks: list[dict[str, Any]] = []
    for block in raw:
        if len(block) < 5:
            continue
        x0, y0, x1, y1, text = block[:5]
        cleaned = str(text).strip()
        if not cleaned:
            continue
        blocks.append(
            {
                "text": cleaned,
                "crop": _normalized_crop(rect, (x0, y0, x1, y1)),
            }
        )
    blocks.sort(key=lambda item: (item["crop"]["y"], item["crop"]["x"]))
    return blocks


def _page_tables(page: fitz.Page) -> list[dict[str, Any]]:
    rect = page.rect
    out: list[dict[str, Any]] = []
    try:
        finder = page.find_tables()
        for table in finder.tables:
            rows = [
                ["" if cell is None else str(cell).strip() for cell in row]
                for row in table.extract()
            ]
            if not rows:
                continue
            out.append(
                {
                    "rows": rows,
                    "crop": _normalized_crop(rect, table.bbox),
                }
            )
    except Exception:
        return []
    return out


def _page_images(page: fitz.Page) -> list[dict[str, Any]]:
    rect = page.rect
    out: list[dict[str, Any]] = []
    seen: set[tuple[int, float, float, float, float]] = set()
    for image in page.get_images(full=True):
        xref = int(image[0])
        try:
            image_rects = page.get_image_rects(xref)
        except Exception:
            image_rects = []
        for image_rect in image_rects:
            key = (
                xref,
                round(float(image_rect.x0), 2),
                round(float(image_rect.y0), 2),
                round(float(image_rect.x1), 2),
                round(float(image_rect.y1), 2),
            )
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "xref": xref,
                    "crop": _normalized_crop(
                        rect,
                        (image_rect.x0, image_rect.y0, image_rect.x1, image_rect.y1),
                    ),
                }
            )
    return out


def _normalized_crop(
    page_rect: fitz.Rect,
    bbox: tuple[float, float, float, float] | fitz.Rect,
) -> dict[str, float]:
    if isinstance(bbox, fitz.Rect):
        x0, y0, x1, y1 = bbox.x0, bbox.y0, bbox.x1, bbox.y1
    else:
        x0, y0, x1, y1 = bbox
    width = max(float(page_rect.width), 1.0)
    height = max(float(page_rect.height), 1.0)
    return {
        "x": max(0.0, min(1.0, float(x0) / width)),
        "y": max(0.0, min(1.0, float(y0) / height)),
        "width": max(0.0, min(1.0, (float(x1) - float(x0)) / width)),
        "height": max(0.0, min(1.0, (float(y1) - float(y0)) / height)),
    }


def _extract_legacy_word(path: Path) -> Extraction:
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        raise ValueError(
            "Legacy DOC/RTF import requires LibreOffice in the processing container"
        )

    with tempfile.TemporaryDirectory() as directory:
        result = subprocess.run(
            [
                executable,
                "--headless",
                "--convert-to",
                "docx",
                "--outdir",
                directory,
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(
                f"LibreOffice conversion failed: {(result.stderr or result.stdout).strip()[:1000]}"
            )

        converted = Path(directory) / (path.stem + ".docx")
        if not converted.exists():
            candidates = list(Path(directory).glob("*.docx"))
            if not candidates:
                raise ValueError("LibreOffice did not produce a DOCX file")
            converted = candidates[0]

        extracted = _extract_docx(converted)
        return Extraction(
            "legacy_word_via_libreoffice",
            extracted.pages,
            extracted.sheets,
            extracted.full_text,
            {**extracted.stats, "converted_from": path.suffix.lower()},
        )


def _extract_docx(path: Path) -> Extraction:
    doc = Document(path)
    blocks: list[str] = []
    for paragraph in doc.paragraphs:
        value = paragraph.text.strip()
        if value:
            blocks.append(value)
    for table in doc.tables:
        for row in table.rows:
            values = [cell.text.strip() for cell in row.cells]
            if any(values):
                blocks.append("\t".join(values))
    text = "\n".join(blocks)
    return Extraction("docx_native", [{"page": 1, "text": text}], [], text, {"paragraphs": len(blocks)})


def _extract_xlsx(path: Path) -> Extraction:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets: list[dict[str, Any]] = []
    all_text: list[str] = []
    for worksheet in workbook.worksheets:
        rows: list[list[str]] = []
        for row in worksheet.iter_rows(values_only=True):
            values = ["" if value is None else str(value) for value in row]
            if any(value.strip() for value in values):
                rows.append(values)
        text = "\n".join("\t".join(row) for row in rows)
        sheets.append({"sheet": worksheet.title, "rows": rows, "text": text})
        all_text.append(text)
    return Extraction("xlsx_native", [], sheets, "\n\n".join(all_text), {"sheets": len(sheets)})


def _extract_xls(path: Path) -> Extraction:
    workbook = xlrd.open_workbook(path)
    sheets: list[dict[str, Any]] = []
    all_text: list[str] = []
    for worksheet in workbook.sheets():
        rows: list[list[str]] = []
        for row_index in range(worksheet.nrows):
            values = [str(worksheet.cell_value(row_index, col)) for col in range(worksheet.ncols)]
            if any(value.strip() for value in values):
                rows.append(values)
        text = "\n".join("\t".join(row) for row in rows)
        sheets.append({"sheet": worksheet.name, "rows": rows, "text": text})
        all_text.append(text)
    return Extraction("xls_native", [], sheets, "\n\n".join(all_text), {"sheets": len(sheets)})


def _extract_delimited(path: Path, delimiter: str) -> Extraction:
    raw = path.read_text("utf-8-sig", errors="replace")
    chosen = delimiter
    try:
        dialect = csv.Sniffer().sniff(raw[:32_768], delimiters=",;\t|")
        chosen = dialect.delimiter
    except csv.Error:
        chosen = delimiter

    rows = list(csv.reader(io.StringIO(raw), delimiter=chosen))
    rows = [
        [str(cell) for cell in row]
        for row in rows
        if any(str(cell).strip() for cell in row)
    ]
    name = path.stem
    text = "\n".join("\t".join(row) for row in rows)
    return Extraction(
        "delimited_native",
        [],
        [{"sheet": name, "rows": rows, "text": text}],
        text,
        {"rows": len(rows), "delimiter": chosen},
    )


def _extract_image(path: Path) -> Extraction:
    image = Image.open(path)
    text = pytesseract.image_to_string(image, lang=_ocr_languages()).strip()
    return Extraction("image_ocr", [{"page": 1, "text": text, "method": "ocr"}], [], text, {"pages": 1})


def _questions_from_fluentforge_export(
    extraction: Extraction,
) -> list[dict[str, Any]] | None:
    """Reconstruct the platform's own paginated Question Bank PDF export.

    The PDF print layout can wrap one question across page boundaries. A fresh
    question starts only at a typed export heading; nested numbered exercises
    and text accidentally embedded inside an option are not new headings.
    """
    if not extraction.pages or not any(
        "FluentForge Question Bank" in str(page.get("text") or "")
        for page in extraction.pages[:2]
    ):
        return None

    header = re.compile(
        r"^\s*(\d{1,4})\.\s+Single\s+Choice\s*[·•]\s*([A-Za-z]{2,5})\s*$",
        re.IGNORECASE,
    )
    typed_header = re.compile(r"^\s*\d{1,4}\.\s+[^.\n]{2,60}[·•]\s*[A-Za-z]{2,5}\s*$")
    option = re.compile(r"^\s*([A-Oa-o])[.)]\s*(.+?)\s*$")
    embedded = re.compile(
        r"(?<!\w)\d{1,3}[.,]\s*(?=(?:Choose|Which|What|When|Where|How|"
        r"Fill|Select|Complete|Identify|Match|Find|Write)\b)",
        re.IGNORECASE,
    )
    footer = re.compile(r"\bEnd of Section\b", re.IGNORECASE)
    raw_questions: list[dict[str, Any]] = []

    for page in extraction.pages:
        for raw_line in str(page.get("text") or "").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            match = header.match(line)
            if match:
                raw_questions.append(
                    {
                        "number": int(match.group(1)),
                        "language": match.group(2).lower(),
                        "page": page.get("page"),
                        "lines": [],
                    }
                )
                continue
            # Do not partially interpret exports containing other question
            # types. Generic processing remains the safe fallback.
            if typed_header.match(line):
                return None
            if raw_questions and not line.startswith("Generated:"):
                raw_questions[-1]["lines"].append(line)

    if not raw_questions:
        return None

    out: list[dict[str, Any]] = []
    for raw in raw_questions:
        prompt: list[str] = []
        options: list[dict[str, str]] = []
        warnings: list[str] = []
        foreign_question_tail = False

        for line in raw["lines"]:
            if foreign_question_tail:
                # Keep its source page in the uploaded PDF; do not turn the
                # unrelated fragment into an option or a synthetic question.
                continue

            choice = option.match(line)
            if choice:
                letter, value = choice.group(1).lower(), choice.group(2).strip()
                embedded_match = embedded.search(value)
                if embedded_match:
                    warnings.append(
                        f"Source PDF contains a second numbered question inside option {letter.upper()}."
                    )
                    value = value[: embedded_match.start()].strip()
                    foreign_question_tail = True

                footer_match = footer.search(value)
                if footer_match:
                    warnings.append(
                        f"Source PDF contains a section footer inside option {letter.upper()}."
                    )
                    value = value[: footer_match.start()].strip()

                if letter > "h":
                    warnings.append(f"Unexpected option {letter.upper()} in source PDF.")
                    continue
                if not value:
                    warnings.append(f"Option {letter.upper()} has no text in source PDF.")
                    continue
                if any(existing["id"] == letter for existing in options):
                    warnings.append(f"Repeated option {letter.upper()} in source PDF.")
                    continue
                options.append({"id": letter, "text": value})
            elif options:
                options[-1]["text"] = f"{options[-1]['text']} {line}".strip()
            elif line != "FluentForge Question Bank":
                prompt.append(line)

        if len(options) < 2:
            warnings.append("Fewer than two answer options were recovered.")
        if not prompt:
            warnings.append("Question text is missing from source PDF.")

        payload = {
            "question_type": "single_choice",
            "prompt": "\n".join(prompt).strip(),
            "learning_language": raw["language"],
            "payload": {"options": options},
            "answer_key": {"correct": []},
            "status": "draft",
        }
        if warnings:
            # The review API treats these as needs_fix, including bulk
            # approvals. The original PDF remains available for manual repair.
            payload["import_warnings"] = warnings

        out.append(
            {
                "item_type": "question",
                "page": raw["page"],
                "sheet": None,
                "crop": None,
                "payload": payload,
                "confidence": 0.35 if warnings else 0.77,
            }
        )

    return out


def detect_candidates(
    extraction: Extraction,
    profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    spreadsheet_mapping = _spreadsheet_mapping(profile)
    expected_content = str((profile or {}).get("expected_content") or "auto")
    if expected_content in {"auto", "questions", "mixed"}:
        exported_questions = _questions_from_fluentforge_export(extraction)
        if exported_questions is not None:
            return exported_questions
    global_answers = _extract_global_answer_key(extraction.full_text)

    for page in extraction.pages:
        page_number = page.get("page")
        question_crops = _question_crop_map(page)

        if expected_content == "vocabulary":
            table_items: list[dict[str, Any]] = []
            for table in page.get("tables") or []:
                rows = table.get("rows") or []
                # PDF grid lines often make PyMuPDF split one visual word-list
                # row across 10+ mostly empty cells. Treat those as layout,
                # not as a spreadsheet: the native text layer preserves the
                # complete row much more accurately.
                if not _is_usable_vocabulary_table(rows):
                    continue
                table_items.extend(
                    _vocabulary_from_rows(
                        rows,
                        page=page_number,
                        sheet=None,
                        profile=profile,
                        crop=table.get("crop"),
                    )
                )
            if table_items:
                candidates.extend(table_items)
            else:
                candidates.extend(
                    _vocabulary_from_text(
                        str(page.get("text") or ""),
                        page=page_number,
                        profile=profile,
                    )
                )
            continue

        if expected_content == "listenings":
            listening_groups = _listening_task_groups(
                page,
                question_crops=question_crops,
                global_answers=global_answers,
            )
            if listening_groups:
                for context_item, grouped_questions in listening_groups:
                    source_ref = str(context_item["payload"]["source_ref"])
                    candidates.append(context_item)
                    for index, question in enumerate(grouped_questions):
                        payload = question.get("payload") or {}
                        payload["import_context"] = {
                            "kind": "listening",
                            "source_ref": source_ref,
                            "sort_order": index,
                            "assets": _nearby_assets(page, question.get("crop")),
                        }
                        question["payload"] = payload
                        question["confidence"] = min(
                            0.98,
                            float(question.get("confidence") or 0) + 0.03,
                        )
                    candidates.extend(grouped_questions)
                continue

        questions = _questions_from_text(
            page.get("text", ""),
            page=page_number,
            question_crops=question_crops,
            global_answers=global_answers,
        )

        context_item: dict[str, Any] | None = None
        context_kind: str | None = None
        if expected_content == "readings":
            context_item = _reading_candidate_from_page(page, questions, explicit=True)
            context_kind = "reading" if context_item else None
        elif expected_content == "listenings":
            context_item = _listening_candidate_from_page(page, questions)
            context_kind = "listening" if context_item else None
        elif expected_content not in {"questions", "vocabulary"}:
            context_item = _reading_candidate_from_page(page, questions)
            context_kind = "reading" if context_item else None

        if context_item and context_kind:
            source_ref = str(context_item["payload"]["source_ref"])
            candidates.append(context_item)
            for index, question in enumerate(questions):
                payload = question.get("payload") or {}
                payload["import_context"] = {
                    "kind": context_kind,
                    "source_ref": source_ref,
                    "sort_order": index,
                    "assets": _nearby_assets(page, question.get("crop")),
                }
                question["payload"] = payload
                question["confidence"] = min(
                    0.98,
                    float(question.get("confidence") or 0) + 0.03,
                )
        else:
            for question in questions:
                assets = _nearby_assets(page, question.get("crop"))
                if assets:
                    payload = question.get("payload") or {}
                    payload["import_context"] = {
                        "kind": "independent",
                        "assets": assets,
                    }
                    question["payload"] = payload

        candidates.extend(questions)

        layout = _page_layout_elements(page)
        associated_asset_keys = {
            _asset_key(asset)
            for question in questions
            for asset in (
                (question.get("payload") or {})
                .get("import_context", {})
                .get("assets", [])
            )
        }

        for element in layout:
            if element["kind"] not in {"table", "image_region"}:
                continue
            if _asset_key(element) in associated_asset_keys:
                continue

            if element["kind"] == "table":
                rows = element.get("rows") or []
                text = "\n".join(
                    "\t".join(str(cell) for cell in row)
                    for row in rows
                )
                payload = {
                    "kind": "table",
                    "rows": rows,
                    "text": text,
                    "layout_order": element["order"],
                }
                confidence = 0.92
            else:
                payload = {
                    "kind": "image_region",
                    "xref": element.get("xref"),
                    "layout_order": element["order"],
                }
                confidence = 0.7

            candidates.append(
                {
                    "item_type": "raw_text",
                    "page": page_number,
                    "sheet": None,
                    "crop": element.get("crop"),
                    "payload": payload,
                    "confidence": confidence,
                }
            )

    for sheet in extraction.sheets:
        if expected_content == "vocabulary":
            candidates.extend(
                _vocabulary_from_rows(
                    sheet.get("rows") or [],
                    page=None,
                    sheet=str(sheet.get("sheet") or ""),
                    profile=profile,
                    crop=None,
                )
            )
            continue
        if spreadsheet_mapping:
            include_sheets = spreadsheet_mapping.get("include_sheets") or []
            if include_sheets and str(sheet.get("sheet") or "") not in include_sheets:
                continue
        candidates.extend(_questions_from_sheet(sheet, spreadsheet_mapping))

    if (
        not candidates
        and extraction.full_text.strip()
        and not (spreadsheet_mapping and extraction.sheets)
    ):
        candidates.append(
            {
                "item_type": "raw_text",
                "page": 1 if extraction.pages else None,
                "sheet": extraction.sheets[0]["sheet"] if extraction.sheets else None,
                "payload": {"text": extraction.full_text[:250_000]},
                "confidence": 0.35,
            }
        )

    return candidates



VOCAB_WORD_HEADERS = {
    "word",
    "term",
    "vocabulary",
    "vocab",
    "soz",
    "söz",
    "kelime",
    "слово",
}
VOCAB_DEFINITION_HEADERS = {
    "definition",
    "meaning",
    "izah",
    "açıqlama",
    "aciklama",
    "значение",
}
VOCAB_TRANSLATION_HEADERS = {
    "translation",
    "tercume",
    "tərcümə",
    "çeviri",
    "перевод",
}
VOCAB_TRANSLATION_LANGUAGE_HEADERS = {
    "translation_language",
    "target_language",
    "translation_lang",
}
VOCAB_POS_HEADERS = {
    "part_of_speech",
    "part_of_speech_pos",
    "pos",
    "word_type",
    "type",
    "qrammatik_nov",
    "qrammatik_növ",
}
VOCAB_IPA_HEADERS = {
    "ipa",
    "phonetic",
    "phonetics",
    "pronunciation",
    "transcription",
    "transkripsiya",
}
VOCAB_EXAMPLE_HEADERS = {
    "example",
    "examples",
    "example_sentence",
    "sentence",
    "sample_sentence",
}
VOCAB_EXAMPLE_TRANSLATION_HEADERS = {
    "example_translation",
    "sentence_translation",
}
VOCAB_LEVEL_HEADERS = {"level", "cefr"}
VOCAB_TAG_HEADERS = {"tags", "labels"}
VOCAB_SYNONYM_HEADERS = {"synonyms", "synonym"}
VOCAB_ANTONYM_HEADERS = {"antonyms", "antonym"}
VOCAB_NOTES_HEADERS = {"notes", "note"}

VOCAB_LANGUAGE_HEADER_ALIASES = {
    "english": "en",
    "ingilis": "en",
    "ingiliscə": "en",
    "ingilisce": "en",
    "azerbaijani": "az",
    "azerbaijan": "az",
    "azərbaycan": "az",
    "azerbaycanca": "az",
    "azərbaycanca": "az",
    "turkish": "tr",
    "türkçe": "tr",
    "turkce": "tr",
    "russian": "ru",
    "русский": "ru",
    "рус": "ru",
}


def _translation_language_from_header(header: str) -> str | None:
    direct = VOCAB_LANGUAGE_HEADER_ALIASES.get(header)
    if direct:
        return direct

    match = re.fullmatch(
        r"(?:translation|tercume|tərcümə|çeviri|перевод)_([a-z]{2,10})",
        header,
    )
    if match:
        return match.group(1)

    for prefix in (
        "translation_",
        "tercume_",
        "tərcümə_",
        "çeviri_",
        "перевод_",
    ):
        if header.startswith(prefix):
            return VOCAB_LANGUAGE_HEADER_ALIASES.get(
                header[len(prefix) :]
            )

    if re.fullmatch(r"[a-z]{2,3}", header):
        return header
    return None


def _infer_vocabulary_languages_from_text(
    text: str,
    defaults: dict[str, Any],
) -> dict[str, Any]:
    if defaults.get("translation_language"):
        return defaults

    aliases = {
        "english": "en",
        "ingilis": "en",
        "ingilisce": "en",
        "ingiliscə": "en",
        "azerbaijani": "az",
        "azerbaijan": "az",
        "azerbaycanca": "az",
        "azərbaycanca": "az",
        "azərbaycan": "az",
        "turkish": "tr",
        "turkce": "tr",
        "türkçe": "tr",
        "russian": "ru",
        "русский": "ru",
    }
    for raw_line in text.splitlines()[:40]:
        cleaned = re.sub(r"^[#\s:|;,\-]+|[#\s:|;,\-]+$", "", raw_line)
        tokens = [
            re.sub(
                r"[^\wƏəĞğİıÖöŞşÇçÜüА-Яа-яЁё]+",
                "",
                token,
            ).casefold().replace("\u0307", "")
            for token in cleaned.split()
        ]
        languages = [aliases[token] for token in tokens if token in aliases]
        if len(languages) >= 2 and languages[0] != languages[1]:
            return {
                **defaults,
                "learning_language": languages[0],
                "translation_language": languages[1],
            }
    return defaults


def _vocabulary_defaults(profile: dict[str, Any] | None) -> dict[str, Any]:
    profile = profile or {}
    learning_language = str(profile.get("learning_language") or "en").strip().lower()
    if not re.fullmatch(r"[a-z]{2,10}", learning_language):
        learning_language = "en"
    translation_language = str(
        profile.get("translation_language") or ""
    ).strip().lower() or None
    if translation_language and not re.fullmatch(
        r"[a-z]{2,10}", translation_language
    ):
        translation_language = None
    if translation_language == learning_language:
        translation_language = None

    level = str(profile.get("level") or "").strip() or None
    status = str(profile.get("status") or "draft").strip().lower()
    if status not in {"draft", "active"}:
        status = "draft"
    return {
        "learning_language": learning_language,
        "translation_language": translation_language,
        "level": level,
        "status": status,
    }


def _split_vocab_values(value: str) -> list[str]:
    return [
        part.strip()
        for part in re.split(r"\s*[|;]\s*", value)
        if part.strip()
    ]


VOCAB_POS_ALIASES = {
    "n": "noun",
    "noun": "noun",
    "v": "verb",
    "verb": "verb",
    "adj": "adjective",
    "adjective": "adjective",
    "adv": "adverb",
    "adverb": "adverb",
    "prep": "preposition",
    "preposition": "preposition",
    "pron": "pronoun",
    "pronoun": "pronoun",
    "conj": "conjunction",
    "conjunction": "conjunction",
    "det": "determiner",
    "determiner": "determiner",
    "exclam": "exclamation",
    "exclamation": "exclamation",
    "number": "number",
    "modal verb": "modal verb",
    "auxiliary verb": "auxiliary verb",
    "phrasal verb": "phrasal verb",
    "article": "article",
    "indefinite article": "indefinite article",
    "definite article": "definite article",
}

VOCAB_LEVEL_RE = re.compile(r"^(A1|A2|B1|B2|C1|C2)$", re.IGNORECASE)
VOCAB_BOILERPLATE_RE = re.compile(
    r"(?:https?://|www\.|©|copyright|page\s+\d+|vocabulary\s+list|"
    r"word\s+list|table\s+of\s+contents|how\s+the\s+list|"
    r"^\s*#?\s*(?:english|ingilis(?:cə|ce)?|azərbaycanca|azerbaycanca)"
    r"\s+(?:azerbaijani|azərbaycanca|azerbaycanca|english|ingilis(?:cə|ce)?)\s*$)",
    re.IGNORECASE,
)


def _clean_vocab_word(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \t—–-:;,.")


def _strip_vocab_row_number(value: str) -> tuple[str, bool]:
    """Strip common numbered-list prefixes without treating the number as a word."""
    match = re.match(
        r"^\s*(?:#\s*)?(\d{1,4})(?:\s*[\.)-]\s*|\s+)(.+?)\s*$",
        value,
    )
    if not match:
        return value.strip(), False
    return match.group(2).strip(), True


def _split_numbered_bilingual_vocab(
    value: str,
    *,
    learning_language: str,
    translation_language: str | None,
) -> tuple[str, str] | None:
    """
    Handle teacher word lists such as:
      66 than daha çox
      67 like kimi
      71 its onun
    When a translation language is configured, numbered glossary rows are
    treated as bilingual rows rather than one long headword.
    """
    if not translation_language:
        return None
    tokens = value.split()
    if len(tokens) < 2:
        return None

    # Numbered teacher glossaries are normally written as
    # "English headword + translation". For English, prefer a single
    # headword token and only extend it for common phrasal-verb particles.
    # This correctly keeps "than | daha çox" instead of "than daha | çox".
    if learning_language == "en":
        particles = {
            "after", "away", "back", "down", "for", "in", "into", "off",
            "on", "out", "over", "through", "to", "up", "with",
        }
        if len(tokens) >= 3 and tokens[1].casefold() in particles:
            return " ".join(tokens[:2]), " ".join(tokens[2:])
        return tokens[0], " ".join(tokens[1:])

    target_specific: dict[str, re.Pattern[str]] = {
        "az": re.compile(r"[əƏğĞıİöÖşŞçÇüÜ]"),
        "tr": re.compile(r"[ğĞıİöÖşŞçÇüÜ]"),
        "ru": re.compile(r"[А-Яа-яЁё]"),
    }
    target_re = target_specific.get(translation_language)
    if target_re:
        for index, token in enumerate(tokens[1:], start=1):
            if target_re.search(token):
                head = " ".join(tokens[:index]).strip()
                meaning = " ".join(tokens[index:]).strip()
                if head and meaning:
                    return head, meaning

    return tokens[0], " ".join(tokens[1:])


def _vocabulary_payload(
    *,
    word: str,
    defaults: dict[str, Any],
    definition: str | None = None,
    ipa: str | None = None,
    part_of_speech: str | None = None,
    level: str | None = None,
    notes: str | None = None,
    translations: list[dict[str, str]] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "word": word,
        "learning_language": defaults["learning_language"],
        "definition": definition or None,
        "ipa": ipa or None,
        "part_of_speech": part_of_speech or None,
        "synonyms": [],
        "antonyms": [],
        "level": level or defaults["level"],
        "notes": notes or None,
        "status": defaults["status"],
        "translations": translations or [],
        "examples": [],
        "tags": tags or [],
    }


def _is_usable_vocabulary_table(rows: list[list[Any]]) -> bool:
    """Return True only when detected table cells represent real data columns.

    Decorative PDF table/grid lines can produce 10-20 columns while each
    logical row has only one non-empty fragment. Feeding that structure to the
    spreadsheet parser truncates words and CEFR labels. Headered tables and
    genuinely multi-column rows remain supported.
    """
    clean_rows = [
        [str(cell or "").strip() for cell in row]
        for row in rows
        if any(str(cell or "").strip() for cell in row)
    ]
    if not clean_rows:
        return False

    headers = {_normalize_header(value) for value in clean_rows[0] if value}
    if headers & VOCAB_WORD_HEADERS:
        return True

    nonempty_counts = [
        sum(1 for cell in row if cell)
        for row in clean_rows[:100]
    ]
    multi_column_rows = sum(1 for count in nonempty_counts if count >= 2)
    max_columns = max((len(row) for row in clean_rows), default=0)

    # Headerless PDF vocabulary tables are only trusted when their physical
    # layout is genuinely narrow. Wide grids are commonly decorative cells
    # that split one logical line (for example the final "C1") across columns.
    if max_columns > 3:
        return False
    if multi_column_rows >= max(2, len(nonempty_counts) // 2):
        return True
    if max_columns <= 3 and multi_column_rows > 0:
        return True
    return False


def _parse_vocab_list_entry(
    value: str,
) -> tuple[str, str | None, str | None, str | None, str | None]:
    """Parse Cambridge/Oxford-style word-list rows with optional sense labels.

    Examples:
      aboard adverb, preposition C1
      absorb verb REMEMBER C1
      abuse noun WRONG ACTION C1
      Absolutely! C1
      in accordance with sth C1
    """
    cleaned = _clean_vocab_word(value)
    level: str | None = None
    ipa: str | None = None
    notes: str | None = None

    level_match = re.search(r"\b(A1|A2|B1|B2|C1|C2)\s*$", cleaned, re.IGNORECASE)
    if level_match:
        level = level_match.group(1).upper()
        cleaned = cleaned[: level_match.start()].strip()

    ipa_match = re.search(r"\s(/[^/]{1,120}/)\s*", cleaned)
    if ipa_match:
        ipa = ipa_match.group(1)
        cleaned = f"{cleaned[:ipa_match.start()]} {cleaned[ipa_match.end():]}".strip()

    # Preserve Oxford's compact dotted notation before the broader full-word
    # matcher. Example: "about prep., adv. A1".
    if re.search(
        r"\b(?:n|v|adj|adv|prep|pron|det|conj|exclam)\.",
        cleaned,
        re.IGNORECASE,
    ):
        compact_word, compact_ipa, compact_pos, compact_level = _parse_vocab_head(
            f"{cleaned} {level or ''}".strip()
        )
        if compact_pos:
            return (
                compact_word,
                ipa or compact_ipa,
                compact_pos,
                level or compact_level,
                None,
            )

    full_labels = [
        key
        for key in VOCAB_POS_ALIASES
        if len(key) > 1 and key not in {"n", "v"}
    ]
    label_pattern = "|".join(
        sorted((re.escape(label) for label in full_labels), key=len, reverse=True)
    )
    pos_match = re.search(
        rf"\s+(?P<pos>(?:{label_pattern})(?:\s*,\s*(?:{label_pattern}))*)\b",
        cleaned,
        re.IGNORECASE,
    )
    if pos_match:
        head = cleaned[: pos_match.start()].strip()
        raw_pos = pos_match.group("pos")
        labels = [
            VOCAB_POS_ALIASES.get(piece.strip().casefold(), piece.strip().casefold())
            for piece in re.split(r"\s*,\s*", raw_pos)
            if piece.strip()
        ]
        pos = ", ".join(dict.fromkeys(labels)) or None
        tail = cleaned[pos_match.end() :].strip(" \t—–-:;,")
        if tail:
            notes = f"Source sense: {tail}"
        return _clean_vocab_word(head), ipa, pos, level, notes

    # Compact/parenthesized formats are already handled by the generic parser.
    word, generic_ipa, pos, generic_level = _parse_vocab_head(
        f"{cleaned} {level or ''}".strip()
    )
    return word, ipa or generic_ipa, pos, level or generic_level, None


def _parse_vocab_head(
    value: str,
) -> tuple[str, str | None, str | None, str | None]:
    value = _clean_vocab_word(value)
    level: str | None = None
    pos: str | None = None
    ipa: str | None = None

    level_match = re.search(r"\b(A1|A2|B1|B2|C1|C2)\s*$", value, re.IGNORECASE)
    if level_match:
        level = level_match.group(1).upper()
        value = value[: level_match.start()].strip()

    ipa_match = re.search(r"\s(/[^/]{1,120}/)\s*", value)
    if ipa_match:
        ipa = ipa_match.group(1)
        value = f"{value[:ipa_match.start()]} {value[ipa_match.end():]}".strip()

    # Cambridge exam word lists commonly use parenthesized labels:
    # "(adj)", "(n & v)", "(phr v)", "(mv)", "(n pl)".
    cambridge_match = re.search(r"\s*\(([^()]{1,40})\)\s*$", value)
    if cambridge_match:
        raw_label = cambridge_match.group(1).strip().casefold()
        token_map = {
            "n": "noun",
            "n pl": "noun",
            "v": "verb",
            "adj": "adjective",
            "adv": "adverb",
            "prep": "preposition",
            "pron": "pronoun",
            "det": "determiner",
            "conj": "conjunction",
            "exclam": "exclamation",
            "mv": "modal verb",
            "phr v": "phrasal verb",
        }
        pieces = [
            piece.strip()
            for piece in re.split(r"\s*(?:&|,)\s*", raw_label)
            if piece.strip()
        ]
        labels = [token_map[piece] for piece in pieces if piece in token_map]
        if labels and len(labels) == len(pieces):
            pos = ", ".join(dict.fromkeys(labels))
            value = value[: cambridge_match.start()].strip()

    pos_match = re.search(
        r"(?:\s+|\()("
        + "|".join(
            sorted(
                (re.escape(key) for key in VOCAB_POS_ALIASES),
                key=len,
                reverse=True,
            )
        )
        + r")\)?\s*$",
        value,
        re.IGNORECASE,
    )
    if pos is None and pos_match:
        key = pos_match.group(1).casefold()
        pos = VOCAB_POS_ALIASES.get(key)
        value = value[: pos_match.start()].strip()
    elif pos is None:
        # Oxford downloadable lists commonly use compact labels such as
        # "n.", "v.", "adj.", or combined "prep., adv.".
        short_match = re.search(
            r"\s+((?:(?:n|v|adj|adv|prep|pron|det|conj|exclam)\.(?:\s*,\s*|\s*)?)+)\s*$",
            value,
            re.IGNORECASE,
        )
        if short_match:
            short_map = {
                "n": "noun",
                "v": "verb",
                "adj": "adjective",
                "adv": "adverb",
                "prep": "preposition",
                "pron": "pronoun",
                "det": "determiner",
                "conj": "conjunction",
                "exclam": "exclamation",
            }
            labels = [
                short_map[token.casefold()]
                for token in re.findall(
                    r"(n|v|adj|adv|prep|pron|det|conj|exclam)\.",
                    short_match.group(1),
                    re.IGNORECASE,
                )
            ]
            pos = ", ".join(dict.fromkeys(labels)) or None
            value = value[: short_match.start()].strip()

    return _clean_vocab_word(value), ipa, pos, level


def _looks_like_vocab_term(value: str) -> bool:
    if not value or len(value) > 120 or VOCAB_BOILERPLATE_RE.search(value):
        return False
    if value.endswith((".", "?", "!", ";", ":")) and len(value.split()) > 3:
        return False
    if re.search(r"\b\d{3,4}\b", value):
        return False
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿƏəĞğİıÖöŞşÇçÜüА-Яа-я]", value):
        return False
    return len(value.split()) <= 8


def _vocabulary_from_text(
    text: str,
    *,
    page: int | None,
    profile: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    defaults = _infer_vocabulary_languages_from_text(
        text,
        _vocabulary_defaults(profile),
    )
    # A level explicitly stated in a teacher's PDF title is source metadata,
    # not an AI estimate. Do not override a profile's selected level.
    heading = "\n".join(text.splitlines()[:12])
    if not defaults.get("level"):
        level_match = re.search(
            r"\b(A1|A2|B1|B2|C1|C2)\s*(?:səviyyə|level|seviye)\b",
            heading,
            re.IGNORECASE,
        )
        if level_match:
            defaults = {**defaults, "level": level_match.group(1).upper()}

    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(
        word: str,
        *,
        definition: str | None = None,
        ipa: str | None = None,
        part_of_speech: str | None = None,
        level: str | None = None,
        notes: str | None = None,
        translations: list[dict[str, str]] | None = None,
        confidence: float,
        dedupe: bool = True,
    ) -> None:
        clean = _clean_vocab_word(word)
        if not _looks_like_vocab_term(clean):
            return
        if not part_of_speech and defaults["learning_language"] == "en":
            # A bare Azerbaijani infinitive can identify a verb with higher
            # certainty than WiktAPI's unrelated first dictionary sense.
            # A longer phrase or parenthesized note is ambiguous and must
            # remain unclassified until the teacher reviews it.
            az_meanings = [
                translation["value"].strip().casefold()
                for translation in (translations or [])
                if translation.get("language") == "az"
            ]
            if len(az_meanings) == 1 and re.fullmatch(
                r"[a-zəğıöşçü]+(?:maq|mək)", az_meanings[0]
            ):
                part_of_speech = "verb"
        key = "::".join(
            [
                clean.casefold(),
                (part_of_speech or "").casefold(),
                (notes or "").casefold(),
                (definition or "").casefold(),
            ]
        )
        if dedupe and key in seen:
            return
        if dedupe:
            seen.add(key)
        out.append(
            {
                "item_type": "vocabulary",
                "page": page,
                "sheet": None,
                "crop": None,
                "payload": _vocabulary_payload(
                    word=clean,
                    defaults=defaults,
                    definition=definition,
                    ipa=ipa,
                    part_of_speech=part_of_speech,
                    level=level,
                    notes=notes,
                    translations=translations,
                ),
                "confidence": confidence,
            }
        )

    # Some PDFs place the list number and the lexical row in separate text
    # objects/lines even though they are visually one table row:
    #   "225)"
    #   "bump into sb C1"
    # Join those pairs before parsing so source-row identity and sense
    # preservation work consistently across every page.
    logical_lines: list[str] = []
    pending_number: str | None = None
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if re.fullmatch(r"(?:#\s*)?\d{1,4}[.)]", stripped):
            if pending_number:
                logical_lines.append(pending_number)
            pending_number = stripped
            continue
        if pending_number and stripped:
            logical_lines.append(f"{pending_number} {stripped}")
            pending_number = None
        else:
            logical_lines.append(raw_line)
    if pending_number:
        logical_lines.append(pending_number)

    source_lines: list[str] = []
    for raw_line in logical_lines:
        segments = [raw_line]
        if ";" in raw_line:
            possible = [
                part.strip()
                for part in raw_line.split(";")
                if part.strip()
            ]
            if len(possible) > 1 and all(
                re.search(r"\t|\s+[—–-]\s+|\s*:\s+|,", part)
                for part in possible
            ):
                segments = possible
        source_lines.extend(segments)

    for raw_line in source_lines:
        line = re.sub(r"^\s*[-•*▪◦]\s*", "", raw_line).strip()
        line, had_row_number = _strip_vocab_row_number(line)
        if not line or len(line) > 2_500 or VOCAB_BOILERPLATE_RE.search(line):
            continue
        if re.fullmatch(
            r"(?:A1|A2|B1|B2|C1|C2)\s+səviyyə\s+üzrə\s+sözlər",
            line,
            re.IGNORECASE,
        ):
            continue

        # Structured dictionary/CEFR metadata takes precedence over the
        # configured translation language. A numbered source row such as
        # "6) absorb verb REMEMBER C1" is a lexical metadata row, not
        # "absorb" translated as "verb REMEMBER C1".
        word, ipa, pos, level, source_note = _parse_vocab_list_entry(line)
        has_definition_separator = bool(
            re.search(r"\t+|\s+[—–-]\s+|\s*:\s+", line)
        )
        if (
            (pos or level or ipa)
            and not has_definition_separator
            and _looks_like_vocab_term(word)
        ):
            add(
                word,
                ipa=ipa,
                part_of_speech=pos,
                level=level,
                notes=source_note,
                confidence=0.96 if level and pos else 0.88,
                dedupe=not had_row_number,
            )
            continue

        if had_row_number:
            bilingual = _split_numbered_bilingual_vocab(
                line,
                learning_language=defaults["learning_language"],
                translation_language=defaults.get("translation_language"),
            )
            if bilingual:
                word, meaning = bilingual
                add(
                    word,
                    translations=[
                        {
                            "language": str(defaults["translation_language"]),
                            "value": meaning,
                        }
                    ],
                    confidence=0.94,
                    dedupe=False,
                )
                continue

        # Dictionary / teacher-list / Quizlet formats:
        # word<TAB>meaning, word — meaning, word - meaning, word: meaning,
        # and simple term,definition rows.
        parts = re.split(
            r"\t+|\s+[—–-]\s+|\s*:\s+|\s*,\s*",
            line,
            maxsplit=1,
        )
        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
            word, ipa, pos, level, source_note = _parse_vocab_list_entry(parts[0])
            meaning = parts[1].strip()
            if (
                _looks_like_vocab_term(word)
                and len(meaning) <= 10_000
                and not VOCAB_LEVEL_RE.fullmatch(meaning)
            ):
                translation_language = defaults.get("translation_language")
                add(
                    word,
                    definition=None if translation_language else meaning,
                    ipa=ipa,
                    part_of_speech=pos,
                    level=level,
                    notes=source_note,
                    translations=(
                        [
                            {
                                "language": translation_language,
                                "value": meaning,
                            }
                        ]
                        if translation_language
                        else None
                    ),
                    confidence=0.86
                    if translation_language
                    else 0.82
                    if (pos or level or ipa)
                    else 0.76,
                    dedupe=not had_row_number,
                )
                continue

        # Some PDF word lists are laid out in columns. Preserve independent terms
        # split by wide whitespace instead of treating a whole row as one phrase.
        columns = [
            value.strip()
            for value in re.split(r"\s{2,}", line)
            if value.strip()
        ]
        if len(columns) >= 2 and all(_looks_like_vocab_term(value) for value in columns):
            for value in columns:
                column_word, column_ipa, column_pos, column_level = _parse_vocab_head(value)
                add(
                    column_word,
                    ipa=column_ipa,
                    part_of_speech=column_pos,
                    level=column_level,
                    confidence=0.68,
                )
            continue

        # Explicit vocabulary imports may also be simple one-term-per-line lists
        # such as Cambridge category word lists. These stay lower-confidence so
        # the teacher reviews them before committing.
        if _looks_like_vocab_term(line):
            add(
                line,
                confidence=0.6,
                dedupe=not had_row_number,
            )

    return out


def _vocabulary_from_rows(
    rows: list[list[Any]],
    *,
    page: int | None,
    sheet: str | None,
    profile: dict[str, Any] | None,
    crop: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    clean_rows = [
        [str(value or "").strip() for value in row]
        for row in rows
        if any(str(value or "").strip() for value in row)
    ]
    if not clean_rows:
        return []

    defaults = _vocabulary_defaults(profile)
    headers = [_normalize_header(value) for value in clean_rows[0]]
    header_set = set(headers)
    has_named_header = bool(header_set & VOCAB_WORD_HEADERS)

    def find(names: set[str]) -> int | None:
        for index, header in enumerate(headers):
            if header in names:
                return index
        return None

    word_idx = find(VOCAB_WORD_HEADERS) if has_named_header else 0
    if word_idx is None:
        return []

    definition_idx = find(VOCAB_DEFINITION_HEADERS)
    translation_idx = find(VOCAB_TRANSLATION_HEADERS)
    translation_language_idx = find(VOCAB_TRANSLATION_LANGUAGE_HEADERS)
    ipa_idx = find(VOCAB_IPA_HEADERS)
    pos_idx = find(VOCAB_POS_HEADERS)
    example_idx = find(VOCAB_EXAMPLE_HEADERS)
    example_translation_idx = find(VOCAB_EXAMPLE_TRANSLATION_HEADERS)
    level_idx = find(VOCAB_LEVEL_HEADERS)
    tags_idx = find(VOCAB_TAG_HEADERS)
    synonyms_idx = find(VOCAB_SYNONYM_HEADERS)
    antonyms_idx = find(VOCAB_ANTONYM_HEADERS)
    notes_idx = find(VOCAB_NOTES_HEADERS)

    explicit_translation_columns: list[tuple[int, str]] = []
    if has_named_header:
        for index, header in enumerate(headers):
            if index == word_idx:
                continue
            language = _translation_language_from_header(header)
            if language:
                explicit_translation_columns.append((index, language))

    start_index = 1 if has_named_header else 0

    def cell(row: list[str], index: int | None) -> str:
        if index is None or index >= len(row):
            return ""
        return row[index].strip()

    out: list[dict[str, Any]] = []
    for row_number, row in enumerate(clean_rows[start_index:], start=start_index + 1):
        word = cell(row, word_idx)
        if not word or len(word) > 500:
            continue

        definition = cell(row, definition_idx)
        translations: list[dict[str, str]] = []

        translation_value = cell(row, translation_idx)
        translation_language = (
            cell(row, translation_language_idx).lower()
            or str(defaults.get("translation_language") or "").lower()
        )
        if translation_value and re.fullmatch(r"[a-z]{2,10}", translation_language):
            translations.append(
                {"language": translation_language, "value": translation_value}
            )
        elif translation_value and not definition:
            # Without a configured/declared target language, preserve the value
            # as a definition instead of inventing a translation language.
            definition = translation_value

        for index, language in explicit_translation_columns:
            value = cell(row, index)
            if value and language != defaults["learning_language"]:
                translations.append({"language": language, "value": value})

        if (
            not has_named_header
            and len(row) > 1
            and not definition
            and not translations
        ):
            second = row[1].strip()
            target_language = defaults.get("translation_language")
            if second and target_language:
                translations.append(
                    {
                        "language": str(target_language),
                        "value": second,
                    }
                )
            else:
                definition = second

        example = cell(row, example_idx)
        examples = (
            [
                {
                    "sentence": example,
                    "translation": cell(row, example_translation_idx) or None,
                }
            ]
            if example
            else []
        )

        out.append(
            {
                "item_type": "vocabulary",
                "page": page,
                "sheet": sheet,
                "crop": crop,
                "payload": {
                    "word": word,
                    "learning_language": defaults["learning_language"],
                    "definition": definition or None,
                    "ipa": cell(row, ipa_idx) or None,
                    "part_of_speech": cell(row, pos_idx) or None,
                    "synonyms": _split_vocab_values(cell(row, synonyms_idx)),
                    "antonyms": _split_vocab_values(cell(row, antonyms_idx)),
                    "level": cell(row, level_idx) or defaults["level"],
                    "notes": cell(row, notes_idx) or None,
                    "status": defaults["status"],
                    "translations": translations,
                    "examples": examples,
                    "tags": _split_vocab_values(cell(row, tags_idx)),
                    "import_mapping": {
                        "row": row_number,
                        "sheet": sheet,
                    },
                },
                "confidence": 0.95 if has_named_header else 0.78,
            }
        )

    return out


def _page_layout_elements(page: dict[str, Any]) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []

    for block in page.get("blocks") or []:
        elements.append(
            {
                "kind": "text",
                "text": block.get("text", ""),
                "crop": block.get("crop"),
            }
        )

    for table in page.get("tables") or []:
        elements.append(
            {
                "kind": "table",
                "rows": table.get("rows") or [],
                "crop": table.get("crop"),
            }
        )

    for image in page.get("images") or []:
        elements.append(
            {
                "kind": "image_region",
                "xref": image.get("xref"),
                "crop": image.get("crop"),
            }
        )

    elements.sort(
        key=lambda item: (
            float((item.get("crop") or {}).get("y", 1)),
            float((item.get("crop") or {}).get("x", 1)),
        )
    )
    for index, element in enumerate(elements):
        element["order"] = index

    return elements


def _question_crop_map(page: dict[str, Any]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for block in page.get("blocks") or []:
        crop = block.get("crop")
        if not crop:
            continue
        for line in str(block.get("text") or "").splitlines():
            match = QUESTION_RE.match(line) or QUESTION_NUMBER_ONLY_RE.match(line)
            if match and match.group(1) not in out:
                out[match.group(1)] = crop
    return out


def _text_before_first_question(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        if QUESTION_RE.match(line) or QUESTION_NUMBER_ONLY_RE.match(line):
            break
        if ANSWER_RE.match(line) or ANSWER_SECTION_HEADING_RE.match(line):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def _reading_candidate_from_page(
    page: dict[str, Any],
    questions: list[dict[str, Any]],
    explicit: bool = False,
) -> dict[str, Any] | None:
    if not questions:
        return None

    primary_prefix = _text_before_first_question(str(page.get("text") or ""))
    block_text = "\n".join(
        str(block.get("text") or "")
        for block in page.get("blocks") or []
        if str(block.get("text") or "").strip()
    )
    block_prefix = _text_before_first_question(block_text)
    prefix = max(
        (primary_prefix, block_prefix),
        key=lambda value: (len(value.split()), len(value)),
    )
    words = prefix.split()
    if explicit:
        if len(prefix) < 80 or len(words) < 15:
            return None
    elif len(prefix) < 180 or len(words) < 30:
        return None

    lines = [line.strip() for line in prefix.splitlines() if line.strip()]
    if not lines:
        return None

    if len(lines) > 1 and len(lines[0]) <= 120 and len(lines[0].split()) <= 16:
        title = lines[0]
        body = "\n".join(lines[1:]).strip()
        if len(body.split()) < 25:
            title = f"Reading passage — page {page.get('page') or 1}"
            body = prefix
    else:
        title = f"Reading passage — page {page.get('page') or 1}"
        body = prefix

    first_question_y = min(
        (
            float((question.get("crop") or {}).get("y", 1))
            for question in questions
            if question.get("crop")
        ),
        default=1.0,
    )
    layout_context = [
        element
        for element in _page_layout_elements(page)
        if float((element.get("crop") or {}).get("y", 1)) < first_question_y
    ]

    source_ref = f"reading:page:{page.get('page') or 1}"
    return {
        "item_type": "reading",
        "page": page.get("page"),
        "sheet": None,
        "crop": _union_crops(
            [
                element["crop"]
                for element in layout_context
                if element.get("crop")
            ]
        ),
        "payload": {
            "source_ref": source_ref,
            "title": title[:300],
            "body": body[:250_000],
            "display_layout": "split",
            "status": "draft",
            "metadata": {
                "reconstructed_from": "pdf_layout",
                "source_page": page.get("page"),
                "layout_elements": layout_context[:200],
            },
        },
        "confidence": 0.84,
    }


def _listening_task_groups(
    page: dict[str, Any],
    question_crops: dict[str, dict[str, float]] | None,
    global_answers: dict[str, str] | None,
) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    text = str(page.get("text") or "")
    matches = list(LISTENING_TASK_RE.finditer(text))
    if not matches:
        return []

    page_number = page.get("page") or 1
    groups: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []

    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        segment = text[match.end() : end].strip()
        questions = _questions_from_text(
            segment,
            page=page.get("page"),
            question_crops=question_crops,
            global_answers=global_answers,
        )
        if not questions:
            continue

        task_number = match.group(1)
        intro = _text_before_first_question(segment)
        intro_lines = [
            line.strip()
            for line in intro.splitlines()
            if line.strip() and not line.strip().lower().startswith(("http://", "https://", "(from "))
        ]
        source_ref = f"listening:page:{page_number}:task:{task_number}"

        candidate = {
            "item_type": "listening",
            "page": page.get("page"),
            "sheet": None,
            "crop": _union_crops(
                [
                    question["crop"]
                    for question in questions
                    if question.get("crop")
                ]
            ),
            "payload": {
                "source_ref": source_ref,
                "title": f"Listening Task {task_number}",
                "transcript": "",
                "status": "draft",
                "metadata": {
                    "reconstructed_from": "listening_task_layout",
                    "source_page": page.get("page"),
                    "task_number": task_number,
                    "instructions": "\n".join(intro_lines)[:5_000],
                    "audio_required": True,
                },
            },
            "confidence": 0.82,
        }
        groups.append((candidate, questions))

    return groups


def _listening_candidate_from_page(
    page: dict[str, Any],
    questions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not questions:
        return None

    prefix = _text_before_first_question(str(page.get("text") or "")).strip()
    lines = [line.strip() for line in prefix.splitlines() if line.strip()]
    page_number = page.get("page") or 1

    title = f"Listening exercise — page {page_number}"
    transcript = ""
    if lines:
        first = lines[0]
        if len(first) <= 120 and len(first.split()) <= 16:
            title = first
            remainder = "\n".join(lines[1:]).strip()
            if len(remainder.split()) >= 12:
                transcript = remainder
        elif len(prefix.split()) >= 12:
            transcript = prefix

    source_ref = f"listening:page:{page_number}"
    first_question_y = min(
        (
            float((question.get("crop") or {}).get("y", 1))
            for question in questions
            if question.get("crop")
        ),
        default=1.0,
    )
    layout_context = [
        element
        for element in _page_layout_elements(page)
        if float((element.get("crop") or {}).get("y", 1)) < first_question_y
    ]

    return {
        "item_type": "listening",
        "page": page.get("page"),
        "sheet": None,
        "crop": _union_crops(
            [
                element["crop"]
                for element in layout_context
                if element.get("crop")
            ]
        ),
        "payload": {
            "source_ref": source_ref,
            "title": title[:300],
            "transcript": transcript[:500_000],
            "status": "draft",
            "metadata": {
                "reconstructed_from": "document_layout",
                "source_page": page.get("page"),
                "layout_elements": layout_context[:200],
                "audio_required": True,
            },
        },
        "confidence": 0.82 if transcript else 0.68,
    }


def _nearby_assets(
    page: dict[str, Any],
    question_crop: dict[str, float] | None,
) -> list[dict[str, Any]]:
    if not question_crop:
        return []

    q_center = float(question_crop.get("y", 0)) + float(
        question_crop.get("height", 0)
    ) / 2
    assets: list[dict[str, Any]] = []

    for element in _page_layout_elements(page):
        if element["kind"] not in {"table", "image_region"}:
            continue
        crop = element.get("crop") or {}
        center = float(crop.get("y", 0)) + float(crop.get("height", 0)) / 2
        if abs(center - q_center) > 0.22:
            continue

        if element["kind"] == "table":
            assets.append(
                {
                    "kind": "table",
                    "rows": element.get("rows") or [],
                    "crop": crop,
                    "layout_order": element["order"],
                }
            )
        else:
            assets.append(
                {
                    "kind": "image_region",
                    "xref": element.get("xref"),
                    "crop": crop,
                    "layout_order": element["order"],
                }
            )

    return assets[:8]


def _asset_key(asset: dict[str, Any]) -> str:
    crop = asset.get("crop") or {}
    return "|".join(
        [
            str(asset.get("kind") or ""),
            str(asset.get("xref") or ""),
            f"{float(crop.get('x', 0)):.5f}",
            f"{float(crop.get('y', 0)):.5f}",
            f"{float(crop.get('width', 0)):.5f}",
            f"{float(crop.get('height', 0)):.5f}",
        ]
    )


def _union_crops(
    crops: list[dict[str, float]],
) -> dict[str, float] | None:
    if not crops:
        return None

    x0 = min(float(crop.get("x", 0)) for crop in crops)
    y0 = min(float(crop.get("y", 0)) for crop in crops)
    x1 = max(
        float(crop.get("x", 0)) + float(crop.get("width", 0))
        for crop in crops
    )
    y1 = max(
        float(crop.get("y", 0)) + float(crop.get("height", 0))
        for crop in crops
    )
    return {
        "x": max(0.0, min(1.0, x0)),
        "y": max(0.0, min(1.0, y0)),
        "width": max(0.0, min(1.0, x1 - x0)),
        "height": max(0.0, min(1.0, y1 - y0)),
    }


def _normalize_choice_markers(line: str) -> str:
    # Common PDF checkbox glyphs are often extracted between the option letter
    # and its text instead of as A)/B) punctuation.
    return re.sub(
        r"(?<!\w)([A-Ha-h])\s*[\ue000-\uf8ff☐☑□❏]\s*",
        r"\1) ",
        line,
    )


def _fixed_choice_options_from_line(line: str) -> list[dict[str, str]]:
    token_re = re.compile(
        r"(?:[\ue000-\uf8ff☐☑□❏]\s*)?(Not Given|True|False|Yes|No)",
        re.IGNORECASE,
    )
    matches = list(token_re.finditer(line))
    if not matches:
        return []

    residual = token_re.sub("", line)
    if residual.strip():
        return []

    options: list[dict[str, str]] = []
    for match in matches:
        text = match.group(1)
        canonical = {
            "not given": "Not Given",
            "true": "True",
            "false": "False",
            "yes": "Yes",
            "no": "No",
        }[text.casefold()]
        options.append(
            {
                "id": canonical.casefold().replace(" ", "_"),
                "text": canonical,
            }
        )
    return options


def _options_from_line(line: str) -> list[dict[str, str]]:
    line = _normalize_choice_markers(line)
    matches = list(INLINE_OPTION_RE.finditer(line))
    if not matches:
        return []
    if line[: matches[0].start()].strip():
        return []

    options: list[dict[str, str]] = []
    for match in matches:
        value = match.group(2).strip()
        if not value:
            continue
        options.append(
            {
                "id": match.group(1).lower(),
                "text": value,
            }
        )
    return options


def _split_prompt_and_inline_options(
    value: str,
) -> tuple[str, list[dict[str, str]]]:
    normalized = _normalize_choice_markers(value)
    first = re.search(r"\s+([A-Ha-h])[\.)]\s*", normalized)
    if first:
        prompt = normalized[: first.start()].strip()
        options = _options_from_line(normalized[first.start() :].strip())
        if len(options) >= 2:
            return prompt, options

    true_false = re.search(
        r"\s+[\ue000-\uf8ff☐☑□❏]?\s*True\s+[\ue000-\uf8ff☐☑□❏]?\s*False\s*$",
        value,
        re.IGNORECASE,
    )
    if true_false:
        return value[: true_false.start()].strip(), [
            {"id": "true", "text": "True"},
            {"id": "false", "text": "False"},
        ]

    return value.strip(), []


def _extract_global_answer_key(text: str) -> dict[str, str]:
    active = False
    values: dict[str, list[str]] = {}
    compact = re.compile(
        r"(?<!\d)(\d{1,4})\s*[:.)-]?\s*(Not Given|True|False|Yes|No|[A-Ha-h]|T|F)\b",
        re.IGNORECASE,
    )
    full_line = re.compile(r"^\s*(\d{1,4})\s*[:.)-]\s*(.+?)\s*$")

    for raw_line in text.splitlines():
        line = raw_line.strip()
        lowered = line.casefold()
        heading_match = ANSWER_SECTION_HEADING_RE.match(line)
        inline_match = ANSWER_RE.match(line)
        inline_kind = inline_match.group(1).casefold() if inline_match else ""
        if heading_match or inline_kind.startswith("answer key") or inline_kind.startswith("answers"):
            active = True
            # Compact answers can appear on an explicit answer heading line.
            if inline_match:
                line = inline_match.group(2).strip()
            else:
                line = ""

        if not active or not line:
            continue

        matches = list(compact.finditer(line))
        if matches:
            for match in matches:
                number = match.group(1)
                value = match.group(2).strip()
                folded = value.casefold()
                if folded == "t":
                    value = "True"
                elif folded == "f":
                    value = "False"
                elif len(value) == 1 and value.isalpha():
                    value = value.upper()
                values.setdefault(number, []).append(value)
            continue

        line_match = full_line.match(line)
        if line_match:
            values.setdefault(line_match.group(1), []).append(
                line_match.group(2).strip()
            )

    # Repeated numbers usually mean separate tasks/sections. Only propagate
    # answers whose source number is unambiguous in the answer-key region.
    return {
        number: answers[0]
        for number, answers in values.items()
        if len(answers) == 1 and answers[0]
    }


def _join_wrapped_option_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    trailing_marker = re.compile(
        r"(?<!\w)[A-Ha-h]\s*(?:[\.)]|[\ue000-\uf8ff☐☑□❏])\s*$"
    )
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        if (
            trailing_marker.search(line)
            and index + 1 < len(lines)
            and lines[index + 1].strip()
        ):
            line = f"{line} {lines[index + 1].strip()}"
            index += 1
        out.append(line)
        index += 1
    return out


def _is_section_boundary(line: str) -> bool:
    value = line.strip().casefold()
    if not value:
        return False
    return bool(
        re.match(
            r"^(?:exercise\s+\d+|section\s+[ivx0-9]+|reading\s+task|listening\s+task|read\s+the\s+(?:passage|text|article)|read\s+and\s+answer|©|www\.)",
            value,
            re.IGNORECASE,
        )
    )


def _split_concatenated_question_lines(lines: list[str]) -> list[str]:
    # PDF text extraction sometimes glues the next numbered question to the
    # final option of the preceding question, e.g. "B) book 13.Choose ...".
    # Do not split numbered statements in the prompt: only split when an
    # earlier A-H option marker exists on the *same* source line.
    question_start = re.compile(
        r"(?<!\w)\d{1,4}[\.)]\s*(?=(?:Choose|Select|Which|What|When|Where|"
        r"Who|Why|How|Complete|Fill|Identify|Find|Match|Arrange|Write|"
        r"Is|Are|Do|Does|Did|Can|Could|Should|Would)\b)",
        re.IGNORECASE,
    )
    option_start = re.compile(r"(?<!\w)[A-Ha-h][\.)]\s*\S")
    out: list[str] = []
    for line in lines:
        split_at = [
            match.start()
            for match in question_start.finditer(line)
            if match.start() > 0 and option_start.search(line[:match.start()])
        ]
        if not split_at:
            out.append(line)
            continue
        start = 0
        for end in split_at:
            segment = line[start:end].strip()
            if segment:
                out.append(segment)
            start = end
        remaining = line[start:].strip()
        if remaining:
            out.append(remaining)
    return out


def _questions_from_text(
    text: str,
    page: int | None,
    question_crops: dict[str, dict[str, float]] | None = None,
    global_answers: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    lines = _split_concatenated_question_lines(
        _join_wrapped_option_lines([line.rstrip() for line in text.splitlines()])
    )
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    answer_key: dict[str, str] = {}

    for line in lines:
        if ANSWER_SECTION_HEADING_RE.match(line):
            if current:
                questions.append(current)
                current = None
            break

        answer_match = ANSWER_RE.match(line)
        if answer_match:
            answer_kind = answer_match.group(1).casefold()
            for number, answer in ANSWER_PAIR_RE.findall(answer_match.group(2)):
                answer_key[number] = answer.strip()
            # Plural answer blocks and answer-key labels end question content.
            # A singular "Answer:" line may belong to the current exercise.
            if (
                answer_kind.startswith("answers")
                or answer_kind.startswith("answer key")
                or answer_kind in {"cavablar", "cevaplar", "ответы"}
            ):
                if current:
                    questions.append(current)
                    current = None
                break
            continue

        number_only = QUESTION_NUMBER_ONLY_RE.match(line)
        if number_only:
            if current:
                questions.append(current)
            current = {
                "_number": number_only.group(1),
                "_standalone_number": True,
                "_nested_numbering": False,
                "prompt": "",
                "options": [],
            }
            continue

        question_match = QUESTION_RE.match(line)
        if question_match:
            question_body = question_match.group(2).strip()

            # Some exam layouts put the main question number on its own line,
            # then include numbered statements (1..5) inside that question.
            # While such a standalone-number question has not reached A/B/C
            # options yet, numbered inline lines belong to its prompt.
            incoming_number = int(question_match.group(1))
            current_number = (
                int(current["_number"]) if current is not None else None
            )
            if (
                current
                and not current["options"]
                and (
                    current.get("_standalone_number")
                    or current.get("_nested_numbering")
                    or (
                        current_number is not None
                        and incoming_number <= current_number
                    )
                )
            ):
                addition = f"{question_match.group(1)}. {question_body}"
                current["prompt"] = (
                    f"{current['prompt']}\n{addition}".strip()
                )
                current["_nested_numbering"] = True
                continue

            if current:
                questions.append(current)
            prompt, inline_options = _split_prompt_and_inline_options(question_body)
            current = {
                "_number": question_match.group(1),
                "_standalone_number": False,
                "_nested_numbering": False,
                "prompt": prompt,
                "options": inline_options,
            }
            continue

        if _is_section_boundary(line):
            if current:
                questions.append(current)
                current = None
            continue

        fixed_options = _fixed_choice_options_from_line(line)
        if current and fixed_options:
            existing = {option["id"] for option in current["options"]}
            current["options"].extend(
                option for option in fixed_options if option["id"] not in existing
            )
            continue

        inline_options = _options_from_line(line)
        if current and inline_options:
            current["options"].extend(inline_options)
            continue

        option_match = OPTION_RE.match(_normalize_choice_markers(line))
        if current and option_match:
            current["options"].append(
                {"id": option_match.group(1).lower(), "text": option_match.group(2).strip()}
            )
            continue

        if current and line.strip():
            if current["options"]:
                current["options"][-1]["text"] = (
                    f"{current['options'][-1]['text']} {line.strip()}".strip()
                )
            else:
                current["prompt"] = (
                    f"{current['prompt']}\n{line.strip()}".strip()
                )

    if current:
        questions.append(current)

    out: list[dict[str, Any]] = []
    for q in questions:
        options = q["options"]
        number = q.pop("_number")
        q.pop("_standalone_number", None)
        q.pop("_nested_numbering", None)
        answer = answer_key.get(number) or (global_answers or {}).get(number)
        if len(options) >= 2:
            correct_id = None
            if answer:
                token = answer.lower().strip()
                if token in {option["id"] for option in options}:
                    correct_id = token
            payload = {
                "question_type": "single_choice",
                "prompt": q["prompt"],
                "payload": {"options": options},
                "answer_key": {"correct": [correct_id]} if correct_id else {"correct": []},
                "status": "draft",
            }
            confidence = 0.9 if correct_id else 0.72
        else:
            payload = {
                "question_type": "short_answer",
                "prompt": q["prompt"],
                "payload": {"blank_count": 1},
                "answer_key": {"blanks": [[answer]]} if answer else {"blanks": [[]]},
                "status": "draft",
            }
            confidence = 0.75 if answer else 0.55

        out.append(
            {
                "item_type": "question",
                "page": page,
                "sheet": None,
                "crop": (question_crops or {}).get(number),
                "payload": payload,
                "confidence": confidence,
            }
        )
    return out


def _spreadsheet_mapping(
    profile: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not profile:
        return None
    mapping = profile.get("spreadsheet_mapping")
    if not isinstance(mapping, dict):
        return None
    columns = mapping.get("columns")
    if not isinstance(columns, dict) or not str(columns.get("prompt") or "").strip():
        return None
    return mapping


def _normalize_header(value: Any) -> str:
    return "_".join(str(value or "").strip().lower().split())


def _questions_from_sheet(
    sheet: dict[str, Any],
    mapping: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows = sheet.get("rows") or []
    if len(rows) < 2:
        return []

    if mapping:
        header_row = max(1, int(mapping.get("header_row") or 1))
        header_index = header_row - 1
        if header_index >= len(rows):
            return []
        first_data_row = mapping.get("first_data_row")
        data_index = (
            max(header_row + 1, int(first_data_row)) - 1
            if first_data_row is not None
            else header_index + 1
        )
        column_config = mapping.get("columns") or {}
    else:
        header_index = 0
        data_index = 1
        column_config = {}

    headers = [_normalize_header(value) for value in rows[header_index]]

    def find(
        configured: str,
        defaults: set[str] | None = None,
    ) -> int | None:
        configured_key = _normalize_header(configured)
        if configured_key:
            try:
                return headers.index(configured_key)
            except ValueError:
                return None

        for name in defaults or set():
            key = _normalize_header(name)
            if key in headers:
                return headers.index(key)
        return None

    prompt_idx = find(
        str(column_config.get("prompt") or ""),
        None if mapping else {"question", "prompt", "sual", "text"},
    )
    if prompt_idx is None:
        return []

    type_idx = find(
        str(column_config.get("question_type") or ""),
        None if mapping else {"type", "question_type", "tip"},
    )
    correct_idx = find(
        str(column_config.get("correct_answer") or ""),
        None if mapping else {"correct", "correct_answer", "answer", "cavab"},
    )

    option_indexes: list[tuple[str, int]] = []
    for letter in "abcdefgh":
        configured = str(column_config.get(f"option_{letter}") or "")
        if mapping:
            idx = find(configured) if configured else None
        else:
            idx = find("", {f"option_{letter}", letter})
        if idx is not None:
            option_indexes.append((letter, idx))

    field_indexes = {
        field: find(str(column_config.get(field) or ""))
        for field in [
            "instructions",
            "explanation",
            "points",
            "difficulty",
            "learning_language",
            "level",
            "tags",
            "section",
        ]
    }

    separator = str(mapping.get("multi_value_separator") or "|") if mapping else "|"
    sheet_name = str(sheet.get("sheet") or "")
    sheet_as_section = bool(mapping and mapping.get("sheet_as_section"))

    def cell(row: list[Any], index: int | None) -> str:
        if index is None or index >= len(row):
            return ""
        return str(row[index] or "").strip()

    def split_values(value: str) -> list[str]:
        if not value:
            return []
        return [
            part.strip()
            for part in value.split(separator)
            if part.strip()
        ]

    out: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows[data_index:], start=data_index + 1):
        prompt = cell(row, prompt_idx)
        if not prompt:
            continue

        requested_type = cell(row, type_idx)
        options = [
            {"id": letter, "text": cell(row, idx)}
            for letter, idx in option_indexes
            if cell(row, idx)
        ]
        correct_raw = cell(row, correct_idx)
        correct_tokens = split_values(correct_raw)

        if len(options) >= 2:
            by_id = {option["id"].lower(): option["id"] for option in options}
            by_text = {
                option["text"].strip().casefold(): option["id"]
                for option in options
            }
            correct_ids: list[str] = []
            unresolved = 0
            for token in correct_tokens:
                lowered = token.strip().lower()
                option_id = by_id.get(lowered)
                if option_id is None:
                    option_id = by_text.get(token.strip().casefold())
                if option_id is None:
                    unresolved += 1
                    continue
                if option_id not in correct_ids:
                    correct_ids.append(option_id)

            question_type = requested_type or (
                "multiple_choice" if len(correct_ids) > 1 else "single_choice"
            )
            answer_key = {"correct": correct_ids}
            payload: dict[str, Any] = {"options": options}
            confidence = (
                0.96
                if correct_ids and unresolved == 0
                else 0.72
                if correct_raw
                else 0.68
            )
        else:
            answers = correct_tokens or ([correct_raw] if correct_raw else [])
            question_type = requested_type or "short_answer"
            answer_key = {"blanks": [answers]}
            payload = {"blank_count": 1}
            confidence = 0.94 if answers else 0.68

        question_payload: dict[str, Any] = {
            "question_type": question_type,
            "prompt": prompt,
            "payload": payload,
            "answer_key": answer_key,
            "status": "draft",
        }

        instructions = cell(row, field_indexes["instructions"])
        explanation = cell(row, field_indexes["explanation"])
        language = cell(row, field_indexes["learning_language"])
        level = cell(row, field_indexes["level"])
        tags = split_values(cell(row, field_indexes["tags"]))
        section = cell(row, field_indexes["section"])
        if not section and sheet_as_section:
            section = sheet_name

        if instructions:
            question_payload["instructions"] = instructions
        if explanation:
            question_payload["explanation"] = explanation
        if language:
            question_payload["learning_language"] = language
        if level:
            question_payload["level"] = level
        if tags:
            question_payload["tags"] = tags[:100]

        points_raw = cell(row, field_indexes["points"])
        if points_raw:
            try:
                points = float(points_raw.replace(",", "."))
                if 0 < points <= 10_000:
                    question_payload["scoring"] = {
                        "points": points,
                        "partial": False,
                        "negative": 0,
                    }
            except ValueError:
                confidence = min(confidence, 0.75)

        difficulty_raw = cell(row, field_indexes["difficulty"])
        if difficulty_raw:
            try:
                difficulty = int(float(difficulty_raw))
                if 1 <= difficulty <= 5:
                    question_payload["difficulty"] = difficulty
                else:
                    confidence = min(confidence, 0.75)
            except ValueError:
                confidence = min(confidence, 0.75)

        if mapping:
            question_payload["import_mapping"] = {
                "sheet": sheet_name,
                "row": row_number,
                "header_row": header_index + 1,
                "section": section or None,
            }
            if section:
                question_payload["import_context"] = {
                    "kind": "independent",
                    "section": section,
                }

        out.append(
            {
                "item_type": "question",
                "page": None,
                "sheet": sheet_name,
                "payload": question_payload,
                "confidence": confidence,
            }
        )
    return out


def _ocr_languages() -> str:
    # Tesseract falls back to English if a configured language pack is unavailable.
    return "aze+eng+rus+tur"
