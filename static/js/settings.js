const KEY = 'wosolve.settings.v1';
const DEFAULTS = { skin: 'arcade', layout: 'column', theme: 'system', extended: false };
let settings = { ...DEFAULTS };

export function getSettings() { return { ...settings }; }

const media = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  return settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
}

function apply() {
  const h = document.documentElement;
  h.dataset.skin = settings.skin;
  h.dataset.layout = settings.layout;
  h.dataset.theme = resolvedTheme();
}

function set(k, v) {
  settings[k] = v;
  localStorage.setItem(KEY, JSON.stringify(settings));
  apply(); syncModal();
  document.dispatchEvent(new CustomEvent('wosolve:settings-changed', { detail: { key: k } }));
}

function syncModal() {
  document.querySelectorAll('#settings-modal .swatches').forEach(g => {
    g.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', settings[g.dataset.setting] === b.dataset.value));
  });
  document.getElementById('set-extended').checked = settings.extended;
}

export function initSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { settings = { ...DEFAULTS }; }
  apply();
  media.addEventListener('change', apply);
  document.getElementById('settings-btn').onclick = () => {
    syncModal(); document.getElementById('settings-modal').showModal();
  };
  document.querySelectorAll('#settings-modal .swatches button').forEach(b =>
    b.onclick = () => set(b.closest('.swatches').dataset.setting, b.dataset.value));
  document.getElementById('set-extended').onchange = e => set('extended', e.target.checked);
}
