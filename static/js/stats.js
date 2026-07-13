const KEY = 'wosolve.stats.v1';
const FRESH = { practice: { played: 0, won: 0, dist: [0, 0, 0, 0, 0, 0], streak: 0, best: 0 },
                solver: { solved: 0 } };
let stats;

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.practice) return s; }
  catch {}
  return structuredClone(FRESH);
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch {} };

export function initStats() {
  stats = load();
  document.addEventListener('wosolve:solved', e => {
    if (e.detail.mode === 'practice') {
      stats.practice.played++; stats.practice.won++;
      stats.practice.dist[Math.min(e.detail.guesses, 6) - 1]++;
      stats.practice.streak++;
      stats.practice.best = Math.max(stats.practice.best, stats.practice.streak);
    } else stats.solver.solved++;
    save(); render();
  });
  document.addEventListener('wosolve:lost', () => {
    stats.practice.played++; stats.practice.streak = 0;
    save(); render();
  });
  document.getElementById('stats-btn').onclick = openModal;
  render();
}

// Unwrapped content for #stats-content: this element is reused verbatim by the
// panes side-panel and the drawer's "Stats" tab. Panel chrome (background/border)
// is applied contextually in CSS (#side-panel .stats-body) rather than baked in
// here, so it doesn't double up when the drawer/dialog already frame it.
function render() {
  const p = stats.practice;
  const max = Math.max(1, ...p.dist);
  document.getElementById('stats-content').innerHTML = `
    <div class="stats-body"><h5>Stats</h5>
      <div class="stat-chips">
        <span class="count-chip">played ${p.played}</span>
        <span class="count-chip">win ${p.played ? Math.round(p.won / p.played * 100) : 0}%</span>
        <span class="count-chip">streak ${p.streak}</span>
        <span class="count-chip">best ${p.best}</span>
        <span class="count-chip">solver wins ${stats.solver.solved}</span>
      </div>
      <div class="dist">${p.dist.map((n, i) =>
        `<div class="drow"><span>${i + 1}</span><span class="dbar"><i style="width:${n / max * 100}%"></i></span><b>${n}</b></div>`).join('')}
      </div></div>`;
  document.dispatchEvent(new CustomEvent('wosolve:stats-changed'));
}

// The dialog gets its own richer layout (stat grid + divider + labeled
// distribution) rather than cloning #stats-content, so it never nests a
// panel-in-a-panel inside the already-panel-styled <dialog>.
function modalHtml() {
  const p = stats.practice;
  const max = Math.max(1, ...p.dist);
  const winPct = p.played ? Math.round(p.won / p.played * 100) : 0;
  return `
    <h3>Statistics</h3>
    <div class="stat-grid">
      <div class="stat-cell"><b>${p.played}</b><span>Played</span></div>
      <div class="stat-cell"><b>${winPct}%</b><span>Win %</span></div>
      <div class="stat-cell"><b>${p.streak}</b><span>Streak</span></div>
      <div class="stat-cell"><b>${p.best}</b><span>Best</span></div>
    </div>
    <div class="stat-divider"></div>
    <h5 class="section-label">Guess distribution</h5>
    <div class="dist dist-modal">${p.dist.map((n, i) =>
      `<div class="drow"><span>${i + 1}</span><span class="dbar"><i style="width:${n / max * 100}%"></i></span><b>${n}</b></div>`).join('')}
    </div>
    <p class="stats-footnote">Solver puzzles cracked: ${stats.solver.solved}</p>`;
}

function openModal() {
  let d = document.getElementById('stats-modal');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'stats-modal';
    document.body.appendChild(d);
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  d.innerHTML = '<div class="dialog-body">' + modalHtml() +
    '<button class="close-modal">Close</button></div>';
  d.querySelector('.close-modal').onclick = () => d.close();
  d.showModal();
}
