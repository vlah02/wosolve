import { stateFromRows, filterWords, rankSuggestions } from './solver.js';

const MARK_CLASS = { '+': 'g', '*': 'y', '-': 'n' };

function headlineFor(guesses, won) {
  if (!won) return "This was a tough one. Here's how it unfolded.";
  if (guesses <= 2) return 'Phenomenal!';
  if (guesses === 3) return 'Excellent solve!';
  if (guesses === 4) return 'Solid work!';
  return 'Got there — nice persistence!'; // 5-6
}

// Pure replay of a finished game: for each guess, the candidate pool sizes
// before/after that guess and what the solver would have suggested at that
// point. No DOM access here — analysis.js keeps logic and rendering
// separate so the harness can exercise analyzeGame without a document.
export function analyzeGame({ rows, pool, answerSet, freq, won = true }) {
  const perGuess = rows.map((row, i) => {
    const before = filterWords(pool, stateFromRows(rows.slice(0, i)));
    const after = filterWords(pool, stateFromRows(rows.slice(0, i + 1)));
    const solverPick = rankSuggestions(before, answerSet, freq)[0] ?? null;
    const cutPct = before.length > 0
      ? Math.round((before.length - after.length) / before.length * 100)
      : 0;
    return { word: row.word, marks: row.marks, before: before.length,
      after: after.length, solverPick, cutPct };
  });
  const guesses = rows.length;
  return { perGuess, summary: { guesses, won, headline: headlineFor(guesses, won) } };
}

function miniRowHtml(word, marks) {
  let tiles = '';
  for (let i = 0; i < 5; i++) {
    const letter = word[i] ?? '';
    tiles += `<div class="tile ${MARK_CLASS[marks[i]] || 'empty'}">${letter}</div>`;
  }
  return `<div class="brow mini">${tiles}</div>`;
}

function guessHtml(g) {
  const line = `${g.before.toLocaleString()} → ${g.after.toLocaleString()} words · ${g.cutPct}% cut`;
  const pick = !g.solverPick || g.solverPick === g.word
    ? (g.solverPick ? '<span class="count-chip analysis-match">matched the solver ✓</span>' : '')
    : `<div class="analysis-pick">solver's pick was ${g.solverPick.toUpperCase()}</div>`;
  return `<div class="analysis-guess">${miniRowHtml(g.word, g.marks)}
    <div class="analysis-line">${line}</div>${pick}</div>`;
}

// Renders into the static #analysis-modal shell (templates/index.html) and
// opens it. The dialog element itself must stay static so ui.js's
// initUI-time querySelectorAll('dialog') wires backdrop-click/Esc close;
// only the inner #analysis-content is replaced here.
export function showAnalysis(analysis) {
  const modal = document.getElementById('analysis-modal');
  const content = document.getElementById('analysis-content');
  if (!modal || !content) return;
  const { perGuess, summary } = analysis;
  if (!perGuess || !perGuess.length) {
    // Keeps the dialog's aria-labelledby (see templates/index.html) resolving
    // to real text even in this no-data edge case, so the modal still has an
    // accessible name.
    content.innerHTML = '<h3 id="analysis-modal-title" class="sr-only">Analysis</h3>';
    modal.showModal();
    return;
  }
  const subtext = summary.won ? `solved in ${summary.guesses}` : `${summary.guesses} guesses used`;
  content.innerHTML = `
    <div class="analysis-summary">
      <h3 id="analysis-modal-title">${summary.headline}</h3>
      <p class="analysis-sub">${subtext}</p>
    </div>
    <div class="analysis-list">${perGuess.map(guessHtml).join('')}</div>`;
  modal.showModal();
}
