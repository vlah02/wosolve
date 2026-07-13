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

function render() {
  const p = stats.practice;
  const max = Math.max(1, ...p.dist);
  document.getElementById('stats-content').innerHTML = `
    <div class="panel"><h5>Stats</h5>
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

function openModal() {
  let d = document.getElementById('stats-modal');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'stats-modal';
    document.body.appendChild(d);
  }
  d.innerHTML = document.getElementById('stats-content').innerHTML +
    '<button class="close-modal">Close</button>';
  d.querySelector('.close-modal').onclick = () => d.close();
  d.showModal();
}
