from app.extractors import _suppress_repeated_pdf_decorations


def asset(xref: int, x: float, y: float, width: float, height: float):
    return {"xref": xref, "crop": {
        "x": x, "y": y, "width": width, "height": height
    }}


def test_repeated_logos_and_tiny_marks_are_not_educational_images():
    pages = [
        {"page": i, "images": [
            asset(10, 0.02, 0.02, 0.30, 0.07),  # repeated header logo
            asset(11, 0.08, 0.42, 0.03, 0.03),  # checkbox decoration
            asset(100 + i, 0.25, 0.42, 0.40, 0.22),  # distinct diagram
        ]}
        for i in range(1, 6)
    ]
    assert _suppress_repeated_pdf_decorations(pages) == 10
    for i, page in enumerate(pages, 1):
        assert [image["xref"] for image in page["images"]] == [100 + i]


def test_large_repeated_central_diagram_is_retained():
    pages = [
        {"page": i, "images": [asset(25, 0.2, 0.3, 0.50, 0.35)]}
        for i in range(1, 5)
    ]
    assert _suppress_repeated_pdf_decorations(pages) == 0
    assert all(page["images"] for page in pages)


def test_single_page_diagram_is_never_removed():
    pages = [{"page": 1, "images": [
        asset(9, 0.06, 0.05, 0.30, 0.04),
    ]}]
    assert _suppress_repeated_pdf_decorations(pages) == 0
    assert len(pages[0]["images"]) == 1
