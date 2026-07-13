import { keyboardHints } from './solver.js';

const $ = s => document.querySelector(s);
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '\nzxcvbnm\b'];
let cb = {}, focusedTile = -1;

export function initUI(callbacks) {
  cb = callbacks;
  buildKeyboard();
  buildLogo();
  window.addEventListener('keydown', onPhysicalKey);
  $('#help-btn').onclick = () => $('#help-modal').showModal();
  document.querySelectorAll('.close-modal').forEach(b => b.onclick = () => b.closest('dialog').close());
}

function onPhysicalKey(e) {
  if (e.target.closest('dialog')) return;
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) { e.preventDefault(); cb.onKey(k); }
  else if (k === 'backspace') { e.preventDefault(); cb.onKey('\b'); }
  else if (k === 'enter') { e.preventDefault(); cb.onKey('\n'); }
  else if ('123'.includes(k) && focusedTile >= 0) { e.preventDefault(); cb.onMark(focusedTile, '+*-'[Number(k) - 1] === '+' ? '+' : '+*-'['123'.indexOf(k)]); }
  else if (k === 'arrowleft' && focusedTile > 0) setFocus(focusedTile - 1);
  else if (k === 'arrowright' && focusedTile >= 0 && focusedTile < 4) setFocus(focusedTile + 1);
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
      if (ch === '\n' || ch === '\b') b.style.minWidth = '52px';
      b.onclick = () => cb.onKey(ch);
      row.appendChild(b);
    }
    kb.appendChild(row);
  }
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
  focusedTile = -1;
  for (const r of rows) board.appendChild(rowEl(r.word, r.marks, opts.animateLast && r === rows[rows.length - 1]));
  if (entry) {
    const row = rowEl(entry.letters.padEnd(5, ' '), entry.marks.padEnd(5, ' '), false, true);
    board.appendChild(row);
    if (opts.shake) { row.classList.add('shake'); setTimeout(() => row.classList.remove('shake'), 450); }
  }
}

function rowEl(word, marks, committed, isEntry = false) {
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
  return row;
}

function setFocus(i) {
  focusedTile = i;
  document.querySelectorAll('.brow:last-child .tile').forEach(t =>
    t.classList.toggle('focused', Number(t.dataset.idx) === i));
}

export function renderSuggestions({ top, count, scores }) {
  const html = count === 0
    ? `<div class="panel"><h5>Solver</h5>
         <p style="margin:6px 0">No words match — check your colors.</p>
         <button class="count-chip" id="undo-btn">Undo last guess</button></div>`
    : `<div class="panel">
         <h5>Best next guess</h5>
         <div class="hero-word">${top[0] ?? ''}</div>
         <button class="count-chip" id="toggle-list">${count} word${count === 1 ? '' : 's'} left · see all</button>
         <div class="word-list" hidden>
           ${top.map((w, i) => `<div class="srow">${w}<span class="bar"><i style="width:${scores[i]}%"></i></span></div>`).join('')}
         </div>
       </div>`;
  $('#suggest-content').innerHTML = html;
  const sideTarget = $('#side-suggest'), drawerBody = $('#drawer-body');
  if (sideTarget) sideTarget.innerHTML = html;
  const toggle = $('#suggest-content #toggle-list') || $('#side-suggest #toggle-list');
  document.querySelectorAll('#toggle-list, #undo-btn').forEach(b => {
    if (b.id === 'undo-btn') b.onclick = () => cb.onUndo();
    else b.onclick = () => { const l = b.parentElement.querySelector('.word-list'); l.hidden = !l.hidden; };
  });
  const evt = new CustomEvent('wosolve:suggestions', { detail: { html } });
  document.dispatchEvent(evt); // drawer listens (Task 8)
}

export function showBanner(text, kind, actionLabel, onAction) {
  const b = $('#banner');
  b.hidden = false; b.className = kind;
  b.innerHTML = text + (actionLabel ? ` <button id="banner-act">${actionLabel}</button>` : '');
  if (actionLabel) $('#banner-act').onclick = onAction;
}
export function clearBanner() { const b = $('#banner'); b.hidden = true; b.innerHTML = ''; }

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
