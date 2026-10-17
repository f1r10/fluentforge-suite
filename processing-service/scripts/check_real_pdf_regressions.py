"""Compare real teacher-provided PDFs against source-verified acceptance counts.

The original copyrighted PDF fixtures are NOT committed to GitHub. Place the
authorized files in a local folder and run this script (see usage below).
It does not change the DB or write any imported questions.

From repository root:
  python processing-service/scripts/check_real_pdf_regressions.py /path/to/pdfs
  python processing-service/scripts/check_real_pdf_regressions.py /path/to/pdfs --strict

Prints machine-readable JSON; --strict exits 1 if a source is missing/wrong.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

# Support running directly from repository root without packaging installation.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.extractors import detect_candidates, extract_document


# Only SHA256 prefixes from *actual* user-supplied samples; two uploaded
# numbered variants are identical. Never substitute arbitrary generated PDFs.
GOLDENS = {
    "d503f3eaf29f6269": ("QA01 baseline", "questions", 10),
    "d3565e46be72d0b0": ("Elementary two-column A1", "questions", 40),
    "94f6f5d2fabd0827": ("A2 sectional Grammar/Reading/Listening", "auto", 60),
    "1b150c0d40022012": ("Azerbaijani nested statements", "questions", 25),
    "e600e74aa01485d9": ("Present Simple written answers", "questions", 32),
    "fd15eb0e8559bb3e": ("Beginner mixed exercises", "auto", 100),
    "43e867b619e50d2d": ("BTU C1 sense-preserving vocabulary", "vocabulary", 1801),
}

def answered(item: dict) -> bool:
    key = item.get("payload", {}).get("answer_key") or {}
    if not isinstance(key, dict):
        return False
    if isinstance(key.get("correct"), list):
        return any(bool(x) for x in key["correct"])
    if isinstance(key.get("blanks"), list):
        return all(isinstance(row, list) and any(bool(v) for v in row)
                   for row in key["blanks"])
    return bool(key.get("pairs") or key.get("order") or key.get("model_answer"))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    if not args.directory.is_dir():
        parser.error("PDF directory does not exist")
    matched: set[str] = set()
    results: list[dict] = []
    for file in sorted(args.directory.rglob("*.pdf")):
        digest = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
        if digest not in GOLDENS:
            continue
        name, mode, expected_count = GOLDENS[digest]
        if digest in matched:
            continue
        matched.add(digest)
        start = time.monotonic()
        try:
            extraction = extract_document(file, file.name, "application/pdf")
            candidates = detect_candidates(extraction, profile={
                "expected_content": mode,
                "learning_language": "en",
            })
            wanted_type = "vocabulary" if mode == "vocabulary" else "question"
            parsed = [item for item in candidates if item.get("item_type") == wanted_type]
            count = len(parsed)
            answered_count = sum(answered(item) for item in parsed) if wanted_type == "question" else None
            warnings = sum(bool(item.get("payload", {}).get("import_warnings")) for item in parsed)
            results.append({
                "source": name, "filename": file.name, "sha256_prefix": digest,
                "expected": expected_count, "actual": count,
                "correct_answer_present": answered_count,
                "needs_manual_review": warnings,
                "raw_text_records": sum(item.get("item_type") == "raw_text" for item in candidates),
                "pages": len(extraction.pages),
                "seconds": round(time.monotonic() - start, 2),
                "status": "PASS" if count == expected_count else "FAIL",
            })
        except Exception as exc:
            results.append({
                "source": name, "filename": file.name, "sha256_prefix": digest,
                "expected": expected_count, "status": "ERROR",
                "error": f"{type(exc).__name__}: {exc}",
            })
    for digest, (name, _, expected) in GOLDENS.items():
        if digest not in matched:
            results.append({"source": name, "sha256_prefix": digest,
                            "expected": expected, "status": "NOT_FOUND"})
    output = {"format": "fluentforge-real-pdf-regressions/v1", "results": results}
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return int(args.strict and any(row["status"] != "PASS" for row in results))

if __name__ == "__main__":
    raise SystemExit(main())
