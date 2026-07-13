const KEY = 'wosolve.settings.v1';
const DEFAULTS = { skin: 'arcade', theme: 'system', extended: false };
let settings = { ...DEFAULTS };

export function getSettings() { return { ...settings }; }

const media = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  return settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
}

function apply() {
  const h = document.documentElement;
  h.dataset.skin = settings.skin;
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
    g.querySelectorAll('button').forEach(b => {
      const on = settings[g.dataset.setting] === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  });
  document.getElementById('set-extended').checked = settings.extended;
}

// Merge only known keys from storage so stale settings from older builds
// (e.g. a removed 'layout' or 'hidePast' key) are dropped rather than
// resurrected into the live settings object.
export function initSettings() {
  settings = { ...DEFAULTS };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (k in stored) settings[k] = stored[k];
  } catch {}
  apply();
  media.addEventListener('change', apply);
  document.getElementById('settings-btn').onclick = () => {
    syncModal(); document.getElementById('settings-modal').showModal();
  };
  document.querySelectorAll('#settings-modal .swatches button').forEach(b =>
    b.onclick = () => set(b.closest('.swatches').dataset.setting, b.dataset.value));
  document.getElementById('set-extended').onchange = e => set('extended', e.target.checked);
}
