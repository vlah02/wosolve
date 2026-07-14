// Cinematic "how to play" walkthrough shown inside the help modal.
//
// Instead of static paragraphs, the whole explanation happens as an animated
// tour: a miniature, component-accurate mock of the real UI (mini board,
// mini keyboard, mini left/right panels — all built from `.hd-*` divs styled
// by the shared design tokens, never the real board/keyboard markup) plays a
// scripted sequence of steps. Each step spotlights the component it explains
// (dim everything else, zoom the relevant column) while an animated caption
// underneath narrates what's happening; a row of progress dots tracks where
// we are in the tour. Two tours exist — TOURS.solver and TOURS.practice —
// chosen from the *current* `document.documentElement.dataset.mode` every
// time the help modal opens, so switching modes and reopening always shows
// the right walkthrough. After the last step there's a short hold, then the
// whole stage fades and the tour loops from the top.
//
// 60fps discipline: every new keyframe/transition here only ever touches
// `transform`/`opacity` — the pointer glides via `transform: translate(...)`
// (never left/top), stat bars fill via `transform: scaleX(...)` (never
// width), the hint's blur cover only ever fades its *opacity* (the blur
// amount itself is a static, never-animated value), and the fake
// word-count ticker writes `textContent` from a rAF loop rather than
// animating any CSS property. Durations/easing come from the
// --dur-*/--ease-pop tokens so pacing follows the active skin.
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

const PRACTICE_WORD_1 = 'TRACE';
const PRACTICE_MARKS_1 = ['n', 'y', 'g', 'n', 'g']; // T=gray R=yellow A=green C=gray E=green
const PRACTICE_WORD_2 = 'REACT';
const PRACTICE_MARKS_2 = ['g', 'g', 'g', 'g', 'g'];

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '\nzxcvbnm\b'];

const FADE_MS = 520; // upper bound covering every skin's --dur-tile

// ---- module state -------------------------------------------------------
let helpDemoEl = null;    // #help-demo wrapper (fades between loop iterations)
let stageEl = null;       // #hd-stage — the mock UI mounts/remounts here
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
      el.textContent = `${val.toLocaleString()} words`;
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
function pointTo(stage, pointer, target) {
  const sr = stage.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  const dx = tr.left - sr.left + tr.width / 2;
  const dy = tr.top - sr.top + tr.height / 2;
  pointer.style.transform = `translate(${dx}px, ${dy}px)`;
}
function tapPointer(pointer) {
  pointer.classList.remove('tap');
  void pointer.offsetWidth;
  pointer.classList.add('tap');
}
function showChip(chip, text) {
  chip.textContent = text;
  chip.classList.add('show');
}
function hideChip(chip) {
  chip.classList.remove('show');
}

// ---- spotlight mechanic --------------------------------------------------
// Dims the whole stage, then brings one of the three columns (left/center/
// right) back to full opacity + a slight zoom — "the component this step
// explains". Finer emphasis inside an already-spotlit column (a specific
// tile/key flashing) layers a one-shot .hd-pulse on top of that.
function spot(scene, name) {
  scene.stage.classList.add('hd-dimmed');
  Object.entries(scene.cols).forEach(([k, el]) => el.classList.toggle('hd-focus', k === name));
}
function unspot(scene) {
  scene.stage.classList.remove('hd-dimmed');
  Object.values(scene.cols).forEach(el => el.classList.remove('hd-focus'));
}

// ---- scene builders -------------------------------------------------------

function mountStage() {
  stageEl.innerHTML = '';
  stageEl.classList.remove('hd-mount');
  void stageEl.offsetWidth;
  stageEl.classList.add('hd-mount', 'hd-stage');
  stageEl.classList.remove('hd-dimmed');
}

function buildSolverScene() {
  mountStage();

  const left = document.createElement('div');
  left.className = 'hd-col hd-left';
  left.innerHTML = '<div class="hd-card-label">Past answers</div>';
  const past = document.createElement('div');
  past.className = 'hd-mini-list';
  left.appendChild(past);

  const center = document.createElement('div');
  center.className = 'hd-col hd-center';
  const { el: boardEl, rows } = makeBoard(5);
  const { el: kbEl, keys, enterKey } = makeKeyboard();
  center.append(boardEl, kbEl);

  const right = document.createElement('div');
  right.className = 'hd-col hd-right';
  right.innerHTML = '<div class="hd-card-label">Suggestions</div>';
  const suggest = document.createElement('div');
  suggest.className = 'hd-suggest';
  const count = document.createElement('span');
  count.className = 'hd-count';
  const hero = document.createElement('div');
  hero.className = 'hd-hero';
  suggest.append(count, hero);
  const wordlist = document.createElement('div');
  wordlist.className = 'hd-mini-list';
  right.append(suggest, wordlist);

  const pointer = document.createElement('span');
  pointer.className = 'hd-pointer';
  const chip = document.createElement('span');
  chip.className = 'hd-chip';

  stageEl.append(left, center, right, pointer, chip);

  return {
    stage: stageEl,
    cols: { left, center, right },
    rows, keys, enterKey,
    past, wordlist, count, hero, pointer, chip,
  };
}

function buildPracticeScene() {
  mountStage();

  const left = document.createElement('div');
  left.className = 'hd-col hd-left';
  left.innerHTML = '<div class="hd-card-label">Play a day</div>';
  const cal = document.createElement('div');
  cal.className = 'hd-cal';
  for (let i = 0; i < 21; i++) {
    const d = document.createElement('div');
    d.className = 'hd-cal-day';
    d.style.animationDelay = `${i * 12}ms`;
    cal.appendChild(d);
  }
  left.appendChild(cal);

  const center = document.createElement('div');
  center.className = 'hd-col hd-center';
  const { el: boardEl, rows } = makeBoard(5);
  rows[0].tiles.forEach(t => t.classList.add('facedown'));
  rows[0].el.classList.add('pulsing');
  const refresh = document.createElement('span');
  refresh.className = 'hd-refresh';
  const { el: kbEl } = makeKeyboard();
  center.append(boardEl, refresh, kbEl);

  const right = document.createElement('div');
  right.className = 'hd-col hd-right';
  right.innerHTML = '<div class="hd-card-label">Hint</div>';
  const hint = document.createElement('div');
  hint.className = 'hd-hint';
  const hero = document.createElement('div');
  hero.className = 'hd-hero show';
  hero.textContent = HERO_WORD;
  const cover = document.createElement('div');
  cover.className = 'hd-hint-cover';
  hint.append(hero, cover);
  const statsLabel = document.createElement('div');
  statsLabel.className = 'hd-card-label hd-mt';
  statsLabel.textContent = 'Stats';
  const stats = document.createElement('div');
  stats.className = 'hd-stats';
  const statBars = [.9, .6, .3].map(v => {
    const bar = document.createElement('div');
    bar.className = 'hd-stat-bar';
    const i = document.createElement('i');
    i.style.setProperty('--v', v);
    bar.appendChild(i);
    stats.appendChild(bar);
    return bar;
  });
  right.append(hint, statsLabel, stats);

  const pointer = document.createElement('span');
  pointer.className = 'hd-pointer';
  const chip = document.createElement('span');
  chip.className = 'hd-chip';

  stageEl.append(left, center, right, pointer, chip);

  return {
    stage: stageEl,
    cols: { left, center, right },
    rows, cal, hero, cover, statBars, refresh,
    pointer, chip,
  };
}

// ---- tour scripts ---------------------------------------------------------
// Each step: { caption, run(scene, ctx) => Promise } — the engine narrates
// `caption` (animated in) then awaits `run`, which mutates the shared mock
// via ctx.wait(ms)/ctx.tick(el, from, to, ms).

const TOURS = {
  solver: [
    {
      caption: 'This is the solver — it finds your Wordle answer.',
      run(scene, ctx) { unspot(scene); return ctx.wait(2600); },
    },
    {
      caption: 'Type the guess you played in Wordle.',
      async run(scene, ctx) {
        spot(scene, 'center');
        const tiles = scene.rows[0].tiles;
        for (let i = 0; i < 5; i++) {
          const ch = SOLVER_WORD[i].toLowerCase();
          pressKey(scene.keys.get(ch));
          typeTile(tiles, i, SOLVER_WORD[i]);
          await ctx.wait(260);
        }
        await ctx.wait(1000);
      },
    },
    {
      caption: 'Tap tiles to set the colors Wordle gave you.',
      async run(scene, ctx) {
        spot(scene, 'center');
        const tiles = scene.rows[0].tiles;
        scene.pointer.classList.add('show');
        pointTo(scene.stage, scene.pointer, tiles[1]);
        await ctx.wait(450);
        tapPointer(scene.pointer);
        paintTile(tiles, 1, 'y', SOLVER_WORD[1]);
        showChip(scene.chip, 'yellow = right letter, wrong spot');
        await ctx.wait(1000);
        hideChip(scene.chip);
        pointTo(scene.stage, scene.pointer, tiles[3]);
        await ctx.wait(450);
        tapPointer(scene.pointer);
        paintTile(tiles, 3, 'g', SOLVER_WORD[3]);
        showChip(scene.chip, 'green = right spot');
        await ctx.wait(1000);
        hideChip(scene.chip);
        scene.pointer.classList.remove('show');
      },
    },
    {
      caption: 'Gray means the letter isn’t in the word.',
      async run(scene, ctx) {
        spot(scene, 'center');
        const tiles = scene.rows[0].tiles;
        paintTile(tiles, 0, 'n', SOLVER_WORD[0]);
        pulseTile(tiles[0]);
        showChip(scene.chip, 'gray = letter not in the word');
        await ctx.wait(1500);
        hideChip(scene.chip);
        await ctx.wait(700);
      },
    },
    {
      caption: 'Press Enter to submit.',
      async run(scene, ctx) {
        spot(scene, 'center');
        pressKey(scene.enterKey);
        await ctx.wait(260);
        scene.rows[0].el.classList.add('committed');
        await ctx.wait(2000);
      },
    },
    {
      caption: 'The suggestions panel shows the best next guess.',
      async run(scene, ctx) {
        spot(scene, 'right');
        scene.count.classList.add('show');
        await ctx.tick(scene.count, COUNT_FROM, COUNT_TO, 700);
        scene.hero.textContent = HERO_WORD;
        scene.hero.classList.add('show');
        await ctx.wait(1600);
      },
    },
    {
      caption: 'See all remaining words anytime.',
      async run(scene, ctx) {
        spot(scene, 'right');
        scene.wordlist.innerHTML = '';
        for (let i = 0; i < 5; i++) {
          const row = document.createElement('div');
          row.className = 'hd-mini-row';
          row.style.width = `${92 - i * 9}%`;
          scene.wordlist.appendChild(row);
        }
        await ctx.wait(1000);
        await ctx.wait(1500);
      },
    },
    {
      caption: 'Past answers are listed here — today’s word is never an old one.',
      async run(scene, ctx) {
        spot(scene, 'left');
        scene.past.innerHTML = '';
        for (let i = 0; i < 5; i++) {
          const row = document.createElement('div');
          row.className = 'hd-mini-row';
          scene.past.appendChild(row);
        }
        await ctx.wait(1100);
        await ctx.wait(900);
      },
    },
    {
      caption: 'Made a mistake? Hover a row and hit × to remove it.',
      async run(scene, ctx) {
        spot(scene, 'left');
        const row = scene.past.children[1] || scene.past.children[0];
        if (!row) { await ctx.wait(1600); return; }
        row.classList.add('hd-x');
        const x = document.createElement('span');
        x.className = 'hd-x-mark';
        x.textContent = '×';
        row.appendChild(x);
        scene.pointer.classList.add('show');
        pointTo(scene.stage, scene.pointer, row);
        await ctx.wait(500);
        x.classList.add('show');
        await ctx.wait(500);
        tapPointer(scene.pointer);
        row.classList.add('hd-exit');
        scene.pointer.classList.remove('show');
        await ctx.wait(450);
        row.remove();
        await ctx.tick(scene.count, COUNT_TO, COUNT_TO + 5, 450);
        await ctx.wait(350);
      },
    },
    {
      caption: 'That’s it — solve in 3-4 guesses on average!',
      async run(scene, ctx) {
        unspot(scene);
        const guess = scene.rows[1].tiles;
        for (let i = 0; i < 5; i++) { typeTile(guess, i, SOLVER_WORD[i]); await ctx.wait(120); }
        await ctx.wait(150);
        paintTile(guess, 1, 'y', SOLVER_WORD[1]);
        paintTile(guess, 3, 'g', SOLVER_WORD[3]);
        await ctx.wait(200);
        scene.rows[1].el.classList.add('committed');
        await ctx.wait(500);
        scene.hero.textContent = HERO_WORD;
        scene.count.textContent = '1 word';
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
      run(scene, ctx) { unspot(scene); return ctx.wait(2600); },
    },
    {
      caption: 'We pick a secret word — colors fill in automatically.',
      async run(scene, ctx) {
        spot(scene, 'center');
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
        spot(scene, 'center');
        const tiles = scene.rows[0].tiles;
        pulseTile(tiles[2]); showChip(scene.chip, 'green = right spot');
        await ctx.wait(750); hideChip(scene.chip);
        pulseTile(tiles[1]); showChip(scene.chip, 'yellow = wrong spot');
        await ctx.wait(750); hideChip(scene.chip);
        pulseTile(tiles[0]); showChip(scene.chip, 'gray = not in the word');
        await ctx.wait(750); hideChip(scene.chip);
        await ctx.wait(300);
      },
    },
    {
      caption: 'Stuck? The hint shares a letter with the answer.',
      async run(scene, ctx) {
        spot(scene, 'right');
        await ctx.wait(400);
        scene.cover.classList.add('hd-wiped');
        await ctx.wait(1400);
      },
    },
    {
      caption: 'Your stats grow with every game.',
      async run(scene, ctx) {
        spot(scene, 'right');
        for (const bar of scene.statBars) { bar.classList.add('fill'); await ctx.wait(180); }
        await ctx.wait(1300);
      },
    },
    {
      caption: 'Pick any day from the calendar to replay that Wordle.',
      async run(scene, ctx) {
        spot(scene, 'left');
        await ctx.wait(500);
        const day = scene.cal.children[10];
        day.classList.add('hd-picked');
        await ctx.wait(250);
        day.classList.add('hd-dot');
        await ctx.wait(1200);
      },
    },
    {
      caption: 'Refresh the page for a fresh random word.',
      async run(scene, ctx) {
        spot(scene, 'center');
        scene.refresh.classList.remove('spin');
        void scene.refresh.offsetWidth;
        scene.refresh.classList.add('spin');
        await ctx.wait(1600);
      },
    },
    {
      caption: 'Guess it in six — good luck!',
      async run(scene, ctx) {
        unspot(scene);
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

function setCaption(text) {
  captionEl.classList.remove('show');
  void captionEl.offsetWidth;
  captionEl.innerHTML = [...text].map((ch, i) =>
    `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
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
  unspot(scene);
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
    scene.cal.children[10].classList.add('hd-picked', 'hd-dot');
  } else {
    const tiles = scene.rows[0].tiles;
    for (let i = 0; i < 5; i++) { tiles[i].textContent = SOLVER_WORD[i]; }
    tiles[0].className = 'hd-tile n';
    tiles[1].className = 'hd-tile y';
    tiles[2].className = 'hd-tile pending';
    tiles[3].className = 'hd-tile g';
    tiles[4].className = 'hd-tile pending';
    scene.rows[0].el.classList.add('committed');
    scene.count.classList.add('show');
    scene.count.textContent = `${COUNT_TO.toLocaleString()} words`;
    scene.hero.textContent = HERO_WORD;
    scene.hero.classList.add('show');
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'hd-mini-row';
      scene.wordlist.appendChild(row);
    }
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'hd-mini-row';
      scene.past.appendChild(row);
    }
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
