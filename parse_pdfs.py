"""
NSB PDF Parser
Parses National Science Bowl question PDFs and outputs data/questions.json
Usage: python3 parse_pdfs.py
"""

import json
import os
import re
from datetime import date
from pathlib import Path

import pdfplumber

# ── Configuration ─────────────────────────────────────────────────────────────

PDF_ROOT = Path(__file__).parent.parent / "NSB_Questions"  # scans HighSchool/ and MiddleSchool/
OUTPUT_FILE = Path(__file__).parent / "data" / "questions.json"

DIFFICULTY_MAP = {
    range(1, 5):   "Easy",        # Rounds 1–4
    range(5, 9):   "Medium",      # Rounds 5–8
    range(9, 13):  "Hard",        # Rounds 9–12
}

CATEGORY_ALIASES = {
    "Earth & Space Science":   "Earth & Space",
    "Earth And Space":         "Earth & Space",   # title-cased "Earth and Space"
    "Earth And Space Science": "Earth & Space",   # title-cased form
    "Earth Science":           "Earth & Space",   # older PDFs: EARTH SCIENCE
    "Earth Ande Space":        "Earth & Space",   # typo in source PDF
    "Mathematics":             "Math",            # MS PDFs use "Mathematics"
    "Math Math":               "Math",            # parsing artifact in some MS PDFs
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_difficulty(round_num: int) -> str:
    for r, label in DIFFICULTY_MAP.items():
        if round_num in r:
            return label
    return "Challenging"


def normalize_category(raw: str) -> str:
    # .title() normalises ALL-CAPS categories from older PDFs ("BIOLOGY" → "Biology")
    # .rstrip(".") removes trailing periods from MS PDFs (e.g. "Life Science.")
    raw = raw.strip().rstrip(".").strip().title()
    return CATEGORY_ALIASES.get(raw, raw)


def extract_text_from_pdf(pdf_path: Path) -> str:
    """Return all text from a PDF, pages joined with newline."""
    parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                parts.append(text)
    return "\n".join(parts)


def split_into_blocks(full_text: str) -> list[tuple[str, list[str]]]:
    """
    Walk lines and group them into (block_type, lines) tuples.
    block_type is 'TOSS-UP' or 'BONUS'.
    Blocks are delimited by the keywords themselves or *** separators.
    """
    blocks = []
    current_type = None
    current_lines = []

    for raw_line in full_text.splitlines():
        line = raw_line.strip()

        if line == "TOSS-UP":
            if current_type and current_lines:
                blocks.append((current_type, current_lines))
            current_type = "TOSS-UP"
            current_lines = []

        elif line == "BONUS":
            if current_type and current_lines:
                blocks.append((current_type, current_lines))
            current_type = "BONUS"
            current_lines = []

        elif re.fullmatch(r"\*+", line):
            # Separator — end current block
            if current_type and current_lines:
                blocks.append((current_type, current_lines))
            current_type = None
            current_lines = []

        elif current_type is not None:
            if line:  # skip blank lines within a block
                current_lines.append(line)

    # Don't forget the last block
    if current_type and current_lines:
        blocks.append((current_type, current_lines))

    return blocks


# Regex for the header line. Handles three variations seen across question sets:
#   Modern:  "4) Energy – Multiple Choice ..."   (paren, dash)
#   Older:   "4) ENERGY Short Answer ..."         (paren, no dash)
#   Variant: "4. ENERGY Short Answer ..."         (period, no dash)
# The trailing period on "Multiple Choice." is also handled.
HEADER_RE = re.compile(
    r"^(\d+)[)\.]\s+(.+?)\s+(?:[–—\-]\s+)?(Short Answer|Multiple Choice)\.?\s*(.*)",
    re.IGNORECASE,
)


def parse_block(
    block_type: str,
    lines: list[str],
    year: int,
    level: str,
    round_num: int,
    set_num: int | None = None,
) -> dict | None:
    """Parse a single TOSS-UP or BONUS block into a question object."""

    if not lines:
        return None

    # First line must match the header pattern
    header_match = HEADER_RE.match(lines[0])
    if not header_match:
        return None

    q_number   = int(header_match.group(1))
    category   = normalize_category(header_match.group(2))
    fmt        = header_match.group(3).title()  # normalize casing
    q_start    = header_match.group(4).strip()

    question_parts = [q_start] if q_start else []
    options: dict[str, str] = {}
    answer_parts: list[str] = []
    in_answer = False

    for line in lines[1:]:
        if in_answer:
            answer_parts.append(line)
        elif line.startswith("ANSWER:"):
            in_answer = True
            tail = line[len("ANSWER:"):].strip()
            if tail:
                answer_parts.append(tail)
        elif re.match(r"^[WXYZ]\)\s", line):
            m = re.match(r"^([WXYZ])\)\s*(.*)", line)
            if m:
                options[m.group(1)] = m.group(2).strip()
        else:
            question_parts.append(line)

    question_text = " ".join(question_parts).strip()
    answer = " ".join(answer_parts).strip()

    if not question_text or not answer:
        return None

    type_str  = "Toss-Up" if block_type == "TOSS-UP" else "Bonus"
    type_code = "TU"      if block_type == "TOSS-UP" else "BN"
    set_part  = f"-Set{set_num}" if set_num is not None else ""
    q_id = f"{year}{set_part}-{level}-Rd{round_num}-{type_code}-{q_number}"

    return {
        "id":             q_id,
        "year":           year,
        "level":          level,
        "round":          round_num,
        "difficulty":     get_difficulty(round_num),
        "questionNumber": q_number,
        "type":           type_str,
        "category":       category,
        "format":         fmt,
        "question":       question_text,
        "options":        options if options else None,
        "answer":         answer,
    }


def parse_pdf(pdf_path: Path) -> tuple[list[dict], list[str]]:
    """Parse one PDF; return (questions, errors)."""
    errors = []

    # Support seven filename conventions:
    #   2020:       {YEAR}-{LEVEL}-Rd{ROUND}.pdf         → 2020-HS-Rd1.pdf
    #   2022:       {YEAR}-{LEVEL}-{ROUND}.pdf            → 2022-HS-1.pdf
    #   2021:       Set-{ROUND}-{LEVEL}-{YEAR}.pdf        → Set-1-HS-2021.pdf
    #   Set-suffix: {YEAR}-Set{N}-{LEVEL}-Rd{ROUND}.pdf  → 2011-Set4-HS-Rd1.pdf
    #   Energy:     {YEAR}-{LEVEL}-Energy.pdf             → 2007-HS-Energy.pdf (round 0)
    #   RR:         {YEAR}-{LEVEL}-RR{N}.pdf              → 2019-MS-RR2.pdf (round 100+N)
    #   DE:         {YEAR}-{LEVEL}-DE{N}.pdf              → 2019-MS-DE1.pdf (round 150+N)
    patterns = [
        (re.compile(r"^(\d{4})-(\w+)-Rd(\d+)\.pdf$"),          "std"),
        (re.compile(r"^(\d{4})-(\w+)-(\d+)\.pdf$"),             "std"),
        (re.compile(r"^Set-(\d+)-(\w+)-(\d{4})\.pdf$"),         "rev"),
        (re.compile(r"^(\d{4})-Set(\d+)-(\w+)-Rd(\d+)\.pdf$"), "set"),
        (re.compile(r"^(\d{4})-(\w+)-Energy\.pdf$"),            "energy"),
        (re.compile(r"^(\d{4})-(\w+)-RR(\d+)\.pdf$"),           "rr"),
        (re.compile(r"^(\d{4})-(\w+)-DE(\d+)\.pdf$"),           "de"),
    ]
    year, level, round_num, set_num = None, None, None, None
    for pat, style in patterns:
        m = pat.match(pdf_path.name)
        if m:
            if style == "std":
                year, level, round_num = int(m.group(1)), m.group(2), int(m.group(3))
            elif style == "rev":
                round_num, level, year = int(m.group(1)), m.group(2), int(m.group(3))
            elif style == "set":
                year, set_num, level, round_num = (
                    int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4))
                )
            elif style == "energy":
                year, level, round_num = int(m.group(1)), m.group(2), 0
            elif style == "rr":
                year, level, round_num = int(m.group(1)), m.group(2), 100 + int(m.group(3))
            elif style == "de":
                year, level, round_num = int(m.group(1)), m.group(2), 150 + int(m.group(3))
            break

    if year is None:
        return [], [f"Cannot parse filename: {pdf_path.name}"]

    try:
        full_text = extract_text_from_pdf(pdf_path)
    except Exception as e:
        return [], [f"Failed to read {pdf_path.name}: {e}"]

    blocks = split_into_blocks(full_text)
    questions = []

    for block_type, lines in blocks:
        q = parse_block(block_type, lines, year, level, round_num, set_num)
        if q:
            questions.append(q)
        else:
            errors.append(
                f"{pdf_path.name}: failed to parse {block_type} block — {lines[:1]}"
            )

    return questions, errors


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    all_questions: list[dict] = []
    all_errors:    list[str]  = []

    years_found:  set[int] = set()
    levels_found: set[str] = set()

    # Collect and sort all PDFs for deterministic output
    pdf_files = sorted(PDF_ROOT.rglob("*.pdf"))

    if not pdf_files:
        print(f"ERROR: No PDF files found under {PDF_ROOT}")
        return

    # Parse each file
    by_year_level: dict[tuple[int, str], int] = {}
    for pdf_path in pdf_files:
        questions, errors = parse_pdf(pdf_path)
        all_questions.extend(questions)
        all_errors.extend(errors)

        for q in questions:
            years_found.add(q["year"])
            levels_found.add(q["level"])
            key = (q["year"], q["level"])
            by_year_level[key] = by_year_level.get(key, 0) + 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PARSE SUMMARY")
    print("=" * 60)
    prev_level = None
    for (yr, lvl) in sorted(by_year_level):
        if lvl != prev_level:
            print(f"\n  [{lvl}]")
            prev_level = lvl
        print(f"    Year {yr}: {by_year_level[(yr, lvl)]:>4} questions")
    print(f"\n  Total:  {len(all_questions):>4} questions")

    categories = sorted({q["category"] for q in all_questions})
    print(f"\nCategories found: {categories}")

    if all_errors:
        print(f"\nParsing errors ({len(all_errors)}):")
        for e in all_errors:
            print(f"  ⚠ {e}")
    else:
        print("\nNo parsing errors.")
    print("=" * 60 + "\n")

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "metadata": {
            "totalQuestions": len(all_questions),
            "years":          sorted(years_found),
            "levels":         sorted(levels_found),
            "lastUpdated":    date.today().isoformat(),
        },
        "questions": all_questions,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Output written to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
