import { animateLogo } from './ui.js';

export function initCelebrate() {
  document.addEventListener('wosolve:solved', () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const skin = document.documentElement.dataset.skin;
    if (skin === 'arcade') confetti();
    else if (skin === 'signal') glowPulse();
    else animateLogo();
  });
}

function glowPulse() {
  const b = document.getElementById('board');
  b.classList.remove('glow-pulse'); void b.offsetWidth;
  b.classList.add('glow-pulse');
}

function confetti() {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60';
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const colors = ['#58cc7a', '#ffc94d', '#7cc4ff', '#ff8fa3'];
  const parts = Array.from({ length: 120 }, () => ({
    x: innerWidth / 2, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 3,
    s: Math.random() * 6 + 4, r: Math.random() * Math.PI,
    col: colors[Math.floor(Math.random() * colors.length)] }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6);
      ctx.restore();
    }
    if (++frames < 130) requestAnimationFrame(tick); else c.remove();
  })();
}
