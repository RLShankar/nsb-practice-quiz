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

### Automated detection of suspicious content in questions and answers
Some parsed questions and answers contain PDF page-footer artifacts appended to the
real content, e.g.:
  "W) MORE IMMIGRATION THAN EMIGRATION 2016 National Science Bowl® - Middle School Regional Events Page 3"

These are caused by PDF text extraction running across page boundaries. They are not
caught by the parser because the question/answer itself is valid — only the trailing
garbage is wrong.

**Proposed approach — a standalone audit script:**
Write a Python script (`audit_questions.py`) that scans all entries in `questions.json`
and flags suspicious content using heuristics, for example:
- Answer or question text containing "Page \d+"
- Answer or question text containing "National Science Bowl"
- Answer or question text containing "Regional Events"
- Answer or question text containing year patterns like "20\d\d" not at the start
- Unusually long answers (e.g. > 100 characters) that may have garbage appended

Output a report of flagged questions (ID + current text) for manual review.
Confirmed corrections get added to `manual_corrections.json`.

This could recover a meaningful number of silently-corrupted answers that currently
look valid to the parser but are wrong for the student.

### Lightweight correction tool (local, private use only)
A local-only workflow for correcting questions that parsed but render incorrectly
(garbled text, wrong answer, truncated question, etc.). This is higher priority than
fixing parse failures — these questions already have valid IDs visible in the results
review screen, so they can be identified organically during a practice session.

**Workflow:**
1. During practice, notice a bad question → note its ID from the results review
   (e.g. `2019-MS-Rd4-TU-7`)
2. Open `data/manual_corrections.json` and add an entry with just the fields that
   need fixing — everything else is inherited from the original parsed data:
   ```json
   {
     "corrections": [
       {
         "id": "2019-MS-Rd4-TU-7",
         "question": "corrected question text here",
         "answer": "CORRECTED ANSWER"
       }
     ]
   }
   ```
3. Run `python3 parse_pdfs.py` — a merge step reads `manual_corrections.json`
   and applies corrections on top of parsed data before writing `questions.json`
4. Commit and push — corrections are version-controlled separately from the parser
   and are never overwritten by future parser runs

**Key properties:**
- Local only — `manual_corrections.json` lives in the repo but the editing is done
  manually; no UI needed initially
- Corrections survive re-parsing — the merge step always re-applies them
- Only specified fields are overridden — partial corrections are supported
- Optionally: a small Python helper script that takes an ID as argument, prints the
  current question data, and guides field-by-field correction entry

**Priority tiers:**
1. Parsed-but-wrong questions (identified by ID from the results review) — tackle first
2. Failed-to-parse questions (~262, see below) — tackle separately once tier 1 is done

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

### Show question metadata in results review
The quiz header already shows year, round, and difficulty. The one missing piece is
the question number within the round, useful for looking up the original PDF.

Recommended approach:
- Add question number to the quiz header (small addition, low clutter)
- Show the full question ID (e.g. "2020-HS-Rd1-TU-3") in the results review screen
  where it's most actionable — the student has finished and wants to investigate a
  specific question. Currently the review only shows category and type.

This is a small, self-contained change to app.js and style.css only.

### User feedback form on results screen (public app)
A lightweight alternative to backend flagging for the public app. A Google Form
(zero backend, zero cost) linked from the results screen lets users submit:
- General feedback on app usefulness
- Specific question IDs they believe are incorrect (the ID format like
  "2020-HS-Rd1-TU-3" is human-readable enough to copy-paste)

Implementation: a small "Share Feedback" button on the results screen.
**Prerequisite:** user must first create the Google Form and share its URL.
Once the URL is available, embedding it takes minutes.

This elegantly solves the public flagging problem without any backend infrastructure
and handles the abuse concern (Google Forms has basic spam controls).

### Question flagging for error review (private app only)
Flagging belongs in the private app, not the public app, for these reasons:
- Public app is a zero-backend static site; adding write capability is a major
  architectural change not worth making just for flagging
- Random public users may flag correct questions they simply got wrong — noise
  with no accountability
- The people best qualified to flag errors are Science Bowl students/coaches
  (the family) — exactly the private app's audience
- Private app already needs a backend for analytics; flagging is free to add there
- Auto-detected parse failures (from parse_pdfs.py) can be fed into the same
  review queue in the private app

### Disclose parse errors to users
A small fraction of questions (~1%) appear garbled due to PDF parsing limitations
(math symbols rendered as images, CID font encoding in older PDFs).

Two complementary approaches to consider:
1. **Passive disclaimer** — add a one-liner to the footer on the level-select and home
   screens, e.g. *"Occasionally a question may appear incomplete due to PDF extraction
   limitations."* Simple, sets expectations upfront.
2. **In-quiz Flag button** — a small flag icon on the quiz screen letting users mark a
   specific question as garbled. More useful: identifies *which* questions are bad,
   produces an actionable list, and feeds naturally into the manual corrections workflow
   described above. This is the better long-term solution.

Recommendation: add the passive disclaimer first (trivial), then build the flag button
as part of the parse-failure corrections workflow.

### Short answer text input with fuzzy checking
Currently short answer questions use a self-grade flow (student reveals answer, marks
themselves correct/incorrect). A text input field would let the app check correctness
automatically, making the experience feel more like a real quiz.

**Recommended approach — fuzzy matching with override:**
1. Student types their answer into a text field and submits
2. App normalizes both the typed answer and the stored answer (lowercase, trim whitespace,
   collapse multiple spaces, optionally strip punctuation) before comparing
3. If they match: mark correct and show the official answer
4. If they don't match: show incorrect with the official answer displayed, plus a small
   "Mark as correct anyway" button to handle legitimate edge cases (e.g. valid alternate
   phrasings, chemical formulas typed differently)

This handles the most common mismatches (case sensitivity, extra spaces) without being
brittle, and keeps human override as a safety valve. The self-grade buttons can be removed
for short answer once this is in place.

**What to avoid:** semantic/AI-based answer checking — unnecessary complexity for NSB
answers which are short and specific (a term, a number, a name).

### Phase 3+ features (not yet started)
- Timed mode
- Flashcard mode
- Team mode
- UI polish

### Private companion app with analytics (separate app, not added to public app)
The public app intentionally has no accounts, no stored data, and no login — keep it that way.
Personal analytics features should live in a separate private app for the family's use.

**Recommended approach — separate app with lightweight backend:**
- New repo (e.g. `nsb-practice-private`) that reuses the same questions.json and quiz engine
- Adds a simple user selector ("Older Son" / "Younger Son") stored in localStorage — no
  real login needed
- Persists session results to a free hosted database (Supabase or Firebase are good options)
- New screens to unlock:
  - **Wrong question retry** — queue of questions answered incorrectly, for focused drilling
  - **Category breakdown over time** — which subjects need the most work
  - **Improvement trends** — score history per category/difficulty across sessions
  - **Weak spots** — specific questions or topics flagged repeatedly as incorrect

**Why not localStorage-only:** data is lost on cache clear and not shared across devices.
A small hosted database solves both problems and is free at this scale.

**Why not add to public app:** keeps the public app simple and zero-friction for anyone;
avoids the complexity of accounts/auth in a publicly shared tool.

### MIT Science Bowl (explicitly deferred)
- MIT HS resource page: https://www.mitsciencebowl.com/high-school/resources
- Would require its own downloader logic (separate URL/format from science.osti.gov)
