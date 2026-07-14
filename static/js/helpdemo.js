// Cinematic "how to play" walkthrough shown inside the help modal.
//
// Instead of static paragraphs, the whole explanation happens as an animated
// tour: a LARGE, DETAILED, component-accurate mock of the real UI (`.hd-mock`,
// a fixed 880x520 logical canvas built entirely from `.hd-*` divs styled by
// the shared design tokens — never the real board/keyboard/panel markup)
// sits inside a small viewport (`#hd-stage`, ~480x330, overflow hidden). A
// virtual CAMERA moves between shots by animating `transform` (translate +
// scale) on `.hd-mock`, so every step can frame its subject — the board, the
// keyboard, the left panel, the right panel, or the whole mock — large and
// readable, the same way a real screen recording would zoom into whatever
// it's explaining. Two tours exist — TOURS.solver and TOURS.practice —
// chosen from the *current* `document.documentElement.dataset.mode` every
// time the help modal opens, so switching modes and reopening always shows
// the right walkthrough. After the last step there's a short hold on the
// final wide shot, then the whole stage fades and the tour loops from the
// top.
//
// 60fps discipline: every new keyframe/transition here only ever touches
// `transform`/`opacity` — the camera pans+zooms via `transform: translate()
// scale()` on `.hd-mock` (never width/height/left/top), the pointer/chip
// glide via `transform: translate(...)` in the mock's own local coordinate
// space (so they track the camera automatically), stat bars fill via
// `transform: scaleX(...)` (never width), the hint's blur cover only ever
// fades its *opacity* (the blur amount itself is a static, never-animated
// value), and the fake word-count ticker writes `textContent` from a rAF
// loop rather than animating any CSS property. Durations/easing come from
// the --dur-*/--ease-pop tokens (or a fixed camera duration, itself zeroed
// under reduced motion) so pacing follows the active skin.
//
// Lifecycle & cancellation: `start()` runs on every help-button click (i.e.
// every modal open), re-reads the mode, and (re)plays a tour. `stop()` runs
// on dialog close. Both bump a generation counter (`gen`, mirrored onto
// `window.__hd_gen` for tests) that every in-flight `delay()`/`tick()`
// promise checks before resolving; a stale generation makes the awaiting
// step's promise chain reject with `Canceled` instead of continuing, so
// rapid open/close/reopen cycles never stack more than one running loop.

const SOLVER_WORD = 'CRANE';
const HERO_WORD = 'SLATE';
const COUNT_FROM = 2315;
const COUNT_TO = 87;
const SUGGESTIONS = ['SLATE', 'CRANE', 'TRACE', 'ADIEU'];
const SUGGESTION_WEIGHTS = [1, .78, .6, .46];
const PAST_ANSWERS = [
  { date: '2026-07-13', word: 'STOUT' },
  { date: '2026-07-12', word: 'MANGO' },
  { date: '2026-07-11', word: 'PRIDE' },
  { date: '2026-07-10', word: 'CHESS' },
  { date: '2026-07-09', word: 'BRAVO' },
];

const PRACTICE_WORD_1 = 'TRACE';
const PRACTICE_MARKS_1 = ['n', 'y', 'g', 'n', 'g']; // T=gray R=yellow A=green C=gray E=green
const PRACTICE_WORD_2 = 'REACT';
const PRACTICE_MARKS_2 = ['g', 'g', 'g', 'g', 'g'];
const STATS_CHIPS = [{ v: '23', l: 'Played' }, { v: '92%', l: 'Win rate' }, { v: '5', l: 'Streak' }];
const STAT_BAR_VALUES = [.9, .6, .3];
const CAL_DAYS = 28;
const CAL_TODAY = 13;
const CAL_PLAYED = 5;
const CAL_PICK = 20;

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '\nzxcvbnm\b'];

const FADE_MS = 520; // upper bound covering every skin's --dur-tile
const CAM_MS = 820;  // camera move duration (matches the .hd-mock CSS transition + margin)

// camera zoom presets — tuned against the 880x520 .hd-mock canvas. `board`
// is deliberately modest: the board is 6 rows tall, and at the stage's
// ~478x328 viewport a scale much above ~1.15 pushes the tall board past the
// stage's height, cropping the very row the step is trying to show.
const CAM = { center: .82, board: 1.12, key: 3, panel: 1.25 };

// ---- module state -------------------------------------------------------
let helpDemoEl = null;    // #help-demo wrapper (fades between loop iterations)
let stageEl = null;       // #hd-stage — the camera viewport the mock mounts into
let captionEl = null;     // #hd-caption — the narrating caption bar
let dotsEl = null;        // #hd-dots — step-progress dots
let staticCaptionsEl = null; // .hd-static-captions <ol> (reduced motion)

let gen = 0;              // bumped on every start()/stop(); invalidates stale timers
const timers = new Set();
const rafIds = new Set();

class Canceled extends Error {}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Resolves after `ms` if this run is still current; otherwise rejects with
// Canceled so the awaiting step (and the loop that awaits the step) stops
// dead instead of touching stale/replaced DOM further.
function delay(ms, myGen) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (myGen === gen) resolve(); else reject(new Canceled());
    }, ms);
    timers.add(id);
  });
}

// Ticks `el.textContent` from `from` to `to` over `ms` via rAF — no CSS
// property is animated, so this is essentially free regardless of frame
// budget, and it self-cancels the same way delay() does.
function tick(el, from, to, ms, myGen) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const frame = now => {
      if (myGen !== gen) { reject(new Canceled()); return; }
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) * (1 - p);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = `${val.toLocaleString()} words left`;
      if (p < 1) { const id = requestAnimationFrame(frame); rafIds.add(id); }
      else resolve();
    };
    const id = requestAnimationFrame(frame);
    rafIds.add(id);
  });
}

function makeCtx(myGen) {
  return {
    wait: ms => delay(ms, myGen),
    tick: (el, from, to, ms) => tick(el, from, to, ms, myGen),
  };
}

// ---- tiny DOM builders ---------------------------------------------------

function makeBoard(rowCount) {
  const board = document.createElement('div');
  board.className = 'hd-board';
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const el = document.createElement('div');
    el.className = 'hd-brow';
    const tiles = [];
    for (let i = 0; i < 5; i++) {
      const t = document.createElement('div');
      t.className = 'hd-tile';
      el.appendChild(t);
      tiles.push(t);
    }
    board.appendChild(el);
    rows.push({ el, tiles });
  }
  return { el: board, rows };
}

function makeKeyboard() {
  const el = document.createElement('div');
  el.className = 'hd-keyboard';
  const keys = new Map();
  let enterKey = null;
  for (const spec of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'hd-krow';
    for (const ch of spec) {
      const k = document.createElement('div');
      if (ch === '\n') { k.className = 'hd-key wide'; k.textContent = '↵'; enterKey = k; }
      else if (ch === '\b') { k.className = 'hd-key wide'; k.textContent = '⌫'; }
      else { k.className = 'hd-key'; k.textContent = ch.toUpperCase(); keys.set(ch, k); }
      row.appendChild(k);
    }
    el.appendChild(row);
  }
  return { el, keys, enterKey };
}

// A fresh node swap reliably (re)triggers the pop-in keyframe on insertion;
// mutating className/textContent on a persisted node would not.
function typeTile(tiles, i, letter) {
  const t = document.createElement('div');
  t.className = 'hd-tile pending';
  t.textContent = letter;
  tiles[i].replaceWith(t);
  tiles[i] = t;
}
// Recolors a tile in place so the change rides along with the row's own
// flip animation instead of racing it with a second pop-in.
function paintTile(tiles, i, cls, letter) {
  const t = tiles[i];
  t.className = 'hd-tile ' + cls;
  if (letter != null) t.textContent = letter;
}
function pulseTile(t) {
  t.classList.remove('hd-pulse');
  void t.offsetWidth;
  t.classList.add('hd-pulse');
}
function pressKey(k) {
  if (!k) return;
  k.classList.remove('press');
  void k.offsetWidth;
  k.classList.add('press');
}
function squash(el) {
  if (!el) return;
  el.classList.remove('hd-squash');
  void el.offsetWidth;
  el.classList.add('hd-squash');
}
function addWordRow(container, word, weight, delayMs) {
  const row = document.createElement('div');
  row.className = 'hd-word-row';
  row.style.setProperty('--w', weight);
  row.style.animationDelay = `${delayMs}ms`;
  row.innerHTML = `<span class="hd-word-row-bar"></span><span class="hd-word-row-text">${word}</span>`;
  container.appendChild(row);
  const raf1 = requestAnimationFrame(() => {
    rafIds.delete(raf1);
    const raf2 = requestAnimationFrame(() => { rafIds.delete(raf2); row.classList.add('show'); });
    rafIds.add(raf2);
  });
  rafIds.add(raf1);
  return row;
}
function addPastRow(container, date, word, delayMs) {
  const row = document.createElement('div');
  row.className = 'hd-mini-row';
  row.style.animationDelay = `${delayMs}ms`;
  row.innerHTML = `<span class="hd-mini-date">${date}</span><span class="hd-mini-word">${word}</span>`;
  container.appendChild(row);
  return row;
}

// ---- camera --------------------------------------------------------------
// The mock is a fixed 880x520 logical canvas; the stage is the small
// viewport it's cropped into. Every camera move computes the mock-LOCAL
// (unscaled) coordinates of its subject and sets `.hd-mock`'s transform so
// that point lands centered in the stage at the requested zoom. Because the
// ratio (screen delta) / (current scale) is scale-invariant, this works
// regardless of what scale the camera currently happens to be at.
function localCenter(scene, el) {
  const mr = scene.mock.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const s = scene.camera.scale || 1;
  return {
    x: (er.left - mr.left) / s + (er.width / s) / 2,
    y: (er.top - mr.top) / s + (er.height / s) / 2,
  };
}
function setCamera(scene, cx, cy, scale) {
  const sw = scene.stage.clientWidth, sh = scene.stage.clientHeight;
  const tx = sw / 2 - cx * scale, ty = sh / 2 - cy * scale;
  scene.mock.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  scene.camera = { x: cx, y: cy, scale };
}
// Establishing shot: the whole mock, letterboxed to fit the stage.
function camWide(scene) {
  const sw = scene.stage.clientWidth, sh = scene.stage.clientHeight;
  const mw = scene.mock.offsetWidth, mh = scene.mock.offsetHeight;
  const scale = Math.min(sw / mw, sh / mh) * 0.94;
  setCamera(scene, mw / 2, mh / 2, scale);
}
// Close-up: centers on `el` at `scale`.
function camFocus(scene, el, scale) {
  const { x, y } = localCenter(scene, el);
  setCamera(scene, x, y, scale);
}

// ---- cursor: pointer glides + taps ripple/squash --------------------------
function showPointer(scene) { scene.pointer.classList.add('show'); }
function hidePointer(scene) { scene.pointer.classList.remove('show'); }
function moveTo(scene, target) {
  const { x, y } = localCenter(scene, target);
  scene.pointer.style.transform = `translate(${x}px, ${y}px)`;
}
function tapAt(scene, target) {
  const { x, y } = localCenter(scene, target);
  scene.pointer.classList.remove('tap'); void scene.pointer.offsetWidth; scene.pointer.classList.add('tap');
  scene.ripple.style.setProperty('--tx', `${x}px`);
  scene.ripple.style.setProperty('--ty', `${y}px`);
  scene.ripple.classList.remove('go'); void scene.ripple.offsetWidth; scene.ripple.classList.add('go');
  squash(target);
}
function showChip(scene, text, target) {
  const { x, y } = localCenter(scene, target);
  scene.chip.textContent = text;
  scene.chip.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
  scene.chip.classList.add('show');
}
function hideChip(scene) { scene.chip.classList.remove('show'); }

// ---- scene builders -------------------------------------------------------

function mountStage() {
  stageEl.innerHTML = '';
  stageEl.classList.remove('hd-mount');
  void stageEl.offsetWidth;
  stageEl.classList.add('hd-mount', 'hd-stage');
}

function buildSolverScene() {
  mountStage();
  const mock = document.createElement('div');
  mock.className = 'hd-mock';

  const left = document.createElement('div');
  left.className = 'hd-col hd-left';
  const leftCard = document.createElement('div');
  leftCard.className = 'hd-card';
  leftCard.innerHTML = '<div class="hd-card-label">Past answers</div>';
  const past = document.createElement('div');
  past.className = 'hd-mini-list';
  leftCard.appendChild(past);
  left.appendChild(leftCard);

  const center = document.createElement('div');
  center.className = 'hd-col hd-center';
  const { el: boardEl, rows } = makeBoard(6);
  const { el: kbEl, keys, enterKey } = makeKeyboard();
  center.append(boardEl, kbEl);

  const right = document.createElement('div');
  right.className = 'hd-col hd-right';
  const rightCard = document.createElement('div');
  rightCard.className = 'hd-card';
  rightCard.innerHTML = '<div class="hd-card-label">Best next guess</div>';
  const hero = document.createElement('div');
  hero.className = 'hd-hero';
  hero.textContent = HERO_WORD;
  const count = document.createElement('div');
  count.className = 'hd-count-chip';
  const wordRowsEl = document.createElement('div');
  wordRowsEl.className = 'hd-word-rows';
  rightCard.append(hero, count, wordRowsEl);
  right.appendChild(rightCard);

  const pointer = document.createElement('span'); pointer.className = 'hd-pointer';
  const ripple = document.createElement('span'); ripple.className = 'hd-ripple';
  const chip = document.createElement('span'); chip.className = 'hd-chip';
  mock.append(left, center, right, pointer, ripple, chip);
  stageEl.appendChild(mock);

  return {
    stage: stageEl, mock, camera: { x: 0, y: 0, scale: 1 },
    cols: { left, center, right },
    boardEl, kbEl, rows, keys, enterKey,
    past, wordRowsEl, count, hero,
    leftCard, rightCard,
    pointer, ripple, chip,
  };
}

function buildPracticeScene() {
  mountStage();
  const mock = document.createElement('div');
  mock.className = 'hd-mock';

  const left = document.createElement('div');
  left.className = 'hd-col hd-left';
  const leftCard = document.createElement('div');
  leftCard.className = 'hd-card';
  leftCard.innerHTML = '<div class="hd-card-label">Play a day</div>';
  const cal = document.createElement('div');
  cal.className = 'hd-cal';
  const calDays = [];
  for (let i = 0; i < CAL_DAYS; i++) {
    const d = document.createElement('div');
    d.className = 'hd-cal-day';
    d.textContent = String(i + 1);
    d.style.animationDelay = `${i * 10}ms`;
    if (i === CAL_TODAY) d.classList.add('hd-today');
    if (i === CAL_PLAYED) d.classList.add('hd-dot');
    cal.appendChild(d);
    calDays.push(d);
  }
  leftCard.appendChild(cal);
  left.appendChild(leftCard);

  const center = document.createElement('div');
  center.className = 'hd-col hd-center';
  const { el: boardEl, rows } = makeBoard(6);
  rows[0].tiles.forEach(t => t.classList.add('facedown'));
  rows[0].el.classList.add('pulsing');
  const refresh = document.createElement('span');
  refresh.className = 'hd-refresh';
  const { el: kbEl } = makeKeyboard();
  center.append(boardEl, refresh, kbEl);

  const right = document.createElement('div');
  right.className = 'hd-col hd-right';

  const hintCard = document.createElement('div');
  hintCard.className = 'hd-card';
  hintCard.innerHTML = '<div class="hd-card-label">Hint</div>';
  const hintWrap = document.createElement('div');
  hintWrap.className = 'hd-hint';
  const hero = document.createElement('div');
  hero.className = 'hd-hero show';
  hero.textContent = HERO_WORD;
  const cover = document.createElement('div');
  cover.className = 'hd-hint-cover';
  hintWrap.append(hero, cover);
  hintCard.appendChild(hintWrap);

  const statsCard = document.createElement('div');
  statsCard.className = 'hd-card';
  statsCard.innerHTML = '<div class="hd-card-label">Stats</div>';
  const chipsRow = document.createElement('div');
  chipsRow.className = 'hd-stat-chips';
  STATS_CHIPS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'hd-stat-chip';
    el.innerHTML = `<b>${c.v}</b><span>${c.l}</span>`;
    chipsRow.appendChild(el);
  });
  const stats = document.createElement('div');
  stats.className = 'hd-stats';
  const statBars = STAT_BAR_VALUES.map(v => {
    const bar = document.createElement('div');
    bar.className = 'hd-stat-bar';
    const i = document.createElement('i');
    i.style.setProperty('--v', v);
    bar.appendChild(i);
    stats.appendChild(bar);
    return bar;
  });
  statsCard.append(chipsRow, stats);

  right.append(hintCard, statsCard);

  const pointer = document.createElement('span'); pointer.className = 'hd-pointer';
  const ripple = document.createElement('span'); ripple.className = 'hd-ripple';
  const chip = document.createElement('span'); chip.className = 'hd-chip';
  mock.append(left, center, right, pointer, ripple, chip);
  stageEl.appendChild(mock);

  return {
    stage: stageEl, mock, camera: { x: 0, y: 0, scale: 1 },
    cols: { left, center, right },
    boardEl, kbEl, rows, cal, calDays, hero, cover, statBars, refresh,
    hintCard, statsCard, leftCard,
    pointer, ripple, chip,
  };
}

// ---- tour scripts ---------------------------------------------------------
// Each step: { caption, run(scene, ctx) => Promise }. The engine narrates
// `caption` (whole-line fade+rise) then awaits `run`, whose usual shape is
// camera move (~CAM_MS) -> action (1.5-2.5s) -> hold, mutating the shared
// mock via ctx.wait(ms)/ctx.tick(el, from, to, ms).

const TOURS = {
  solver: [
    {
      caption: 'This is the solver — it finds your Wordle answer.',
      async run(scene, ctx) { camWide(scene); await ctx.wait(CAM_MS); await ctx.wait(1780); },
    },
    {
      caption: 'Type the guess you played in Wordle.',
      async run(scene, ctx) {
        camFocus(scene, scene.cols.center, CAM.center);
        await ctx.wait(CAM_MS);
        const tiles = scene.rows[0].tiles;
        for (let i = 0; i < 5; i++) {
          const ch = SOLVER_WORD[i].toLowerCase();
          pressKey(scene.keys.get(ch));
          typeTile(tiles, i, SOLVER_WORD[i]);
          await ctx.wait(260);
        }
        await ctx.wait(800);
      },
    },
    {
      caption: 'Tap tiles to set the colors Wordle gave you.',
      async run(scene, ctx) {
        camFocus(scene, scene.boardEl, CAM.board);
        await ctx.wait(CAM_MS);
        const tiles = scene.rows[0].tiles;
        showPointer(scene);
        moveTo(scene, tiles[1]);
        await ctx.wait(450);
        tapAt(scene, tiles[1]);
        paintTile(tiles, 1, 'y', SOLVER_WORD[1]);
        showChip(scene, 'yellow = right letter, wrong spot', tiles[1]);
        await ctx.wait(1000);
        hideChip(scene);
        moveTo(scene, tiles[3]);
        await ctx.wait(450);
        tapAt(scene, tiles[3]);
        paintTile(tiles, 3, 'g', SOLVER_WORD[3]);
        showChip(scene, 'green = right spot', tiles[3]);
        await ctx.wait(1000);
        hideChip(scene);
        hidePointer(scene);
      },
    },
    {
      caption: 'Gray means the letter isn’t in the word.',
      async run(scene, ctx) {
        camFocus(scene, scene.boardEl, CAM.board);
        await ctx.wait(CAM_MS);
        const tiles = scene.rows[0].tiles;
        paintTile(tiles, 0, 'n', SOLVER_WORD[0]);
        pulseTile(tiles[0]);
        showChip(scene, 'gray = letter not in the word', tiles[0]);
        await ctx.wait(1300);
        hideChip(scene);
        await ctx.wait(500);
      },
    },
    {
      caption: 'Press Enter to submit.',
      async run(scene, ctx) {
        camFocus(scene, scene.enterKey, CAM.key);
        await ctx.wait(CAM_MS);
        pressKey(scene.enterKey);
        await ctx.wait(260);
        scene.rows[0].el.classList.add('committed');
        await ctx.wait(1700);
      },
    },
    {
      caption: 'The suggestions panel shows the best next guess.',
      async run(scene, ctx) {
        camFocus(scene, scene.rightCard, CAM.panel);
        await ctx.wait(CAM_MS);
        scene.count.classList.add('show');
        await ctx.tick(scene.count, COUNT_FROM, COUNT_TO, 700);
        scene.hero.classList.add('show');
        await ctx.wait(1200);
      },
    },
    {
      caption: 'See all remaining words anytime.',
      async run(scene, ctx) {
        camFocus(scene, scene.rightCard, CAM.panel);
        await ctx.wait(300);
        SUGGESTIONS.forEach((w, i) => addWordRow(scene.wordRowsEl, w, SUGGESTION_WEIGHTS[i], i * 90));
        await ctx.wait(1600);
      },
    },
    {
      caption: 'Past answers are listed here — today’s word is never an old one.',
      async run(scene, ctx) {
        camFocus(scene, scene.leftCard, CAM.panel);
        await ctx.wait(CAM_MS);
        PAST_ANSWERS.forEach((p, i) => addPastRow(scene.past, p.date, p.word, i * 70));
        await ctx.wait(1500);
      },
    },
    {
      caption: 'Made a mistake? Hover a row and hit × to remove it.',
      async run(scene, ctx) {
        camFocus(scene, scene.leftCard, CAM.panel);
        await ctx.wait(300);
        const row = scene.past.children[1] || scene.past.children[0];
        if (!row) { await ctx.wait(1600); return; }
        row.classList.add('hd-x');
        const x = document.createElement('span');
        x.className = 'hd-x-mark';
        x.textContent = '×';
        row.appendChild(x);
        showPointer(scene);
        moveTo(scene, row);
        await ctx.wait(500);
        x.classList.add('show');
        await ctx.wait(500);
        tapAt(scene, row);
        row.classList.add('hd-exit');
        hidePointer(scene);
        await ctx.wait(450);
        row.remove();
        await ctx.tick(scene.count, COUNT_TO, COUNT_TO + 5, 450);
        await ctx.wait(350);
      },
    },
    {
      caption: 'That’s it — solve in 3-4 guesses on average!',
      async run(scene, ctx) {
        camWide(scene);
        await ctx.wait(CAM_MS);
        const guess = scene.rows[1].tiles;
        for (let i = 0; i < 5; i++) { typeTile(guess, i, SOLVER_WORD[i]); await ctx.wait(110); }
        await ctx.wait(150);
        paintTile(guess, 1, 'y', SOLVER_WORD[1]);
        paintTile(guess, 3, 'g', SOLVER_WORD[3]);
        await ctx.wait(200);
        scene.rows[1].el.classList.add('committed');
        await ctx.wait(500);
        const final = scene.rows[2];
        for (let i = 0; i < 5; i++) typeTile(final.tiles, i, HERO_WORD[i]);
        await ctx.wait(150);
        for (let i = 0; i < 5; i++) paintTile(final.tiles, i, 'g', HERO_WORD[i]);
        final.el.classList.add('committed', 'hd-celebrate');
        await ctx.wait(900);
      },
    },
  ],
  practice: [
    {
      caption: 'Practice mode — play Wordle right here.',
      async run(scene, ctx) { camWide(scene); await ctx.wait(CAM_MS); await ctx.wait(1780); },
    },
    {
      caption: 'We pick a secret word — colors fill in automatically.',
      async run(scene, ctx) {
        camFocus(scene, scene.cols.center, CAM.center);
        await ctx.wait(CAM_MS);
        scene.rows[0].el.classList.remove('pulsing');
        const tiles = scene.rows[0].tiles;
        for (let i = 0; i < 5; i++) { typeTile(tiles, i, PRACTICE_WORD_1[i]); await ctx.wait(220); }
        await ctx.wait(300);
        for (let i = 0; i < 5; i++) paintTile(tiles, i, PRACTICE_MARKS_1[i], PRACTICE_WORD_1[i]);
        scene.rows[0].el.classList.add('committed');
        await ctx.wait(900);
      },
    },
    {
      caption: 'Green = right spot, yellow = wrong spot, gray = not in the word.',
      async run(scene, ctx) {
        camFocus(scene, scene.boardEl, CAM.board);
        await ctx.wait(CAM_MS);
        const tiles = scene.rows[0].tiles;
        pulseTile(tiles[2]); showChip(scene, 'green = right spot', tiles[2]);
        await ctx.wait(750); hideChip(scene);
        pulseTile(tiles[1]); showChip(scene, 'yellow = wrong spot', tiles[1]);
        await ctx.wait(750); hideChip(scene);
        pulseTile(tiles[0]); showChip(scene, 'gray = not in the word', tiles[0]);
        await ctx.wait(750); hideChip(scene);
        await ctx.wait(300);
      },
    },
    {
      caption: 'Stuck? The hint shares a letter with the answer.',
      async run(scene, ctx) {
        camFocus(scene, scene.hintCard, CAM.panel);
        await ctx.wait(CAM_MS);
        scene.cover.classList.add('hd-wiped');
        await ctx.wait(1400);
      },
    },
    {
      caption: 'Your stats grow with every game.',
      async run(scene, ctx) {
        camFocus(scene, scene.statsCard, CAM.panel);
        await ctx.wait(CAM_MS);
        for (const bar of scene.statBars) { bar.classList.add('fill'); await ctx.wait(180); }
        await ctx.wait(1200);
      },
    },
    {
      caption: 'Pick any day from the calendar to replay that Wordle.',
      async run(scene, ctx) {
        camFocus(scene, scene.leftCard, CAM.panel);
        await ctx.wait(CAM_MS);
        const day = scene.calDays[CAL_PICK];
        showPointer(scene);
        moveTo(scene, day);
        await ctx.wait(450);
        tapAt(scene, day);
        day.classList.add('hd-picked');
        await ctx.wait(300);
        day.classList.add('hd-dot');
        hidePointer(scene);
        await ctx.wait(1000);
      },
    },
    {
      caption: 'Refresh the page for a fresh random word.',
      async run(scene, ctx) {
        camFocus(scene, scene.cols.center, CAM.center);
        await ctx.wait(CAM_MS);
        scene.refresh.classList.add('show');
        scene.refresh.classList.remove('spin');
        void scene.refresh.offsetWidth;
        scene.refresh.classList.add('spin');
        await ctx.wait(1600);
      },
    },
    {
      caption: 'Guess it in six — good luck!',
      async run(scene, ctx) {
        camWide(scene);
        await ctx.wait(CAM_MS);
        const row = scene.rows[1];
        for (let i = 0; i < 5; i++) { typeTile(row.tiles, i, PRACTICE_WORD_2[i]); await ctx.wait(150); }
        await ctx.wait(200);
        for (let i = 0; i < 5; i++) paintTile(row.tiles, i, PRACTICE_MARKS_2[i], PRACTICE_WORD_2[i]);
        row.el.classList.add('committed', 'hd-celebrate');
        await ctx.wait(1000);
      },
    },
  ],
};

// ---- caption + progress dots ----------------------------------------------
// Whole-line fade+rise (no typewriter/letter-cascade — that reads as a
// glitch when a frame lands mid-word).
function setCaption(text) {
  captionEl.classList.remove('show');
  void captionEl.offsetWidth;
  captionEl.textContent = text;
  captionEl.classList.add('show');
}
function buildDots(n) {
  dotsEl.innerHTML = Array.from({ length: n }, () => '<span class="hd-dot"></span>').join('');
}
function setActiveDot(i) {
  Array.from(dotsEl.children).forEach((d, idx) => d.classList.toggle('on', idx === i));
}

// ---- engine ----------------------------------------------------------------

async function playLoop(mode, myGen) {
  const tour = TOURS[mode];
  buildDots(tour.length);
  let scene = mode === 'practice' ? buildPracticeScene() : buildSolverScene();
  const ctx = makeCtx(myGen);
  try {
    for (;;) {
      for (let i = 0; i < tour.length; i++) {
        if (myGen !== gen) return;
        setActiveDot(i);
        setCaption(tour[i].caption);
        await tour[i].run(scene, ctx);
      }
      await ctx.wait(2000);
      helpDemoEl.classList.add('fading');
      await ctx.wait(FADE_MS);
      helpDemoEl.classList.remove('fading');
      scene = mode === 'practice' ? buildPracticeScene() : buildSolverScene();
    }
  } catch (e) {
    if (!(e instanceof Canceled)) throw e;
  }
}

function showStatic(mode) {
  const tour = TOURS[mode];
  dotsEl.innerHTML = '';
  captionEl.hidden = true;
  const scene = mode === 'practice' ? buildPracticeScene() : buildSolverScene();
  camWide(scene);
  if (mode === 'practice') {
    const tiles0 = scene.rows[0].tiles;
    scene.rows[0].el.classList.remove('pulsing');
    for (let i = 0; i < 5; i++) { paintTile(tiles0, i, PRACTICE_MARKS_1[i], PRACTICE_WORD_1[i]); tiles0[i].classList.remove('facedown'); }
    scene.rows[0].el.classList.add('committed');
    const tiles1 = scene.rows[1].tiles;
    for (let i = 0; i < 5; i++) { tiles1[i].textContent = PRACTICE_WORD_2[i]; tiles1[i].className = 'hd-tile ' + PRACTICE_MARKS_2[i]; }
    scene.rows[1].el.classList.add('committed');
    scene.cover.classList.add('hd-wiped');
    scene.statBars.forEach(b => b.classList.add('fill'));
    scene.calDays[CAL_PICK].classList.add('hd-picked', 'hd-dot');
  } else {
    const tiles = scene.rows[0].tiles;
    for (let i = 0; i < 5; i++) tiles[i].textContent = SOLVER_WORD[i];
    tiles[0].className = 'hd-tile n';
    tiles[1].className = 'hd-tile y';
    tiles[2].className = 'hd-tile pending';
    tiles[3].className = 'hd-tile g';
    tiles[4].className = 'hd-tile pending';
    scene.rows[0].el.classList.add('committed');
    scene.count.classList.add('show');
    scene.count.textContent = `${COUNT_TO.toLocaleString()} words left`;
    scene.hero.classList.add('show');
    SUGGESTIONS.forEach((w, i) => {
      addWordRow(scene.wordRowsEl, w, SUGGESTION_WEIGHTS[i], 0);
      scene.wordRowsEl.lastChild.classList.add('show');
    });
    PAST_ANSWERS.forEach((p, i) => addPastRow(scene.past, p.date, p.word, 0));
  }
  if (staticCaptionsEl) {
    staticCaptionsEl.innerHTML = tour.map(s => `<li>${s.caption}</li>`).join('');
    staticCaptionsEl.hidden = false;
  }
}

function stop() {
  gen++;
  window.__hd_gen = gen;
  timers.forEach(id => clearTimeout(id));
  timers.clear();
  rafIds.forEach(id => cancelAnimationFrame(id));
  rafIds.clear();
}

function start() {
  stop();
  gen++;
  window.__hd_gen = gen;
  const myGen = gen;
  if (!stageEl) return;
  helpDemoEl.classList.remove('fading');
  if (staticCaptionsEl) staticCaptionsEl.hidden = true;
  captionEl.hidden = false;
  captionEl.classList.remove('show');
  const mode = document.documentElement.dataset.mode === 'practice' ? 'practice' : 'solver';
  if (reducedMotion()) { showStatic(mode); return; }
  playLoop(mode, myGen).catch(() => {});
}

export function initHelpDemo() {
  const root = document.getElementById('help-demo');
  const modal = document.getElementById('help-modal');
  if (!root || !modal) return;
  helpDemoEl = root;
  stageEl = root.querySelector('#hd-stage');
  captionEl = root.querySelector('#hd-caption');
  dotsEl = root.querySelector('#hd-dots');
  staticCaptionsEl = root.querySelector('.hd-static-captions');
  const btn = document.getElementById('help-btn');
  if (btn) btn.addEventListener('click', start);
  modal.addEventListener('close', stop);
}
