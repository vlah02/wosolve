// Animated "how to play" demo shown at the top of the help modal.
// A small step-driven state machine loops a ~6s scripted animation:
// type a word letter by letter, tap two tiles to cycle their color,
// then "press" Enter and watch the row commit. Starts when the help
// modal is opened, stops (clears all timers) when it closes, and is
// skipped entirely under prefers-reduced-motion in favor of a static
// final frame.

const WORD = 'CRANE';
const CAPTIONS = {
  type: 'Type your guess',
  tap: "Tap tiles to match Wordle’s colors",
  enter: 'Press Enter — the solver narrows the list',
};
const CYCLE_MS = 7500;

let els = null;
let timers = [];

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}
function schedule(delay, fn) {
  timers.push(setTimeout(fn, delay));
}

function setTile(i, letter, cls) {
  const t = els.tiles[i];
  if (!t) return;
  t.textContent = letter || '';
  t.className = 'tile ' + (cls || (letter ? 'pending' : 'empty'));
}

function resetStage() {
  els.row.classList.remove('committed');
  for (let i = 0; i < 5; i++) setTile(i, '', '');
  els.pointer.classList.remove('show', 'tap');
  els.key.classList.remove('show', 'press');
  els.caption.textContent = CAPTIONS.type;
}

function movePointerTo(i) {
  const tile = els.tiles[i];
  if (!tile) return;
  const stageRect = els.stage.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  els.pointer.style.left = (tileRect.left - stageRect.left + tileRect.width / 2) + 'px';
  els.pointer.style.top = (tileRect.top - stageRect.top + tileRect.height / 2) + 'px';
}

function tapTile(i, cls) {
  els.pointer.classList.add('tap');
  schedule(260, () => els.pointer.classList.remove('tap'));
  setTile(i, WORD[i], cls);
}

function runCycle() {
  resetStage();
  schedule(300, () => setTile(0, WORD[0], 'pending'));
  schedule(600, () => setTile(1, WORD[1], 'pending'));
  schedule(900, () => setTile(2, WORD[2], 'pending'));
  schedule(1200, () => setTile(3, WORD[3], 'pending'));
  schedule(1500, () => setTile(4, WORD[4], 'pending'));
  schedule(2200, () => {
    els.caption.textContent = CAPTIONS.tap;
    els.pointer.classList.add('show');
    movePointerTo(1);
  });
  schedule(2700, () => tapTile(1, 'y'));
  schedule(3100, () => movePointerTo(2));
  schedule(3600, () => tapTile(2, 'g'));
  schedule(4000, () => els.pointer.classList.remove('show'));
  schedule(4300, () => {
    els.caption.textContent = CAPTIONS.enter;
    els.key.classList.add('show', 'press');
  });
  schedule(4600, () => {
    els.key.classList.remove('press');
    els.row.classList.add('committed');
  });
  schedule(5200, () => els.key.classList.remove('show'));
  schedule(CYCLE_MS, runCycle);
}

function showStaticFrame() {
  resetStage();
  setTile(0, WORD[0], 'pending');
  setTile(1, WORD[1], 'y');
  setTile(2, WORD[2], 'g');
  setTile(3, WORD[3], 'pending');
  setTile(4, WORD[4], 'pending');
  els.caption.textContent = 'Tap tiles to match Wordle’s colors, then press Enter to narrow the word list.';
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function start() {
  if (!els) return;
  clearTimers();
  if (reducedMotion()) { showStaticFrame(); return; }
  runCycle();
}
function stop() { clearTimers(); }

export function initHelpDemo() {
  const root = document.getElementById('help-demo');
  const modal = document.getElementById('help-modal');
  if (!root || !modal) return;
  els = {
    stage: root.querySelector('.help-demo-stage'),
    row: root.querySelector('#help-demo-row'),
    tiles: [...root.querySelectorAll('#help-demo-row .tile')],
    pointer: root.querySelector('.help-demo-pointer'),
    key: root.querySelector('.help-demo-key'),
    caption: root.querySelector('.help-demo-caption'),
  };
  resetStage();
  const btn = document.getElementById('help-btn');
  if (btn) btn.addEventListener('click', start);
  modal.addEventListener('close', stop);
}
