// Themed in-panel "play a day" calendar. Renders into #play-day-calendar
// (practice-mode left panel) in place of the old native <input type="date">.
// Pure DOM/vanilla — no dependency on game.js beyond the onPick callback it
// is handed at init time.

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

let state = null;

const pad = n => String(n).padStart(2, '0');
// Parsed/formatted as local calendar dates (not UTC) so "YYYY-MM-DD" strings
// round-trip exactly regardless of the browser's timezone offset.
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Initializes the calendar. `min`/`max` are 'YYYY-MM-DD' strings bounding
// pickable dates; `playedDates` is a { 'YYYY-MM-DD': 'won'|'lost' } map;
// `selected` (optional) is the date string of the currently-loaded dated
// game, if any. Default view is the month containing `max`.
export function initCalendar({ min, max, onPick, playedDates = {}, selected = null }) {
  const maxD = parseDate(max);
  state = { min, max, onPick, playedDates, selected,
    viewYear: maxD.getFullYear(), viewMonth: maxD.getMonth() };
  render();
}

// Patches playedDates/selected without resetting the current month view.
export function refreshCalendar({ playedDates, selected } = {}) {
  if (!state) return;
  if (playedDates) state.playedDates = playedDates;
  if (selected !== undefined) state.selected = selected;
  render();
}

function navigate(delta) {
  const minD = parseDate(state.min), maxD = parseDate(state.max);
  let m = state.viewMonth + delta, y = state.viewYear;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  if (y < minD.getFullYear() || (y === minD.getFullYear() && m < minD.getMonth())) {
    y = minD.getFullYear(); m = minD.getMonth();
  }
  if (y > maxD.getFullYear() || (y === maxD.getFullYear() && m > maxD.getMonth())) {
    y = maxD.getFullYear(); m = maxD.getMonth();
  }
  state.viewYear = y; state.viewMonth = m;
  render();
}

function render() {
  const container = document.getElementById('play-day-calendar');
  if (!container || !state) return;

  const minD = parseDate(state.min);
  const maxD = parseDate(state.max);
  const { viewYear, viewMonth } = state;
  const atMinMonth = viewYear === minD.getFullYear() && viewMonth === minD.getMonth();
  const atMaxMonth = viewYear === maxD.getFullYear() && viewMonth === maxD.getMonth();

  const first = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7; // Monday-first offset

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d));
  while (cells.length < 42) cells.push(null); // fixed 6-row grid

  const dayHtml = cells.map(d => {
    if (!d) return '<div class="cal-day cal-outside" aria-hidden="true"></div>';
    const dateStr = formatDate(d);
    const disabled = d < minD || d > maxD;
    const isMax = dateStr === state.max;
    const isSelected = state.selected === dateStr;
    const played = state.playedDates[dateStr];
    const classes = ['cal-day'];
    if (disabled) classes.push('cal-disabled');
    if (isMax && !isSelected) classes.push('cal-today');
    if (played) classes.push('cal-played', played === 'won' ? 'cal-won' : 'cal-lost');
    if (isSelected) classes.push('cal-selected');
    return `<button type="button" class="${classes.join(' ')}" data-date="${dateStr}"
        ${disabled ? 'disabled' : ''} aria-label="Play the Wordle from ${dateStr}" aria-pressed="${isSelected}">
        <span class="cal-num">${d.getDate()}</span>${played ? '<span class="cal-dot" aria-hidden="true"></span>' : ''}
      </button>`;
  }).join('');

  container.innerHTML = `
    <div class="cal-header">
      <button type="button" class="cal-nav cal-prev" aria-label="Previous month" ${atMinMonth ? 'disabled' : ''}>&lsaquo;</button>
      <span class="cal-label">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
      <button type="button" class="cal-nav cal-next" aria-label="Next month" ${atMaxMonth ? 'disabled' : ''}>&rsaquo;</button>
    </div>
    <div class="cal-weekdays">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${dayHtml}</div>
  `;

  container.querySelector('.cal-prev')?.addEventListener('click', () => navigate(-1));
  container.querySelector('.cal-next')?.addEventListener('click', () => navigate(1));
  container.querySelectorAll('.cal-day[data-date]').forEach(btn => {
    btn.addEventListener('click', () => state.onPick(btn.dataset.date));
  });
}
