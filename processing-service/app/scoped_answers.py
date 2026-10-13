"""Section/task-aware answer-key detection for numbered PDF examinations.

Do not attach an answer by question number alone when independent exam tasks
restart numbering at 1. The key is (section, task, local question number).
"""
from __future__ import annotations

import re

SECTION_RE = re.compile(
    r"^\\s*Section\\s+(?:I|II|III)\\s*:\\s*(Grammar|Reading|Listening)\\b",
    re.IGNORECASE,
)
TASK_RE = re.compile(
    r"^\\s*(?:(?:Reading|Listening)\\s+)?Task\\s+(\\d+)\\s*:?",
    re.IGNORECASE,
)
PAGE_TASK_RE = re.compile(
    r"(?im)^\\s*(?:Reading|Listening)\\s+Task\\s+(\\d+)\\b",
)
ANSWER_TOKEN_RE = re.compile(
    r"(?<!\\d)(\\d{1,3})\\s*[:.\\-) ]?\\s*"
    r"(Not Given|True|False|[A-H]|T|F)(?!\\w)",
    re.IGNORECASE,
)


def extract_scoped_answers(document_text: str) -> dict[tuple[str, int], dict[str, str]]:
    """Extract e.g. Grammar 1b; Reading Task 2: 1T; Listening Task 3: 2e."""
    active = False
    section = ""
    task = 0
    answers: dict[tuple[str, int], dict[str, str]] = {}
    for raw in document_text.splitlines():
        line = raw.strip()
        if re.match(r"^Answer\\s+Key\\s*:", line, re.IGNORECASE):
            active = True
            continue
        if not active:
            continue
        section_match = SECTION_RE.match(line)
        if section_match:
            section = section_match.group(1).casefold()
            task = 0
            continue
        task_match = TASK_RE.match(line)
        if task_match:
            task = int(task_match.group(1))
        if not section:
            continue
        # For task-based sections, never harvest arbitrary prose as answers:
        # only the answer tokens after an explicit Task N: label count.
        answer_line = (
            line[task_match.end():]
            if task_match
            else line if section == "grammar" else ""
        )
        for number, value in ANSWER_TOKEN_RE.findall(answer_line):
            normal = {"t": "True", "f": "False"}.get(
                value.casefold(),
                value.upper() if len(value) == 1 else value.title(),
            )
            slot = answers.setdefault((section, task), {})
            # Repeated answer definitions are ambiguous, never overwrite.
            if number in slot and slot[number] != normal:
                slot[number] = ""
            else:
                slot[number] = normal
    return {
        key: {number: answer for number, answer in bucket.items() if answer}
        for key, bucket in answers.items()
    }


def section_for_page(page_text: str, previous: str | None) -> str | None:
    """Keep a section active across page breaks."""
    current = previous
    for line in page_text.splitlines():
        match = SECTION_RE.match(line)
        if match:
            current = match.group(1).casefold()
    return current


def task_for_page(page_text: str, section: str | None) -> int:
    if section not in {"reading", "listening"}:
        return 0
    match = PAGE_TASK_RE.search(page_text)
    return int(match.group(1)) if match else 0
