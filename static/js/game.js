import * as S from './solver.js';
import * as UI from './ui.js';
import * as Calendar from './calendar.js';
import { getSettings } from './settings.js';
import { analyzeGame, showAnalysis } from './analysis.js';

const CALENDAR_MIN = '2021-06-19';

const KEY = 'wosolve.game.v1';
const RECENT_KEY = 'wosolve.recent.v1';
const RECENT_CAP = 10;
let lists, state;
let byDate = {}, pastMeta = null;
let recentPlayed = [];

const fresh = () => ({ mode: 'solver', solverRows: [], solvedKey: '',
  practice: { secret: null, rows: [], done: false, dateLabel: null } });

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.mode) return s; }
  catch {}
  return fresh();
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

function loadRecent() {
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY)); if (Array.isArray(r)) return r; }
  catch {}
  return [];
}
const saveRecent = () => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentPlayed)); } catch {} };

// Appends a finished dated game to the "recently played" list (newest first,
// capped). Called only for DATED practice games (random games aren't tracked
// here — there's no calendar identity to show).
function recordRecent(date, won) {
  recentPlayed = [{ date, won }, ...recentPlayed].slice(0, RECENT_CAP);
  saveRecent();
  UI.renderRecentlyPlayed(recentPlayed);
  Calendar.refreshCalendar({ playedDates: playedMap() });
}

// { 'YYYY-MM-DD': 'won'|'lost' } for the calendar's per-day dots. recentPlayed
// is newest-first, so the first occurrence of a date is its latest result.
function playedMap() {
  const map = {};
  for (const r of recentPlayed) if (!(r.date in map)) map[r.date] = r.won ? 'won' : 'lost';
  return map;
}

let entry = { letters: '', marks: '' };
let practiceTileInfoShown = false; // one-time-per-session nudge

export function initGame(wordLists, initUI_) {
  lists = wordLists;
  if (wordLists.pastAnswers) {
    byDate = wordLists.pastAnswers.byDate;
    pastMeta = wordLists.pastAnswers.meta;
  }
  recentPlayed = loadRecent();
  state = load();
  if (state.mode === 'practice') {
    // Every page load starts a brand-new random practice game — even mid-game
    // (dated games included; refreshing abandons whatever was in progress).
    // The persisted practice board is only ever read back when switching
    // modes within the same session (see switchMode/replay below).
    newPracticeGame();
    UI.showToast('New word picked — guess it in 6!');
  }
  document.documentElement.dataset.mode = state.mode;
  document.dispatchEvent(new CustomEvent('wosolve:mode-changed', { detail: { mode: state.mode } }));
  initUI_({ onKey, onCycle, onMark, onUndo, onRemoveRow });
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.onclick = () => switchMode(b.dataset.mode));
  document.querySelectorAll('#mode-toggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  document.addEventListener('wosolve:settings-changed', e => {
    if (e.detail.key === 'extended') rerender();
  });
  initPracticeControls();
  UI.renderPastAnswers(byDate);
  UI.renderRecentlyPlayed(recentPlayed);
  const board = document.getElementById('board');
  if (board) board.addEventListener('click', e => {
    if (state.mode !== 'practice' || practiceTileInfoShown) return;
    if (!e.target.closest('.committed .tile')) return;
    practiceTileInfoShown = true;
    UI.showBanner('Colors are automatic in practice mode', 'info');
  });
  save(); rerender();
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
  if (mode === 'practice') Calendar.refreshCalendar({ selected: state.practice.dateLabel });
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
    UI.showToast("I picked a secret word — guess it in 6 tries!");
}

function newPracticeGame() {
  state.practice = {
    secret: lists.answers[Math.floor(Math.random() * lists.answers.length)],
    rows: [], done: false, dateLabel: null };
}

function initPracticeControls() {
  const container = document.getElementById('play-day-calendar');
  if (!container) return;
  if (!pastMeta) {
    container.innerHTML = '<p class="muted-note">Dated puzzles unavailable.</p>';
    return;
  }
  Calendar.initCalendar({
    min: CALENDAR_MIN, max: pastMeta.through,
    selected: state.practice.dateLabel, playedDates: playedMap(),
    onPick: onPlayDate,
  });
}

function onPlayDate(dateStr) {
  const word = byDate[dateStr];
  if (!word) {
    UI.showBanner('No answer on record for that date', 'warn');
    return;
  }
  state.practice = { secret: word, rows: [], done: false, dateLabel: dateStr };
  entry = { letters: '', marks: '' };
  UI.showBanner(`Wordle from ${dateStr} — guess it in 6!`, 'info');
  save(); rerender();
  UI.animateBoardReset();
  Calendar.refreshCalendar({ selected: dateStr });
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
    const word = entry.letters;
    state.solverRows.push({ word, marks: entry.marks });
    if (entry.marks === '+++++' && trySolve(state.solverRows.length))
      UI.showBanner(`It's ${word.toUpperCase()}!`, 'win', [{ label: 'See analysis', onAction: seeAnalysis }]);
  } else {
    if (entry.letters !== state.practice.secret && !pool().includes(entry.letters)) {
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
      if (state.practice.dateLabel) recordRecent(state.practice.dateLabel, true);
      UI.showBanner(`You got it in ${state.practice.rows.length}!`, 'win',
        [{ label: 'Play again', onAction: replay }, { label: 'See analysis', onAction: seeAnalysis }]);
    } else if (state.practice.rows.length >= 6) {
      state.practice.done = true;
      document.dispatchEvent(new CustomEvent('wosolve:lost'));
      if (state.practice.dateLabel) recordRecent(state.practice.dateLabel, false);
      UI.showBanner(`The word was ${state.practice.secret.toUpperCase()}`, 'lose',
        [{ label: 'Play again', onAction: replay }, { label: 'See analysis', onAction: seeAnalysis }]);
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
  Calendar.refreshCalendar({ selected: state.practice.dateLabel });
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
  UI.renderRows(r, showEntry ? entry : null,
    { ...opts, removable: state.mode === 'solver', fixedRows: state.mode === 'practice' ? 6 : null });
  UI.renderKeyboard(r); // both modes: derived from committed rows
  if (state.mode === 'solver') {
    const cands = S.filterWords(pool(), S.stateFromRows(r));
    const ranked = S.rankSuggestions(cands, new Set(lists.answers), lists.freq);
    const topScore = ranked.length ? scoreOf(ranked[0], cands) : 1;
    const top = ranked.slice(0, 30);
    UI.renderSuggestions({ top, count: cands.length,
      scores: top.map(w => Math.max(6, Math.round(scoreOf(w, cands) / topScore * 100))) });
    if (cands.length === 1 && r.length && !r.some(x => x.marks === '+++++'))
      solvedOnce(cands[0]);
  } else {
    if (state.practice.done) {
      const sideTarget = document.getElementById('side-suggest');
      if (sideTarget) sideTarget.hidden = true;
    } else {
      UI.renderSuggestions({ top: [hintFor()], count: -1, scores: [100] });
    }
  }
}

function solvedOnce(word) {
  if (trySolve(state.solverRows.length))
    UI.showBanner(`It's ${word.toUpperCase()}!`, 'win', [{ label: 'See analysis', onAction: seeAnalysis }]);
}

// Analysis pool matches the solver's own filtering pool.
function seeAnalysis() {
  const r = rows();
  if (!r.length) return;
  const won = state.mode === 'practice' ? r[r.length - 1].marks === '+++++' : true;
  const p = pool();
  showAnalysis(analyzeGame({
    rows: r, pool: p, answerSet: new Set(lists.answers), freq: lists.freq, won,
  }));
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
  const cands = S.filterWords(pool(), S.stateFromRows(state.practice.rows));
  const ranked = S.rankSuggestions(cands, new Set(lists.answers), lists.freq);
  const secret = state.practice.secret;
  const greenShare = ranked.find(w => w.split('').some((c, i) => c === secret[i]));
  return greenShare ?? ranked[0] ?? '';
}
