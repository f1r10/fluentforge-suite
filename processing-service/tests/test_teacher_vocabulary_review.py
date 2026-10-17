"""Regression tests for teacher-supervised bilingual vocabulary extraction."""

from app.extractors import _vocabulary_from_text


def test_az_a1_pdf_level_and_verb_sense_are_preserved():
    items = _vocabulary_from_text(
        "A1 səviyyə üzrə sözlər\nbuy – almaq\nwork – işləmək\nfood – yemək (qida)\n",
        page=1,
        profile={"learning_language": "en", "translation_language": "az"},
    )
    by_word = {item["payload"]["word"]: item["payload"] for item in items}

    assert "A1 səviyyə üzrə sözlər" not in by_word
    assert set(by_word) == {"buy", "work", "food"}
    assert all(value["level"] == "A1" for value in by_word.values())
    assert by_word["buy"]["part_of_speech"] == "verb"
    assert by_word["buy"]["translations"] == [{"language": "az", "value": "almaq"}]
    assert by_word["work"]["part_of_speech"] == "verb"
    assert by_word["food"]["part_of_speech"] is None


def test_explicit_profile_level_and_part_of_speech_are_not_overwritten():
    items = _vocabulary_from_text(
        "A1 səviyyə üzrə sözlər\nwork noun – iş\n",
        page=2,
        profile={
            "learning_language": "en",
            "translation_language": "az",
            "level": "B1",
        },
    )
    payload = next(item["payload"] for item in items if item["payload"]["word"] == "work")
    assert payload["level"] == "B1"
    assert payload["part_of_speech"] == "noun"
