const $ = s => document.querySelector(s);
let tab = 'words', lastSuggestHtml = '';

export function initDrawer() {
  const drawer = $('#drawer');
  drawer.hidden = false; // visibility is controlled by layouts.css
  let startY = null, startH = 0, dragged = false;
  const grip = $('#drawer-grip');
  grip.onclick = () => {
    if (dragged) { dragged = false; return; }
    cycleSnap();
  };
  grip.addEventListener('pointerdown', e => {
    startY = e.clientY; startH = drawer.offsetHeight;
    dragged = false;
    grip.setPointerCapture(e.pointerId);
    drawer.style.transition = 'none';
  });
  grip.addEventListener('pointermove', e => {
    if (startY === null) return;
    if (Math.abs(startY - e.clientY) > 5) dragged = true;
    drawer.style.height = Math.max(92, Math.min(innerHeight * .82, startH + (startY - e.clientY))) + 'px';
  });
  grip.addEventListener('pointerup', () => {
    drawer.style.transition = '';
    const h = drawer.offsetHeight;
    drawer.style.height = '';
    drawer.classList.remove('half', 'full');
    if (h > innerHeight * .6) drawer.classList.add('full');
    else if (h > innerHeight * .25) drawer.classList.add('half');
    startY = null;
  });
  document.querySelectorAll('#drawer-tabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#drawer-tabs button').forEach(x =>
      x.classList.toggle('on', x === b));
    if (!drawer.classList.contains('half') && !drawer.classList.contains('full'))
      drawer.classList.add('half');
    renderTab();
  });
  document.addEventListener('wosolve:suggestions', e => {
    lastSuggestHtml = e.detail.html;
    if (tab === 'words') renderTab();
  });
  document.addEventListener('wosolve:stats-changed', () => {
    if (tab === 'stats') renderTab();
  });
  document.addEventListener('wosolve:mode-changed', e => {
    if (e.detail.mode === 'solver' && tab === 'stats') {
      tab = 'words';
      document.querySelectorAll('#drawer-tabs button').forEach(x =>
        x.classList.toggle('on', x.dataset.tab === 'words'));
      renderTab();
    }
  });
  lastSuggestHtml = $('#suggest-content').innerHTML;
  if (tab === 'words') renderTab();
}

function cycleSnap() {
  const d = $('#drawer');
  if (d.classList.contains('full')) d.classList.remove('full', 'half');
  else if (d.classList.contains('half')) { d.classList.remove('half'); d.classList.add('full'); }
  else d.classList.add('half');
}

function renderTab() {
  const body = $('#drawer-body');
  if (tab === 'words') body.innerHTML = lastSuggestHtml;
  else if (tab === 'stats') body.innerHTML = $('#stats-content').innerHTML;
  else body.innerHTML = $('#help-modal').innerHTML.replace(/<button[^>]*close-modal[^>]*>.*?<\/button>/, '');
}
