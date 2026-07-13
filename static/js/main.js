import { initUI, animateLogo } from './ui.js';
import { initSettings } from './settings.js';
import { initGame } from './game.js';
import { initDrawer } from './drawer.js';
import { initStats } from './stats.js';
import { initCelebrate } from './celebrate.js';

async function fetchLists() {
  const [a, e] = await Promise.all([
    fetch('/static/data/answers.json'), fetch('/static/data/extended.json')]);
  if (!a.ok || !e.ok) throw new Error('word list fetch failed');
  let freq = {};
  try {
    const f = await fetch('/static/data/freq.json');
    if (f.ok) freq = await f.json();
  } catch {}
  return { answers: await a.json(), extended: await e.json(), freq };
}

async function boot() {
  initSettings();
  let lists;
  try { lists = await fetchLists(); }
  catch {
    document.querySelector('#board-zone').innerHTML =
      '<div class="panel">Could not load word lists. <button class="count-chip" onclick="location.reload()">Retry</button></div>';
    return;
  }
  initGame(lists, initUI);
  initStats();
  initDrawer();
  initCelebrate();
  animateLogo();

  setInterval(() => {
    if (document.hidden) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animateLogo();
  }, 90000);

  // 15-click dog easter egg (preserved)
  let clicks = 0;
  const gif = document.getElementById('movingGif');
  document.getElementById('logo').addEventListener('click', () => {
    if (++clicks < 15 || gif.style.display === 'block') return;
    gif.style.display = 'block';
    let x = 40, y = 40, vx = 2, vy = 2;
    (function move() {
      x += vx; y += vy;
      if (x + 100 >= innerWidth || x <= 0) vx *= -1;
      if (y + 100 >= innerHeight || y <= 0) vy *= -1;
      gif.style.left = x + 'px'; gif.style.top = y + 'px';
      requestAnimationFrame(move);
    })();
  });
}
boot();
