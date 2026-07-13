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

export function initGame(wordLists, initUI_) {
  lists = wordLists;
  state = load();
  if (state.mode === 'practice' && !state.practice.secret) newPracticeGame();
  initUI_({ onKey, onCycle, onMark, onUndo });
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.onclick = () => switchMode(b.dataset.mode));
  document.addEventListener('wosolve:settings-changed', e => { if (e.detail.key === 'extended') rerender(); });
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
  UI.clearBanner();
  save(); rerender();
}

function newPracticeGame() {
  state.practice = {
    secret: lists.answers[Math.floor(Math.random() * lists.answers.length)],
    rows: [], done: false };
}

function onKey(k) {
  if (state.mode === 'practice' && state.practice.done) return;
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
function onCycle(i) {
  if (state.mode !== 'solver' || !entry.marks[i]) return;
  entry.marks = entry.marks.slice(0, i) + CYCLE[entry.marks[i]] + entry.marks.slice(i + 1);
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
    if (entry.marks === '+++++') solved(state.solverRows.length);
  } else {
    if (!pool().includes(entry.letters)) {
      rerender({ shake: true });
      return;
    }
    const marks = S.feedback(state.practice.secret, entry.letters);
    state.practice.rows.push({ word: entry.letters, marks });
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
  newPracticeGame(); UI.clearBanner(); save(); rerender();
}

function onUndo() {
  if (state.mode !== 'solver' || !state.solverRows.length) return;
  state.solverRows.pop(); UI.clearBanner(); state.solvedKey = ''; save(); rerender();
}

function rerender(opts = {}) {
  const r = rows();
  const showEntry = state.mode === 'solver' || (!state.practice.done && r.length < 6);
  UI.renderRows(r, showEntry ? entry : null, opts);
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
  const k = state.solverRows.map(r => r.word).join(',');
  if (k === (state.solvedKey || '')) return;
  state.solvedKey = k;
  save();
  UI.showBanner(`It's ${word.toUpperCase()}!`, 'win');
  solved(state.solverRows.length);
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
