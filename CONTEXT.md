# NSB Quiz App — Context for Agents

## What this app is
A web-based National Science Bowl (NSB) practice quiz app built in vanilla JS.
No framework. Runs locally via `python3 -m http.server 8080` or deploys to GitHub Pages.

## File structure (inside nsb-quiz-app/)
```
nsb-quiz-app/
├── index.html          — filter screen + practice UI
├── style.css           — all styles
├── app.js              — all client-side logic
├── parse_pdfs.py       — Python script: reads PDFs → writes data/questions.json
├── data/
│   └── questions.json  — generated file; do not edit manually
└── CONTEXT.md          — this file
```

## Question data source (outside nsb-quiz-app/)
PDFs live in a sibling folder at the same level as nsb-quiz-app/:
```
National Science Bowl Practice/
├── NSB_Questions/
│   ├── HighSchool/        — HS Sets 1–14 (2007–2022), 14 years
│   │   ├── 2020/          — 17 rounds (782 questions)
│   │   ├── 2021/          — 10 sets  (360 questions)
│   │   ├── 2022/          — 15 rounds (540 questions)
│   │   └── ...            — Sets 1–12 covering 2007–2019
│   └── MiddleSchool/      — MS Sets 1–16 (2007–2022), 16 years
│       ├── 2007/          — oldest MS set
│       └── ...
├── nsb-quiz-app/          — this folder
└── NSB_Downloader_Tool/   — standalone download script (separate tool)
```

**Important:** `NSB_Questions/` was previously named `High School/` (with a space).
It was renamed and moved on 2026-03-02. Do not reference the old path.

## Parser (parse_pdfs.py)
- **Run:** `python3 parse_pdfs.py` from inside nsb-quiz-app/
- **Input:** All `*.pdf` files found recursively under `../NSB_Questions/` (both HS and MS)
- **Output:** `data/questions.json`
- **PDF_ROOT** (line 17): `Path(__file__).parent.parent / "NSB_Questions"`

### Filename conventions the parser handles
| Style | Example | Notes |
|-------|---------|-------|
| `{YEAR}-{LEVEL}-Rd{N}.pdf` | `2020-HS-Rd1.pdf` | Standard modern format |
| `{YEAR}-{LEVEL}-{N}.pdf` | `2022-HS-1.pdf` | 2022 variant |
| `Set-{N}-{LEVEL}-{YEAR}.pdf` | `Set-1-HS-2021.pdf` | 2021 variant |
| `{YEAR}-Set{S}-{LEVEL}-Rd{N}.pdf` | `2011-Set4-HS-Rd1.pdf` | Duplicate-year HS sets |
| `{YEAR}-{LEVEL}-Energy.pdf` | `2007-HS-Energy.pdf` | Set 3 special file (round 0) |
| `{YEAR}-{LEVEL}-RR{N}.pdf` | `2019-MS-RR2.pdf` | MS Round Robin (round 100+N) |
| `{YEAR}-{LEVEL}-DE{N}.pdf` | `2019-MS-DE1.pdf` | MS Double Elimination (round 150+N) |

The downloader tool is responsible for naming files correctly on download.

### Question block header variants the parser handles
Older PDFs (pre-2015) use different header formats inside the PDF text:
- **Modern** (2015+): `4) Biology – Short Answer ...`  (paren, en-dash)
- **Older**: `4) BIOLOGY Short Answer ...`  (paren, no dash, ALL-CAPS category)
- **Variant**: `4. BIOLOGY Short Answer ...`  (period instead of paren)

The parser normalises ALL-CAPS categories to title case and handles all three formats.
It also strips trailing periods from category names (e.g. `Life Science.` → `Life Science`).

### Category aliases (normalised in CATEGORY_ALIASES)
- `Earth & Space Science`, `Earth Science`, `Earth And Space` → `Earth & Space`
- `Mathematics`, `Math Math` → `Math`

### Known parse failures (~262 questions, ~1%)
Some questions cannot be recovered due to PDF text extraction limitations:
- Math questions where formulas/symbols are rendered as images or special fonts
- CID-encoded characters that pdfplumber cannot decode (shows as `(cid:XXXX)`)
These are distributed across the older sets (2007–2014) and are not fixable without OCR.

## questions.json schema
```json
{
  "metadata": {
    "totalQuestions": 22923,
    "years": [2007, 2008, ..., 2022],
    "levels": ["HS", "MS"],
    "lastUpdated": "2026-03-02"
  },
  "questions": [
    {
      "id": "2020-HS-Rd1-TU-1",
      "year": 2020,
      "level": "HS",
      "round": 1,
      "difficulty": "Easy",
      "questionNumber": 1,
      "type": "Toss-Up",
      "category": "Biology",
      "format": "Multiple Choice",
      "question": "...",
      "options": { "W": "...", "X": "...", "Y": "...", "Z": "..." },
      "answer": "..."
    }
  ]
}
```

- `difficulty`: Easy (rounds 1–4), Medium (5–8), Hard (9–12), Challenging (other)
- `type`: "Toss-Up" or "Bonus"
- `format`: "Multiple Choice" or "Short Answer"
- `options`: object with W/X/Y/Z keys for MC questions; `null` for Short Answer
- `level`: "HS" (High School) or "MS" (Middle School)

## Current status
- Phase 1 (PDF parser): complete — 22,923 questions across HS (2007–2022) + MS (2007–2022)
- Phase 2 (core web app — filter screen, practice mode, results): complete
- NSB Downloader Tool: complete — HS Sets 1–14 and MS Sets 1–16 downloaded
- Phase 3+ (timed mode, flashcard mode, team mode, polish): not started
- MIT Science Bowl: explicitly deferred

## To regenerate questions.json after adding new PDFs
```bash
cd "/Users/shankar/Documents/National Science Bowl Practice/nsb-quiz-app"
python3 parse_pdfs.py
```
Then refresh the browser. No other changes needed.

---

## TODO (future phases)

### Revisit parse failures (~262 questions)
The parser silently drops ~262 questions that it cannot parse, mostly math questions from
older sets (2007–2014) where formulas were rendered as images or used CID font encoding.

**Proposed approach (manual correction workflow):**
1. Enhance `parse_pdfs.py` to write a `data/parse_failures.json` alongside `questions.json`.
   Each entry should include: filename, year, level, set_num, round, block_type, and the raw
   lines extracted from the PDF (so the user knows what context is available).
2. User opens the original PDFs for each flagged question, reads the actual question, and
   types corrected versions into a new file: `data/manual_corrections.json` using the same
   schema as `questions.json`.
3. Add a merge step to `parse_pdfs.py` (or a small separate script) that reads
   `manual_corrections.json` and appends those questions to the final output.

**Notes:**
- ~262 failures across both HS and MS; most are concentrated in 2007–2014 math rounds.
- Two sub-types exist: (a) question text is partially readable but formula is missing — these
  are recoverable by looking at the PDF; (b) the block is completely garbled (e.g. first line
  is just `['1']`) — these may not be recoverable even manually.
- The corrections file is fully additive and reversible — it does not touch any existing data.

### Phase 3+ features (not yet started)
- Timed mode
- Flashcard mode
- Team mode
- UI polish

### MIT Science Bowl (explicitly deferred)
- MIT HS resource page: https://www.mitsciencebowl.com/high-school/resources
- Would require its own downloader logic (separate URL/format from science.osti.gov)
