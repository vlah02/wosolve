// Animated "how to play" demo shown at the top of the help modal.
//
// Two fully scripted, ~10s looping sequences — one for solver mode, one for
// practice mode — chosen by the CURRENT `document.documentElement.dataset.mode`
// every time the help modal is opened (not just once at page load, so
// switching modes and reopening the modal always shows the right flow).
//
// 60fps discipline: every animation here only ever touches `transform` and
// `opacity` (no width/height/left/top/margin animation) — the pointer glides
// via `transform: translate(...)`, not left/top, and the fake result-count
// ticks down by writing `textContent` from a rAF loop rather than animating
// any CSS property. Durations/easing come from the --dur-*/--ease-pop tokens
// so pacing follows the active skin (and collapses under reduced motion,
// see tokens.css). Each loop iteration rebuilds its ~10 tiny DOM nodes from
// scratch (cheap) rather than mutating a long-lived tree.
//
// Lifecycle: `start()` runs on every help-button click (i.e. every modal
// open), re-reads the mode, and (re)builds+schedules a run. `stop()` runs on
// dialog close and cancels every timer/rAF. A generation counter guards
// against stale callbacks firing after a stop/restart, and repeated
// open/close never stacks more than one active loop because `start()` always
// stops the previous run (and bumps the generation) before scheduling a new
// one.

const SOLVER_WORD = 'CRANE';
const HERO_WORD = 'SLATE';
const COUNT_FROM = 2315;
const COUNT_TO = 87;

const PRACTICE_WORD_1 = 'TRACE';
const PRACTICE_MARKS_1 = ['n', 'y', 'g', 'n', 'g'];
const PRACTICE_WORD_2 = 'REACT';
const PRACTICE_MARKS_2 = ['g', 'g', 'g', 'g', 'g'];

const SOLVER_CAPTIONS = [
  'Type your Wordle guess',
  'Tap tiles to match Wordle’s colors',
  'Press Enter to submit',
  'The solver narrows the list and suggests the best next word',
];
const PRACTICE_CAPTIONS = [
  'We picked a secret word',
  'Type a guess — colors fill in automatically',
  'Green = right spot, yellow = wrong spot',
  'Crack it within six tries!',
];

const FADE_MS = 520; // upper bound covering every skin's --dur-tile

let live = null;         // .help-demo-live wrapper (persists across loops)
let staticCaptions = null; // .help-demo-static-captions <ol> (reduced motion)
let gen = 0;              // bumped on every start()/stop(); invalidates stale timers
let timers = [];
let rafId = null;

function clearAll() {
  timers.forEach(clearTimeout);
  timers = [];
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}
function schedule(myGen, delay, fn) {
  timers.push(setTimeout(() => { if (myGen === gen) fn(); }, delay));
}
function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeTile(letter, cls) {
  const t = document.createElement('div');
  t.className = 'tile ' + (cls || (letter ? 'pending' : 'empty'));
  t.textContent = letter || '';
  return t;
}
// Types (or re-colors) a letter by swapping in a *new* tile node — a fresh
// element reliably (re)triggers the CSS pop-in keyframe on insertion, which
// mutating className/textContent on a persisted node would not.
function setTileNode(row, i, letter, cls) {
  if (!row || !row.children[i]) return;
  row.replaceChild(makeTile(letter, cls), row.children[i]);
}
// Reveals a mark on an already-typed tile in place (no node swap) so the
// color change rides along with the row's own `.committed` flip animation
// instead of racing it with a second pop-in.
function paintTile(row, i, cls) {
  const t = row && row.children[i];
  if (!t) return;
  t.className = 'tile ' + cls;
}
function flashTile(myGen, row, i) {
  const t = row && row.children[i];
  if (!t) return;
  t.classList.add('hd-flash');
  schedule(myGen, 420, () => t.classList.remove('hd-flash'));
}

function rowSkeleton(id, extra, tileClass) {
  const tiles = Array.from({ length: 5 }, () => `<div class="tile ${tileClass || 'empty'}"></div>`).join('');
  return `<div class="brow mini ${extra || ''}" id="${id}">${tiles}</div>`;
}

function buildLive(mode) {
  live.innerHTML = mode === 'practice'
    ? `<div class="help-demo-stage">
         ${rowSkeleton('hd-row', 'pulsing', 'facedown')}
         ${rowSkeleton('hd-row2')}
       </div>
       <p class="help-demo-caption" id="hd-caption"></p>`
    : `<div class="help-demo-stage">
         ${rowSkeleton('hd-row')}
         <span class="help-demo-pointer" id="hd-pointer" aria-hidden="true"><i class="help-demo-pointer-dot"></i></span>
         <span class="help-demo-key" id="hd-key" aria-hidden="true">Enter &#8629;</span>
       </div>
       <div class="help-demo-suggest" id="hd-suggest">
         <span class="help-demo-count" id="hd-count"></span>
         <div class="hero-word help-demo-hero" id="hd-hero">${HERO_WORD}</div>
       </div>
       <p class="help-demo-caption" id="hd-caption"></p>`;
  return {
    row: live.querySelector('#hd-row'),
    row2: live.querySelector('#hd-row2'),
    pointer: live.querySelector('#hd-pointer'),
    key: live.querySelector('#hd-key'),
    suggest: live.querySelector('#hd-suggest'),
    count: live.querySelector('#hd-count'),
    hero: live.querySelector('#hd-hero'),
    caption: live.querySelector('#hd-caption'),
  };
}

function movePointerTo(stage, pointer, tile) {
  if (!pointer || !tile || !stage) return;
  const stageRect = stage.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const dx = tileRect.left - stageRect.left + tileRect.width / 2;
  const dy = tileRect.top - stageRect.top + tileRect.height / 2;
  pointer.style.transform = `translate(${dx}px, ${dy}px)`;
}

function tapPointer(myGen, pointer) {
  pointer.classList.add('tap');
  schedule(myGen, 260, () => pointer.classList.remove('tap'));
}

// Ticks a count down from `from` to `to` over `duration`ms by writing
// textContent from requestAnimationFrame — no CSS property is animated, so
// this is essentially free regardless of frame budget.
function animateCount(myGen, el, from, to, duration, onDone) {
  const t0 = performance.now();
  const frame = now => {
    if (myGen !== gen) return;
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - (1 - p) * (1 - p);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = `${val.toLocaleString()} words`;
    if (p < 1) { rafId = requestAnimationFrame(frame); }
    else { rafId = null; if (onDone) onDone(); }
  };
  rafId = requestAnimationFrame(frame);
}

function fadeAndLoop(myGen, holdEnd, mode) {
  schedule(myGen, holdEnd, () => live.classList.add('fading'));
  schedule(myGen, holdEnd + FADE_MS, () => {
    live.classList.remove('fading');
    runCycleFor(mode, myGen);
  });
}

function runSolverCycle(myGen) {
  const els = buildLive('solver');
  const stage = live.querySelector('.help-demo-stage');
  els.caption.textContent = SOLVER_CAPTIONS[0];

  // (a) type CRANE letter by letter, each tile popping in
  for (let i = 0; i < 5; i++) {
    schedule(myGen, 150 + i * 280, () => setTileNode(els.row, i, SOLVER_WORD[i], 'pending'));
  }

  // (b) tap tile 2 -> yellow, tile 4 -> green, pointer glides via transform
  schedule(myGen, 2000, () => {
    els.caption.textContent = SOLVER_CAPTIONS[1];
    els.pointer.classList.add('show');
    movePointerTo(stage, els.pointer, els.row.children[1]);
  });
  schedule(myGen, 2450, () => { tapPointer(myGen, els.pointer); setTileNode(els.row, 1, SOLVER_WORD[1], 'y'); });
  schedule(myGen, 2850, () => movePointerTo(stage, els.pointer, els.row.children[3]));
  schedule(myGen, 3300, () => { tapPointer(myGen, els.pointer); setTileNode(els.row, 3, SOLVER_WORD[3], 'g'); });
  schedule(myGen, 3700, () => els.pointer.classList.remove('show'));

  // (c) press Enter -> row commits with the flip animation
  schedule(myGen, 3900, () => { els.caption.textContent = SOLVER_CAPTIONS[2]; els.key.classList.add('show', 'press'); });
  schedule(myGen, 4200, () => { els.key.classList.remove('press'); els.row.classList.add('committed'); });
  schedule(myGen, 4800, () => els.key.classList.remove('show'));

  // (d) suggestion line: count ticks down, hero word fades in
  schedule(myGen, 5000, () => {
    els.caption.textContent = SOLVER_CAPTIONS[3];
    els.suggest.classList.add('show');
    animateCount(myGen, els.count, COUNT_FROM, COUNT_TO, 600);
  });
  schedule(myGen, 5650, () => els.hero.classList.add('show'));

  // (e) hold, fade, loop (~9.6s total)
  fadeAndLoop(myGen, 9200, 'solver');
}

function runPracticeCycle(myGen) {
  const els = buildLive('practice');
  els.caption.textContent = PRACTICE_CAPTIONS[0];

  // (a) five face-down tiles pulse subtly (CSS: .pulsing .facedown, transform+opacity)
  // (b) typing clears the pulse and types TRACE letter by letter
  schedule(myGen, 1800, () => { els.caption.textContent = PRACTICE_CAPTIONS[1]; els.row.classList.remove('pulsing'); });
  for (let i = 0; i < 5; i++) {
    schedule(myGen, 2000 + i * 280, () => setTileNode(els.row, i, PRACTICE_WORD_1[i], 'pending'));
  }
  // row flips, revealing the gray/yellow/green mix at once
  schedule(myGen, 3700, () => {
    for (let i = 0; i < 5; i++) paintTile(els.row, i, PRACTICE_MARKS_1[i]);
    els.row.classList.add('committed');
  });

  // (c) highlight what green/yellow mean by pulsing those tiles once
  schedule(myGen, 4700, () => { els.caption.textContent = PRACTICE_CAPTIONS[2]; flashTile(myGen, els.row, 1); });
  schedule(myGen, 4850, () => { flashTile(myGen, els.row, 2); flashTile(myGen, els.row, 4); });

  // (d) second guess REACT -> all green + a small celebratory bounce
  schedule(myGen, 5700, () => els.caption.textContent = PRACTICE_CAPTIONS[3]);
  for (let i = 0; i < 5; i++) {
    schedule(myGen, 5900 + i * 280, () => setTileNode(els.row2, i, PRACTICE_WORD_2[i], 'pending'));
  }
  schedule(myGen, 7600, () => {
    for (let i = 0; i < 5; i++) paintTile(els.row2, i, PRACTICE_MARKS_2[i]);
    els.row2.classList.add('committed', 'hd-celebrate');
  });
  schedule(myGen, 8200, () => els.row2.classList.remove('hd-celebrate'));

  // (e) hold, fade, loop (~9.8s total)
  fadeAndLoop(myGen, 9400, 'practice');
}

function runCycleFor(mode, myGen) {
  if (mode === 'practice') runPracticeCycle(myGen);
  else runSolverCycle(myGen);
}

function showStaticFrame(mode) {
  const els = buildLive(mode);
  if (mode === 'practice') {
    for (let i = 0; i < 5; i++) { setTileNode(els.row, i, PRACTICE_WORD_1[i], PRACTICE_MARKS_1[i]); }
    els.row.classList.remove('pulsing');
    els.row.classList.add('committed');
    for (let i = 0; i < 5; i++) { setTileNode(els.row2, i, PRACTICE_WORD_2[i], PRACTICE_MARKS_2[i]); }
    els.row2.classList.add('committed');
    els.caption.remove();
  } else {
    setTileNode(els.row, 0, SOLVER_WORD[0], 'pending');
    setTileNode(els.row, 1, SOLVER_WORD[1], 'y');
    setTileNode(els.row, 2, SOLVER_WORD[2], 'pending');
    setTileNode(els.row, 3, SOLVER_WORD[3], 'g');
    setTileNode(els.row, 4, SOLVER_WORD[4], 'pending');
    els.row.classList.add('committed');
    els.suggest.classList.add('show');
    els.hero.classList.add('show');
    els.count.textContent = `${COUNT_TO.toLocaleString()} words`;
    els.caption.remove();
  }
  if (staticCaptions) {
    const captions = mode === 'practice' ? PRACTICE_CAPTIONS : SOLVER_CAPTIONS;
    staticCaptions.innerHTML = captions.map(c => `<li>${c}</li>`).join('');
    staticCaptions.hidden = false;
  }
}

function reorderHelpCopy(mode) {
  const copy = document.querySelector('.help-copy');
  if (!copy) return;
  const target = copy.querySelector(`[data-help-section="${mode}"]`);
  if (target && copy.firstElementChild !== target) copy.insertBefore(target, copy.firstElementChild);
}

function stop() {
  gen++; // invalidate any in-flight scheduled/rAF callbacks
  clearAll();
}

function start() {
  stop();
  gen++;
  const myGen = gen;
  if (!live) return;
  live.classList.remove('fading');
  if (staticCaptions) staticCaptions.hidden = true;
  const mode = document.documentElement.dataset.mode === 'practice' ? 'practice' : 'solver';
  reorderHelpCopy(mode);
  if (reducedMotion()) { showStaticFrame(mode); return; }
  runCycleFor(mode, myGen);
}

export function initHelpDemo() {
  const root = document.getElementById('help-demo');
  const modal = document.getElementById('help-modal');
  if (!root || !modal) return;
  live = root.querySelector('.help-demo-live');
  staticCaptions = root.querySelector('.help-demo-static-captions');
  const btn = document.getElementById('help-btn');
  if (btn) btn.addEventListener('click', start);
  modal.addEventListener('close', stop);
}
