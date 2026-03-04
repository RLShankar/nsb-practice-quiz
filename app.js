'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  allQuestions: [],  // full dataset (both levels)
  level:        null,// 'HS' or 'MS', set on level selection
  filtered:     [],  // after applying filter UI
  quiz:         [],  // questions selected for this session
  index:        0,   // current question index (0-based)
  answers:      [],  // { question, correct, skipped }
};

// ── Category → hex color ──────────────────────────────────────────────────────
const CAT_COLOR = {
  'Astronomy':        '#6366f1',
  'Biology':          '#14b8a6',
  'Chemistry':        '#10b981',
  'Earth & Space':    '#64748b',
  'Energy':           '#f59e0b',
  'General Science':  '#0ea5e9',
  'Life Science':     '#84cc16',
  'Math':             '#3b82f6',
  'Physical Science': '#f97316',
  'Physics':          '#8b5cf6',
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────
const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundLabel(round) {
  if (round === 0)  return 'Energy Round';
  if (round >= 150) return `Double Elim. Rd ${round - 150}`;
  if (round >= 100) return `Round Robin Rd ${round - 100}`;
  return `Round ${round}`;
}

// ── Fuzzy answer matching ─────────────────────────────────────────────────────

// Strip parenthetical notes, PDF garbage, and separator lines from a stored
// answer string to extract just the primary answer text.
// Examples:
//   "BOND DISSOCIATION ENERGY (ALSO ACCEPT: BOND DISSOCIATION)" → "BOND DISSOCIATION ENERGY"
//   "1500 KG·M/S (Solution: momentum = mv…)"                   → "1500 KG·M/S"
//   "HUND'S RULE 2017 Regional High School NSB® PAGE 1"         → "HUND'S RULE"
//   "40 Round 11 Page 6"                                         → "40"
//   "TWO _______________"                                         → "TWO"
function extractPrimary(raw) {
  let s = raw;
  s = s.replace(/\s*\(.*$/, '');                                            // strip from first '('
  s = s.replace(/\s*[~_]{3,}.*$/, '');                                     // strip separator lines
  s = s.replace(/\s+(Round\s+\d|Page\s+\d|\d{4}\s+Reg).*/i, '').trim();   // strip page/year refs
  s = s.replace(/\s+(High School|Middle School)\b.*/i, '').trim();         // strip school refs
  return s.trim();
}

// Normalize a string for comparison: lowercase, collapse whitespace,
// strip trailing/leading punctuation.
function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]/g, '').trim();
}

// Extract any "(ALSO ACCEPT: X, Y)" alternatives from a stored answer string.
function extractAlts(raw) {
  const m = raw.match(/\(\s*(?:ALSO\s+)?ACCEPT:\s*([^)]+)\)/i);
  if (!m) return [];
  return m[1].split(/[,;]/).map(a => normalize(extractPrimary(a.trim()))).filter(Boolean);
}

// Return true if the student's typed answer matches the stored answer,
// either via the primary answer or any accepted alternatives.
function fuzzyMatch(typed, stored) {
  const typedNorm = normalize(typed.trim());
  if (!typedNorm) return false;
  if (typedNorm === normalize(extractPrimary(stored))) return true;
  return extractAlts(stored).some(alt => typedNorm === alt);
}

// Return true if the typed answer matches a "(DO NOT ACCEPT: ...)" entry.
function matchesDoNotAccept(typed, stored) {
  const m = stored.match(/\(\s*DO NOT ACCEPT:\s*([^)]+)\)/i);
  if (!m) return false;
  const typedNorm = normalize(typed.trim());
  return m[1].split(/[,;]/).some(a => normalize(extractPrimary(a.trim())) === typedNorm);
}

// ── Screen navigation ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res  = await fetch('./data/questions.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.allQuestions = data.questions;

    const hsCount = state.allQuestions.filter(q => q.level === 'HS').length;
    const msCount = state.allQuestions.filter(q => q.level === 'MS').length;
    $('hs-count').textContent = `${hsCount.toLocaleString()} questions`;
    $('ms-count').textContent = `${msCount.toLocaleString()} questions`;
  } catch (err) {
    $('hs-count').textContent = '⚠ Could not load';
    $('ms-count').textContent = 'Run: python3 -m http.server';
    console.error(err);
  }
}

// ── Level selection ───────────────────────────────────────────────────────────
function selectLevel(level) {
  state.level = level;
  $('home-subtitle').textContent =
    `National Science Bowl · ${level === 'HS' ? 'High School' : 'Middle School'}`;
  buildFilterUI();
  applyFilters();
  showScreen('home');
}

// ── Dynamic filter UI ─────────────────────────────────────────────────────────
function buildFilterUI() {
  const levelQs = state.allQuestions.filter(q => q.level === state.level);

  const years = [...new Set(levelQs.map(q => q.year))].sort((a, b) => a - b);
  $('year-filters').innerHTML = years.map(y =>
    `<label class="check-label">
      <input type="checkbox" name="year" value="${y}" checked> ${y}
    </label>`
  ).join('');

  const cats = [...new Set(levelQs.map(q => q.category))].sort();
  $('cat-filters').innerHTML = cats.map(cat => {
    const safe = cat.replace(/&/g, '&amp;');
    return `<label class="check-label">
      <input type="checkbox" name="category" value="${safe}" checked>
      <span class="cat-dot" data-cat="${safe}"></span>${safe}
    </label>`;
  }).join('');
}

// ── Filters ───────────────────────────────────────────────────────────────────
function getFilters() {
  return {
    years:      [...document.querySelectorAll('input[name="year"]:checked')].map(el => Number(el.value)),
    categories: [...document.querySelectorAll('input[name="category"]:checked')].map(el => el.value),
    qtype:      document.querySelector('input[name="qtype"]:checked').value,
    qformat:    document.querySelector('input[name="qformat"]:checked').value,
    difficulty: document.querySelector('input[name="difficulty"]:checked').value,
  };
}

function applyFilters() {
  const f = getFilters();
  state.filtered = state.allQuestions.filter(q => {
    if (q.level !== state.level)                                    return false;
    if (f.years.length      && !f.years.includes(q.year))          return false;
    if (f.categories.length && !f.categories.includes(q.category)) return false;
    if (f.qtype !== 'all'      && q.type !== f.qtype)               return false;
    if (f.qformat !== 'all'    && q.format !== f.qformat)           return false;
    if (f.difficulty !== 'all' && q.difficulty !== f.difficulty)    return false;
    return true;
  });

  const n  = state.filtered.length;
  const el = $('match-count');
  el.textContent = `${n.toLocaleString()} question${n !== 1 ? 's' : ''} match your filters`;
  el.className   = 'match-count' + (n === 0 ? ' zero' : '');
  $('start-btn').disabled = (n === 0);

  const inp = $('question-count');
  inp.max = n;
  if (Number(inp.value) > n) inp.value = n;
}

// ── Quiz start ────────────────────────────────────────────────────────────────
function startQuiz() {
  const count = Math.min(
    Math.max(1, parseInt($('question-count').value) || 20),
    state.filtered.length,
  );
  state.quiz    = shuffle(state.filtered).slice(0, count);
  state.index   = 0;
  state.answers = [];

  showScreen('quiz');
  renderQuestion();
}

// ── Question rendering ────────────────────────────────────────────────────────
function renderQuestion() {
  const q      = state.quiz[state.index];
  const total  = state.quiz.length;
  const isLast = state.index === total - 1;

  $('progress-fill').style.width = `${(state.index / total) * 100}%`;

  $('q-counter').textContent = `Question ${state.index + 1} of ${total}`;

  const answered = state.answers.filter(a => !a.skipped).length;
  const correct  = state.answers.filter(a => a.correct).length;
  $('q-score').textContent = answered > 0 ? `Score: ${correct} / ${answered}` : '';

  const badge = $('q-badge');
  badge.textContent = `${q.category} · ${q.type}`;
  badge.dataset.cat = q.category;

  $('q-info').textContent = `${q.year} · ${roundLabel(q.round)} · Q${q.questionNumber} · ${q.difficulty}`;

  $('question-text').textContent = q.question;

  // Reset answer area
  hide('answer-area');
  hide('mark-correct');
  hide('dna-note');
  const display = $('answer-display');
  display.textContent = '';
  display.className   = 'answer-display';

  // Reset short answer input
  $('sa-input').value = '';

  $('next-btn').textContent = isLast ? 'See Results' : 'Next →';

  state.index > 0 ? show('back-btn') : hide('back-btn');
  show('skip-btn');
  hide('next-btn');

  if (q.format === 'Multiple Choice') {
    renderMCOptions(q);
    show('mc-options');
    hide('sa-reveal');
  } else {
    hide('mc-options');
    show('sa-reveal');
    $('sa-input').focus();
  }
}

function renderMCOptions(q) {
  const container = $('mc-options');
  container.innerHTML = '';
  ['W', 'X', 'Y', 'Z'].forEach(letter => {
    if (!q.options?.[letter]) return;
    const btn = document.createElement('button');
    btn.className      = 'mc-option';
    btn.dataset.letter = letter;
    btn.innerHTML      = `<span class="mc-letter">${letter}</span>${q.options[letter]}`;
    btn.addEventListener('click', () => handleMCAnswer(letter));
    container.appendChild(btn);
  });
}

// ── Answer handling ───────────────────────────────────────────────────────────
function handleMCAnswer(selected) {
  const q             = state.quiz[state.index];
  const correctLetter = q.answer[0];
  const correct       = selected === correctLetter;

  document.querySelectorAll('.mc-option').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.letter === correctLetter)             btn.classList.add('correct');
    else if (btn.dataset.letter === selected && !correct) btn.classList.add('wrong');
  });

  const display       = $('answer-display');
  display.textContent = `ANSWER: ${q.answer}`;
  display.className   = `answer-display ${correct ? 'correct' : 'wrong'}`;
  show('answer-area');
  hide('skip-btn');
  hide('back-btn');

  recordAnswer(correct, false);
  show('next-btn');
}

function submitSAAnswer() {
  const typed = $('sa-input').value;
  if (!typed.trim()) return;

  const q       = state.quiz[state.index];
  const correct = fuzzyMatch(typed, q.answer);

  const display       = $('answer-display');
  display.textContent = `ANSWER: ${q.answer}`;
  display.className   = `answer-display ${correct ? 'correct' : 'wrong'}`;

  hide('sa-reveal');
  hide('skip-btn');
  hide('back-btn');
  show('answer-area');

  recordAnswer(correct, false);

  if (!correct) {
    if (matchesDoNotAccept(typed, q.answer)) show('dna-note');
    show('mark-correct');
  }
  show('next-btn');
}

function markCorrect() {
  // Override: the fuzzy match was wrong but the student's answer was acceptable
  state.answers[state.answers.length - 1].correct = true;
  $('answer-display').className = 'answer-display correct';
  hide('mark-correct');

  const answered = state.answers.filter(a => !a.skipped).length;
  const correctN = state.answers.filter(a => a.correct).length;
  $('q-score').textContent = `Score: ${correctN} / ${answered}`;
}

function skipQuestion() {
  recordAnswer(false, true);
  advance();
}

function recordAnswer(correct, skipped) {
  state.answers.push({ question: state.quiz[state.index], correct, skipped });
  if (!skipped) {
    const answered = state.answers.filter(a => !a.skipped).length;
    const correctN = state.answers.filter(a => a.correct).length;
    $('q-score').textContent = `Score: ${correctN} / ${answered}`;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function goBack() {
  if (state.index === 0) return;
  state.answers.pop();
  state.index--;
  renderQuestion();
}

function advance() {
  state.index++;
  if (state.index >= state.quiz.length) {
    endQuiz();
  } else {
    renderQuestion();
  }
}

// ── Results ───────────────────────────────────────────────────────────────────
function endQuiz() {
  showScreen('results');

  const answers  = state.answers;
  const answered = answers.filter(a => !a.skipped);
  const skipped  = answers.filter(a => a.skipped).length;
  const correct  = answered.filter(a => a.correct).length;
  const pct      = answered.length ? Math.round((correct / answered.length) * 100) : 0;

  $('score-fraction').textContent = `${correct} / ${answered.length}`;
  $('score-pct').textContent =
    `${pct}% correct` + (skipped ? ` · ${skipped} skipped` : '');

  renderCategoryBreakdown(answers);
  renderReview(answers);
}

function renderCategoryBreakdown(answers) {
  const stats = {};
  answers.forEach(a => {
    const cat = a.question.category;
    if (!stats[cat]) stats[cat] = { correct: 0, total: 0 };
    if (!a.skipped) {
      stats[cat].total++;
      if (a.correct) stats[cat].correct++;
    }
  });

  $('cat-breakdown').innerHTML = Object.entries(stats)
    .filter(([, s]) => s.total > 0)
    .map(([cat, s]) => {
      const pct   = Math.round((s.correct / s.total) * 100);
      const color = CAT_COLOR[cat] || '#94a3b8';
      return `
        <div class="cat-row">
          <span class="cat-row-name">${cat}</span>
          <div class="cat-bar-bg">
            <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="cat-row-score">${s.correct}/${s.total} (${pct}%)</span>
        </div>`;
    }).join('');
}

function renderReview(answers) {
  $('q-review').innerHTML = answers.map((a, i) => {
    const cls  = a.skipped ? 'skipped' : a.correct ? 'correct' : 'wrong';
    const icon = a.skipped ? '—'       : a.correct ? '✓'       : '✗';
    const q    = a.question;
    const safeQ = q.question.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeA = q.answer.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `
      <div class="review-item ${cls}">
        <details>
          <summary>
            <span class="review-num">Q${i + 1}</span>
            <span class="review-cat">${q.category} · ${q.type}</span>
            <span class="review-status">${icon}</span>
          </summary>
          <div class="review-body">
            <p class="review-q">${safeQ}</p>
            <p class="review-ans">Answer: ${safeA}</p>
            <p class="review-id">${q.id}</p>
          </div>
        </details>
      </div>`;
  }).join('');
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  // Level select
  $('btn-hs').addEventListener('click', () => selectLevel('HS'));
  $('btn-ms').addEventListener('click', () => selectLevel('MS'));
  $('change-level-btn').addEventListener('click', () => showScreen('level'));

  // Filter panel — event delegation covers dynamic year/category checkboxes
  $('filter-panel').addEventListener('change', applyFilters);

  // Home
  $('start-btn').addEventListener('click', startQuiz);

  // Quiz — Short Answer input
  $('sa-submit-btn').addEventListener('click', submitSAAnswer);
  $('sa-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitSAAnswer(); });
  $('mark-correct-btn').addEventListener('click', markCorrect);

  // Quiz — navigation
  $('back-btn').addEventListener('click', goBack);
  $('next-btn').addEventListener('click', advance);
  $('skip-btn').addEventListener('click', skipQuestion);
  $('end-btn').addEventListener('click', () => {
    if (confirm('End the quiz now? Results will be shown for questions answered so far.')) {
      endQuiz();
    }
  });

  // Results
  $('retry-btn').addEventListener('click', () => {
    state.quiz    = shuffle(state.quiz);
    state.index   = 0;
    state.answers = [];
    showScreen('quiz');
    renderQuestion();
  });
  $('new-quiz-btn').addEventListener('click', () => showScreen('home'));
});
