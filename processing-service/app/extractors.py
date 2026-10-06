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


QUESTION_RE = re.compile(r"^\s*(\d{1,4})[\.)]\s+(.+?)\s*$")
OPTION_RE = re.compile(r"^\s*([A-Ha-h])[\.)]\s+(.+?)\s*$")
ANSWER_RE = re.compile(
    r"^\s*(?:answer\s*key|answers?|cavab(?:lar)?|cevap(?:lar)?|ответы?)\s*[:\-]?\s*(.*)$",
    re.IGNORECASE,
)
ANSWER_PAIR_RE = re.compile(r"(\d{1,4})\s*[-.:)]?\s*([A-H]|True|False|Yes|No|Not Given)", re.IGNORECASE)


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
        native_text = "\n".join(block["text"] for block in blocks if block["text"]).strip()
        text = native_text or page.get_text("text").strip()
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
    rows = list(csv.reader(io.StringIO(raw), delimiter=delimiter))
    rows = [[str(cell) for cell in row] for row in rows if any(str(cell).strip() for cell in row)]
    name = path.stem
    text = "\n".join("\t".join(row) for row in rows)
    return Extraction("delimited_native", [], [{"sheet": name, "rows": rows, "text": text}], text, {"rows": len(rows)})


def _extract_image(path: Path) -> Extraction:
    image = Image.open(path)
    text = pytesseract.image_to_string(image, lang=_ocr_languages()).strip()
    return Extraction("image_ocr", [{"page": 1, "text": text, "method": "ocr"}], [], text, {"pages": 1})


def detect_candidates(
    extraction: Extraction,
    profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    spreadsheet_mapping = _spreadsheet_mapping(profile)

    for page in extraction.pages:
        page_number = page.get("page")
        question_crops = _question_crop_map(page)
        questions = _questions_from_text(
            page.get("text", ""),
            page=page_number,
            question_crops=question_crops,
        )

        reading = _reading_candidate_from_page(page, questions)
        if reading:
            source_ref = str(reading["payload"]["source_ref"])
            candidates.append(reading)
            for index, question in enumerate(questions):
                payload = question.get("payload") or {}
                payload["import_context"] = {
                    "kind": "reading",
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
            match = QUESTION_RE.match(line)
            if match and match.group(1) not in out:
                out[match.group(1)] = crop
    return out


def _text_before_first_question(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        if QUESTION_RE.match(line):
            break
        if ANSWER_RE.match(line):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def _reading_candidate_from_page(
    page: dict[str, Any],
    questions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not questions:
        return None

    prefix = _text_before_first_question(str(page.get("text") or ""))
    words = prefix.split()
    if len(prefix) < 180 or len(words) < 30:
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


def _questions_from_text(
    text: str,
    page: int | None,
    question_crops: dict[str, dict[str, float]] | None = None,
) -> list[dict[str, Any]]:
    lines = [line.rstrip() for line in text.splitlines()]
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    answer_key: dict[str, str] = {}

    for line in lines:
        answer_match = ANSWER_RE.match(line)
        if answer_match:
            for number, answer in ANSWER_PAIR_RE.findall(answer_match.group(1)):
                answer_key[number] = answer.strip()
            continue

        question_match = QUESTION_RE.match(line)
        if question_match:
            if current:
                questions.append(current)
            current = {
                "_number": question_match.group(1),
                "prompt": question_match.group(2).strip(),
                "options": [],
            }
            continue

        option_match = OPTION_RE.match(line)
        if current and option_match:
            current["options"].append(
                {"id": option_match.group(1).lower(), "text": option_match.group(2).strip()}
            )
            continue

        if current and line.strip():
            current["prompt"] += "\n" + line.strip()

    if current:
        questions.append(current)

    out: list[dict[str, Any]] = []
    for q in questions:
        options = q["options"]
        number = q.pop("_number")
        answer = answer_key.get(number)
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
