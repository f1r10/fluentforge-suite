from pathlib import Path

import fitz

from app.extractors import detect_candidates, extract_document


def test_plain_text_question_detection(tmp_path: Path):
    source = tmp_path / "questions.txt"
    source.write_text(
        "1. Capital of France?\n"
        "A. Paris\n"
        "B. London\n"
        "Answer: 1 A\n",
        encoding="utf-8",
    )

    extraction = extract_document(source, source.name, "text/plain")
    items = detect_candidates(extraction)

    assert extraction.method == "native_text"
    assert len(items) == 1
    assert items[0]["item_type"] == "question"
    assert items[0]["payload"]["prompt"] == "Capital of France?"
    assert items[0]["payload"]["answer_key"] == {"correct": ["a"]}


def test_csv_question_detection(tmp_path: Path):
    source = tmp_path / "questions.csv"
    source.write_text(
        "question,type,option_a,option_b,correct\n"
        "2+2?,single_choice,4,5,A\n",
        encoding="utf-8",
    )

    extraction = extract_document(source, source.name, "text/csv")
    items = detect_candidates(extraction)

    assert extraction.method == "delimited_native"
    assert len(items) == 1
    assert items[0]["payload"]["question_type"] == "single_choice"
    assert items[0]["payload"]["answer_key"] == {"correct": ["a"]}


def test_falls_back_to_raw_text_when_no_question_pattern(tmp_path: Path):
    source = tmp_path / "notes.txt"
    source.write_text("A paragraph without a numbered question.", encoding="utf-8")

    extraction = extract_document(source, source.name, "text/plain")
    items = detect_candidates(extraction)

    assert len(items) == 1
    assert items[0]["item_type"] == "raw_text"


def test_pdf_layout_blocks_include_normalized_crop(tmp_path: Path):
    source = tmp_path / "layout.pdf"
    document = fitz.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((72, 100), "1. Example question")
    page.insert_text((72, 130), "A. First option")
    page.insert_text((72, 160), "B. Second option")
    document.save(source)
    document.close()

    extraction = extract_document(source, source.name, "application/pdf")

    assert extraction.method == "pdf_layout_native"
    assert extraction.stats["pages"] == 1
    assert extraction.pages[0]["blocks"]
    crop = extraction.pages[0]["blocks"][0]["crop"]
    assert 0 <= crop["x"] <= 1
    assert 0 <= crop["y"] <= 1
    assert 0 < crop["width"] <= 1
    assert 0 < crop["height"] <= 1
