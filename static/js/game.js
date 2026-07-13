import * as S from './solver.js';
import * as UI from './ui.js';
import { getSettings } from './settings.js';

const KEY = 'wosolve.game.v1';
let lists, state;

const fresh = () => ({ mode: 'solver', solverRows: [], solvedKey: '',
  practice: { secret: null, rows: [], done: false } });

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.mode) return s; }
  catch {}
  return fresh();
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

let entry = { letters: '', marks: '' };
let practiceTileInfoShown = false; // one-time-per-session nudge

export function initGame(wordLists, initUI_) {
  lists = wordLists;
  state = load();
  if (state.mode === 'practice' && !state.practice.secret) newPracticeGame();
  document.documentElement.dataset.mode = state.mode;
  document.dispatchEvent(new CustomEvent('wosolve:mode-changed', { detail: { mode: state.mode } }));
  initUI_({ onKey, onCycle, onMark, onUndo, onRemoveRow });
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.onclick = () => switchMode(b.dataset.mode));
  document.querySelectorAll('#mode-toggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  document.addEventListener('wosolve:settings-changed', e => { if (e.detail.key === 'extended') rerender(); });
  const board = document.getElementById('board');
  if (board) board.addEventListener('click', e => {
    if (state.mode !== 'practice' || practiceTileInfoShown) return;
    if (!e.target.closest('.committed .tile')) return;
    practiceTileInfoShown = true;
    UI.showBanner('Colors are automatic in practice mode', 'info');
  });
  rerender();
}

function pool() {
  return getSettings().extended ? lists.answers.concat(lists.extended) : lists.answers;
}
function rows() { return state.mode === 'solver' ? state.solverRows : state.practice.rows; }

function switchMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  entry = { letters: '', marks: '' };
  if (mode === 'practice' && (!state.practice.secret || state.practice.done)) newPracticeGame();
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === mode));
  document.documentElement.dataset.mode = mode;
  document.dispatchEvent(new CustomEvent('wosolve:mode-changed', { detail: { mode } }));
  UI.clearBanner();
  maybeShowPracticeIntro();
  save(); rerender();
}

// Onboarding nudge for practice mode: only for a genuinely fresh game (no
// guesses submitted yet), never when merely resuming one already in progress.
function maybeShowPracticeIntro() {
  if (state.mode === 'practice' && state.practice.rows.length === 0)
    UI.showBanner("I picked a secret word — guess it in 6 tries!", 'info');
}

function newPracticeGame() {
  state.practice = {
    secret: lists.answers[Math.floor(Math.random() * lists.answers.length)],
    rows: [], done: false };
}

function onKey(k) {
  if (state.mode === 'practice' && state.practice.done) return;
  if (state.mode === 'practice') UI.clearBanner();
  if (k === '\b') {
    entry.letters = entry.letters.slice(0, -1);
    entry.marks = entry.marks.slice(0, -1);
  } else if (k === '\n') return submit();
  else if (/^[a-z]$/.test(k) && entry.letters.length < 5) {
    entry.letters += k;
    entry.marks += state.mode === 'solver' ? '-' : ' ';
  }
  rerender();
}

const CYCLE = { '-': '*', '*': '+', '+': '-' };
const CYCLE_BACK = { '-': '+', '+': '*', '*': '-' };
function onCycle(i, back = false) {
  if (state.mode !== 'solver' || !entry.marks[i]) return;
  const map = back ? CYCLE_BACK : CYCLE;
  entry.marks = entry.marks.slice(0, i) + map[entry.marks[i]] + entry.marks.slice(i + 1);
  rerender();
}
function onMark(i, mark) {
  if (state.mode !== 'solver' || !entry.letters[i]) return;
  entry.marks = entry.marks.slice(0, i) + mark + entry.marks.slice(i + 1);
  rerender();
}

function submit() {
  if (entry.letters.length !== 5) return;
  if (state.mode === 'solver') {
    state.solverRows.push({ word: entry.letters, marks: entry.marks });
    if (entry.marks === '+++++') trySolve(state.solverRows.length);
  } else {
    if (!pool().includes(entry.letters)) {
      UI.showBanner('Not in the word list', 'warn');
      rerender({ shake: true });
      return;
    }
    const marks = S.feedback(state.practice.secret, entry.letters);
    state.practice.rows.push({ word: entry.letters, marks });
    if (state.practice.rows.length === 1) UI.clearBanner();
    if (marks === '+++++') {
      state.practice.done = true;
      solved(state.practice.rows.length);
      UI.showBanner(`You got it in ${state.practice.rows.length}!`, 'win', 'Play again', replay);
    } else if (state.practice.rows.length >= 6) {
      state.practice.done = true;
      document.dispatchEvent(new CustomEvent('wosolve:lost'));
      UI.showBanner(`The word was ${state.practice.secret.toUpperCase()}`, 'lose', 'Play again', replay);
    }
  }
  entry = { letters: '', marks: '' };
  save(); rerender({ animateLast: true });
}

function solved(guesses) {
  document.dispatchEvent(new CustomEvent('wosolve:solved',
    { detail: { mode: state.mode, guesses } }));
}

function replay() {
  newPracticeGame(); UI.clearBanner(); maybeShowPracticeIntro(); save(); rerender();
}

function onUndo() {
  if (state.mode !== 'solver' || !state.solverRows.length) return;
  state.solverRows.pop(); UI.clearBanner(); state.solvedKey = ''; save(); rerender();
}

function onRemoveRow(i) {
  if (state.mode !== 'solver') return;
  if (i < 0 || i >= state.solverRows.length) return;
  state.solverRows.splice(i, 1);
  state.solvedKey = '';
  UI.clearBanner();
  save(); rerender();
}

function rerender(opts = {}) {
  const r = rows();
  const showEntry = state.mode === 'solver' || (!state.practice.done && r.length < 6);
  UI.renderRows(r, showEntry ? entry : null, { ...opts, removable: state.mode === 'solver' });
  UI.renderKeyboard(r); // both modes: derived from committed rows
  if (state.mode === 'solver') {
    const cands = S.filterWords(pool(), S.stateFromRows(r));
    const ranked = S.rankSuggestions(cands, new Set(lists.answers));
    const topScore = ranked.length ? scoreOf(ranked[0], cands) : 1;
    const top = ranked.slice(0, 30);
    UI.renderSuggestions({ top, count: cands.length,
      scores: top.map(w => Math.max(6, Math.round(scoreOf(w, cands) / topScore * 100))) });
    if (cands.length === 1 && r.length && !r.some(x => x.marks === '+++++'))
      solvedOnce(cands[0]);
  } else {
    UI.renderSuggestions({ top: [hintFor()], count: -1, scores: [100] });
  }
}

function solvedOnce(word) {
  if (trySolve(state.solverRows.length)) UI.showBanner(`It's ${word.toUpperCase()}!`, 'win');
}

// Guards both the process-of-elimination path (solvedOnce, narrowed to 1 candidate
// with no all-green row yet) and the direct all-green submit path against firing
// wosolve:solved twice for the same puzzle: the key is the joined word list of
// state.solverRows (including whatever row was just pushed), and firing is skipped
// whenever that key is an extension of (or equal to) the previously recorded key —
// i.e. the puzzle was already marked solved earlier in this same row sequence.
function trySolve(guesses) {
  const k = state.solverRows.map(r => r.word).join(',');
  const prev = state.solvedKey || '';
  if (prev && (k === prev || k.startsWith(prev + ','))) return false;
  state.solvedKey = k;
  save();
  solved(guesses);
  return true;
}

function scoreOf(w, cands) {
  const freq = {};
  for (const c of cands) for (const l of new Set(c)) freq[l] = (freq[l] || 0) + 1;
  let s = 0; for (const l of new Set(w)) s += freq[l] || 0;
  return s || 1;
}

function hintFor() {
  const cands = S.filterWords(lists.answers, S.stateFromRows(state.practice.rows));
  return S.rankSuggestions(cands, new Set(lists.answers))[0] ?? '';
}
