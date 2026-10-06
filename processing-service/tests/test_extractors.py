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


def test_pdf_reconstructs_reading_and_links_questions(tmp_path: Path):
    source = tmp_path / "reading.pdf"
    document = fitz.open()
    page = document.new_page(width=600, height=800)

    page.insert_text((72, 70), "A Short Passage")
    passage = (
        "Learning another language takes regular practice and repeated exposure. "
        "Students improve more quickly when they read meaningful texts, review "
        "new vocabulary, listen to authentic speech, and answer questions about "
        "what they understood. Teachers can then use those answers to identify "
        "weak areas and choose the next activity."
    )
    page.insert_textbox(fitz.Rect(72, 95, 530, 250), passage, fontsize=11)

    page.insert_text((72, 330), "1. What helps students improve?")
    page.insert_text((92, 360), "A. Regular practice")
    page.insert_text((92, 390), "B. Avoiding reading")
    page.insert_text((72, 440), "2. What can teachers identify?")
    page.insert_text((92, 470), "A. Weak areas")
    page.insert_text((92, 500), "B. Nothing")
    page.insert_text((72, 570), "Answers: 1 A 2 A")

    document.save(source)
    document.close()

    extraction = extract_document(source, source.name, "application/pdf")
    items = detect_candidates(extraction)

    readings = [item for item in items if item["item_type"] == "reading"]
    questions = [item for item in items if item["item_type"] == "question"]

    assert len(readings) == 1
    assert len(questions) == 2
    assert readings[0]["payload"]["title"] == "A Short Passage"
    assert "Learning another language" in readings[0]["payload"]["body"]

    source_ref = readings[0]["payload"]["source_ref"]
    for index, question in enumerate(questions):
        context = question["payload"]["import_context"]
        assert context["kind"] == "reading"
        assert context["source_ref"] == source_ref
        assert context["sort_order"] == index
        assert question["crop"] is not None


def test_pdf_short_intro_does_not_create_false_reading(tmp_path: Path):
    source = tmp_path / "short-intro.pdf"
    document = fitz.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((72, 80), "Choose the correct answer.")
    page.insert_text((72, 140), "1. Capital of France?")
    page.insert_text((92, 170), "A. Paris")
    page.insert_text((92, 200), "B. London")
    page.insert_text((72, 250), "Answer: 1 A")
    document.save(source)
    document.close()

    extraction = extract_document(source, source.name, "application/pdf")
    items = detect_candidates(extraction)

    assert not [item for item in items if item["item_type"] == "reading"]
    assert len([item for item in items if item["item_type"] == "question"]) == 1
