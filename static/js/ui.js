import { keyboardHints } from './solver.js';

const $ = s => document.querySelector(s);
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '\nzxcvbnm\b'];
let cb = {}, focusedTile = -1, lastEntryLen = 0;

export function initUI(callbacks) {
  cb = callbacks;
  buildKeyboard();
  buildLogo();
  window.addEventListener('keydown', onPhysicalKey);
  $('#help-btn').onclick = () => $('#help-modal').showModal();
  document.querySelectorAll('.close-modal').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d =>
    d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  document.addEventListener('click', e => {
    const rem = e.target.closest('.js-remove-row');
    if (rem) { cb.onRemoveRow(Number(rem.dataset.row)); return; }
    const undo = e.target.closest('.js-undo');
    if (undo) { cb.onUndo(); return; }
    const tog = e.target.closest('.js-toggle-list');
    if (tog) {
      const panel = tog.parentElement;
      const l = panel.querySelector('.word-list');
      const cap = panel.querySelector('.list-caption');
      if (l) l.hidden = !l.hidden;
      if (cap) cap.hidden = !cap.hidden;
      return;
    }
    const blur = e.target.closest('.js-unblur');
    if (blur) { blur.classList.remove('blurred'); cb.onHintReveal?.(); }
  });
}

function onPhysicalKey(e) {
  if (e.target.matches?.('input, select, textarea')) return;
  if (e.key === 'Escape') {
    const open = document.querySelector('dialog[open]');
    if (open) { e.preventDefault(); open.close(); return; }
  }
  if (e.target.closest('dialog')) return;
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) { e.preventDefault(); cb.onKey(k); flashKey(k); }
  else if (k === 'backspace') { e.preventDefault(); cb.onKey('\b'); flashKey('\b'); }
  else if (k === 'enter') { e.preventDefault(); cb.onKey('\n'); flashKey('\n'); }
  else if ('123'.includes(k) && focusedTile >= 0) { e.preventDefault(); cb.onMark(focusedTile, '+*-'['123'.indexOf(k)]); }
  else if (k === 'arrowleft') {
    if (focusedTile > 0) setFocus(focusedTile - 1);
    else if (focusedTile === -1 && lastEntryLen > 0) setFocus(lastEntryLen - 1);
  }
  else if (k === 'arrowright') {
    if (focusedTile >= 0 && focusedTile < 4) setFocus(focusedTile + 1);
    else if (focusedTile === -1 && lastEntryLen > 0) setFocus(0);
  }
  else if (k === 'arrowup' && focusedTile >= 0) { e.preventDefault(); cb.onCycle(focusedTile); }
  else if (k === 'arrowdown' && focusedTile >= 0) { e.preventDefault(); cb.onCycle(focusedTile, true); }
}

function buildKeyboard() {
  const kb = $('#keyboard');
  kb.innerHTML = '';
  for (const rowSpec of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'krow';
    for (const ch of rowSpec) {
      const b = document.createElement('button');
      b.className = 'key';
      b.dataset.key = ch;
      b.textContent = ch === '\n' ? '↵' : ch === '\b' ? '⌫' : ch.toUpperCase();
      if (ch === '\n' || ch === '\b') b.classList.add('wide');
      b.onclick = () => { cb.onKey(ch); flashKey(ch); b.blur(); };
      row.appendChild(b);
    }
    kb.appendChild(row);
  }
}

// Pops the on-screen key that matches a just-entered character (works for
// letters as well as the '\n'/'\b' control keys) — called from both the
// button click handler and the physical-keydown path so either input method
// gives the same visible feedback.
function flashKey(ch) {
  const b = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.key === ch);
  if (!b) return;
  b.classList.remove('pressed');
  void b.offsetWidth; // restart animation
  b.classList.add('pressed');
}

export function renderKeyboard(rows) {
  const hints = keyboardHints(rows);
  document.querySelectorAll('.key').forEach(b => {
    const k = b.dataset.key;
    b.classList.remove('green', 'yellow', 'excluded');
    if (hints[k]) b.classList.add(hints[k] === 'excluded' ? 'excluded' : hints[k]);
  });
}

const MARK_CLASS = { '+': 'g', '*': 'y', '-': 'n' };

export function renderRows(rows, entry, opts = {}) {
  const board = $('#board');
  board.innerHTML = '';
  rows.forEach((r, i) => board.appendChild(rowEl(r.word, r.marks,
    opts.animateLast && r === rows[rows.length - 1], false, opts.removable ? i : null)));
  if (entry) {
    const len = entry.letters.length;
    if (len !== lastEntryLen) {
      focusedTile = len > 0 ? len - 1 : -1;
      lastEntryLen = len;
    } else if (focusedTile >= len) {
      focusedTile = len > 0 ? len - 1 : -1;
    }
    const row = rowEl(entry.letters.padEnd(5, ' '), entry.marks.padEnd(5, ' '), false, true);
    board.appendChild(row);
    if (opts.shake) { row.classList.add('shake'); setTimeout(() => row.classList.remove('shake'), 450); }
    if (focusedTile >= 0) {
      row.querySelectorAll('.tile').forEach(t =>
        t.classList.toggle('focused', Number(t.dataset.idx) === focusedTile));
    }
  } else {
    focusedTile = -1;
    lastEntryLen = 0;
  }
  if (opts.fixedRows) {
    while (board.children.length > opts.fixedRows) board.removeChild(board.lastElementChild);
    while (board.children.length < opts.fixedRows) board.appendChild(rowEl(' '.repeat(5), ' '.repeat(5), false));
  }
}

function rowEl(word, marks, committed, isEntry = false, removeIdx = null) {
  const row = document.createElement('div');
  row.className = 'brow' + (committed ? ' committed' : '');
  for (let i = 0; i < 5; i++) {
    const t = document.createElement('div');
    const letter = word[i] !== ' ' ? word[i] : '';
    const mark = marks[i] !== ' ' ? marks[i] : '';
    t.className = 'tile ' + (letter ? (mark ? MARK_CLASS[mark] : 'pending') : 'empty');
    t.textContent = letter;
    if (isEntry && letter && mark) {
      t.classList.add('cyclable');
      t.onclick = () => { setFocus(i); cb.onCycle(i); };
    }
    t.dataset.idx = i;
    row.appendChild(t);
  }
  if (removeIdx !== null) {
    row.insertAdjacentHTML('beforeend',
      `<button class="row-remove js-remove-row" data-row="${removeIdx}" title="Remove this guess" aria-label="Remove guess ${word.toUpperCase()}">×</button>`);
  }
  return row;
}

function setFocus(i) {
  focusedTile = i;
  document.querySelectorAll('.brow:last-child .tile').forEach(t =>
    t.classList.toggle('focused', Number(t.dataset.idx) === i));
}

export function renderSuggestions({ top, count, scores, revealed }) {
  const html = count === 0
    ? `<div class="panel"><h5>Solver</h5>
         <p style="margin:6px 0">No words match — check your colors.</p>
         <button class="count-chip js-undo">Undo last guess</button></div>`
    : count === -1
    ? `<div class="panel">
         <h5>Hint</h5>
         <div class="hero-word${revealed ? '' : ' blurred'} js-unblur">${top[0] ?? ''}</div>
       </div>`
    : `<div class="panel">
         <h5>Best next guess</h5>
         <div class="hero-word">${top[0] ?? ''}</div>
         <div class="hero-sub">likely + familiar words first</div>
         <button class="count-chip js-toggle-list">${count} word${count === 1 ? '' : 's'} left · see all</button>
         <div class="list-caption" hidden>Fuller bar = guess that narrows the list more</div>
         <div class="word-list" hidden>
           ${top.map((w, i) => `<div class="srow" title="How much this guess narrows the remaining words"><span class="srow-fill" style="width:${scores[i]}%"></span><span class="srow-text">${w}</span></div>`).join('')}
         </div>
       </div>`;
  const sideTarget = $('#side-suggest');
  if (sideTarget) sideTarget.innerHTML = html;
  const evt = new CustomEvent('wosolve:suggestions', { detail: { html } });
  document.dispatchEvent(evt);
}

// Past-answers panel (solver-mode left panel): newest first, capped at the
// most recent 400 rows to keep DOM weight down (full history is ~1850 rows;
// the list is a browsing aid, not an archive).
const PAST_LIST_CAP = 400;
export function renderPastAnswers(byDate) {
  const list = $('#past-list');
  if (!list || !byDate) return;
  const dates = Object.keys(byDate).sort().reverse().slice(0, PAST_LIST_CAP);
  list.innerHTML = dates.map(d =>
    `<div class="past-row"><span class="past-date">${d}</span><span class="past-word">${byDate[d].toUpperCase()}</span></div>`
  ).join('');
}

// Recently-played list (practice-mode left panel), newest first.
export function renderRecentlyPlayed(entries) {
  const list = $('#recent-list');
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<p class="muted-note">No dated games played yet.</p>';
    return;
  }
  list.innerHTML = entries.map(e =>
    `<div class="past-row recent-row ${e.won ? 'won' : 'lost'}"><span class="past-date">${e.date}</span><span class="recent-mark">${e.won ? '✓' : '✕'}</span></div>`
  ).join('');
}

export function showBanner(text, kind, actions = []) {
  const b = $('#banner');
  b.hidden = false; b.className = kind;
  b.classList.remove('banner-pop');
  void b.offsetWidth; // restart animation
  b.classList.add('banner-pop');
  b.innerHTML = '<span class="banner-bar" aria-hidden="true"></span>' +
    `<span class="banner-text">${text}</span>` +
    actions.map(() => `<button class="banner-act count-chip"></button>`).join('');
  b.querySelectorAll('.banner-act').forEach((btn, i) => {
    btn.textContent = actions[i].label;
    btn.onclick = actions[i].onAction;
  });
}
export function clearBanner() { const b = $('#banner'); b.hidden = true; b.innerHTML = ''; }

export function animateBoardReset() {
  const board = $('#board');
  board.classList.remove('dealing');
  void board.offsetWidth; // restart animation
  board.classList.add('dealing');
  const rowEls = board.querySelectorAll('.brow');
  const cleanup = () => board.classList.remove('dealing');
  const last = rowEls[rowEls.length - 1];
  if (last) last.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 1000);
}

const LOGO = [['w', 'g'], ['o', 'n'], ['s', 'y'], ['o', 'g'], ['l', 'n'], ['v', 'y'], ['e', 'g']];
function buildLogo() {
  const el = $('#logo');
  el.innerHTML = LOGO.map(([l, c]) => `<span class="lt ${c}">${l.toUpperCase()}</span>`).join('');
}
export function animateLogo() {
  const el = $('#logo');
  el.classList.remove('animate');
  void el.offsetWidth; // restart animation
  el.classList.add('animate');
  el.querySelectorAll('.lt').forEach((t, i) => t.style.animationDelay = `${i * 90}ms`);
}

// Lightweight toast system: fixed top-center stack, independent of the
// single-slot #banner. Used for low-stakes/ambient notices; win/lose/warn
// messages keep using showBanner. Entrance/exit are transform+opacity only,
// so the global prefers-reduced-motion rule (--dur-fast: 0ms) collapses them
// to instant with no extra branching needed here.
let toastContainer = null;
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}
export function showToast(text) {
  const container = getToastContainer();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('exit');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
