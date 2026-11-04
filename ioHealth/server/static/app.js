/* ioHealth, the web app: a small single-page app over the receiver's /api. No build step; uPlot draws the charts and
   Leaflet the maps. Pages are hash routes (#/workouts, #/workout/<uuid>, #/metrics?types=…). */
'use strict';

// ---------- basics ----------

const $ = (sel, el = document) => el.querySelector(sel);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DAY = 86400;
// Axis steps for values in minutes, so ticks land on whole hours.
const MINUTE_INCRS = [15, 30, 60, 120, 180, 240, 360, 600, 1200, 1800, 3000, 6000, 12000];

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svgNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ---------- the menu: a sidebar with the pages in groups, Settings and Maintenance at the foot (as in iopix) ----------

const ICONS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z',
  chart: 'M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z',
  scatter: 'M7 10c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm8.01 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-.01-3c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z',
  run: 'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z',
  map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
  trophy: 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',
  bed: 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z',
  drop: 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  wrench: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  menuOpen: 'M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  spark: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
};
function icon(name) {
  const el = h('span', { class: 'ic' });
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONS[name] || ''}"/></svg>`;
  return el;
}
for (const el of document.querySelectorAll('.ic[data-ic]')) el.innerHTML = icon(el.dataset.ic).innerHTML;

// The pages, in the sidebar's order: [page, label, icon, hue]. A gap and a heading start each group; Settings and
// Maintenance (admins) sit at the foot. On phones the bottom bar shows the first four and the rest open from More.
const NAV = [
  ['dashboard', 'Dashboard', 'dashboard', 'purple'], ['day', 'Day', 'calendar', 'amber'], ['metrics', 'Metrics', 'chart', 'blue'], ['workouts', 'Workouts', 'run', 'orange'],
  ['correlations', 'Correlations', 'scatter', 'teal'], ['map', 'Map', 'map', 'cyan'], ['records', 'Records', 'trophy', 'green'],
  ['sleep', 'Sleep', 'bed', 'indigo'], ['glucose', 'Glucose', 'drop', 'rose'],
];
const NAV_GROUPS = { correlations: 'Analysis', sleep: 'Health' };  // the first page of each group after the first
const NAV_FOOT = [['settings', 'Settings', 'gear', 'slate'], ['maintenance', 'Maintenance', 'wrench', 'slate']];
const PHONE_BAR = ['dashboard', 'day', 'metrics', 'workouts'];
const navHue = page => [...NAV, ...NAV_FOOT].find(n => n[0] === page)?.[3] || 'slate';
const navLink = ([page, label, ic]) => h('a', { href: page === 'dashboard' ? '#/' : `#/${page}`, 'data-page': page }, icon(ic), h('span', { class: 'nl' }, label));
const pageTitle = (ic, hue, ...kids) => h('h1', { class: 'ptitle', style: { '--hue': `var(--c-${hue})` } }, h('span', { class: 'pic' }, icon(ic)), ...kids);

function buildNav() {
  const nav = $('#nav');
  nav.replaceChildren(
    h('div', { class: 'navhead' }, h('a', { class: 'brand', href: '#/', title: 'Dashboard' }, h('img', { src: 'favicon.svg', alt: '', width: 24, height: 24 }),
      h('span', { class: 'brand-name' }, h('span', { class: 'io' }, 'io'), h('span', { class: 'nm' }, 'Health'))), h('button', { id: 'sidebtn', class: 'iconbtn' })),
    ...NAV.flatMap(n => [NAV_GROUPS[n[0]] ? [h('div', { class: 'navgap' }), h('div', { class: 'navsec' }, NAV_GROUPS[n[0]])] : null, navLink(n)]).flat().filter(Boolean),
    h('button', { class: 'navmore', 'data-page': 'more', title: 'More', onclick: moreSheet }, icon('more'), 'More'),
    h('div', { class: 'navfoot' }, ...NAV_FOOT.map(navLink), h('div', { class: 'ver', id: 'nav-version' })));
  initSidebar();
}

/** The sidebar docks beside the page on a wide screen, unless its button put it away (remembered). Put away, or on
 *  a narrower screen, it hides off the left edge and the menu button in the top bar slides it over the page; choosing
 *  a page, the dimmed page or Escape puts it away again. Phones keep the bottom bar instead. */
function initSidebar() {
  const body = document.body, btn = $('#sidebtn'), DOCK_MIN = 1100, KEY = 'iohealth.sidebar';
  const pref = () => { try { return localStorage.getItem(KEY) || '1'; } catch { return '1'; } };
  const canDock = () => innerWidth >= DOCK_MIN;
  const setOpen = on => { body.classList.toggle('side-open', on); $('#navscrim').hidden = !on; };
  const apply = () => {
    const docked = canDock() && pref() === '1';
    body.classList.toggle('side-docked', docked);
    if (docked) setOpen(false);
    const [ic, title] = docked ? ['menuOpen', 'Hide the sidebar'] : canDock() ? ['pin', 'Keep the sidebar open'] : ['close', 'Close the sidebar'];
    btn.replaceChildren(icon(ic)); btn.title = title; btn.setAttribute('aria-label', title);
  };
  btn.onclick = () => {
    try { if (body.classList.contains('side-docked')) localStorage.setItem(KEY, '0'); else if (canDock()) localStorage.setItem(KEY, '1'); else { setOpen(false); return; } } catch { /* private mode */ }
    apply();
  };
  $('#menubtn').onclick = () => setOpen(true);
  $('#navscrim').onclick = () => setOpen(false);
  $('#nav').addEventListener('click', e => { if (e.target.closest('a') && !body.classList.contains('side-docked')) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && body.classList.contains('side-open')) { setOpen(false); e.stopPropagation(); } }, true);
  addEventListener('resize', apply);
  apply();
}

/** Phones: the bottom bar shows four pages; the rest, with Settings and Maintenance, open from More. */
function moreSheet() {
  const current = route().page === 'workout' ? 'workouts' : route().page;
  const rest = [...NAV.filter(n => !PHONE_BAR.includes(n[0]) && !$(`#nav a[data-page="${n[0]}"]`)?.hidden), NAV_FOOT[0], ...(isAdmin() ? [NAV_FOOT[1]] : [])];
  let close;
  const grid = h('div', { class: 'sheetgrid' }, rest.map(([page, label, ic, hue]) => h('a', { href: `#/${page}`, class: current === page ? 'on' : '', style: { '--hue': `var(--c-${hue})` }, onclick: () => close() },
    h('span', { class: 'sic' }, icon(ic)), label)));
  const d = dialog('More', grid, [{ label: 'Close' }]);
  close = () => document.querySelector('.scrim:last-of-type')?.remove();
  return d;
}

function setNavOn(page) {
  const inBar = !!$(`#nav a[data-page="${page}"]`);
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.page === page);
  $('#nav .navmore')?.classList.toggle('on', !inBar || (!PHONE_BAR.includes(page) && innerWidth <= 800));
}

const settings = (() => {
  const defaults = { units: 'metric', maxHr: '', theme: 'auto', glucoseUnit: '', glucoseLow: '70', glucoseHigh: '180', hiddenSections: [], hiddenTypes: [] };
  try { return Object.assign(defaults, JSON.parse(localStorage.getItem('iohealth.settings') || '{}')); } catch { return defaults; }
})();
// Settings live in the database (web_settings), shared by every browser; the copy in localStorage only makes the
// theme right before the server answers.
let settingsTimer;
function saveSettings() {
  try { localStorage.setItem('iohealth.settings', JSON.stringify(settings)); } catch { /* private mode */ }
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => fetch('api/settings', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings) }).catch(e => console.error('saving settings', e)), 300);
}
async function loadSettings() {
  try {
    const r = await fetch('api/settings', { credentials: 'same-origin' });
    if (r.status === 401) { signIn(true); return; }
    const stored = await r.json();
    if (Object.keys(stored).length) Object.assign(settings, stored);
    else saveSettings(); // first run: keep what this browser had
  } catch (e) { console.error('loading settings', e); }
}
function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
applyTheme();

const apiCache = new Map();
let inflight = 0;
// whenIdle resolves once no API request has been running for a moment (the page has drawn what it loads).
async function whenIdle(quiet = 400, max = 15000) {
  const end = Date.now() + max;
  let calm = 0;
  while (Date.now() < end && calm < quiet) { await new Promise(r => setTimeout(r, 50)); calm = inflight ? 0 : calm + 50; }
}
async function api(path, params = {}, { cache = true } = {}) {
  const q = new URLSearchParams({ ...params, tz: TZ });
  if (settings.maxHr) q.set('maxHr', settings.maxHr);
  const url = 'api/' + path + '?' + q;
  if (cache && apiCache.has(url)) {
    const hit = apiCache.get(url);
    if (Date.now() - hit.at < 60000) return hit.promise;
  }
  inflight++;
  const promise = fetch(url, { credentials: 'same-origin' }).then(async r => {
    if (r.status === 401) { signIn(true); throw new Error('not signed in'); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || body.detail || r.statusText);
    return body;
  }).finally(() => { inflight--; });
  apiCache.set(url, { at: Date.now(), promise });
  promise.catch(() => apiCache.delete(url));
  return promise;
}

// ---------- formatting ----------

const nf = {};
function fmtNum(v, dec = 0) {
  if (v == null || !isFinite(v)) return '—';
  const k = dec;
  nf[k] ||= new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return nf[k].format(v);
}
function fmtCompact(v) {
  if (v == null || !isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v / 1e6, 1) + 'M';
  if (a >= 1e4) return fmtNum(v / 1e3, 0) + 'k';
  if (a >= 100) return fmtNum(v, 0);
  if (a >= 10) return fmtNum(v, 1).replace(/\.0$/, '');
  return fmtNum(v, 2).replace(/\.?0+$/, '');
}
function fmtDuration(sec, short = false) {
  if (sec == null || !isFinite(sec)) return '—';
  sec = Math.round(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
  if (short) return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
function fmtHM(minutes) {
  if (minutes == null || !isFinite(minutes)) return '—';
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtDate = t => t == null ? '—' : dateFmt.format(new Date(t * 1000));
const fmtDateShort = t => dateShortFmt.format(new Date(t * 1000));
const fmtDateTime = t => dateTimeFmt.format(new Date(t * 1000));
const fmtTime = t => timeFmt.format(new Date(t * 1000));
// 'today', 'yesterday', or the date (with the year when it isn't this year).
function fmtDayAgo(t) {
  const d = new Date(t * 1000), day = isoDate(d);
  if (day === today()) return 'today';
  if (day === daysAgo(1)) return 'yesterday';
  return d.getFullYear() === new Date().getFullYear() ? fmtDateShort(t) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtAgo(t) {
  const d = Date.now() / 1000 - t;
  if (d < 90) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} days ago`;
}
function isoDate(d) { // local yyyy-mm-dd
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
const today = () => isoDate(new Date());

const imperial = () => settings.units === 'imperial';
function fmtDist(m, dec) {
  if (m == null) return '—';
  if (imperial()) return fmtNum(m / 1609.344, dec ?? 2) + ' mi';
  return m < 1000 && dec == null ? fmtNum(m, 0) + ' m' : fmtNum(m / 1000, dec ?? 2) + ' km';
}
function distParts(m) {
  return imperial() ? [fmtNum(m / 1609.344, 2), 'mi'] : [fmtNum(m / 1000, 2), 'km'];
}
function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return '—';
  const v = imperial() ? secPerKm * 1.609344 : secPerKm;
  return fmtDuration(v) + (imperial() ? ' /mi' : ' /km');
}
function fmtSpeed(mps) {
  if (mps == null) return '—';
  return imperial() ? fmtNum(mps * 2.236936, 1) + ' mph' : fmtNum(mps * 3.6, 1) + ' km/h';
}
const fmtElev = m => m == null ? '—' : imperial() ? fmtNum(m * 3.28084, 0) + ' ft' : fmtNum(m, 0) + ' m';
const fmtKcal = k => k == null ? '—' : fmtNum(k, 0) + ' kcal';

// ---------- health types ----------

const TYPES = {
  step_count: ['Steps', 0], distance_walking_running: ['Walking + running distance', 2], distance_cycling: ['Cycling distance', 1],
  distance_swimming: ['Swimming distance', 0], active_energy_burned: ['Active energy', 0], basal_energy_burned: ['Resting energy', 0],
  apple_exercise_time: ['Exercise minutes', 0], apple_stand_time: ['Stand minutes', 0], apple_move_time: ['Move minutes', 0],
  flights_climbed: ['Flights climbed', 0], heart_rate: ['Heart rate', 0], resting_heart_rate: ['Resting heart rate', 0],
  walking_heart_rate_average: ['Walking heart rate', 0], heart_rate_variability_sdnn: ['Heart rate variability', 0],
  heart_rate_recovery_one_minute: ['Cardio recovery', 0], vo2_max: ['VO₂ max', 1], body_mass: ['Weight', 1],
  body_mass_index: ['Body mass index', 1], body_fat_percentage: ['Body fat', 1], lean_body_mass: ['Lean body mass', 1],
  height: ['Height', 0], waist_circumference: ['Waist', 1], oxygen_saturation: ['Blood oxygen', 1], respiratory_rate: ['Respiratory rate', 1],
  body_temperature: ['Body temperature', 1], apple_sleeping_wrist_temperature: ['Wrist temperature', 2],
  blood_pressure_systolic: ['Blood pressure (systolic)', 0], blood_pressure_diastolic: ['Blood pressure (diastolic)', 0],
  blood_glucose: ['Blood glucose', 0], insulin_delivery: ['Insulin', 1], walking_speed: ['Walking speed', 2], walking_step_length: ['Step length', 0],
  walking_asymmetry_percentage: ['Walking asymmetry', 1], walking_double_support_percentage: ['Double support time', 1],
  apple_walking_steadiness: ['Walking steadiness', 0], six_minute_walk_test_distance: ['Six-minute walk', 0],
  stair_ascent_speed: ['Stair speed up', 2], stair_descent_speed: ['Stair speed down', 2], running_speed: ['Running speed', 2],
  running_power: ['Running power', 0], running_stride_length: ['Stride length', 2], running_vertical_oscillation: ['Vertical oscillation', 1],
  running_ground_contact_time: ['Ground contact time', 0], cycling_power: ['Cycling power', 0], cycling_cadence: ['Cycling cadence', 0],
  cycling_speed: ['Cycling speed', 1], cycling_functional_threshold_power: ['Cycling FTP', 0], physical_effort: ['Physical effort', 1],
  time_in_daylight: ['Time in daylight', 0], environmental_audio_exposure: ['Environmental sound', 0],
  headphone_audio_exposure: ['Headphone audio', 0], sleep_analysis: ['Sleep', 1], mindful_session: ['Mindful minutes', 0],
  apple_stand_hour: ['Stand hours', 0], dietary_energy_consumed: ['Dietary energy', 0], dietary_water: ['Water', 0],
  dietary_caffeine: ['Caffeine', 0], dietary_carbohydrates: ['Carbohydrates', 0], dietary_sugar: ['Sugar', 0], dietary_fiber: ['Fiber', 0], dietary_protein: ['Protein', 0], number_of_alcoholic_beverages: ['Alcoholic drinks', 0],
  uv_exposure: ['UV index', 0], swimming_stroke_count: ['Swimming strokes', 0], push_count: ['Wheelchair pushes', 0],
  underwater_depth: ['Underwater depth', 1], water_temperature: ['Water temperature', 1], workout_effort_score: ['Workout effort', 1],
  atrial_fibrillation_burden: ['AFib history', 1], electrodermal_activity: ['Electrodermal activity', 2],
  activity_move: ['Move ring', 0], activity_move_goal: ['Move goal', 0], activity_move_percent: ['Move ring % of goal', 0],
  activity_exercise: ['Exercise ring', 0], activity_exercise_goal: ['Exercise goal', 0], activity_exercise_percent: ['Exercise ring % of goal', 0],
  activity_stand: ['Stand ring', 0], activity_stand_goal: ['Stand goal', 0], activity_stand_percent: ['Stand ring % of goal', 0],
};
const typeLabel = t => TYPES[t]?.[0] || t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const typeDec = (t, unit) => /^mmol/i.test(unit || '') ? 1 : TYPES[t]?.[1] ?? 1;
const PRETTY_UNITS = { 'count/min': 'bpm', count: '', degC: '°C', degF: '°F', dBASPL: 'dB', 'mL/kg·min': 'mL/kg/min', 'mL/min·kg': 'mL/kg/min', 'ml/(kg*min)': 'mL/kg/min',
  'mL/(kg·min)': 'mL/kg/min', 'kcal/hr·kg': 'kcal/h/kg', 'kcal/(kg*hr)': 'kcal/h/kg', mmHg: 'mmHg', 'mg/dL': 'mg/dL', 'm/s': 'm/s' };
const prettyUnit = u => u == null ? '' : /^mmol</i.test(u) ? 'mmol/L' : (u in PRETTY_UNITS ? PRETTY_UNITS[u] : u);
// HealthKit percentages are fractions; show them out of 100.
const scaleFor = unit => unit === '%' ? 100 : 1;

const COMMON_TYPES = ['blood_glucose', 'step_count', 'active_energy_burned', 'apple_exercise_time', 'distance_walking_running', 'flights_climbed',
  'heart_rate', 'resting_heart_rate', 'heart_rate_variability_sdnn', 'walking_heart_rate_average', 'vo2_max', 'body_mass',
  'body_fat_percentage', 'oxygen_saturation', 'respiratory_rate', 'apple_sleeping_wrist_temperature', 'time_in_daylight',
  'walking_speed', 'running_power'];

const ACTIVITY_NAMES = { highIntensityIntervalTraining: 'HIIT', traditionalStrengthTraining: 'Strength training',
  functionalStrengthTraining: 'Functional strength', mixedCardio: 'Mixed cardio', crossTraining: 'Cross training',
  preparationAndRecovery: 'Recovery', mindAndBody: 'Mind & body', swimBikeRun: 'Multisport', stairClimbing: 'Stair climbing',
  coreTraining: 'Core training', cardioDance: 'Dance', socialDance: 'Social dance', wheelchairWalkPace: 'Wheelchair walk',
  wheelchairRunPace: 'Wheelchair run', other: 'Other' };
const activityName = a => ACTIVITY_NAMES[a] || (a || 'Workout').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const ACTIVITY_COLORS = { running: '#e8445a', walking: '#16a34a', hiking: '#65a30d', cycling: '#2563eb', swimming: '#06b6d4',
  traditionalStrengthTraining: '#8b5cf6', functionalStrengthTraining: '#a855f7', highIntensityIntervalTraining: '#f97316',
  yoga: '#db2777', rowing: '#0ea5e9', elliptical: '#f59e0b', mixedCardio: '#ef4444', coreTraining: '#c026d3' };
const PALETTE = ['#e8445a', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#06b6d4', '#db2777', '#65a30d', '#f97316', '#0f766e'];
function activityColor(a) {
  if (ACTIVITY_COLORS[a]) return ACTIVITY_COLORS[a];
  let x = 0;
  for (const c of a || '') x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}
const paceSports = new Set(['running', 'walking', 'hiking', 'wheelchairRunPace', 'wheelchairWalkPace', 'trackAndField']);

// ---------- page lifecycle ----------

let cleanups = [];
function onCleanup(f) { cleanups.push(f); }
function resetPage() { for (const f of cleanups.splice(0)) { try { f(); } catch (e) { console.error(e); } } }

function loading(el) { el.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); }
function showError(el, e) { el.replaceChildren(h('p', { class: 'error' }, 'Could not load: ' + e.message)); console.error(e); }
function empty(msg) { return h('div', { class: 'empty' }, msg); }

const tip = h('div', { class: 'tip', hidden: true });
document.body.append(tip);
function showTip(e, text) { tip.textContent = text; tip.hidden = false; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; }
function hideTip() { tip.hidden = true; }

// ---------- charts ----------

function observeWidth(el, f) {
  const ro = new ResizeObserver(() => f(el.clientWidth));
  ro.observe(el);
  onCleanup(() => ro.disconnect());
}

/* chart draws a uPlot time series.
   series: [{label, color, unit, dec, bars, scale, values, fill, dash, points, value(fmt)}]; data = [xs, ...values]. */
/* Unless zoom is false (the caller attaches its own zoomGroup), every chart gets drag to pan, wheel/pinch to zoom and
   Shift-drag to zoom, kept within its data; charts sharing a sync key move together. */
const autoGroups = new Map();
// A line on a time axis stops wherever the samples stop: a hole much longer than the usual spacing between
// samples (and at least 30 minutes) is left empty instead of being bridged by a straight line.
const gapCache = new WeakMap();
function gapLimit(xs, ys) {
  let c = gapCache.get(ys);
  if (c && c.xs === xs) return c.limit;
  const d = [];
  let prev = -1;
  for (let i = 0; i < ys.length; i++) if (ys[i] != null) { if (prev >= 0) d.push(xs[i] - xs[prev]); prev = i; }
  d.sort((a, b) => a - b);
  const limit = Math.max(1800, 2.5 * (d.length ? d[d.length >> 1] : 0));
  gapCache.set(ys, { xs, limit });
  return limit;
}
function sampleGaps(u, sidx, idx0, idx1, nullGaps) {
  const xs = u.data[0], ys = u.data[sidx], limit = gapLimit(xs, ys), px = x => Math.round(u.valToPos(x, 'x', true));
  const gaps = [...nullGaps];
  let prev = -1;
  for (let i = Math.max(0, idx0 - 1); i <= Math.min(ys.length - 1, idx1 + 1); i++) {
    if (ys[i] == null) continue;
    if (prev >= 0 && xs[i] - xs[prev] > limit) gaps.push([px(xs[prev]), px(xs[i])]);
    prev = i;
  }
  return gaps.sort((a, b) => a[0] - b[0]);
}
// A sample with no neighbour on either side would vanish once the line breaks, so it gets a dot.
function lonePoints(u, sidx, show) {
  if (show) return null;
  const xs = u.data[0], ys = u.data[sidx], limit = gapLimit(xs, ys), out = [];
  const idx = [];
  for (let i = 0; i < ys.length; i++) if (ys[i] != null) idx.push(i);
  idx.forEach((i, k) => {
    const a = k ? xs[i] - xs[idx[k - 1]] : Infinity, b = k < idx.length - 1 ? xs[idx[k + 1]] - xs[i] : Infinity;
    if (a > limit && b > limit) out.push(i);
  });
  return out.length ? out : null;
}

function chart(el, { xs, series, height = 240, sync, xTime = true, xRange, xFmt, xIncrs, xSpace, bands, legend = true, yRange, hooks, axisFmt, incrs, zoom = true }) {
  const muted = cssVar('--muted'), line = cssVar('--line');
  const scales = { x: { time: xTime } };
  const axes = [{ stroke: muted, grid: { stroke: line, width: 1 }, ticks: { stroke: line }, values: xFmt, incrs: xIncrs }];
  if (xSpace) axes[0].space = xSpace; // an undefined space would replace uPlot's default and drop every label
  const useries = [{ label: xTime ? 'Time' : '', value: xTime ? (u, v) => v == null ? '' : fmtDateTime(v) : (u, v) => v == null ? '' : (xFmt ? xFmt(u, [v])[0] : v) }];
  const seen = [];
  for (const sr of series) {
    const sc = sr.scale || 'y';
    if (!scales[sc]) {
      const n = seen.push(sc);
      scales[sc] = { auto: true, dir: sr.invert ? -1 : 1 };
      if (yRange || sr.bars || sr.zero) scales[sc].range = yRange || ((u, mn, mx) => [Math.min(0, mn ?? 0), (mx ?? 1) > 0 ? mx * 1.08 : 1]);
      axes.push({
        scale: sc, side: n % 2 ? 3 : 1, stroke: seen.length > 1 || series.length > 1 ? (sr.axisColor || sr.color) : muted,
        grid: { show: n === 1, stroke: line, width: 1 }, ticks: { stroke: line }, size: 60, incrs: sr.incrs || (n === 1 ? incrs : undefined),
        values: (u, vals) => vals.map(v => (sr.axisFmt || axisFmt || fmtCompact)(v)),
      });
    }
    useries.push({
      label: sr.label, stroke: sr.color, scale: sc, width: sr.bars ? 0 : (sr.width ?? 2), dash: sr.dash,
      fill: sr.bars ? (sr.fill || sr.color) : sr.fill, spanGaps: sr.bars ? true : xTime ? false : sr.spanGaps ?? true, show: sr.show ?? true,
      paths: sr.bars ? uPlot.paths.bars({ size: [0.75, sr.barMax || 48], align: 1 }) : sr.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined,
      points: { show: sr.points ?? false, size: 5, fill: sr.color, filter: !sr.bars && xTime ? lonePoints : undefined },
      gaps: !sr.bars && xTime ? sampleGaps : undefined,
      value: sr.value || ((u, v) => v == null ? '—' : fmtNum(v, sr.dec ?? 1) + (sr.unit ? ' ' + sr.unit : '')),
    });
  }
  const opts = {
    width: el.clientWidth || 600, height, scales, axes, series: useries, bands,
    legend: { show: legend, live: true }, cursor: { sync: sync ? { key: sync, setSeries: false } : undefined, drag: { x: true, y: false }, bind: { dblclick: () => () => null } },
    hooks: zoom ? { ...hooks, setScale: [...(hooks?.setScale || []), (u, key) => { if (key === 'x' && u.zoomGroup) u.zoomGroup.scaled(u); }] } : hooks,
  };
  const u = new uPlot(opts, [xs, ...series.map(sr => sr.values)], el);
  if (xRange) u.setScale('x', { min: xRange[0], max: xRange[1] });
  if (zoom && xs.length > 1) {
    let g = sync && autoGroups.get(sync);
    if (!g) {
      // uPlot sets its scales only on the first draw, so the starting view comes from the data (half a step wider
      // on each side when there are bars, so the first and last bars aren't cut).
      const pad = series.some(sr => sr.bars) ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) / 2 : 0;
      const home = xRange ? [...xRange] : [xs[0] - pad, xs[xs.length - 1] + pad];
      g = zoomGroup({ home, minT: home[0], maxT: home[1], minSpan: Math.max(Math.min(900, (home[1] - home[0]) / 50), 3 * (home[1] - home[0]) / xs.length) });
      if (sync) { autoGroups.set(sync, g); onCleanup(() => autoGroups.delete(sync)); }
    }
    u.zoomGroup = g;
    g.attach(u);
  }
  observeWidth(el, w => u.setSize({ width: w, height }));
  onCleanup(() => u.destroy());
  return u;
}

/* zoomGroup keeps the x axes of several charts together and adds zoom and pan: drag to pan, Shift-drag across a chart to zoom into
   that period, the mouse wheel, Ctrl/⌘ + scroll or a trackpad pinch to zoom, Shift + scroll or a sideways swipe to pan, two-finger pinch and
   one-finger drag on touch screens, double-click to go back. onView([from, to]) runs once the view settles. */
function zoomGroup({ home, onView, minT, maxT, minSpan = 900 }) {
  const g = { charts: [], home, syncing: false, timer: null };
  g.view = () => { const u = g.charts[0]; return u && u.scales.x.min != null ? [u.scales.x.min, u.scales.x.max] : g.home; };
  g.set = (a, b) => {
    const limit = maxT || Date.now() / 1000 + DAY, low = minT ?? -Infinity;
    if (b - a < minSpan) { const c = (a + b) / 2; a = c - minSpan / 2; b = c + minSpan / 2; }
    if (b - a >= limit - low) { a = low; b = limit; }
    else if (b > limit) { a -= b - limit; b = limit; }
    else if (a < low) { b += low - a; a = low; }
    g.syncing = true;
    for (const u of g.charts) u.setScale('x', { min: a, max: b });
    g.syncing = false;
    g.changed();
  };
  g.zoom = (f, center) => { const [a, b] = g.view(); const c = center ?? (a + b) / 2; g.set(c - (c - a) * f, c + (b - c) * f); };
  g.pan = f => { const [a, b] = g.view(), d = (b - a) * f; g.set(a + d, b + d); };
  g.reset = () => g.set(...g.home);
  g.changed = () => { clearTimeout(g.timer); g.timer = setTimeout(() => onView && onView(g.view()), 350); };
  // Called from the chart's setScale hook, e.g. after a drag-to-zoom on one chart.
  g.scaled = u => {
    if (g.syncing) return;
    g.syncing = true;
    for (const o of g.charts) if (o !== u) o.setScale('x', { min: u.scales.x.min, max: u.scales.x.max });
    g.syncing = false;
    g.changed();
  };
  g.attach = u => {
    g.charts.push(u);
    u.setScale('x', { min: g.home[0], max: g.home[1] });
    const over = u.over;
    const tAt = clientX => { const r = over.getBoundingClientRect(); return u.posToVal(clientX - r.left, 'x'); };
    // A mouse wheel moves in notches (whole lines, or wheelDelta steps of 120) and zooms without Ctrl; a trackpad
    // sends a smooth stream, and plain two-finger scrolling over a chart keeps scrolling the page.
    let smoothUntil = 0;
    over.addEventListener('wheel', e => {
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const notch = e.deltaMode !== 0 || (e.wheelDeltaY && e.wheelDeltaY % 120 === 0 && !e.deltaX);
      if (!notch) smoothUntil = e.timeStamp + 400;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); g.zoom(Math.exp(e.deltaY * 0.01), tAt(e.clientX)); }
      else if (notch && !e.shiftKey && e.timeStamp > smoothUntil) { e.preventDefault(); g.zoom(e.deltaY > 0 ? 1.25 : 0.8, tAt(e.clientX)); }
      else if (sideways || e.shiftKey) { e.preventDefault(); const [a, b] = g.view(); const d = (sideways ? e.deltaX : e.deltaY) / over.clientWidth * (b - a); g.set(a + d, b + d); }
    }, { passive: false });
    // Click and drag pans; Shift- or Alt-drag falls through to uPlot's drag-to-zoom selection.
    over.style.cursor = 'grab';
    over.addEventListener('mousedown', e => {
      if (e.shiftKey || e.altKey || e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const x0 = e.clientX, [a0, b0] = g.view();
      over.style.cursor = 'grabbing';
      let frame;
      const move = m => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const d = -(m.clientX - x0) / over.clientWidth * (b0 - a0); g.set(a0 + d, b0 + d); }); };
      const up = () => { over.style.cursor = 'grab'; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }, true);
    over.addEventListener('dblclick', e => { e.stopPropagation(); g.reset(); }, true);
    let touch = null;
    over.addEventListener('touchstart', e => {
      const [a, b] = g.view();
      touch = { a, b, x: [...e.touches].map(t => t.clientX), moved: false };
    }, { passive: true });
    over.addEventListener('touchmove', e => {
      if (!touch) return;
      const xs = [...e.touches].map(t => t.clientX), w = over.clientWidth, span = touch.b - touch.a;
      if (xs.length === 2 && touch.x.length === 2) {
        e.preventDefault();
        const d0 = Math.abs(touch.x[0] - touch.x[1]) || 1, d1 = Math.abs(xs[0] - xs[1]) || 1;
        const c = tAt((touch.x[0] + touch.x[1]) / 2), f = d0 / d1;
        g.set(c - (c - touch.a) * f, c + (touch.b - c) * f);
      } else if (xs.length === 1 && touch.x.length === 1 && (touch.moved || Math.abs(xs[0] - touch.x[0]) > 12)) {
        e.preventDefault();
        touch.moved = true;
        const d = -(xs[0] - touch.x[0]) / w * span;
        g.set(touch.a + d, touch.b + d);
      }
    }, { passive: false });
    over.addEventListener('touchend', () => { touch = null; });
  };
  return g;
}

function zoomToolbar(g, label) {
  const btn = (text, title, f) => h('button', { title, onclick: f }, text);
  return h('div', { class: 'toolbar zoombar' },
    h('span', { class: 'seg' }, btn('−', 'Zoom out', () => g.zoom(2)), btn('+', 'Zoom in', () => g.zoom(0.5))),
    h('span', { class: 'seg' }, btn('◀', 'Earlier', () => g.pan(-0.5)), btn('▶', 'Later', () => g.pan(0.5))),
    btn('Reset', 'Back to the selected range', () => g.reset()), label,
    h('span', { class: 'muted small hint' }, 'Drag to move · Shift-drag across a chart to zoom in · mouse wheel, Ctrl/⌘ + scroll or pinch to zoom · double-click to reset'));
}

/* stackedBars draws stacked bars with uPlot by plotting running totals, tallest first, so each bar covers the ones
   above it; the legend shows each part's own value. */
function stackedBars(el, { xs, stacks, height = 240, unit = '', dec = 0, axisFmt, valueFmt, xFmt, sync, incrs }) {
  const totals = xs.map(() => 0);
  const cum = stacks.map(st => st.values.map((v, i) => (totals[i] += v || 0)));
  const fmt = valueFmt || (v => fmtNum(v, dec) + (unit ? ' ' + unit : ''));
  const series = stacks.map((st, k) => ({
    label: st.label, color: st.color, bars: true, values: cum[k], scale: 'y',
    value: (u, v, si, i) => i == null ? '—' : fmt(st.values[i] || 0),
  })).reverse();
  return chart(el, { xs, series, height, axisFmt: axisFmt || fmtCompact, xFmt, sync, incrs, yRange: (u, mn, mx) => [0, (mx || 1) * 1.08] });
}

function sparkline(values, { w = 190, h: ht = 38, color = cssVar('--accent'), bars = false, goal = null } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(p => p[1] != null && isFinite(p[1]));
  const svg = s('svg', { width: '100%', height: ht, viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'none' });
  if (pts.length < 2) return svg;
  const ys = pts.map(p => p[1]);
  if (goal != null && isFinite(goal)) ys.push(goal);
  let mn = Math.min(...ys), mx = Math.max(...ys);
  if (bars) mn = 0;
  if (mx === mn) { mx += 1; mn -= 1; }
  const X = i => i / (values.length - 1) * (w - 2) + 1, Y = v => ht - 2 - (v - mn) / (mx - mn) * (ht - 4);
  if (bars) {
    const bw = Math.max(1, (w / values.length) * 0.7);
    for (const [i, v] of pts) svg.append(s('rect', { x: X(i) - bw / 2, y: Y(v), width: bw, height: ht - 2 - Y(v), fill: color, opacity: .75 }));
  } else {
    svg.append(s('path', { d: pts.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(''), fill: 'none', stroke: color, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke' }));
  }
  if (goal != null && isFinite(goal)) svg.append(s('line', { x1: 0, x2: w, y1: Y(goal), y2: Y(goal), stroke: cssVar('--good'), 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function rings(a, size = 120) {
  const svg = s('svg', { width: size, height: size, viewBox: '0 0 120 120' });
  const defs = [[a?.move, a?.moveGoal, '--move', 52], [a?.exercise, a?.exerciseGoal, '--exercise', 38], [a?.stand, a?.standGoal, '--stand', 24]];
  for (const [v, goal, color, r] of defs) {
    const c = cssVar(color), len = 2 * Math.PI * r, f = goal > 0 ? (v || 0) / goal : 0;
    svg.append(s('circle', { cx: 60, cy: 60, r, fill: 'none', stroke: c, 'stroke-opacity': .2, 'stroke-width': 12 }));
    // Past 100 % the ring keeps going round, a darker lap on top.
    svg.append(s('circle', { cx: 60, cy: 60, r, fill: 'none', stroke: c, 'stroke-width': 12, 'stroke-linecap': 'round',
      'stroke-dasharray': `${Math.min(f, 1) * len} ${len}`, transform: 'rotate(-90 60 60)' }));
    if (f > 1) svg.append(s('circle', { cx: 60, cy: 60, r, fill: 'none', stroke: c, 'stroke-width': 12, 'stroke-linecap': 'round', filter: 'brightness(.75)',
      'stroke-dasharray': `${Math.min(f - 1, 1) * len} ${len}`, transform: 'rotate(-90 60 60)' }));
  }
  return svg;
}

function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    el.append(h('button', { class: v === value ? 'on' : '', onclick: () => {
      for (const b of el.children) b.classList.remove('on');
      el.querySelector(`[data-v="${CSS.escape(v)}"]`).classList.add('on');
      onChange(v);
    }, 'data-v': v }, label));
  }
  return el;
}

function card(title, ...children) { return h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...children); }
function stat(k, v, unit) { return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('small', {}, unit) : null)); }

// Linear trend per day over [t, v] points.
function slopePerDay(points) {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [t, v] of points) { const x = t / DAY; sx += x; sy += v; sxx += x * x; sxy += x * v; }
  const d = n * sxx - sx * sx;
  return d ? (n * sxy - sx * sy) / d : null;
}

// ---------- export ----------

// downloadCSV saves rows (arrays) under a header as a .csv file.
function downloadCSV(name, header, rows) {
  const esc = v => v == null || (typeof v === 'number' && !isFinite(v)) ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const text = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name.replace(/[^\w.-]+/g, '-') + '.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csvButton(f, title = 'Download the data shown as a CSV file') { return h('button', { class: 'noprint small-btn', title, onclick: f }, '⤓ CSV'); }
// Local date and time as text for CSV files.
function fmtLocal(t) { const d = new Date(t * 1000); return isoDate(d) + ' ' + d.toTimeString().slice(0, 8); }
const csvNum = (v, dec = 3) => v == null || !isFinite(v) ? '' : +v.toFixed(dec);

// printPage turns the page into a PDF through the browser's print dialog: light colours, no menus or buttons, and a
// line saying what is shown. Charts are drawn again first so they print in light colours.
async function printPage() {
  const root = document.documentElement, theme = root.getAttribute('data-theme');
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.add('printing');
  if (dark) { root.setAttribute('data-theme', 'light'); await render(); }
  await whenIdle();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  fillPrintHead();
  const done = async () => {
    root.classList.remove('printing');
    if (dark) { applyTheme(); await render(); }
  };
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}
function fillPrintHead() {
  const main = $('#app');
  const picked = [...main.querySelectorAll('.toolbar .seg button.on, .toolbar select')].map(el => el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent : el.textContent)
    .filter(t => t && !/^(mg\/dL|mmol\/L)$/.test(t));
  const view = [...main.querySelectorAll('.zoombar > .muted.small:not(.hint)')].map(el => el.textContent).filter(Boolean);
  $('#print-head').replaceChildren(h('b', {}, 'ioHealth'), ' · ', [...picked, ...view].join(' · '), h('span', { class: 'muted' }, ' · printed ' + fmtDateTime(Date.now() / 1000)));
}
window.addEventListener('beforeprint', fillPrintHead);
$('#print-btn')?.addEventListener('click', printPage);

// ---------- goals ----------

// settings.goals: [{type, dir: 'min' (at least) | 'max' (at most), value}] in the units the app shows.
const goalFor = t => (settings.goals || []).find(g => g.type === t && g.value !== '' && isFinite(+g.value));
const goalMet = (g, v) => v != null && (g.dir === 'max' ? v <= +g.value : v >= +g.value);
const ALERT_DEFAULTS = { tir: 70, lows: 1, rhr: 5, hrv: 15, sync: 24 };
const alertSetting = k => { const v = settings.alerts?.[k]; return v === '' || v == null || !isFinite(+v) ? ALERT_DEFAULTS[k] : +v; };

// Sections and metrics can be switched off in Settings; switched-off metrics are left out of every list and chart.
const SECTIONS = [['activity', 'Activity rings', 'the Move/Exercise/Stand card on the dashboard'], ['sleep', 'Sleep', 'the Sleep page, the last-night card and sleep in Metrics'],
  ['glucose', 'Blood glucose', 'the Glucose page and the dashboard glucose card'], ['workouts', 'Workouts', 'the Workouts and Map pages and the workout cards on the dashboard'],
  ['records', 'Records', 'the Records page']];
const sectionOn = name => !(settings.hiddenSections || []).includes(name);
function typeHidden(t) {
  if ((settings.hiddenTypes || []).includes(t)) return true;
  if (t === 'sleep_analysis' && !sectionOn('sleep')) return true;
  if (t === 'blood_glucose' && !sectionOn('glucose')) return true;
  if (t.startsWith('activity_') && !sectionOn('activity')) return true;
  return false;
}
function applySections() {
  const pageSection = { sleep: 'sleep', glucose: 'glucose', workouts: 'workouts', map: 'workouts', records: 'records' };
  for (const a of document.querySelectorAll('#nav a')) a.hidden = !!pageSection[a.dataset.page] && !sectionOn(pageSection[a.dataset.page]);
}
applySections();
let typeListPromise;
function typeList() {
  return typeListPromise ||= api('types').then(list => Object.fromEntries(list.filter(t => !typeHidden(t.type)).map(t => [t.type, t])));
}

// ---------- router ----------

const pages = {};
function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, ...rest] = path.split('/');
  return { page: page || 'dashboard', arg: rest.join('/'), params: new URLSearchParams(query || '') };
}
function setParams(params) {
  const r = route();
  const q = new URLSearchParams(params).toString();
  history.replaceState(null, '', '#/' + (r.page === 'dashboard' ? '' : r.page) + (r.arg ? '/' + r.arg : '') + (q ? '?' + q : ''));
}
async function render() {
  resetPage();
  const r = route();
  const pageName = r.page === 'workout' ? 'workouts' : r.page;
  setNavOn(pageName);
  const main = $('#app');
  loading(main);
  main.scrollTo(0, 0);
  const f = pages[r.page] || pages.dashboard;
  try { await f(main, r.arg, r.params); } catch (e) { showError(main, e); }
}
window.addEventListener('hashchange', render);

async function refreshStatus() {
  try {
    const st = await api('status', {}, { cache: false });
    const el = $('#sync-status');
    if (st.lastSync?.started) el.textContent = `Last sync ${fmtAgo(st.lastSync.finished || st.lastSync.started)}` + (st.lastSync.device ? ` from ${st.lastSync.device}` : '');
    else el.textContent = 'No sync yet';
    window.healthStatus = st;
    if (st.version) { const v = $('#nav-version'); if (v) v.textContent = `ioHealth v${st.version}`; }
    updateBanner(st.update);
  } catch { /* shown by the page */ }
}

// ---------- dashboard ----------

const DASH_KPIS = ['step_count', 'active_energy_burned', 'apple_exercise_time', 'distance_walking_running', 'flights_climbed',
  'resting_heart_rate', 'heart_rate_variability_sdnn', 'walking_heart_rate_average', 'vo2_max', 'body_mass', 'respiratory_rate',
  'oxygen_saturation', 'time_in_daylight', 'apple_sleeping_wrist_temperature'];

pages.dashboard = async (main) => {
  const types = await typeList();
  main.replaceChildren();
  const top = h('div', { class: 'grid cols-2' });
  const ringsCard = card('Activity rings');
  const sleepCard = card('Last night');
  const show = { activity: sectionOn('activity'), sleep: sectionOn('sleep'), workouts: sectionOn('workouts') };
  if (show.activity) top.append(ringsCard);
  if (show.sleep) top.append(sleepCard);
  const kpis = h('div', { class: 'grid kpis' });
  const workoutsCard = card('Recent workouts');
  const weeklyCard = card('Training volume, last 12 weeks');
  const glucoseCard = types.blood_glucose && sectionOn('glucose') ? card('Blood glucose, last 14 days') : null;
  const alertList = h('div', { class: 'alerts' });
  const alertsCard = card('Heads-up', alertList);
  alertsCard.hidden = true;
  alertsCard.style.marginBottom = '16px';
  // level: good, warn or bad; shown most serious first.
  const addAlert = (level, text, href) => {
    alertsCard.hidden = false;
    const el = h('div', { class: 'alert ' + level, 'data-rank': { bad: 0, warn: 1, good: 2 }[level] }, h('span', {}, { bad: '⚠️', warn: '⚠️', good: '✅' }[level]), h('span', {}, text),
      href ? h('a', { href, class: 'small noprint' }, 'Look →') : null);
    const after = [...alertList.children].find(c => +c.dataset.rank > +el.dataset.rank);
    alertList.insertBefore(el, after || null);
  };
  main.append(...[h('div', { class: 'row spread' }, pageTitle('dashboard', 'purple', 'Dashboard'), h('a', { href: '#/day', class: 'small' }, 'Today in detail →')), alertsCard,
    top.children.length ? top : null, glucoseCard, h('div', { style: { height: '16px' } }), kpis,
    show.workouts ? h('div', { class: 'grid cols-2' }, workoutsCard, weeklyCard) : null].filter(Boolean));

  // Rings: today big, the week small.
  if (show.activity) api('activity', { from: daysAgo(6), to: today() }).then(days => {
    const byDate = Object.fromEntries(days.map(d => [d.date, d]));
    const t = byDate[today()] || days[days.length - 1];
    const row = h('div', { class: 'rings-row' });
    for (let i = 6; i >= 0; i--) {
      const d = daysAgo(i);
      row.append(h('div', { class: 'ring-day' }, rings(byDate[d], 44), h('div', {}, new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' }))));
    }
    if (!t) { ringsCard.append(empty('No activity summaries yet.')); return; }
    const line = (label, v, goal, unit, color) => h('div', {}, h('div', { class: 'small muted' }, label),
      h('div', { style: { fontSize: '20px', fontWeight: 700, color: cssVar(color) } }, `${fmtNum(v, 0)}/${fmtNum(goal, 0)}`, h('small', { class: 'muted' }, ' ' + unit)));
    ringsCard.append(h('div', { class: 'row', style: { gap: '24px' } }, rings(t, 130),
      h('div', { class: 'grid', style: { gap: '8px' } }, line('Move', t.move, t.moveGoal, 'kcal', '--move'),
        line('Exercise', t.exercise, t.exerciseGoal, 'min', '--exercise'), line('Stand', t.stand, t.standGoal, 'h', '--stand')),
      row), h('p', { class: 'small muted' }, t.date === today() ? 'Today' : 'Latest day: ' + t.date));
  }).catch(e => ringsCard.append(h('p', { class: 'error' }, e.message)));

  if (glucoseCard) api('glucose', { from: daysAgo(13), to: today(), low: settings.glucoseLow || 70, high: settings.glucoseHigh || 180 }).then(g => {
    if (!settings.glucoseUnit) settings.glucoseUnit = g.recordedUnit;
    const st = g.stats;
    if (!st.readings) { glucoseCard.append(empty('No readings in the last 14 days.')); return; }
    const last = g.readings[g.readings.length - 1];
    glucoseCard.append(h('div', { class: 'stats' }, stat('Latest', fmtG(last[1]), gUnit()), stat('Average', fmtG(st.mean), gUnit()),
      stat('Time in range', pct(st.ranges.inRange)), stat('Below range', pct(st.ranges.low + st.ranges.veryLow)), stat('GMI', fmtNum(st.gmi, 1), '%'), stat('CV', fmtNum(st.cv, 1), '%')),
    h('div', { style: { marginTop: '12px' } }, rangeBar(st.ranges, 14)), rangeLegend(st.ranges, g.target),
    h('p', { class: 'small muted' }, 'Latest reading ', fmtAgo(last[0]), ' · ', h('a', { href: '#/glucose' }, 'Glucose details →')));
  }).catch(e => glucoseCard.append(h('p', { class: 'error' }, e.message)));

  // Sleep
  if (show.sleep) api('sleep', { from: daysAgo(14), to: today() }).then(nights => {
    if (!nights.length) { sleepCard.append(empty('No sleep data in the last two weeks.')); return; }
    const last = nights[nights.length - 1];
    const avg = nights.reduce((a, n) => a + n.asleep, 0) / nights.length;
    sleepCard.append(h('div', { class: 'stats' },
      stat('Asleep', fmtHM(last.asleep)), stat('Bedtime', last.start ? fmtTime(last.start) : '—'), stat('Woke up', last.end ? fmtTime(last.end) : '—'),
      stat('Deep', fmtHM(last.stages.deep)), stat('REM', fmtHM(last.stages.rem)), stat('14-night average', fmtHM(avg))),
    h('div', { style: { marginTop: '10px' } }, sparkline(nights.map(n => n.asleep / 60), { bars: true, color: '#8b5cf6', h: 44 })),
    h('p', { class: 'small muted' }, `Night of ${last.date} · `, h('a', { href: '#/sleep' }, 'Sleep details')));
  }).catch(e => sleepCard.append(h('p', { class: 'error' }, e.message)));

  dashboardAlerts(types, addAlert);

  // KPI cards: the usual ones plus any metric with a goal.
  const shown = [...new Set([...DASH_KPIS, ...(settings.goals || []).map(g => g.type)])].filter(t => types[t]);
  if (!shown.length) kpis.append(card(null, empty('No samples yet. Sync from the iPhone app and they show up here.')));
  for (const t of shown) {
    const info = types[t];
    const el = h('section', { class: 'card kpi', onclick: () => location.hash = t === 'blood_glucose' ? '#/glucose' : '#/metrics?types=' + t + '&range=90d' },
      h('div', { class: 'label' }, typeLabel(t)), h('div', { class: 'value' }, '…'));
    kpis.append(el);
    api('series', { type: t, from: daysAgo(59), to: today(), bucket: 'day' }).then(async sr => {
      const k = scaleFor(sr.unit), pts = sr.points;
      if (!pts.length) {
        // Nothing in the last 60 days: show the latest reading, however old, with its date.
        const lastDay = !info.cumulative && info.last ? isoDate(new Date(info.last * 1000)) : null;
        const old = lastDay ? (await api('series', { type: t, from: lastDay, to: lastDay, bucket: 'day' })).points.at(-1) : null;
        if (!old) { el.querySelector('.value').textContent = '—'; return; }
        el.querySelector('.value').replaceChildren(fmtNum(old.v * k, typeDec(t)), h('small', {}, prettyUnit(info.unit === '%' ? '%' : sr.unit)));
        el.append(h('div', { class: 'sub' }, 'last on ', fmtDayAgo(old.t), ' · none in 60 days'));
        return;
      }
      const byDay = new Map(pts.map(p => [isoDate(new Date(p.t * 1000)), p.v * k]));
      const vals = []; for (let i = 59; i >= 0; i--) vals.push(byDay.get(daysAgo(i)) ?? null);
      const last = pts[pts.length - 1];
      const avg = arr => { const xs = arr.filter(v => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
      const recent = avg(vals.slice(-7)), before = avg(vals.slice(-35, -7));
      const unit = prettyUnit(info.unit === '%' ? '%' : sr.unit);
      const headline = info.cumulative ? (byDay.get(today()) ?? 0) : last.v * k;
      const delta = recent != null && before ? (recent - before) / Math.abs(before) * 100 : null;
      const goal = goalFor(t);
      if (goal) goalNotes(t, goal, info, vals, last.v * k, unit, el, addAlert);
      const lowerIsBetter = ['resting_heart_rate', 'walking_heart_rate_average', 'respiratory_rate'].includes(t);
      const cls = delta == null || Math.abs(delta) < 2 ? 'flat' : (delta > 0) !== lowerIsBetter ? 'up' : 'down';
      const dec = t === 'blood_glucose' && /^mmol/i.test(sr.unit) ? 1 : typeDec(t);
      el.querySelector('.value').replaceChildren(fmtNum(headline, dec), h('small', {}, unit));
      el.append(h('div', { class: 'sub' }, info.cumulative ? 'today' : fmtDayAgo(last.t),
        ' · 7-day avg ', fmtNum(recent, typeDec(t)), delta != null ? h('span', { class: cls }, ` ${delta > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(delta), 0)}%`) : null),
      sparkline(vals, { bars: info.cumulative, goal: goal ? +goal.value : null }));
      if (goal) el.append(el.querySelector('.goal-note'));
    }).catch(e => el.append(h('div', { class: 'sub error' }, e.message)));
  }

  // Workouts
  if (show.workouts) api('workouts', { from: daysAgo(83), to: today() }).then(ws => {
    if (!ws.length) { workoutsCard.append(empty('No workouts in the last 12 weeks.')); weeklyCard.append(empty('Nothing to show yet.')); return; }
    workoutsCard.append(workoutTable(ws.slice(0, 8), { compact: true }), h('p', { class: 'small' }, h('a', { href: '#/workouts' }, 'All workouts →')));
    const chartEl = h('div', { class: 'chart' });
    weeklyCard.append(chartEl);
    weeklyChart(chartEl, ws, 12);
  }).catch(e => workoutsCard.append(h('p', { class: 'error' }, e.message)));
};

// goalNotes adds a goal line to a dashboard card and raises streaks, misses and trends as alerts. vals are the last
// 60 days (today last) in the units shown.
function goalNotes(t, goal, info, vals, latest, unit, el, addAlert) {
  const label = typeLabel(t), target = +goal.value, dec = typeDec(t);
  const word = goal.dir === 'max' ? 'at most' : 'at least';
  const note = h('div', { class: 'sub goal-note' });
  el.append(note);
  const daily = info.cumulative || info.kind === 'ring' || t === 'sleep_analysis';
  if (daily) {
    const todayMet = goalMet(goal, vals[vals.length - 1]);
    const past = vals.slice(0, -1);
    const met7 = past.slice(-7).filter(v => goalMet(goal, v)).length;
    let streak = 0;
    for (let i = past.length - 1; i >= 0 && goalMet(goal, past[i]); i--) streak++;
    if (todayMet) streak++;
    note.append(`Goal ${word} ${fmtNum(target, dec)} · met ${met7} of the last 7 days`, streak >= 2 ? ` · ${streak}-day streak` : '');
    if (streak >= 3) addAlert('good', `${label}: goal met ${streak} days in a row.`, '#/metrics?types=' + t + '&range=30d');
    else if (past.slice(-3).length === 3 && past.slice(-3).every(v => v != null && !goalMet(goal, v)) && !todayMet)
      addAlert('warn', `${label}: goal (${word} ${fmtNum(target, dec)}) missed the last 3 days.`, '#/metrics?types=' + t + '&range=30d');
    return;
  }
  // A level to reach (weight, resting heart rate…): how far, and whether the 30-day trend heads there.
  if (goalMet(goal, latest)) {
    note.append(`Goal ${word} ${fmtNum(target, dec)} · reached`);
    addAlert('good', `${label} is at your goal (${word} ${fmtNum(target, dec)} ${unit}).`, '#/metrics?types=' + t + '&range=90d');
    return;
  }
  const gap = Math.abs(target - latest);
  const recent = vals.slice(-30).map((v, i) => [i * DAY, v]).filter(p => p[1] != null);
  const slope = recent.length >= 5 ? slopePerDay(recent) : null; // per day
  const toward = slope != null && (target - latest) * slope > 0;
  let eta = '';
  if (toward && Math.abs(slope) > 1e-9) {
    const days = gap / Math.abs(slope);
    if (days < 365) eta = ' · on track for ' + fmtDayAgo(Date.now() / 1000 + days * DAY);
  }
  note.append(`Goal ${word} ${fmtNum(target, dec)} · ${fmtNum(gap, dec)} to go${eta}`);
  if (slope != null && !toward && Math.abs(slope * 30) > Math.abs(latest) * 0.005)
    addAlert('warn', `${label} is moving away from your goal: ${slope > 0 ? '+' : '−'}${fmtNum(Math.abs(slope * 30), dec)} ${unit} over 30 days (goal ${word} ${fmtNum(target, dec)}).`, '#/metrics?types=' + t + '&range=90d');
}

// dashboardAlerts: things worth a look, from the alert settings.
function dashboardAlerts(types, addAlert) {
  const avg = a => { const x = a.filter(v => v != null); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : null; };
  const syncH = alertSetting('sync');
  if (syncH > 0) api('status', {}, { cache: false }).then(st => {
    const t = st.lastSync?.finished || st.lastSync?.started;
    if (t && Date.now() / 1000 - t > syncH * 3600) addAlert('warn', `No sync from the iPhone for ${fmtAgo(t).replace(' ago', '')}. Open the app on the phone to send the latest data.`);
  }).catch(() => {});
  if (types.blood_glucose && sectionOn('glucose')) {
    api('glucose', { from: daysAgo(6), to: today(), low: +settings.glucoseLow || 70, high: +settings.glucoseHigh || 180 }).then(g => {
      const st = g.stats;
      if (!st.readings || st.perDay < 50) return;
      const tir = st.ranges.inRange * 100, want = alertSetting('tir'), lows = alertSetting('lows');
      if (lows > 0 && st.lows >= lows) addAlert('bad', `${st.lows} low${st.lows === 1 ? '' : 's'} (under ${fmtG(g.target[0])} ${gUnit()} for 15 minutes or more) in the last 7 days.`, '#/glucose?range=7');
      if (want > 0 && tir < want) addAlert('warn', `Glucose time in range was ${fmtNum(tir, 0)}% over the last 7 days, under your ${fmtNum(want, 0)}% target.`, '#/glucose?range=7');
      else if (want > 0) addAlert('good', `Glucose time in range ${fmtNum(tir, 0)}% over the last 7 days.`, '#/glucose?range=7');
    }).catch(() => {});
  }
  const usual = (t, f) => api('series', { type: t, from: daysAgo(34), to: today(), bucket: 'day' }).then(sr => {
    const byDay = new Map(sr.points.map(p => [isoDate(new Date(p.t * 1000)), p.v]));
    const vals = []; for (let i = 34; i >= 0; i--) vals.push(byDay.get(daysAgo(i)) ?? null);
    const now = avg(vals.slice(-7)), base = avg(vals.slice(0, -7));
    if (now != null && base != null && vals.slice(-7).filter(v => v != null).length >= 3) f(now, base, sr.unit);
  }).catch(() => {});
  const rhr = alertSetting('rhr'), hrv = alertSetting('hrv');
  if (rhr > 0 && types.resting_heart_rate) usual('resting_heart_rate', (now, base) => {
    if (now - base >= rhr) addAlert('warn', `Resting heart rate is up: ${fmtNum(now, 0)} bpm this week against your usual ${fmtNum(base, 0)}. Illness, stress, alcohol or too little recovery can do that.`, '#/metrics?types=resting_heart_rate,heart_rate_variability_sdnn&range=90d');
  });
  if (hrv > 0 && types.heart_rate_variability_sdnn) usual('heart_rate_variability_sdnn', (now, base) => {
    if (base > 0 && (base - now) / base * 100 >= hrv) addAlert('warn', `Heart rate variability is down: ${fmtNum(now, 0)} ms this week against your usual ${fmtNum(base, 0)} ms (−${fmtNum((base - now) / base * 100, 0)}%).`, '#/metrics?types=heart_rate_variability_sdnn,resting_heart_rate&range=90d');
  });
}

function mondayOf(t) { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; }

// weeklyChart: workout minutes per week, stacked by activity type.
function weeklyChart(el, ws, weeks, { height = 240, monthly = false } = {}) {
  const startOf = monthly ? (t => { const d = new Date(t * 1000); return new Date(d.getFullYear(), d.getMonth(), 1); }) : mondayOf;
  const end = startOf(Date.now() / 1000);
  const xs = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(end);
    if (monthly) d.setMonth(d.getMonth() - i); else d.setDate(d.getDate() - 7 * i);
    xs.push(d.getTime() / 1000);
  }
  const index = new Map(xs.map((x, i) => [x, i]));
  const byType = {};
  for (const w of ws) {
    const i = index.get(startOf(w.start).getTime() / 1000);
    if (i == null) continue;
    (byType[w.activityType] ||= xs.map(() => 0))[i] += w.duration / 60;
  }
  const order = Object.entries(byType).sort((a, b) => b[1].reduce((x, y) => x + y) - a[1].reduce((x, y) => x + y));
  const stacks = order.map(([t, values]) => ({ label: activityName(t), color: activityColor(t), values }));
  if (!stacks.length) { el.append(empty('No workouts in this period.')); return; }
  stackedBars(el, { xs, stacks, height, valueFmt: v => fmtHM(v), axisFmt: v => fmtCompact(v / 60) + 'h', incrs: MINUTE_INCRS });
}

function workoutTable(ws, { compact = false } = {}) {
  const tb = h('tbody');
  for (const w of ws) {
    const pace = w.distance > 0 && paceSports.has(w.activityType) ? fmtPace(w.duration / (w.distance / 1000)) : w.distance > 0 ? fmtSpeed(w.distance / w.duration) : '';
    tb.append(h('tr', { class: 'click', onclick: () => location.hash = '#/workout/' + w.uuid },
      h('td', {}, h('span', { class: 'chip', style: { color: activityColor(w.activityType), padding: '1px 8px' } }, h('span', { class: 'dot', style: { background: activityColor(w.activityType) } }), activityName(w.activityType)),
        w.hasRoute ? ' 📍' : ''),
      h('td', {}, compact ? fmtDate(w.start) : fmtDateTime(w.start)),
      h('td', { class: 'r num' }, fmtDuration(w.duration)),
      h('td', { class: 'r num' }, w.distance ? fmtDist(w.distance) : ''),
      compact ? null : h('td', { class: 'r num' }, pace),
      h('td', { class: 'r num' }, w.energy ? fmtKcal(w.energy) : ''),
      h('td', { class: 'r num' }, w.hrAvg ? fmtNum(w.hrAvg, 0) + ' bpm' : ''),
      compact ? null : h('td', { class: 'r num' }, w.elevation ? fmtElev(w.elevation) : ''),
      compact ? null : h('td', { class: 'muted' }, w.source)));
  }
  return h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Workout'), h('th', {}, 'Date'), h('th', { class: 'r' }, 'Time'),
    h('th', { class: 'r' }, 'Distance'), compact ? null : h('th', { class: 'r' }, 'Pace / speed'), h('th', { class: 'r' }, 'Energy'), h('th', { class: 'r' }, 'Avg HR'),
    compact ? null : h('th', { class: 'r' }, 'Climb'), compact ? null : h('th', {}, 'Source'))), tb));
}

// ---------- metrics explorer ----------

const RANGES = [['today', 'Today', 1], ['yesterday', 'Yesterday', 1], ['7d', '7 days', 7], ['30d', '30 days', 30], ['90d', '90 days', 90], ['1y', '1 year', 365], ['2y', '2 years', 730], ['5y', '5 years', 1826], ['all', 'All', 0]];

pages.metrics = async (main, _, params) => {
  const types = await typeList();
  const state = {
    types: (params.get('types') || 'resting_heart_rate,heart_rate_variability_sdnn').split(',').filter(t => types[t]),
    range: params.get('range') || '90d', bucket: params.get('bucket') || 'auto', mode: params.get('mode') || 'stack',
    from: params.get('from') || '', to: params.get('to') || '', band: params.get('band') !== '0', cmp: params.get('cmp') || '',
  };
  const save = () => setParams(Object.fromEntries(Object.entries({ types: state.types.join(','), range: state.range, bucket: state.bucket,
    mode: state.mode, from: state.range === 'custom' ? state.from : '', to: state.range === 'custom' ? state.to : '', band: state.band ? '' : '0', cmp: state.cmp }).filter(([, v]) => v)));

  const all = Object.values(types).filter(t => t.kind === 'quantity' || t.kind === 'category').sort((a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)));
  const chips = h('div', { class: 'row' });
  const search = h('input', { list: 'type-options', placeholder: 'Add a metric…', style: { minWidth: '240px' } });
  const datalist = h('datalist', { id: 'type-options' }, all.map(t => h('option', { value: typeLabel(t.type) + ' · ' + t.type })));
  search.addEventListener('change', () => {
    const t = search.value.split(' · ').pop().trim();
    search.value = '';
    if (types[t] && !state.types.includes(t)) { state.types.push(t); draw(); }
  });
  const quick = h('div', { class: 'type-picker' }, COMMON_TYPES.filter(t => types[t]).map(t => h('span', { class: 'chip', onclick: () => {
    state.types = state.types.includes(t) ? state.types.filter(x => x !== t) : [...state.types, t]; draw();
  } }, typeLabel(t))));

  const fromIn = h('input', { type: 'date', value: state.from || daysAgo(90) });
  const toIn = h('input', { type: 'date', value: state.to || today() });
  const customRow = h('span', { class: 'row', hidden: state.range !== 'custom' }, fromIn, '–', toIn,
    h('button', { onclick: () => { state.from = fromIn.value; state.to = toIn.value; draw(); } }, 'Apply'));
  const bucketSel = h('select', { onchange: e => { state.bucket = e.target.value; draw(); } },
    [['auto', 'Auto'], ['raw', 'Every sample'], ['hour', 'Hourly'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']]
      .map(([v, l]) => h('option', { value: v, selected: v === state.bucket }, l)));
  const cmpSel = h('select', { title: 'Draw an earlier period as a dashed line, shifted onto this one', onchange: e => { state.cmp = e.target.value; draw(); } },
    [['', 'No comparison'], ['prev', 'Compare: previous period'], ['year', 'Compare: a year earlier']].map(([v, l]) => h('option', { value: v, selected: v === state.cmp }, l)));
  const bandBox = h('label', { class: 'row small', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: state.band, onchange: e => { state.band = e.target.checked; draw(); } }), 'min/max band');

  const out = h('div');
  const summary = h('div');
  main.replaceChildren(pageTitle('chart', 'blue', 'Metrics'),
    h('section', { class: 'card' },
      h('div', { class: 'toolbar' }, chips),
      h('div', { class: 'toolbar' }, search, datalist, h('span', { class: 'muted small' }, 'or pick:')), quick,
      h('div', { class: 'toolbar', style: { marginTop: '12px', marginBottom: 0 } },
        seg([...RANGES.map(r => [r[0], r[1]]), ['custom', 'Custom']], state.range, v => { state.range = v; customRow.hidden = v !== 'custom'; if (v !== 'custom') draw(); }),
        customRow, bucketSel,
        seg([['stack', 'Stacked'], ['overlay', 'Overlay']], state.mode, v => { state.mode = v; draw(); }), bandBox, cmpSel)),
    h('div', { style: { height: '16px' } }), out, summary);

  // The bucket for a visible span: every sample when zoomed in close, coarser as the span grows.
  const bucketFor = (t, span) => {
    if (state.bucket !== 'auto') return state.bucket;
    const cumulative = types[t]?.cumulative;
    if (span <= 1.5 * DAY && !cumulative && t !== 'sleep_analysis') return 'raw';
    if (span <= 3 * DAY) return 'hour';
    if (span <= 400 * DAY) return 'day';
    if (span <= 4 * 365 * DAY) return 'week';
    return 'month';
  };
  const BUCKET_WORDS = { raw: 'every sample', hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };

  let drawSeq = 0;
  async function draw() {
    save();
    const seq = ++drawSeq;
    resetPage();
    chips.replaceChildren(...state.types.map((t, i) => h('span', { class: 'chip on', style: { color: PALETTE[i % PALETTE.length] } },
      h('span', { class: 'dot', style: { background: PALETTE[i % PALETTE.length] } }), typeLabel(t),
      h('span', { class: 'x', title: 'Remove', onclick: () => { state.types = state.types.filter(x => x !== t); draw(); } }, '✕'))));
    for (const c of quick.children) c.classList.toggle('on', state.types.some(t => typeLabel(t) === c.textContent));
    bandBox.hidden = cmpSel.hidden = state.mode !== 'stack';
    if (!state.types.length) { out.replaceChildren(card(null, empty('Pick one or more metrics above.'))); summary.replaceChildren(); return; }
    loading(out);
    let from, to = today();
    if (state.range === 'custom') { from = state.from || daysAgo(90); to = state.to || today(); }
    else if (state.range === 'today') from = today();
    else if (state.range === 'yesterday') from = to = daysAgo(1);
    else if (state.range === 'all') {
      const first = Math.min(...state.types.map(t => types[t].first));
      from = isoDate(new Date(first * 1000));
    } else from = daysAgo(RANGES.find(r => r[0] === state.range)[2] - 1);
    const home = [new Date(from + 'T00:00').getTime() / 1000, new Date(to + 'T00:00').getTime() / 1000 + DAY];
    const earliest = Math.min(...state.types.map(t => types[t].first)) - DAY;

    // What is loaded: the period fetched and each metric's reply.
    let loaded = { a: home[0], b: home[1], results: null };
    // Comparison: the same metrics for an earlier period, moved forward by `shift` onto this one.
    const shift = state.mode !== 'stack' || state.range === 'all' ? 0 : state.cmp === 'prev' ? home[1] - home[0] : state.cmp === 'year' ? 365 * DAY : 0;
    const cmpLabel = state.cmp === 'year' ? 'A year earlier' : 'Previous period';
    const fetchSet = (a, b, span) => Promise.all(state.types.map(t => api('series', { type: t, from: String(Math.floor(a)), to: String(Math.ceil(b)), bucket: bucketFor(t, span) })));
    const fetchAll = async (a, b) => {
      const [results, cmp] = await Promise.all([fetchSet(a, b, b - a), shift ? fetchSet(a - shift, b - shift, b - a) : null]);
      loaded.nextCmp = cmp;
      return results;
    };
    try {
      loaded.results = await fetchAll(home[0], home[1]);
      loaded.cmp = loaded.nextCmp;
    } catch (e) { if (seq === drawSeq) showError(out, e); return; }
    if (seq !== drawSeq) return;

    const viewLabel = h('span', { class: 'muted small' });
    const group = zoomGroup({ home, onView: v => refresh(v) });
    const defs = state.types.map((t, i) => ({ t, i, color: PALETTE[i % PALETTE.length], band: state.band && !types[t].cumulative }));
    const unitOf = d => loaded.results[d.i].unit;
    const k = d => scaleFor(unitOf(d));
    const isBars = d => loaded.results[d.i].cumulative;
    // Data arrays for a metric: [xs, value, (max, min)].
    const dataFor = d => {
      const pts = loaded.results[d.i].points, kk = k(d);
      const cols = [pts.map(p => p.t), pts.map(p => p.v * kk)];
      if (d.band) cols.push(pts.map(p => (p.max ?? p.v) * kk), pts.map(p => (p.min ?? p.v) * kk));
      if (!shift || !loaded.cmp) return cols;
      const cp = loaded.cmp[d.i].points;
      return uPlot.join([cols, [cp.map(p => p.t + shift), cp.map(p => p.v * kk)]]);
    };
    const hooks = { setScale: [(u, key) => { if (key === 'x') group.scaled(u); }] };
    const subtitles = [];
    let overlayChart, stackCharts = [];
    const zb = zoomToolbar(group, viewLabel);
    zb.insertBefore(csvButton(() => exportCsv()), zb.querySelector('.hint'));
    out.replaceChildren(card(null, zb));
    if (state.mode === 'overlay') {
      const el = h('div', { class: 'chart' });
      out.append(card(`${defs.map(d => typeLabel(d.t)).join(' · ')}`, el, h('p', { class: 'small muted' }, 'Each unit has its own axis.')));
      const joined = defs.length > 1 ? uPlot.join(defs.map(d => dataFor(d).slice(0, 2))) : dataFor(defs[0]).slice(0, 2);
      overlayChart = chart(el, { xs: joined[0], height: 420, hooks, zoom: false, series: defs.map((d, j) => ({
        label: typeLabel(d.t), color: d.color, unit: prettyUnit(unitOf(d)), dec: typeDec(d.t, unitOf(d)), scale: prettyUnit(unitOf(d)) || d.t, values: joined[j + 1],
        points: false, fill: isBars(d) ? d.color + '22' : undefined,
      })) });
      group.attach(overlayChart);
    } else {
      for (const d of defs) {
        const el = h('div', { class: 'chart' });
        const sub = h('span', { class: 'muted small' });
        subtitles.push([d, sub]);
        out.append(card(null, h('div', { class: 'row spread' }, h('h2', { style: { color: d.color } }, typeLabel(d.t)), sub), el));
        const cols = dataFor(d), dec = typeDec(d.t, unitOf(d)), unit = prettyUnit(unitOf(d));
        const series = [{ label: typeLabel(d.t), color: d.color, unit, dec, values: cols[1], bars: isBars(d), points: !isBars(d) && cols[0].length < 90 }];
        let bands;
        if (d.band) {
          series.push({ label: 'max', color: d.color + '55', width: 1, unit, dec, values: cols[2] });
          series.push({ label: 'min', color: d.color + '55', width: 1, unit, dec, values: cols[3] });
          bands = [{ series: [2, 3], fill: d.color + '1f' }];
        }
        if (shift) series.push({ label: cmpLabel, color: d.color + 'aa', width: 1.5, dash: [6, 4], unit, dec, values: cols[cols.length - 1] });
        const goal = goalFor(d.t);
        const goalHook = goal ? { draw: [u => { const y = u.valToPos(+goal.value, 'y', true); if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
          const ctx = u.ctx; ctx.save(); ctx.strokeStyle = cssVar('--good'); ctx.lineWidth = 1.5 * devicePixelRatio; ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
          ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke(); ctx.restore(); }] } : {};
        const u = chart(el, { xs: cols[0], series, bands, hooks: { ...hooks, ...goalHook }, zoom: false, height: defs.length > 2 ? 200 : 260, sync: 'metrics',
          yRange: !goal ? undefined : isBars(d) ? (u, mn, mx) => [0, Math.max(mx || 1, +goal.value) * 1.08]
            : (u, mn, mx) => { const lo = Math.min(mn, +goal.value), hi = Math.max(mx, +goal.value), p = (hi - lo) * 0.08 || 1; return [lo - p, hi + p]; } });
        stackCharts.push(u);
        group.attach(u);
      }
    }

    function describe([a, b]) {
      const r0 = loaded.results[0];
      const fmt = (b - a) <= 2 * DAY ? fmtDateTime : fmtDate;
      viewLabel.textContent = `${fmt(a)} – ${fmt(b - 1)} · ${BUCKET_WORDS[r0?.bucket] || ''}`;
      for (const [d, sub] of subtitles) {
        const r = loaded.results[d.i];
        sub.textContent = `${prettyUnit(r.unit) || 'count'} · ${BUCKET_WORDS[r.bucket]}${r.bucket === 'raw' ? '' : r.cumulative ? ' totals' : ' averages'}`;
      }
      renderSummary(a, b);
    }

    // After a zoom or pan: fetch again when the view leaves the loaded period or wants a finer or coarser bucket.
    let refreshSeq = 0;
    async function refresh([a, b]) {
      const span = b - a;
      const needs = a < Math.max(loaded.a, earliest) || b > loaded.b + 60 ||
        state.types.some((t, i) => bucketFor(t, span) !== loaded.results[i].bucket);
      if (!needs) { describe([a, b]); return; }
      const my = ++refreshSeq;
      const fa = Math.max(earliest, a - span / 2), fb = Math.min(Date.now() / 1000 + DAY, b + span / 2);
      viewLabel.textContent = 'Loading…';
      let results;
      try { results = await fetchAll(fa, fb); } catch (e) { viewLabel.textContent = 'Could not load: ' + e.message; return; }
      if (my !== refreshSeq || seq !== drawSeq) return;
      loaded = { a: fa, b: fb, results, cmp: loaded.nextCmp };
      const [va, vb] = group.view();
      group.syncing = true;
      if (overlayChart) {
        const joined = defs.length > 1 ? uPlot.join(defs.map(d => dataFor(d).slice(0, 2))) : dataFor(defs[0]).slice(0, 2);
        overlayChart.setData(joined, false);
      }
      stackCharts.forEach((u, j) => {
        const d = defs[j], cols = dataFor(d);
        u.series[1].points.show = () => !isBars(d) && cols[0].length < 90;
        u.setData(cols, false);
      });
      for (const u of group.charts) u.setScale('x', { min: va, max: vb });
      group.syncing = false;
      describe([va, vb]);
    }

    // Summary of what is on screen.
    function renderSummary(a, b) {
      const tb = h('tbody');
      for (const d of defs) {
        const r = loaded.results[d.i], kk = k(d), dec = typeDec(d.t, r.unit);
        const pts = r.points.filter(p => p.t >= a && p.t < b), vals = pts.map(p => p.v * kk);
        if (!vals.length) { tb.append(h('tr', {}, h('td', {}, typeLabel(d.t)), h('td', { colspan: 6, class: 'muted' }, 'no data in view'))); continue; }
        const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
        const mn = Math.min(...pts.map(p => (p.min ?? p.v) * kk)), mx = Math.max(...pts.map(p => (p.max ?? p.v) * kk));
        const slope = (b - a) >= 14 * DAY ? slopePerDay(pts.map((p, i) => [p.t, vals[i]])) : null;
        tb.append(h('tr', {}, h('td', {}, h('span', { class: 'dot', style: { background: d.color, display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', marginRight: '6px' } }), typeLabel(d.t)),
          h('td', { class: 'r num' }, fmtNum(avg, dec), ' ', prettyUnit(r.unit)), h('td', { class: 'r num' }, fmtNum(mn, dec)), h('td', { class: 'r num' }, fmtNum(mx, dec)),
          h('td', { class: 'r num' }, r.cumulative && r.bucket !== 'raw' ? fmtNum(vals.reduce((x, y) => x + y, 0), dec) : '—'),
          h('td', { class: 'r num' }, fmtNum(vals[vals.length - 1], dec)),
          h('td', { class: 'r num' }, slope == null ? '—' : (slope > 0 ? '+' : '') + fmtNum(slope * 30, dec + 1) + ' / 30 days'),
          shift ? h('td', { class: 'r num' }, cmpCell(d, a, b, avg, dec)) : null));
      }
      const per = loaded.results[0]?.bucket === 'raw' ? 'sample' : { hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' }[loaded.results[0]?.bucket];
      summary.replaceChildren(card('Summary of the visible period', h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {},
        ...['Metric', `Average per ${per}`, 'Min', 'Max', 'Total', 'Latest', 'Trend', ...(shift ? [cmpLabel] : [])].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), tb))));
    }
    // The comparison period's average for what is in view, and the change to now.
    function cmpCell(d, a, b, avg, dec) {
      const vals = (loaded.cmp?.[d.i]?.points || []).filter(p => p.t + shift >= a && p.t + shift < b).map(p => p.v * k(d));
      if (!vals.length) return '—';
      const was = vals.reduce((x, y) => x + y, 0) / vals.length;
      const ch = was ? (avg - was) / Math.abs(was) * 100 : null;
      return h('span', {}, fmtNum(was, dec), ch == null ? '' : h('span', { class: 'muted' }, ` ${ch > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(ch), 0)}%`));
    }
    function exportCsv() {
      const [a, b] = group.view();
      const rows = [];
      for (const d of defs) {
        const r = loaded.results[d.i], kk = k(d);
        for (const p of r.points) if (p.t >= a && p.t < b) rows.push([fmtLocal(p.t), d.t, csvNum(p.v * kk), csvNum(p.min == null ? null : p.min * kk), csvNum(p.max == null ? null : p.max * kk), p.n ?? '', prettyUnit(r.unit), r.bucket]);
      }
      downloadCSV(`iohealth-${state.types.join('-')}-${isoDate(new Date(a * 1000))}-${isoDate(new Date((b - 1) * 1000))}`, ['time', 'metric', 'value', 'min', 'max', 'samples', 'unit', 'bucket'], rows);
    }
    describe(home);
  }
  draw();
};

// ---------- correlations ----------

// Per-day values that aren't plain metrics.
const CORR_EXTRA = { glucose_tir: ['Glucose time in range', '%', 0], glucose_cv: ['Glucose variability (CV)', '%', 1], workout_minutes: ['Workout minutes', 'min', 0] };
const corrLabel = k => CORR_EXTRA[k]?.[0] || typeLabel(k);

// dailyValues returns Map(yyyy-mm-dd → value) and the unit for one metric over [from, to].
async function dailyValues(key, from, to) {
  const out = new Map();
  if (key === 'glucose_tir' || key === 'glucose_cv') {
    const g = await api('glucose', { from, to, low: +settings.glucoseLow || 70, high: +settings.glucoseHigh || 180 });
    for (const d of g.days) if (d.n >= 12) out.set(d.date, key === 'glucose_tir' ? d.ranges.inRange * 100 : d.mean ? d.sd / d.mean * 100 : null);
    return { values: out, unit: '%' };
  }
  if (key === 'workout_minutes') {
    const ws = await api('workouts', { from, to });
    for (let d = new Date(from + 'T12:00'); isoDate(d) <= to; d.setDate(d.getDate() + 1)) out.set(isoDate(d), 0);
    for (const w of ws) { const d = isoDate(new Date(w.start * 1000)); if (out.has(d)) out.set(d, out.get(d) + w.duration / 60); }
    return { values: out, unit: 'min' };
  }
  const sr = await api('series', { type: key, from, to, bucket: 'day' });
  const k = scaleFor(sr.unit);
  for (const p of sr.points) out.set(isoDate(new Date(p.t * 1000)), p.v * k);
  return { values: out, unit: sr.unit === '%' ? '%' : prettyUnit(sr.unit) };
}

function nextDay(d, n = 1) { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return isoDate(x); }
// pairs: [date of Y, x, y] for days where both have a value; with lag 1, X is from the day before Y.
function corrPairs(xs, ys, lag) {
  const out = [];
  for (const [d, y] of ys) {
    const x = xs.get(lag ? nextDay(d, -lag) : d);
    if (x != null && y != null && isFinite(x) && isFinite(y)) out.push([d, x, y]);
  }
  return out.sort((a, b) => a[0] < b[0] ? -1 : 1);
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, intercept: my - sxy / sxx * mx } : null;
}
function ranks(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
const strength = r => r == null ? '' : Math.abs(r) < 0.1 ? 'no real link' : Math.abs(r) < 0.3 ? 'a weak link' : Math.abs(r) < 0.5 ? 'a moderate link' : 'a strong link';
function niceTicks(lo, hi, n = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function scatterPlot(pairs, fit, xLabel, yLabel, xDec, yDec) {
  const W = 680, H = 400, L = 62, R = 16, T = 14, B = 46;
  const xs = pairs.map(p => p[1]), ys = pairs.map(p => p[2]);
  const pad = (a, b) => { const d = (b - a) * 0.05 || 1; return [a - d, b + d]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - R), Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const muted = cssVar('--muted'), line = cssVar('--line');
  const svg = s('svg', { class: 'scatter', viewBox: `0 0 ${W} ${H}` });
  for (const v of niceTicks(x0, x1)) svg.append(s('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: line }), s('text', { x: X(v), y: H - B + 16, 'font-size': 11, fill: muted, 'text-anchor': 'middle' }, fmtCompact(v)));
  for (const v of niceTicks(y0, y1)) svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: line }), s('text', { x: L - 6, y: Y(v) + 4, 'font-size': 11, fill: muted, 'text-anchor': 'end' }, fmtCompact(v)));
  svg.append(s('text', { x: (L + W - R) / 2, y: H - 8, 'font-size': 12, fill: muted, 'text-anchor': 'middle' }, xLabel),
    s('text', { x: 14, y: (T + H - B) / 2, 'font-size': 12, fill: muted, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, yLabel));
  const accent = cssVar('--accent');
  pairs.forEach(([d, x, y], i) => svg.append(s('circle', { cx: X(x), cy: Y(y), r: 4.5, fill: accent, 'fill-opacity': 0.25 + 0.6 * (i + 1) / pairs.length, style: 'cursor:pointer',
    onmousemove: e => showTip(e, `${fmtDate(new Date(d + 'T12:00') / 1000)} · ${fmtNum(x, xDec)} → ${fmtNum(y, yDec)}`), onmouseleave: hideTip,
    onclick: () => { hideTip(); location.hash = '#/day/' + d; } })));
  if (fit) {
    const ya = fit.intercept + fit.slope * x0, yb = fit.intercept + fit.slope * x1;
    svg.append(s('defs', {}, s('clipPath', { id: 'scatter-clip' }, s('rect', { x: L, y: T, width: W - L - R, height: H - T - B }))),
      s('line', { x1: X(x0), y1: Y(ya), x2: X(x1), y2: Y(yb), stroke: cssVar('--text'), 'stroke-width': 2, 'stroke-dasharray': '6 4', 'clip-path': 'url(#scatter-clip)' }));
  }
  return svg;
}

pages.correlations = async (main, _, params) => {
  const types = await typeList();
  const options = [...Object.keys(CORR_EXTRA).filter(k => k.startsWith('glucose') ? types.blood_glucose && sectionOn('glucose') : sectionOn('workouts')),
    ...Object.values(types).filter(t => t.kind === 'quantity' || t.kind === 'category' || t.kind === 'ring').map(t => t.type)]
    .sort((a, b) => corrLabel(a).localeCompare(corrLabel(b)));
  const pick = (want, ...fallbacks) => [want, ...fallbacks].find(k => k && options.includes(k)) || options[0];
  const state = {
    y: pick(params.get('y'), 'blood_glucose', 'resting_heart_rate', 'step_count'),
    x: pick(params.get('x'), 'sleep_analysis', 'step_count', 'active_energy_burned'),
    range: params.get('range') || '1y', lag: params.get('lag') === '1' ? 1 : 0,
  };
  const sel = (key) => h('select', { onchange: e => { state[key] = e.target.value; draw(); } }, options.map(k => h('option', { value: k, selected: k === state[key] }, corrLabel(k))));
  const xSel = sel('x'), ySel = sel('y');
  const out = h('div'), table = h('div');
  main.replaceChildren(pageTitle('scatter', 'teal', 'Correlations'),
    card(null, h('div', { class: 'toolbar' }, h('span', {}, 'Does'), xSel, h('span', {}, 'go with'), ySel, h('span', {}, '?')),
      h('div', { class: 'toolbar', style: { marginBottom: 0 } },
        seg([['90d', '90 days'], ['1y', '1 year'], ['2y', '2 years'], ['5y', '5 years']], state.range, v => { state.range = v; draw(); }),
        seg([['0', 'Same day'], ['1', 'Day before']], String(state.lag), v => { state.lag = +v; draw(); }),
        h('span', { class: 'muted small' }, 'Day before: the first metric from the day before the second (e.g. sleep or a workout, then the next day’s glucose).'))),
    h('div', { style: { height: '16px' } }, ''), out, table);

  let seq = 0;
  async function draw() {
    const my = ++seq;
    setParams({ x: state.x, y: state.y, range: state.range, lag: String(state.lag) });
    xSel.value = state.x; ySel.value = state.y;
    loading(out);
    const days = { '90d': 90, '1y': 365, '2y': 730, '5y': 1826 }[state.range] || 365;
    const from = daysAgo(days), to = today();
    let X, Y;
    try { [X, Y] = await Promise.all([dailyValues(state.x, from, to), dailyValues(state.y, from, to)]); } catch (e) { if (my === seq) showError(out, e); return; }
    if (my !== seq) return;
    const pairs = corrPairs(X.values, Y.values, state.lag);
    const xDec = CORR_EXTRA[state.x]?.[2] ?? typeDec(state.x), yDec = CORR_EXTRA[state.y]?.[2] ?? typeDec(state.y);
    const xl = `${corrLabel(state.x)}${state.lag ? ' (day before)' : ''}${X.unit ? ' · ' + X.unit : ''}`, yl = `${corrLabel(state.y)}${Y.unit ? ' · ' + Y.unit : ''}`;
    if (pairs.length < 5) { out.replaceChildren(card(null, empty(`Only ${pairs.length} days have both. Pick a longer period or other metrics.`))); }
    else {
      const fit = pearson(pairs.map(p => p[1]), pairs.map(p => p[2]));
      const rho = pearson(ranks(pairs.map(p => p[1])), ranks(pairs.map(p => p[2])));
      const r = fit?.r;
      const words = r == null ? 'One of them doesn’t change, so there is nothing to compare.'
        : `${pairs.length} days show ${strength(r)}${Math.abs(r) >= 0.1 ? (r > 0 ? ': when ' + corrLabel(state.x).toLowerCase() + ' is higher, ' + corrLabel(state.y).toLowerCase() + ' tends to be higher too.' : ': when ' + corrLabel(state.x).toLowerCase() + ' is higher, ' + corrLabel(state.y).toLowerCase() + ' tends to be lower.') : '.'}`;
      out.replaceChildren(card(null,
        h('div', { class: 'row spread' }, h('h2', { style: { margin: 0 } }, `${corrLabel(state.x)} and ${corrLabel(state.y)}`),
          csvButton(() => downloadCSV(`iohealth-${state.x}-vs-${state.y}`, ['date', state.x + (state.lag ? '_day_before' : ''), state.y], pairs.map(p => [p[0], csvNum(p[1]), csvNum(p[2])])))),
        h('div', { class: 'stats', style: { margin: '12px 0' } }, stat('Correlation (r)', fmtNum(r, 2)), stat('Rank correlation', fmtNum(rho?.r, 2)),
          stat('Explains', r == null ? '—' : fmtNum(r * r * 100, 0) + '%', 'of the variation'), stat('Days', fmtNum(pairs.length)),
          fit ? stat(`Per 1 ${X.unit || 'unit'} more`, (fit.slope > 0 ? '+' : '') + fmtNum(fit.slope, Math.max(yDec, 2)), Y.unit) : null),
        h('p', {}, words),
        scatterPlot(pairs, fit, xl, yl, xDec, yDec),
        h('p', { class: 'small muted' }, 'Each dot is a day (darker is more recent); click one to open that day. The dashed line is the best straight-line fit. A link isn’t proof that one causes the other.')));
    }
    drawTable(my, from, to);
  }

  // What else goes with the second metric, same day and day before.
  async function drawTable(my, from, to) {
    const cands = [...new Set([...COMMON_TYPES, 'sleep_analysis', 'dietary_carbohydrates', 'dietary_energy_consumed', 'number_of_alcoholic_beverages', 'dietary_caffeine',
      'time_in_daylight', 'mindful_session', 'body_mass', ...Object.keys(CORR_EXTRA)])].filter(k => options.includes(k) && k !== state.y);
    table.replaceChildren(card(`What goes with ${corrLabel(state.y).toLowerCase()}`, h('p', { class: 'muted small' }, 'Working it out…')));
    const Y = await dailyValues(state.y, from, to).catch(() => null);
    const rows = await Promise.all(cands.map(async k => {
      const X = await dailyValues(k, from, to).catch(() => null);
      if (!X || !Y) return null;
      const res = [0, 1].map(lag => { const p = corrPairs(X.values, Y.values, lag); return p.length >= 14 ? { r: pearson(p.map(x => x[1]), p.map(x => x[2]))?.r, n: p.length } : null; });
      return res.some(x => x?.r != null) ? { k, res } : null;
    }));
    if (my !== seq) return;
    const list = rows.filter(Boolean).sort((a, b) => Math.max(...b.res.map(x => Math.abs(x?.r ?? 0))) - Math.max(...a.res.map(x => Math.abs(x?.r ?? 0))));
    const cell = (x, lag, k) => h('td', { class: 'r num click', style: { cursor: 'pointer' }, onclick: () => { state.x = k; state.lag = lag; draw(); $('#app').scrollTo(0, 0); } },
      x?.r == null ? '—' : h('span', {}, h('span', { class: 'corr-bar', style: { width: Math.abs(x.r) * 60 + 'px', background: x.r > 0 ? '#2563eb' : '#e8445a', marginRight: '8px' } }), fmtNum(x.r, 2)));
    table.replaceChildren(card(`What goes with ${corrLabel(state.y).toLowerCase()}`, list.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Metric'), h('th', { class: 'r' }, 'Same day (r)'), h('th', { class: 'r' }, 'Day before (r)'), h('th', { class: 'r' }, 'Days'))),
      h('tbody', {}, list.map(({ k, res }) => h('tr', {}, h('td', {}, corrLabel(k)), cell(res[0], 0, k), cell(res[1], 1, k), h('td', { class: 'r num muted' }, fmtNum(Math.max(res[0]?.n || 0, res[1]?.n || 0)))))))) : empty('Not enough overlapping days.'),
    h('p', { class: 'small muted' }, 'Blue: both go up together. Red: one goes up as the other goes down. Click a number to plot it. Needs at least 14 days in common.')));
  }
  draw();
};

// ---------- workouts ----------

pages.workouts = async (main, _, params) => {
  const state = { type: params.get('type') || '', range: params.get('range') || '365' };
  const [all, profile] = await Promise.all([api('workouts'), api('profile').catch(() => ({}))]);
  const typesCount = {};
  for (const w of all) typesCount[w.activityType] = (typesCount[w.activityType] || 0) + 1;
  const years = [...new Set(all.map(w => new Date(w.start * 1000).getFullYear()))].sort((a, b) => b - a);

  const body = h('div');
  const typeSel = h('select', { onchange: e => { state.type = e.target.value; draw(); } }, h('option', { value: '' }, `All activities (${all.length})`),
    Object.entries(typesCount).sort((a, b) => b[1] - a[1]).map(([t, n]) => h('option', { value: t, selected: t === state.type }, `${activityName(t)} (${n})`)));
  const rangeSel = h('select', { onchange: e => { state.range = e.target.value; draw(); } },
    [['90', 'Last 90 days'], ['365', 'Last 12 months'], ...years.map(y => ['y' + y, String(y)]), ['all', 'All time']]
      .map(([v, l]) => h('option', { value: v, selected: v === state.range }, l)));
  main.replaceChildren(pageTitle('run', 'orange', 'Workouts'), h('div', { class: 'toolbar' }, typeSel, rangeSel), body);
  if (!all.length) { body.append(card(null, empty('No workouts yet.'))); return; }

  function draw() {
    resetPage();
    setParams(Object.fromEntries(Object.entries(state).filter(([, v]) => v)));
    let from = 0, to = Infinity;
    const now = Date.now() / 1000;
    if (state.range === 'all') from = 0;
    else if (state.range.startsWith('y')) { const y = +state.range.slice(1); from = new Date(y, 0, 1) / 1000; to = new Date(y + 1, 0, 1) / 1000; }
    else from = now - +state.range * DAY;
    const ws = all.filter(w => (!state.type || w.activityType === state.type) && w.start >= from && w.start < to);
    const sum = (f) => ws.reduce((a, w) => a + (f(w) || 0), 0);

    const totals = card(null, h('div', { class: 'stats' }, stat('Workouts', fmtNum(ws.length)), stat('Time', fmtHM(sum(w => w.duration) / 60)),
      stat('Distance', ...distParts(sum(w => w.distance))), stat('Energy', fmtNum(sum(w => w.energy)), 'kcal'),
      stat('Climbing', fmtElev(sum(w => w.elevation))), stat('Avg per week', fmtHM(sum(w => w.duration) / 60 / Math.max(1, ((Math.min(to, now) - Math.max(from, ws.length ? ws[ws.length - 1].start : from)) / (7 * DAY)))))));

    const calEl = h('div', { class: 'calendar' });
    const volEl = h('div', { class: 'chart' });
    const loadEl = h('div', { class: 'chart' });
    const spanDays = (Math.min(to, now) - (from || (all.length ? all[all.length - 1].start : now))) / DAY;
    const monthly = spanDays > 400;
    body.replaceChildren(totals,
      card('Calendar', calEl, h('p', { class: 'small muted' }, 'Each square is a day, darker for more workout time. Click one to open that day.')),
      h('div', { class: 'grid cols-2' }, card(monthly ? 'Time per month' : 'Time per week', volEl),
        card('Training load', loadEl, h('p', { class: 'small muted' },
          `Fitness is the 42-day and fatigue the 7-day weighted average of daily TRIMP (heart-rate based effort, max HR ${profile.maxHr || '?'}, resting ${profile.restingHr || '?'}). Form = fitness − fatigue. Workouts without heart rate are skipped.`))),
      card(null, h('div', { class: 'row spread' }, h('h2', {}, `${ws.length} workouts`), csvButton(() => downloadCSV('iohealth-workouts',
        ['start', 'end', 'activity', 'minutes', 'distance_m', 'energy_kcal', 'avg_hr', 'max_hr', 'climb_m', 'source'],
        ws.map(w => [fmtLocal(w.start), fmtLocal(w.end), activityName(w.activityType), csvNum(w.duration / 60, 1), csvNum(w.distance, 0), csvNum(w.energy, 0), csvNum(w.hrAvg, 0), csvNum(w.hrMax, 0), csvNum(w.elevation, 0), w.source])))),
        workoutTable(ws.slice(0, 300)), ws.length > 300 ? h('p', { class: 'small muted' }, 'Showing the latest 300; narrow the range to see others.') : null));

    calendar(calEl, ws, state.range.startsWith('y') ? new Date(+state.range.slice(1), 11, 31) : new Date());
    const periods = monthly ? Math.ceil(spanDays / 30.4) + 1 : Math.max(4, Math.ceil(Math.min(spanDays, 3650) / 7) + 1);
    if (state.range.startsWith('y')) weeklyChartRange(volEl, ws, from, to, monthly);
    else weeklyChart(volEl, ws, Math.min(periods, monthly ? 240 : 60), { monthly });
    trainingLoad(loadEl, all.filter(w => !state.type || w.activityType === state.type), profile, from, Math.min(to, now));
  }
  draw();
};

function weeklyChartRange(el, ws, from, to, monthly) {
  // Weeks of a past year: the same as weeklyChart but anchored at the end of that year.
  const startOf = monthly ? (t => { const d = new Date(t * 1000); return new Date(d.getFullYear(), d.getMonth(), 1); }) : mondayOf;
  const xs = [];
  for (let d = startOf(from); d / 1000 < to; monthly ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 7)) xs.push(d.getTime() / 1000);
  const index = new Map(xs.map((x, i) => [x, i]));
  const byType = {};
  for (const w of ws) {
    const i = index.get(startOf(w.start).getTime() / 1000);
    if (i != null) (byType[w.activityType] ||= xs.map(() => 0))[i] += w.duration / 60;
  }
  const stacks = Object.entries(byType).map(([t, values]) => ({ label: activityName(t), color: activityColor(t), values }));
  if (!stacks.length) { el.append(empty('No workouts.')); return; }
  stackedBars(el, { xs, stacks, valueFmt: v => fmtHM(v), axisFmt: v => fmtCompact(v / 60) + 'h', incrs: MINUTE_INCRS });
}

function calendar(el, ws, endDate) {
  const minutes = {};
  for (const w of ws) { const d = isoDate(new Date(w.start * 1000)); minutes[d] = (minutes[d] || 0) + w.duration / 60; }
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 364); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const cell = 13, gap = 3, weeks = Math.ceil(((end - start) / 864e5 + 1) / 7);
  const svg = s('svg', { width: weeks * (cell + gap) + 30, height: 7 * (cell + gap) + 20 });
  const accent = cssVar('--accent'), lineC = cssVar('--line');
  const max = Math.max(60, ...Object.values(minutes));
  let lastMonth = -1;
  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const wk = Math.floor(i / 7), dow = (d.getDay() + 6) % 7, key = isoDate(d), m = minutes[key] || 0;
    if (d.getMonth() !== lastMonth && dow === 0) {
      lastMonth = d.getMonth();
      svg.append(s('text', { x: 30 + wk * (cell + gap), y: 10, 'font-size': 10, fill: cssVar('--muted') }, d.toLocaleDateString(undefined, { month: 'short' })));
    }
    const label = `${weekdayFmt.format(d)}: ${m ? fmtHM(m) : 'no workouts'}`;
    svg.append(s('rect', { x: 30 + wk * (cell + gap), y: 16 + dow * (cell + gap), width: cell, height: cell, rx: 2,
      fill: m ? accent : lineC, 'fill-opacity': m ? 0.25 + 0.75 * Math.min(1, m / max) : 1,
      onmousemove: e => showTip(e, label), onmouseleave: hideTip, onclick: () => { hideTip(); location.hash = '#/day/' + key; }, style: 'cursor:pointer' }));
  }
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => svg.append(s('text', { x: 0, y: 26 + i * 2 * (cell + gap), 'font-size': 10, fill: cssVar('--muted') }, d)));
  el.replaceChildren(svg);
}

// Banister TRIMP per day, then exponentially weighted fitness (42 days) and fatigue (7 days).
function trainingLoad(el, ws, profile, from, to) {
  const maxHr = +settings.maxHr || profile.maxHr, rest = profile.restingHr || 60;
  if (!maxHr) { el.append(empty('Needs a maximum heart rate (Settings) or your date of birth.')); return; }
  const male = profile.characteristics?.biologicalSex === '2';
  const daily = new Map();
  let first = Infinity;
  for (const w of ws) {
    if (!w.hrAvg) continue;
    const hrr = Math.max(0, Math.min(1, (w.hrAvg - rest) / (maxHr - rest)));
    const trimp = (w.duration / 60) * hrr * 0.64 * Math.exp((male ? 1.92 : 1.67) * hrr);
    const day = Math.floor(new Date(isoDate(new Date(w.start * 1000)) + 'T00:00').getTime() / 1000);
    daily.set(day, (daily.get(day) || 0) + trimp);
    first = Math.min(first, day);
  }
  if (!daily.size) { el.append(empty('No workouts with heart rate.')); return; }
  const xs = [], fit = [], fat = [], form = [], load = [];
  let ctl = 0, atl = 0;
  const startDay = new Date(first * 1000); startDay.setHours(0, 0, 0, 0);
  for (let d = startDay; d.getTime() / 1000 <= to; d.setDate(d.getDate() + 1)) {
    const t = d.getTime() / 1000, x = daily.get(t) || 0;
    ctl += (x - ctl) / 42; atl += (x - atl) / 7;
    if (t >= from - DAY) { xs.push(t); fit.push(ctl); fat.push(atl); form.push(ctl - atl); load.push(x || null); }
  }
  if (!xs.length) { el.append(empty('No data in this range.')); return; }
  chart(el, { xs, height: 240, series: [
    { label: 'Fitness', color: '#2563eb', dec: 0, values: fit },
    { label: 'Fatigue', color: '#e8445a', dec: 0, values: fat },
    { label: 'Form', color: '#16a34a', dec: 0, values: form, dash: [4, 3] },
    { label: 'Daily TRIMP', color: '#9aa1ad88', dec: 0, values: load, bars: true, scale: 'trimp', axisColor: cssVar('--muted') },
  ] });
}

// ---------- one workout ----------

pages.workout = async (main, id) => {
  const w = await api('workouts/' + encodeURIComponent(id));
  const name = activityName(w.activityType);
  const isPace = paceSports.has(w.activityType);
  const statsByType = Object.fromEntries((w.statistics || []).map(s => [s.type, s]));
  const statsEl = h('div', { class: 'stats' },
    stat('Duration', fmtDuration(w.duration)),
    w.distance ? stat('Distance', ...distParts(w.distance)) : null,
    w.distance && isPace ? stat('Avg pace', fmtPace(w.duration / (w.distance / 1000))) : null,
    w.distance && !isPace ? stat('Avg speed', fmtSpeed(w.distance / w.duration)) : null,
    w.energy ? stat('Active energy', fmtNum(w.energy), 'kcal') : null,
    w.hrAvg ? stat('Avg heart rate', fmtNum(w.hrAvg), 'bpm') : null,
    w.hrMax ? stat('Max heart rate', fmtNum(w.hrMax), 'bpm') : null,
    (w.elevation || w.routeGain) ? stat('Climb', fmtElev(w.elevation ?? w.routeGain)) : null,
    statsByType.running_power ? stat('Avg power', fmtNum(statsByType.running_power.average), 'W') : null,
    statsByType.cycling_power ? stat('Avg power', fmtNum(statsByType.cycling_power.average), 'W') : null,
    statsByType.cycling_cadence ? stat('Avg cadence', fmtNum(statsByType.cycling_cadence.average), 'rpm') : null,
    statsByType.step_count && w.duration ? stat('Cadence', fmtNum(statsByType.step_count.sum / (w.duration / 60)), 'spm') : null,
    w.metadata?.HKAverageMETs ? stat('Avg METs', fmtNum(parseFloat(w.metadata.HKAverageMETs), 1)) : null,
    w.metadata?.HKWeatherTemperature ? stat('Weather', weatherText(w.metadata)) : null,
  );

  main.replaceChildren(
    h('p', { class: 'small' }, h('a', { href: '#/workouts' }, '← Workouts')),
    h('div', { class: 'row spread' }, h('h1', { style: { color: activityColor(w.activityType) } }, name),
      h('span', { class: 'muted' }, fmtDateTime(w.start), ' – ', fmtTime(w.end), ' · ', w.source, w.indoor ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Indoor') : null)),
    card(null, statsEl));

  const series = w.series || {};
  const route = w.route || [];
  let mapMarker, map, routeTimes = route.map(p => p[0]);

  if (route.length > 1) {
    const mapEl = h('div', { class: 'map' });
    let colorBy = 'speed';
    const legend = h('div', { class: 'legend' });
    const mapCard = card(null, h('div', { class: 'row spread', style: { marginBottom: '10px' } }, h('h2', { style: { margin: 0 } }, 'Route'),
      seg([['speed', isPace ? 'Pace' : 'Speed'], ['hr', 'Heart rate'], ['alt', 'Elevation'], ['plain', 'Plain']], colorBy, v => { colorBy = v; paint(); })), mapEl, legend);
    main.append(mapCard);
    map = makeMap(mapEl);
    const latlngs = route.map(p => [p[1], p[2]]);
    const speeds = smoothSpeed(route);
    let layer;
    function paint() {
      if (layer) layer.remove();
      layer = L.layerGroup().addTo(map);
      const vals = colorBy === 'speed' ? speeds : colorBy === 'hr' ? route.map(p => p[6] > 0 ? p[6] : null) : colorBy === 'alt' ? route.map(p => p[3]) : null;
      if (!vals || vals.every(v => v == null)) {
        L.polyline(latlngs, { color: activityColor(w.activityType), weight: 4 }).addTo(layer);
        legend.replaceChildren(colorBy !== 'plain' ? 'No data for this colouring.' : '');
      } else {
        const sorted = vals.filter(v => v != null).sort((a, b) => a - b);
        const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)];
        const step = Math.max(1, Math.floor(route.length / 400));
        for (let i = 0; i < route.length - 1; i += step) {
          const j = Math.min(route.length - 1, i + step), v = vals[i];
          const f = v == null || hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
          L.polyline([latlngs[i], latlngs[j]], { color: rampColor(f), weight: 5, opacity: .95 }).addTo(layer);
        }
        const fmtV = colorBy === 'speed' ? (v => isPace ? fmtPace(1000 / v) : fmtSpeed(v)) : colorBy === 'hr' ? (v => fmtNum(v) + ' bpm') : fmtElev;
        legend.replaceChildren(h('span', {}, h('i', { style: { background: rampColor(0) } }), fmtV(lo)), h('span', {}, h('i', { style: { background: rampColor(.5) } }), 'middle'),
          h('span', {}, h('i', { style: { background: rampColor(1) } }), fmtV(hi)));
      }
      L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(layer).bindTooltip('Start');
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(layer).bindTooltip('Finish');
    }
    paint();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
    mapMarker = L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, opacity: 0, fillOpacity: 0 }).addTo(map);
  }

  // Charts over time, synced with each other and with the map marker.
  const chartsCard = card('Over time');
  const hooks = { setCursor: [u => {
    if (!mapMarker || u.cursor.idx == null) return;
    const t = u.data[0][u.cursor.idx];
    let i = lowerBound(routeTimes, t);
    if (i >= route.length) i = route.length - 1;
    if (i >= 0 && Math.abs(routeTimes[i] - t) < 120) { mapMarker.setLatLng([route[i][1], route[i][2]]); mapMarker.setStyle({ opacity: 1, fillOpacity: 1 }); }
  }] };
  let charts = 0;
  const addChart = (title, xs, values, opts) => {
    if (!xs.length || values.every(v => v == null)) return;
    const el = h('div', { class: 'chart' });
    chartsCard.append(h('h3', {}, title), el);
    chart(el, { xs, height: 170, sync: 'workout', hooks, series: [{ label: title, values, ...opts }], xFmt: (u, vals) => vals.map(v => fmtDuration(v - w.start)), xTime: false });
    charts++;
  };
  const hr = series.heart_rate || [];
  addChart('Heart rate', hr.map(p => p[0]), hr.map(p => p[1]), { color: '#e8445a', unit: 'bpm', dec: 0, fill: '#e8445a18' });
  if (route.length > 1) {
    const sp = smoothSpeed(route);
    if (isPace) addChart('Pace', routeTimes, sp.map(v => v && v > 0.5 ? 1000 / v : null), { color: '#2563eb', invert: true, axisFmt: v => fmtPace(v).replace(/ \/.*/, ''), value: (u, v) => v == null ? '—' : fmtPace(v), fill: undefined });
    else addChart('Speed', routeTimes, sp.map(v => v == null ? null : imperial() ? v * 2.236936 : v * 3.6), { color: '#2563eb', unit: imperial() ? 'mph' : 'km/h', dec: 1 });
    addChart('Elevation', routeTimes, route.map(p => imperial() ? p[3] * 3.28084 : p[3]), { color: '#65a30d', unit: imperial() ? 'ft' : 'm', dec: 0, fill: '#65a30d22' });
  }
  for (const [t, label, unit, color, k] of [['running_power', 'Running power', 'W', '#f59e0b', 1], ['cycling_power', 'Power', 'W', '#f59e0b', 1],
    ['cycling_cadence', 'Cadence', 'rpm', '#8b5cf6', 1], ['running_stride_length', 'Stride length', 'm', '#8b5cf6', 1],
    ['running_vertical_oscillation', 'Vertical oscillation', 'cm', '#06b6d4', 1], ['running_ground_contact_time', 'Ground contact', 'ms', '#db2777', 1]]) {
    const sr = series[t];
    if (sr?.length > 2) addChart(label, sr.map(p => p[0]), sr.map(p => p[1] * k), { color, unit, dec: 0 });
  }
  if (charts) main.append(chartsCard);
  const types = await typeList();
  if (types.blood_glucose) {
    const gl = await workoutGlucose(w).catch(() => null);
    if (gl) { main.append(gl[0]); gl[1](); }
  }

  const grid = h('div', { class: 'grid cols-2' });
  // Splits
  const sp = (w.splits || {})[imperial() ? 'mi' : 'km'] || [];
  if (sp.length) {
    const unitM = imperial() ? 1609.344 : 1000;
    const paces = sp.map(x => x.seconds / (x.distance / unitM));
    const fastest = Math.min(...paces), slowest = Math.max(...paces);
    const tb = h('tbody');
    sp.forEach((x, i) => tb.append(h('tr', {},
      h('td', { class: 'num' }, x.distance < unitM * 0.98 ? fmtNum(x.distance / unitM, 2) : x.index),
      h('td', { class: 'num' }, isPace ? fmtDuration(paces[i]) : fmtSpeed(x.distance / x.seconds)),
      h('td', { style: { width: '40%' } }, h('div', { class: 'bar-bg' }, h('div', { class: 'bar', style: { width: (30 + 70 * (slowest === fastest ? 1 : (slowest - paces[i]) / (slowest - fastest))) + '%', background: paces[i] === fastest ? '#16a34a' : cssVar('--accent') } }))),
      h('td', { class: 'r num' }, x.hr ? fmtNum(x.hr) + ' bpm' : ''),
      h('td', { class: 'r num' }, fmtElev(x.gain)))));
    grid.append(card(`Splits per ${imperial() ? 'mile' : 'km'}`, h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, imperial() ? 'Mile' : 'Km'),
      h('th', {}, isPace ? 'Pace' : 'Speed'), h('th', {}), h('th', { class: 'r' }, 'HR'), h('th', { class: 'r' }, 'Climb'))), tb))));
  }
  // Zones
  if (w.zones?.length) {
    const total = w.zones.reduce((a, z) => a + z.seconds, 0) || 1;
    const colors = ['#94a3b8', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];
    grid.append(card('Heart rate zones', ...w.zones.map((z, i) => h('div', { class: 'zone-row' },
      h('span', {}, h('b', {}, 'Zone ' + z.zone), h('div', { class: 'small muted' }, `${z.low}–${z.high} bpm`)),
      h('div', { class: 'bar-bg' }, h('div', { class: 'bar', style: { width: (z.seconds / total * 100) + '%', background: colors[i], height: '14px' } })),
      h('span', { class: 'num r' }, fmtDuration(z.seconds), h('div', { class: 'small muted' }, fmtNum(z.seconds / total * 100) + '%')))),
    h('p', { class: 'small muted' }, `Max heart rate ${fmtNum(w.maxHr)} bpm (${{ setting: 'from Settings', age: '220 − age', observed: 'highest recorded this year' }[w.maxHrFrom] || ''}).`)));
  }
  // Best efforts
  if (w.efforts?.length && isPace) {
    grid.append(card('Best efforts in this workout', ...w.efforts.map(e => h('div', { class: 'record' }, h('span', {}, e.name),
      h('span', { class: 'rv' }, fmtDuration(e.seconds), h('div', { class: 'small muted' }, fmtPace(e.seconds / (e.distance / 1000))))))));
  }
  // Segments and laps
  const laps = (w.events || []).filter(e => e.type === 'lap' || e.type === 'segment');
  if (w.activities?.length > 1) {
    grid.append(card('Segments', h('table', {}, h('tbody', {}, w.activities.map(a => h('tr', {}, h('td', {}, activityName(a.activity_type)),
      h('td', {}, fmtTime(a.start)), h('td', { class: 'r num' }, a.end ? fmtDuration(a.end - a.start) : '')))))));
  }
  if (laps.length) {
    grid.append(card(`Laps and segments (${laps.length})`, h('div', { class: 'scroll', style: { maxHeight: '320px' } }, h('table', {}, h('tbody', {}, laps.map((e, i) => h('tr', {},
      h('td', {}, `${e.type} ${i + 1}`), h('td', {}, fmtDuration(e.start - w.start)), h('td', { class: 'r num' }, fmtDuration(e.end - e.start)))))))));
  }
  // All statistics
  if (w.statistics?.length) {
    grid.append(card('All statistics', h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Type', 'Average', 'Min', 'Max', 'Total'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
      h('tbody', {}, w.statistics.map(st => h('tr', {}, h('td', {}, typeLabel(st.type), h('span', { class: 'muted small' }, ' ' + prettyUnit(st.unit))),
        ...['average', 'minimum', 'maximum', 'sum'].map(k => h('td', { class: 'r num' }, st[k] == null ? '' : fmtCompact(st[k] * scaleFor(st.unit)))))))))));
  }
  if (grid.children.length) main.append(grid);
};

function weatherText(m) {
  const t = m.HKWeatherTemperature.split(' ');
  let v = parseFloat(t[0]);
  if (t[1] === 'degF' && !imperial()) v = (v - 32) * 5 / 9;
  if (t[1] === 'degC' && imperial()) v = v * 9 / 5 + 32;
  const hum = m.HKWeatherHumidity ? ` · ${fmtNum(parseFloat(m.HKWeatherHumidity) / (parseFloat(m.HKWeatherHumidity) > 100 ? 100 : 1))}%` : '';
  return fmtNum(v) + (imperial() ? '°F' : '°C') + hum;
}

function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

// smoothSpeed: metres per second from distance over a ±15 s window, which is steadier than the per-fix GPS speed.
function smoothSpeed(route) {
  const out = new Array(route.length).fill(null);
  let a = 0, b = 0;
  for (let i = 0; i < route.length; i++) {
    while (route[a][0] < route[i][0] - 15) a++;
    while (b < route.length - 1 && route[b + 1][0] <= route[i][0] + 15) b++;
    const dt = route[b][0] - route[a][0];
    if (dt > 3) out[i] = (route[b][4] - route[a][4]) / dt;
  }
  return out;
}

function rampColor(f) { // blue → green → yellow → red
  const stops = [[37, 99, 235], [22, 163, 74], [234, 179, 8], [220, 38, 38]];
  const x = f * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), t = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * t));
  return `rgb(${c.join(',')})`;
}

function makeMap(el) {
  const map = L.map(el, { scrollWheelZoom: true, preferCanvas: true });
  const tiles = window.healthStatus?.tiles || {};
  // The page's Referrer-Policy (same-origin) would send tile requests without a Referer, and OpenStreetMap's tile
  // usage policy blocks those with a 403. Send just the site's origin to the tile server, nothing else.
  L.tileLayer(tiles.url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    referrerPolicy: 'strict-origin-when-cross-origin', maxZoom: 19, attribution: tiles.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  onCleanup(() => map.remove());
  observeWidth(el, () => map.invalidateSize());
  return map;
}

// ---------- all routes ----------

pages.map = async (main, _, params) => {
  const state = { type: params.get('type') || '', range: params.get('range') || '365' };
  const all = await api('workouts');
  const withRoute = all.filter(w => w.hasRoute);
  const typesCount = {};
  for (const w of withRoute) typesCount[w.activityType] = (typesCount[w.activityType] || 0) + 1;
  const years = [...new Set(withRoute.map(w => new Date(w.start * 1000).getFullYear()))].sort((a, b) => b - a);
  const mapEl = h('div', { class: 'map tall' });
  const info = h('span', { class: 'muted small' });
  const legend = h('div', { class: 'legend' });
  main.replaceChildren(pageTitle('map', 'cyan', 'Map'),
    h('div', { class: 'toolbar' },
      h('select', { onchange: e => { state.type = e.target.value; draw(); } }, h('option', { value: '' }, 'All activities'),
        Object.entries(typesCount).sort((a, b) => b[1] - a[1]).map(([t, n]) => h('option', { value: t, selected: t === state.type }, `${activityName(t)} (${n})`))),
      h('select', { onchange: e => { state.range = e.target.value; draw(); } },
        [['90', 'Last 90 days'], ['365', 'Last 12 months'], ...years.map(y => ['y' + y, String(y)]), ['all', 'All time']].map(([v, l]) => h('option', { value: v, selected: v === state.range }, l))),
      info),
    card(null, mapEl, legend));
  if (!withRoute.length) { mapEl.replaceWith(empty('No workouts with GPS routes yet.')); return; }
  await refreshStatus();
  const map = makeMap(mapEl);
  map.setView([20, 0], 2);
  let layer;
  async function draw() {
    setParams(Object.fromEntries(Object.entries(state).filter(([, v]) => v)));
    const p = {};
    if (state.type) p.type = state.type;
    if (state.range.startsWith('y')) { p.from = state.range.slice(1) + '-01-01'; p.to = state.range.slice(1) + '-12-31'; }
    else if (state.range === 'all') p.from = '2000-01-01';
    else p.from = daysAgo(+state.range);
    info.textContent = 'Loading routes…';
    const lines = await api('routes', p);
    if (layer) layer.remove();
    layer = L.featureGroup().addTo(map);
    const types = {};
    let dist = 0;
    for (const r of lines) {
      types[r.activityType] = (types[r.activityType] || 0) + 1;
      dist += r.distance;
      L.polyline(r.points, { color: activityColor(r.activityType), weight: 3, opacity: lines.length > 50 ? 0.45 : 0.8 })
        .bindTooltip(`${activityName(r.activityType)} · ${fmtDate(r.start)} · ${fmtDist(r.distance)}`, { sticky: true })
        .on('click', () => location.hash = '#/workout/' + r.uuid).addTo(layer);
    }
    info.textContent = `${lines.length} routes · ${fmtDist(dist, 0)}`;
    legend.replaceChildren(...Object.entries(types).map(([t, n]) => h('span', {}, h('i', { style: { background: activityColor(t) } }), `${activityName(t)} (${n})`)));
    if (lines.length) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  }
  draw();
};

// ---------- sleep ----------

const STAGES = [['deep', 'Deep', '#3730a3'], ['core', 'Core', '#3b82f6'], ['rem', 'REM', '#06b6d4'], ['asleep', 'Asleep (unspecified)', '#8b5cf6'], ['awake', 'Awake', '#f97316']];

pages.sleep = async (main, _, params) => {
  const state = { range: params.get('range') || '30' };
  const body = h('div');
  main.replaceChildren(pageTitle('bed', 'indigo', 'Sleep'), h('div', { class: 'toolbar' },
    seg([['14', '2 weeks'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']], state.range, v => { state.range = v; draw(); })), body);
  async function draw() {
    resetPage();
    setParams({ range: state.range });
    loading(body);
    const nights = await api('sleep', { from: daysAgo(+state.range - 1), to: today() });
    if (!nights.length) { body.replaceChildren(card(null, empty('No sleep data in this period.'))); return; }
    const avg = f => { const xs = nights.map(f).filter(v => v != null && isFinite(v)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    // Clock times as minutes from noon, so 23:30 and 00:30 average to midnight.
    const clock = t => { const d = new Date(t * 1000); let m = d.getHours() * 60 + d.getMinutes() - 720; if (m < 0) m += 1440; return m; };
    const fmtClock = m => { if (m == null) return '—'; const x = Math.round(m + 720) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
    const beds = nights.filter(n => n.start).map(n => clock(n.start));
    const sd = beds.length > 1 ? Math.sqrt(beds.reduce((a, b) => a + (b - avg(n => n.start ? clock(n.start) : null)) ** 2, 0) / beds.length) : null;
    const stagesChart = h('div', { class: 'chart' }), clockChart = h('div', { class: 'chart' });
    const nightCard = card('Night');
    body.replaceChildren(
      card(null, h('div', { class: 'stats' }, stat('Avg asleep', fmtHM(avg(n => n.asleep))), stat('Avg in bed', fmtHM(avg(n => n.inBed || null))),
        stat('Avg bedtime', fmtClock(avg(n => n.start ? clock(n.start) : null))), stat('Avg wake', fmtClock(avg(n => n.end ? clock(n.end) : null))),
        stat('Bedtime spread', sd == null ? '—' : '±' + fmtNum(sd) + ' min'), stat('Avg deep', fmtHM(avg(n => n.stages.deep))), stat('Avg REM', fmtHM(avg(n => n.stages.rem))),
        stat('Nights ≥ 7 h', fmtNum(nights.filter(n => n.asleep >= 420).length / nights.length * 100) + '%'))),
      card(null, h('div', { class: 'row spread' }, h('h2', {}, 'Sleep stages per night'), csvButton(() => downloadCSV('iohealth-sleep',
        ['night_ending', 'bedtime', 'wake', 'asleep_min', 'in_bed_min', ...STAGES.map(x => x[0] + '_min')],
        nights.map(n => [n.date, n.start ? fmtLocal(n.start) : '', n.end ? fmtLocal(n.end) : '', csvNum(n.asleep, 0), csvNum(n.inBed, 0), ...STAGES.map(x => csvNum(n.stages[x[0]] || 0, 0))])))), stagesChart, h('p', { class: 'small muted' }, 'Click a night for its timeline. When several apps record the same night, the one with the most sleep is used.')),
      h('div', { class: 'grid cols-2' }, card('Bedtime and wake time', clockChart), nightCard));
    const xs = nights.map(n => new Date(n.date + 'T00:00').getTime() / 1000);
    const used = STAGES.filter(([k]) => nights.some(n => n.stages[k] > 0));
    const u = stackedBars(stagesChart, { xs, height: 280, stacks: used.map(([k, label, color]) => ({ label, color, values: nights.map(n => (n.stages[k] || 0)) })),
      valueFmt: fmtHM, axisFmt: v => fmtNum(v / 60) + 'h', incrs: MINUTE_INCRS, xFmt: (u, vals) => vals.map(v => fmtDateShort(v)) });
    u.over.addEventListener('click', () => { if (u.cursor.idx != null) showNight(nights[u.cursor.idx].date); });
    u.over.style.cursor = 'pointer';
    chart(clockChart, { xs, height: 240, incrs: [60, 120, 180, 240, 360], yRange: (u, mn, mx) => [Math.min(mn, 480) - 30, Math.max(mx, 1260) + 30], axisFmt: fmtClock, series: [
      { label: 'Bedtime', color: '#8b5cf6', values: nights.map(n => n.start ? clock(n.start) : null), points: true, width: 1, value: (u, v) => fmtClock(v) },
      { label: 'Wake', color: '#f59e0b', values: nights.map(n => n.end ? clock(n.end) : null), points: true, width: 1, value: (u, v) => fmtClock(v) },
    ] });
    async function showNight(date) {
      nightCard.replaceChildren(h('h2', {}, 'Night of ' + new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
      try {
        const n = await api('sleep', { date });
        nightCard.append(hypnogram(n), h('div', { class: 'stats', style: { marginTop: '12px' } }, stat('Asleep', fmtHM(n.asleep)),
          ...used.map(([k, label]) => stat(label, fmtHM(n.stages[k] || 0)))), h('p', { class: 'small muted' }, 'Source: ' + n.source + ' · ', h('a', { href: '#/day/' + date }, 'The day after →')));
      } catch (e) { nightCard.append(h('p', { class: 'error' }, e.message)); }
    }
    showNight(nights[nights.length - 1].date);
  }
  draw();
};

function hypnogram(n) {
  const segs = n.segments.filter(s => s.stage !== 'inBed');
  if (!segs.length) return empty('No stage data.');
  const t0 = Math.min(...segs.map(s => s.s)), t1 = Math.max(...segs.map(s => s.e));
  const rows = ['awake', 'rem', 'core', 'deep', 'asleep'].filter(k => segs.some(s => s.stage === k));
  const W = 600, rowH = 26, H = rows.length * rowH + 22;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', preserveAspectRatio: 'none', style: 'max-height:200px' });
  const X = t => 70 + (t - t0) / (t1 - t0) * (W - 80);
  rows.forEach((k, i) => svg.append(s('text', { x: 0, y: i * rowH + 17, 'font-size': 11, fill: cssVar('--muted') }, STAGES.find(x => x[0] === k)[1].replace(' (unspecified)', ''))));
  for (const sg of segs) {
    const i = rows.indexOf(sg.stage);
    if (i < 0) continue;
    svg.append(s('rect', { x: X(sg.s), y: i * rowH + 4, width: Math.max(1, X(sg.e) - X(sg.s)), height: rowH - 8, rx: 3, fill: STAGES.find(x => x[0] === sg.stage)[2],
      onmousemove: e => showTip(e, `${STAGES.find(x => x[0] === sg.stage)[1]} ${fmtTime(sg.s)}–${fmtTime(sg.e)}`), onmouseleave: hideTip }));
  }
  for (let t = Math.ceil(t0 / 3600) * 3600; t < t1; t += 3600) {
    svg.append(s('text', { x: X(t), y: H - 4, 'font-size': 10, fill: cssVar('--muted'), 'text-anchor': 'middle' }, fmtTime(t).replace(/:00/, '')));
  }
  return svg;
}

// ---------- blood glucose ----------

const GLUCOSE_BANDS = [['veryLow', 'Very low', '#991b1b'], ['low', 'Low', '#ef4444'], ['inRange', 'In range', '#16a34a'], ['high', 'High', '#f59e0b'], ['veryHigh', 'Very high', '#c2410c']];
const GLUCOSE_OVERLAYS = ['heart_rate', 'step_count', 'active_energy_burned', 'dietary_carbohydrates', 'insulin_delivery', 'apple_exercise_time',
  'heart_rate_variability_sdnn', 'respiratory_rate', 'body_mass'];
const mmol = () => settings.glucoseUnit === 'mmol/L';
const gUnit = () => mmol() ? 'mmol/L' : 'mg/dL';
const gVal = v => v == null ? null : mmol() ? v / 18.0182 : v;
const fmtG = v => v == null || !isFinite(v) ? '—' : fmtNum(gVal(v), mmol() ? 1 : 0);
const pct = f => fmtNum((f || 0) * 100, 0) + '%';

function rangeBar(r, height = 22) {
  const bar = h('div', { style: { display: 'flex', height: height + 'px', borderRadius: '6px', overflow: 'hidden', background: cssVar('--line') } });
  for (const [k, label, color] of GLUCOSE_BANDS) if (r[k] > 0) bar.append(h('div', { title: `${label}: ${pct(r[k])}`, style: { width: r[k] * 100 + '%', background: color } }));
  return bar;
}
function rangeLegend(r, target) {
  const lo = fmtG(target[0]), hi = fmtG(target[1]);
  const labels = { veryLow: `< ${fmtG(54)}`, low: `${fmtG(54)}–${lo}`, inRange: `${lo}–${hi}`, high: `${hi}–${fmtG(250)}`, veryHigh: `> ${fmtG(250)}` };
  return h('div', { class: 'legend' }, GLUCOSE_BANDS.map(([k, label, color]) => h('span', {}, h('i', { style: { background: color } }), `${label} ${labels[k]}: `, h('b', {}, pct(r[k])))));
}

// glucoseLine: readings as [times, values] with a gap (null) wherever readings stop for more than 20 minutes
// (a sensor change, or no CGM), so the line isn't drawn straight across the missing time.
function glucoseLine(readings) {
  const xs = [], ys = [];
  readings.forEach((r, i) => {
    // A null at each end of the gap, so points of other series joined in between can't bridge it.
    if (i && r[0] - readings[i - 1][0] > 1200) { xs.push(readings[i - 1][0] + 300, r[0] - 300); ys.push(null, null); }
    xs.push(r[0]); ys.push(gVal(r[1]));
  });
  return [xs, ys];
}

// keepGaps: after joining other series onto a glucose line, the glucose column has no value at their times; inside a
// gap (between the nulls glucoseLine put there) those become null too, so the line can't bridge the gap through them.
function keepGaps(data) {
  const col = data[1];
  let inGap = false;
  for (let i = 0; i < col.length; i++) {
    if (col[i] === null) inGap = !inGap; // nulls come in pairs: where a gap starts and where it ends
    else if (col[i] === undefined) { if (inGap) col[i] = null; }
    else inGap = false;
  }
  return data;
}

// Shades the target range (and optionally workouts) behind a chart whose glucose scale is 'g'.
function glucoseBackdrop(target, workouts = []) {
  return u => {
    const ctx = u.ctx, { left, top, width, height } = u.bbox;
    ctx.save();
    const y1 = u.valToPos(gVal(target[1]), 'g', true), y2 = u.valToPos(gVal(target[0]), 'g', true);
    ctx.fillStyle = 'rgba(22,163,74,0.10)';
    ctx.fillRect(left, Math.max(top, y1), width, Math.min(top + height, y2) - Math.max(top, y1));
    ctx.fillStyle = 'rgba(249,115,22,0.13)';
    for (const w of workouts) {
      const x1 = u.valToPos(w.start, 'x', true), x2 = u.valToPos(w.end, 'x', true);
      if (x2 < left || x1 > left + width) continue;
      ctx.fillRect(Math.max(left, x1), top, Math.min(left + width, x2) - Math.max(left, x1), height);
    }
    ctx.restore();
  };
}

pages.glucose = async (main, _, params) => {
  const types = await typeList();
  const state = { range: params.get('range') || '14', overlays: (params.get('with') || '').split(',').filter(Boolean), workouts: params.get('workouts') !== '0' };
  if (!types.blood_glucose) {
    main.replaceChildren(pageTitle('drop', 'rose', 'Blood glucose'), card(null, empty('No blood glucose readings yet. Turn on Blood Glucose under Data types in the iPhone app (CGM apps such as Dexcom, Libre or a meter app write it to Health), then sync.')));
    return;
  }
  const body = h('div');
  const overlayChips = h('div', { class: 'row' });
  const unitSeg = h('span');
  main.replaceChildren(pageTitle('drop', 'rose', 'Blood glucose'),
    h('div', { class: 'toolbar' },
      seg([['1', '24 hours'], ['3', '3 days'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']], state.range, v => { state.range = v; draw(); }),
      unitSeg),
    body);
  async function draw() {
    resetPage();
    setParams(Object.fromEntries(Object.entries({ range: state.range, with: state.overlays.join(','), workouts: state.workouts ? '' : '0' }).filter(([, v]) => v)));
    loading(body);
    const days = +state.range;
    const from = days === 1 ? String(Math.floor(Date.now() / 1000) - DAY) : daysAgo(days - 1);
    const target = [+settings.glucoseLow || 70, +settings.glucoseHigh || 180];
    const [g, ws] = await Promise.all([api('glucose', { from, to: today(), low: target[0], high: target[1] }), api('workouts', { from: daysAgo(days), to: today() })]);
    if (!settings.glucoseUnit) settings.glucoseUnit = g.recordedUnit;
    unitSeg.replaceChildren(seg([['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']], gUnit(), v => { settings.glucoseUnit = v; saveSettings(); draw(); }));
    const st = g.stats;
    if (!st.readings) { body.replaceChildren(card(null, empty('No readings in this period.'))); return; }
    const cgm = st.perDay > 50;

    const statsCard = card(null, h('div', { class: 'stats' },
      stat('Average', fmtG(st.mean), gUnit()), stat('GMI (est. A1c)', fmtNum(st.gmi, 1), '%'),
      stat('Time in range', pct(st.ranges.inRange)), stat('Below range', pct(st.ranges.low + st.ranges.veryLow)),
      stat('Above range', pct(st.ranges.high + st.ranges.veryHigh)), stat('Variability (CV)', fmtNum(st.cv, 1), '%'),
      stat('Std deviation', fmtG(st.sd), gUnit()), stat('Lows ≥ 15 min', fmtNum(st.lows)),
      stat('Lowest / highest', `${fmtG(st.min)} / ${fmtG(st.max)}`), stat('Readings', fmtNum(st.readings), cgm && days >= 3 ? `${fmtNum(st.perDay)}/day` : '')),
    h('div', { style: { marginTop: '14px' } }, rangeBar(st.ranges)), rangeLegend(st.ranges, g.target),
    h('p', { class: 'small muted' }, `Targets: time in range above 70 %, below range under 4 %, CV at or under 36 %. GMI estimates HbA1c from the average (3.31 + 0.02392 × mg/dL) and needs about 14 days of CGM data to mean much. Target range ${fmtG(g.target[0])}–${fmtG(g.target[1])} ${gUnit()} (change it in Settings).`));

    // Readings chart with overlays.
    const avail = GLUCOSE_OVERLAYS.filter(t => types[t]);
    overlayChips.replaceChildren(h('span', { class: 'muted small' }, 'Overlay:'),
      ...avail.map((t, i) => h('span', { class: 'chip' + (state.overlays.includes(t) ? ' on' : ''), style: { color: PALETTE[(i + 1) % PALETTE.length] },
        onclick: () => { state.overlays = state.overlays.includes(t) ? state.overlays.filter(x => x !== t) : [...state.overlays, t]; draw(); } },
      h('span', { class: 'dot', style: { background: PALETTE[(i + 1) % PALETTE.length] } }), typeLabel(t))),
      h('label', { class: 'chip' + (state.workouts ? ' on' : ''), style: { color: '#f97316' } }, h('input', { type: 'checkbox', checked: state.workouts, style: { margin: 0 },
        onchange: e => { state.workouts = e.target.checked; draw(); } }), 'Workouts'),
      h('a', { class: 'small', href: '#/metrics?types=' + ['blood_glucose', ...state.overlays].join(',') + '&range=' + (days <= 7 ? '7d' : days <= 30 ? '30d' : days <= 90 ? '90d' : '1y') + '&mode=stack' }, 'Open in Metrics →'));
    const readingsEl = h('div', { class: 'chart' });
    const agpEl = h('div', { class: 'chart' });
    const dailyEl = h('div', { class: 'chart' });
    body.replaceChildren(statsCard,
      card(null, h('div', { class: 'row spread' }, h('h2', {}, 'Readings'), csvButton(() => downloadCSV('iohealth-glucose-' + daysAgo(days - 1) + '-' + today(),
        ['time', 'glucose', 'unit', 'note'], g.readings.map(r => [fmtLocal(r[0]), csvNum(gVal(r[1]), 1), gUnit(), r[2] || ''])))), h('div', { class: 'toolbar' }, overlayChips), readingsEl,
        h('p', { class: 'small muted' }, 'Green band: target range. ', state.workouts ? 'Orange: workouts. ' : '', 'Overlays get their own axis. Drag to move, scroll or Shift-drag to zoom, double-click to reset.')),
      days < 3 ? null : h('div', { class: 'grid cols-2' },
        card('Daily pattern (ambulatory glucose profile)', agpEl, h('p', { class: 'small muted' }, `Every day of the period folded onto one: median line, 25–75 % and 5–95 % bands, per 15 minutes${cgm ? '' : '. With finger-prick readings only, the bands are rough'}.`)),
        card('Time in range per day', dailyEl)));

    // The readings chart covers the selected period at first; dragging or zooming past what's loaded fetches the readings,
    // overlays and workouts for the new view, so it can be moved back through the whole history.
    const bucket = days <= 3 ? 'raw' : days <= 30 ? 'hour' : 'day';
    const wsShown = state.workouts ? [...ws] : [];
    const overlaysFor = (a, b) => Promise.all(state.overlays.map(t => api('series', { type: t, from: a, to: b, bucket: isCumulativeType(types, t) && bucket === 'raw' ? 'hour' : bucket }).catch(() => null)));
    const defs = [];
    const joinData = (readings, overlayData) => {
      const tables = [glucoseLine(readings)];
      state.overlays.forEach((t, k) => {
        const sr = overlayData[k], d = defs.find(d => d.t === t);
        if (!d) return;
        tables.push(sr && sr.points.length ? [sr.points.map(p => p.t), sr.points.map(p => p.v * scaleFor(sr.unit))] : [[readings[0]?.[0] ?? 0], [null]]);
      });
      return tables.length > 1 ? keepGaps(uPlot.join(tables, tables.map((t, i) => [0, i ? 0 : 1]))) : tables[0];
    };
    const fromT = days === 1 ? +from : Math.floor(new Date(from + 'T00:00:00').getTime() / 1000), nowT = Math.floor(Date.now() / 1000);
    const overlayData = await overlaysFor(fromT, nowT);
    overlayData.forEach((sr, k) => {
      if (sr && sr.points.length) defs.push({ t: state.overlays[k], sr, color: PALETTE[(avail.indexOf(state.overlays[k]) + 1) % PALETTE.length] });
    });
    const joined = joinData(g.readings, overlayData);
    let loaded = [fromT, nowT], fetchSeq = 0;
    const group = zoomGroup({ home: [fromT, nowT], onView: async ([a, b]) => {
      if (a >= loaded[0] && b <= loaded[1]) return;
      const span = b - a, fa = Math.floor(a - span), fb = Math.min(nowT, Math.ceil(b + span)), seq = ++fetchSeq;
      try {
        const [gg, od, ww] = await Promise.all([api('glucose', { from: fa, to: fb, low: target[0], high: target[1] }), overlaysFor(fa, fb),
          state.workouts ? api('workouts', { from: fa, to: fb }) : []]);
        if (seq !== fetchSeq || !gg.readings.length) return;
        loaded = [fa, fb];
        wsShown.splice(0, wsShown.length, ...(Array.isArray(ww) ? ww : ww.workouts || []));
        const [va, vb] = group.view();
        readingsChart.setData(joinData(gg.readings, od), false);
        readingsChart.setScale('x', { min: va, max: vb });
      } catch (e) { /* keep what's shown */ }
    } });
    const readingsChart = chart(readingsEl, {
      xs: joined[0], height: 340, zoom: false, hooks: { drawClear: [glucoseBackdrop(g.target, wsShown)], setScale: [(u, key) => { if (key === 'x') group.scaled(u); }] },
      series: [
        { label: 'Glucose', color: '#e8445a', scale: 'g', unit: gUnit(), dec: mmol() ? 1 : 0, values: joined[1], points: !cgm || g.readings.length < 200, width: cgm ? 2 : 1.5,
          spanGaps: false, axisFmt: v => fmtNum(v, mmol() ? 1 : 0) },
        ...defs.map((d, k) => ({ label: typeLabel(d.t), color: d.color, scale: d.t, unit: prettyUnit(d.sr.unit), dec: typeDec(d.t, d.sr.unit), values: joined[k + 2],
          bars: d.sr.cumulative, width: 1.5, fill: d.sr.cumulative ? d.color + '66' : undefined })),
      ],
    });
    group.attach(readingsChart);
    // Ambulatory glucose profile and per-day time in range, for periods of several days.
    if (days < 3) { /* one day: the readings chart says it all */ }
    else if (g.agp.length > 3) {
      const xs = g.agp.map(b => b.minute * 60), col = k => g.agp.map(b => gVal(b[k]));
      chart(agpEl, { xs, height: 280, xTime: false, xIncrs: [3600, 7200, 10800, 14400, 21600], xFmt: (u, vals) => vals.map(v => `${String(Math.floor(v / 3600)).padStart(2, '0')}:${String(Math.floor(v % 3600 / 60)).padStart(2, '0')}`),
        hooks: { drawClear: [glucoseBackdrop(g.target)] },
        bands: [{ series: [1, 5], fill: '#e8445a1a' }, { series: [2, 4], fill: '#e8445a40' }],
        series: [['95 %', 'p95'], ['75 %', 'p75'], ['Median', 'p50'], ['25 %', 'p25'], ['5 %', 'p5']].map(([label, k]) => ({
          label, scale: 'g', values: col(k), color: k === 'p50' ? '#e8445a' : '#e8445a66', width: k === 'p50' ? 2.5 : 1, dash: k === 'p5' || k === 'p95' ? [4, 3] : undefined,
          unit: gUnit(), dec: mmol() ? 1 : 0, axisFmt: v => fmtNum(v, mmol() ? 1 : 0) })) });
    } else agpEl.append(empty('Not enough readings for a daily pattern.'));
    // Per-day time in range
    if (days >= 3) {
    const xs = g.days.map(d => new Date(d.date + 'T00:00').getTime() / 1000);
    stackedBars(dailyEl, { xs, height: 280, stacks: GLUCOSE_BANDS.map(([k, label, color]) => ({ label, color, values: g.days.map(d => d.ranges[k] * 100) })),
      valueFmt: v => fmtNum(v, 0) + '%', axisFmt: v => fmtNum(v) + '%', xFmt: (u, vals) => vals.map(v => fmtDateShort(v)) });
    }

    // How glucose moves around workouts and meals.
    if (cgm && days >= 3) {
      const slot = h('div');
      body.append(slot);
      const carbs = types.dietary_carbohydrates ? await api('series', { type: 'dietary_carbohydrates', from: daysAgo(days - 1), to: today(), bucket: 'raw' }).catch(() => null) : null;
      slot.replaceWith(responseCard(g.readings, sectionOn('workouts') ? ws.filter(w => w.start >= fromT) : [], carbs?.points || []));
    }

    // Finger-prick style readings list.
    if (!cgm) {
      const recent = g.readings.slice(-60).reverse();
      body.append(card('Latest readings', h('div', { class: 'scroll', style: { maxHeight: '360px' } }, h('table', {}, h('tbody', {}, recent.map(r => h('tr', {},
        h('td', {}, fmtDateTime(r[0])), h('td', { class: 'r num' }, fmtG(r[1]), ' ', gUnit()), h('td', { class: 'muted' }, r[2] || ''),
        h('td', {}, h('span', { class: 'badge', style: { color: r[1] < g.target[0] ? '#ef4444' : r[1] > g.target[1] ? '#f59e0b' : '#16a34a' } },
          r[1] < g.target[0] ? 'low' : r[1] > g.target[1] ? 'high' : 'in range')))))))));
    }
  }
  draw();
};
function isCumulativeType(types, t) { return !!types[t]?.cumulative; }

// ---------- glucose around workouts and meals ----------

// glucoseAt reads glucose (mg/dL) at time t from sorted readings: interpolated between neighbours up to 20 minutes
// apart, else the nearest reading within 7.5 minutes.
function glucoseAt(rt, rv, t) {
  const b = lowerBound(rt, t), a = b - 1;
  if (a >= 0 && b < rt.length && rt[b] - rt[a] <= 1200) return rt[b] === rt[a] ? rv[a] : rv[a] + (rv[b] - rv[a]) * (t - rt[a]) / (rt[b] - rt[a]);
  if (b < rt.length && rt[b] - t <= 450) return rv[b];
  if (a >= 0 && t - rt[a] <= 450) return rv[a];
  return null;
}
const RESPONSE_STEP = 5; // minutes
// glucoseResponse: the glucose curve from `before` minutes before t to `after` minutes after it on a 5-minute grid,
// with the baseline (average of the 30 minutes before). Null when the readings don't cover it well.
function glucoseResponse(rt, rv, t, before = 60, after = 180) {
  const mins = [], vals = [];
  for (let m = -before; m <= after; m += RESPONSE_STEP) { mins.push(m); vals.push(glucoseAt(rt, rv, t + m * 60)); }
  const pre = vals.filter((v, i) => mins[i] >= -30 && mins[i] <= 0 && v != null);
  if (pre.length < 3 || vals.filter(v => v != null).length < vals.length * 0.6) return null;
  const base = pre.reduce((a, b) => a + b, 0) / pre.length;
  const at = m => vals[mins.indexOf(Math.round(m / RESPONSE_STEP) * RESPONSE_STEP)] ?? null;
  const within = (a, b) => vals.filter((v, i) => mins[i] >= a && mins[i] <= b && v != null);
  return { t, mins, vals, base, at, within };
}

// mealsFrom groups carbohydrate entries less than 30 minutes apart into meals of at least 10 g.
function mealsFrom(points) {
  const meals = [];
  for (const p of points) {
    const last = meals[meals.length - 1];
    if (last && p.t - last.t <= 1800) last.carbs += p.v;
    else meals.push({ t: p.t, carbs: p.v });
  }
  return meals.filter(m => m.carbs >= 10);
}

const fmtMin = m => m === 0 ? '0' : (m < 0 ? '−' : '+') + (Math.abs(m) >= 60 && Math.abs(m) % 60 === 0 ? Math.abs(m) / 60 + ' h' : Math.abs(m) + ' min');
const fmtDelta = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtG(Math.abs(v));

// responseCard: average glucose change around workouts (per activity) or meals (per meal size), and the list.
function responseCard(readings, workouts, carbPoints) {
  const rt = readings.map(r => r[0]), rv = readings.map(r => r[1]);
  const body = h('div');
  let mode = workouts.length ? 'workouts' : 'meals';
  const el = card(null, h('div', { class: 'row spread', style: { marginBottom: '10px' } }, h('h2', { style: { margin: 0 } }, 'Glucose around workouts and meals'),
    h('div', { class: 'row' }, seg([['workouts', `Workouts`], ['meals', 'Meals']], mode, v => { mode = v; draw(); }), csvButton(() => exportCsv()))), body);
  let rows = [];
  function draw() {
    const isW = mode === 'workouts';
    const events = isW ? workouts.map(w => ({ t: w.start, w, dur: Math.round((w.end - w.start) / 60) }))
      : mealsFrom(carbPoints).map(m => ({ t: m.t, carbs: m.carbs }));
    const after = isW ? 180 : 180;
    rows = [];
    for (const e of events) {
      const r = glucoseResponse(rt, rv, e.t, 60, after);
      if (!r) continue;
      if (isW) {
        const endM = Math.min(e.dur, after), during = r.within(0, endM + 60);
        rows.push({ e, r, group: e.w.activityType, groupLabel: activityName(e.w.activityType), color: activityColor(e.w.activityType),
          a: r.at(endM) == null ? null : r.at(endM) - r.base, b: during.length ? Math.min(...during) : null, c: r.at(endM + 60) == null ? null : r.at(endM + 60) - r.base });
      } else {
        const post = r.mins.map((m, i) => [m, r.vals[i]]).filter(([m, v]) => m >= 0 && v != null);
        if (!post.length) continue;
        const [pm, pv] = post.reduce((x, y) => y[1] > x[1] ? y : x);
        const back = post.find(([m, v]) => m > pm && v <= r.base + 10);
        const size = e.carbs < 30 ? ['small', 'Under 30 g', '#16a34a'] : e.carbs < 60 ? ['medium', '30–60 g', '#f59e0b'] : ['large', '60 g or more', '#e8445a'];
        rows.push({ e, r, group: size[0], groupLabel: size[1], color: size[2], a: pv - r.base, b: pm, c: back ? back[0] : null });
      }
    }
    if (!rows.length) {
      body.replaceChildren(empty(isW ? 'No workouts in this period with glucose readings around them. Pick a longer period.' :
        carbPoints.length ? 'No meals with readings around them in this period. Pick a longer period.' : 'No carbohydrates logged. Log meals (carbs) in an app that writes to Health and they show up here.'));
      return;
    }
    // Average change from the baseline per group.
    const groups = new Map();
    for (const x of rows) (groups.get(x.group) || groups.set(x.group, { label: x.groupLabel, color: x.color, rows: [] }).get(x.group)).rows.push(x);
    const top = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length).slice(0, 6);
    const mins = rows[0].r.mins;
    const series = top.map(g => ({
      label: `${g.label} (${g.rows.length})`, color: g.color, unit: gUnit(), dec: mmol() ? 1 : 0, width: 2.5,
      values: mins.map((m, i) => { const ds = g.rows.filter(x => x.r.vals[i] != null).map(x => x.r.vals[i] - x.r.base); return ds.length ? gVal(ds.reduce((a, b) => a + b, 0) / ds.length) : null; }),
      value: (u, v) => v == null ? '—' : (v > 0 ? '+' : '') + fmtNum(v, mmol() ? 1 : 0) + ' ' + gUnit(),
    }));
    const chartEl = h('div', { class: 'chart' });
    const tb = h('tbody');
    for (const x of rows.slice().sort((a, b) => b.e.t - a.e.t).slice(0, 60)) {
      tb.append(h('tr', { class: 'click', onclick: () => location.hash = isW ? '#/workout/' + x.e.w.uuid : '#/day/' + isoDate(new Date(x.e.t * 1000)) },
        h('td', {}, fmtDateTime(x.e.t)),
        h('td', {}, isW ? h('span', { style: { color: x.color, fontWeight: 600 } }, activityName(x.e.w.activityType), h('span', { class: 'muted' }, ' · ' + fmtHM(x.e.dur))) : fmtNum(x.e.carbs, 0) + ' g'),
        h('td', { class: 'r num' }, fmtG(x.r.base)),
        h('td', { class: 'r num' }, fmtDelta(x.a)),
        h('td', { class: 'r num' }, isW ? fmtG(x.b) : fmtMin(x.b)),
        h('td', { class: 'r num' }, isW ? fmtDelta(x.c) : x.c == null ? 'not within 3 h' : fmtMin(x.c))));
    }
    const heads = isW ? ['When', 'Workout', 'Before', 'Change by the end', 'Lowest (to 1 h after)', '1 h after the end'] : ['When', 'Carbs', 'Before', 'Rise to peak', 'Peak after', 'Back near start'];
    body.replaceChildren(chartEl,
      h('p', { class: 'small muted' }, isW ? 'Average change from the level in the 30 minutes before the start, per activity. 0 is the start of the workout.'
        : 'Average change from the level in the 30 minutes before eating, per meal size. Carb entries less than 30 minutes apart count as one meal.'),
      h('div', { class: 'scroll', style: { maxHeight: '360px' } }, h('table', {}, h('thead', {}, h('tr', {}, ...heads.map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), tb)),
      ...(rows.length > 60 ? [h('p', { class: 'small muted' }, `Latest 60 of ${rows.length}; the chart uses all of them.`)] : []));
    chart(chartEl, { xs: mins.map(m => m * 60), xTime: false, height: 260, xIncrs: [1800, 3600, 7200, 10800], xSpace: 64, xFmt: (u, vals) => vals.map(v => fmtMin(v / 60)), series,
      axisFmt: v => (v > 0 ? '+' : '') + fmtNum(v, mmol() ? 1 : 0),
      hooks: { drawClear: [u => { const ctx = u.ctx, x = u.valToPos(0, 'x', true), y = u.valToPos(0, 'y', true); ctx.save(); ctx.strokeStyle = cssVar('--muted'); ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke(); ctx.restore(); }] } });
  }
  function exportCsv() {
    const isW = mode === 'workouts';
    downloadCSV('iohealth-glucose-' + mode, isW ? ['start', 'workout', 'minutes', 'before', 'change_by_end', 'lowest', 'change_1h_after', 'unit'] : ['time', 'carbs_g', 'before', 'rise_to_peak', 'peak_min', 'back_near_start_min', 'unit'],
      rows.map(x => isW ? [fmtLocal(x.e.t), activityName(x.e.w.activityType), x.e.dur, csvNum(gVal(x.r.base), 1), csvNum(gVal(x.a), 1), csvNum(gVal(x.b), 1), csvNum(gVal(x.c), 1), gUnit()]
        : [fmtLocal(x.e.t), csvNum(x.e.carbs, 0), csvNum(gVal(x.r.base), 1), csvNum(gVal(x.a), 1), x.b, x.c ?? '', gUnit()]));
  }
  draw();
  return el;
}

// The glucose curve around one workout, for the workout page.
async function workoutGlucose(w) {
  const target = [+settings.glucoseLow || 70, +settings.glucoseHigh || 180];
  const g = await api('glucose', { from: String(Math.floor(w.start - 3600)), to: String(Math.ceil(w.end + 7200)), low: target[0], high: target[1] });
  if (g.readings.length < 6) return null;
  if (!settings.glucoseUnit) settings.glucoseUnit = g.recordedUnit;
  const rt = g.readings.map(r => r[0]), rv = g.readings.map(r => r[1]);
  const r = glucoseResponse(rt, rv, w.start, 60, Math.round((w.end - w.start) / 60) + 120);
  const endM = Math.round((w.end - w.start) / 60);
  const el = h('div', { class: 'chart' });
  const c = card('Blood glucose around this workout', r ? h('div', { class: 'stats', style: { marginBottom: '10px' } },
    stat('Before', fmtG(r.base), gUnit()), stat('Change by the end', fmtDelta(r.at(endM) == null ? null : r.at(endM) - r.base), gUnit()),
    stat('Lowest', fmtG(Math.min(...r.within(0, endM + 60))), gUnit()), stat('1 h after the end', fmtDelta(r.at(endM + 60) == null ? null : r.at(endM + 60) - r.base), gUnit())) : null,
  el, h('p', { class: 'small muted' }, 'From an hour before to two hours after. Orange: the workout. Green band: target range.'));
  const line = glucoseLine(g.readings);
  return [c, () => chart(el, { xs: line[0], height: 240, hooks: { drawClear: [glucoseBackdrop(g.target, [w])] },
    series: [{ label: 'Glucose', color: '#e8445a', scale: 'g', unit: gUnit(), dec: mmol() ? 1 : 0, values: line[1], spanGaps: false, points: rt.length < 60, axisFmt: v => fmtNum(v, mmol() ? 1 : 0) }] })];
}

// ---------- records ----------

pages.records = async (main) => {
  const showWorkouts = sectionOn('workouts');
  const [rec, eff] = await Promise.all([api('records'), showWorkouts ? api('records/efforts', { type: 'running' }).catch(() => []) : []]);
  rec.records = rec.records.filter(r => r.group === 'workout' ? showWorkouts : !typeHidden(r.type));
  if (!sectionOn('activity')) rec.rings = [];
  const grid = h('div', { class: 'grid cols-3' });
  main.replaceChildren(pageTitle('trophy', 'green', 'Personal records'), grid);
  const fmtRec = r => {
    switch (r.unit) {
      case 's': return fmtDuration(r.value);
      case 'm': return r.name === 'Most climbing' ? fmtElev(r.value) : fmtDist(r.value);
      case 's/km': return paceSports.has(r.type) ? fmtPace(r.value) : fmtSpeed(1000 / r.value);
      case 'kcal': return fmtKcal(r.value);
      default: return fmtNum(r.value * scaleFor(r.unit), typeDec(r.type)) + ' ' + prettyUnit(r.unit);
    }
  };
  const recRow = r => h('div', { class: 'record' }, h('span', {}, r.unit === 's/km' && !paceSports.has(r.type) ? 'Fastest average speed' : r.name, h('div', { class: 'small muted' },
    r.uuid ? h('a', { href: '#/workout/' + r.uuid }, fmtDate(r.when)) : fmtDate(r.when))), h('span', { class: 'rv' }, fmtRec(r)));

  if (eff.length) grid.append(card('Fastest running efforts', ...eff.map(e => h('div', { class: 'record' }, h('span', {}, e.name,
    h('div', { class: 'small muted' }, h('a', { href: '#/workout/' + e.uuid }, fmtDate(e.start)))),
    h('span', { class: 'rv' }, fmtDuration(e.seconds), h('div', { class: 'small muted' }, fmtPace(e.seconds / (e.distance / 1000))))))));
  const days = rec.records.filter(r => r.group === 'day'), health = rec.records.filter(r => r.group === 'health');
  if (days.length) grid.append(card('Best days', ...days.map(recRow)));
  if (health.length) grid.append(card('Health bests', ...health.map(recRow)));
  if (rec.rings?.some(r => r.daysClosed)) grid.append(card('Ring streaks', ...rec.rings.map(r => h('div', { class: 'record' }, h('span', {}, r.ring,
    h('div', { class: 'small muted' }, `${fmtNum(r.daysClosed)} days closed · current streak ${r.current}`)), h('span', { class: 'rv' }, r.longest + ' days',
    h('div', { class: 'small muted' }, r.longest ? 'ended ' + fmtDate(new Date(r.longestEnded + 'T12:00') / 1000) : ''))))));
  const byType = {};
  for (const r of rec.records.filter(r => r.group === 'workout')) (byType[r.type] ||= []).push(r);
  for (const t of (rec.totals || []).map(t => t.activityType)) {
    const tot = rec.totals.find(x => x.activityType === t);
    if (!byType[t]) continue;
    grid.append(card(null, h('h2', { style: { color: activityColor(t) } }, activityName(t)),
      h('p', { class: 'small muted' }, `${fmtNum(tot.count)} workouts since ${fmtDate(tot.first)} · ${fmtHM(tot.duration / 60)}${tot.distance ? ' · ' + fmtDist(tot.distance, 0) : ''}`),
      ...byType[t].map(recRow)));
  }
  if (!grid.children.length) grid.append(card(null, empty('No records yet.')));
};

// ---------- one day ----------

// Shades spans of time behind a chart: workouts orange, sleep violet.
function spansBackdrop(spans) {
  return u => {
    const ctx = u.ctx, { left, top, width, height } = u.bbox;
    ctx.save();
    for (const sp of spans) {
      const x1 = u.valToPos(sp.start, 'x', true), x2 = u.valToPos(sp.end, 'x', true);
      if (x2 < left || x1 > left + width) continue;
      ctx.fillStyle = sp.color;
      ctx.fillRect(Math.max(left, x1), top, Math.min(left + width, x2) - Math.max(left, x1), height);
    }
    ctx.restore();
  };
}

const DAY_TOTALS = [['step_count', 'Steps'], ['active_energy_burned', 'Active energy'], ['apple_exercise_time', 'Exercise'], ['distance_walking_running', 'Distance'],
  ['flights_climbed', 'Flights'], ['resting_heart_rate', 'Resting HR'], ['heart_rate_variability_sdnn', 'HRV'], ['body_mass', 'Weight'], ['dietary_carbohydrates', 'Carbs'],
  ['dietary_energy_consumed', 'Food energy'], ['time_in_daylight', 'Daylight']];

pages.day = async (main, arg) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : today();
  const types = await typeList();
  const t0 = new Date(date + 'T00:00').getTime() / 1000, t1 = new Date(date + 'T00:00');
  t1.setDate(t1.getDate() + 1);
  const end = t1.getTime() / 1000;
  const shift = n => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return isoDate(d); };
  const go = d => location.hash = '#/day/' + d;
  const picker = h('input', { type: 'date', value: date, max: today(), onchange: e => e.target.value && go(e.target.value) });
  const title = new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const statsEl = h('div', { class: 'stats' });
  const timeline = h('div');
  const side = h('div', { class: 'grid cols-2' });
  const csvRows = [];
  main.replaceChildren(
    h('div', { class: 'row spread' }, pageTitle('calendar', 'amber', title),
      h('div', { class: 'daynav toolbar', style: { margin: 0 } }, h('button', { onclick: () => go(shift(-1)) }, '◀ Previous'), picker,
        h('button', { onclick: () => go(shift(1)), disabled: date >= today() }, 'Next ▶'), date !== today() ? h('button', { onclick: () => go(today()) }, 'Today') : null,
        csvButton(() => downloadCSV('iohealth-' + date, ['time', 'metric', 'value', 'unit'], csvRows)))),
    card(null, statsEl), h('div', { style: { height: '16px' } }), timeline, side);

  const show = { glucose: types.blood_glucose && sectionOn('glucose'), sleep: types.sleep_analysis && sectionOn('sleep'), workouts: sectionOn('workouts'), activity: sectionOn('activity') };
  const target = [+settings.glucoseLow || 70, +settings.glucoseHigh || 180];
  const totalsWanted = DAY_TOTALS.filter(([t]) => types[t]);
  const [totals, ring, night, ws, gl, hr, steps, energy, carbs] = await Promise.all([
    Promise.all(totalsWanted.map(([t]) => api('series', { type: t, from: date, to: date, bucket: 'day' }).catch(() => null))),
    show.activity ? api('activity', { from: date, to: date }).then(a => a[0]).catch(() => null) : null,
    show.sleep ? api('sleep', { date }).catch(() => null) : null,
    show.workouts ? api('workouts', { from: date, to: date }).catch(() => []) : [],
    show.glucose ? api('glucose', { from: date, to: date, low: target[0], high: target[1] }).catch(() => null) : null,
    types.heart_rate ? api('series', { type: 'heart_rate', from: date, to: date, bucket: 'raw' }).catch(() => null) : null,
    types.step_count ? api('series', { type: 'step_count', from: date, to: date, bucket: 'hour' }).catch(() => null) : null,
    types.active_energy_burned ? api('series', { type: 'active_energy_burned', from: date, to: date, bucket: 'hour' }).catch(() => null) : null,
    types.dietary_carbohydrates ? api('series', { type: 'dietary_carbohydrates', from: date, to: date, bucket: 'raw' }).catch(() => null) : null,
  ]);
  if (gl && !settings.glucoseUnit) settings.glucoseUnit = gl.recordedUnit;

  // Numbers for the day.
  const stats = [];
  totalsWanted.forEach(([t, label], i) => {
    const p = totals[i]?.points?.[0];
    if (!p) return;
    const unit = totals[i].unit, v = p.v * scaleFor(unit);
    if (t === 'apple_exercise_time') stats.push(stat(label, fmtHM(v)));
    else if (t === 'distance_walking_running') stats.push(stat(label, ...distParts(unit === 'km' ? v * 1000 : unit === 'mi' ? v * 1609.344 : v)));
    else stats.push(stat(label, fmtNum(v, typeDec(t, unit)), prettyUnit(unit)));
    csvRows.push([date, t, csvNum(v), prettyUnit(unit)]);
  });
  if (night) stats.push(stat('Slept', fmtHM(night.asleep)));
  if (gl?.stats?.readings) stats.push(stat('Avg glucose', fmtG(gl.stats.mean), gUnit()), stat('Time in range', pct(gl.stats.ranges.inRange)));
  if (ws.length) stats.push(stat(ws.length === 1 ? 'Workout' : `${ws.length} workouts`, fmtHM(ws.reduce((a, w) => a + w.duration, 0) / 60)));
  if (ring) stats.unshift(h('div', { class: 'stat' }, rings(ring, 64)));
  statsEl.replaceChildren(...(stats.length ? stats : [empty('Nothing recorded on this day.')]));

  // Timeline: everything on one clock, sleep and workouts shaded.
  const spans = [...ws.map(w => ({ start: w.start, end: w.end, color: 'rgba(249,115,22,0.15)' }))];
  if (night?.segments) for (const sg of night.segments) if (sg.stage !== 'inBed' && sg.stage !== 'awake') spans.push({ start: sg.s, end: sg.e, color: 'rgba(139,92,246,0.10)' });
  const backdrop = spansBackdrop(spans);
  const charts = [], later = [];
  const add = (titleText, el) => { charts.push(h('h3', { style: { marginTop: charts.length ? '14px' : 0 } }, titleText), el); };
  const xr = [t0, end];
  const hourOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const hourFmt = (u, vals) => vals.map(v => v % 3600 === 0 ? hourOnly.format(new Date(v * 1000)) : fmtTime(v));
  // Clock labels such as "10:00 PM" are wide: whole hours, spaced so they never touch whatever the chart's width.
  const hourAxis = { xFmt: hourFmt, xIncrs: [300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200], xSpace: 64 };
  if (gl?.readings?.length) {
    const el = h('div', { class: 'chart' });
    add('Blood glucose', el);
    const carbPts = (carbs?.points || []);
    const tables = [glucoseLine(gl.readings)];
    if (carbPts.length) tables.push([carbPts.map(p => p.t), carbPts.map(p => p.v)]);
    const d = tables.length > 1 ? keepGaps(uPlot.join(tables, [[0, 1], [0, 0]])) : tables[0];
    later.push(() => chart(el, { xs: d[0], height: 240, xRange: xr, ...hourAxis, sync: 'day', hooks: { drawClear: [glucoseBackdrop(gl.target), backdrop] }, series: [
      { label: 'Glucose', color: '#e8445a', scale: 'g', unit: gUnit(), dec: mmol() ? 1 : 0, values: d[1], spanGaps: false, points: gl.readings.length < 60, axisFmt: v => fmtNum(v, mmol() ? 1 : 0) },
      ...(carbPts.length ? [{ label: 'Carbs', color: '#f59e0b', fill: '#f59e0b99', scale: 'carbs', unit: 'g', dec: 0, values: d[2], bars: true, barMax: 8 }] : []),
    ] }));
    for (const r of gl.readings) csvRows.push([fmtLocal(r[0]), 'blood_glucose', csvNum(gVal(r[1]), 1), gUnit()]);
    for (const p of carbPts) csvRows.push([fmtLocal(p.t), 'dietary_carbohydrates', csvNum(p.v, 1), 'g']);
  }
  if (hr?.points?.length) {
    const el = h('div', { class: 'chart' });
    add('Heart rate', el);
    later.push(() => chart(el, { xs: hr.points.map(p => p.t), height: 180, xRange: xr, ...hourAxis, sync: 'day', hooks: { drawClear: [backdrop] },
      series: [{ label: 'Heart rate', color: '#e8445a', unit: 'bpm', dec: 0, values: hr.points.map(p => p.v), width: 1.5 }] }));
    for (const p of hr.points) csvRows.push([fmtLocal(p.t), 'heart_rate', csvNum(p.v, 0), 'bpm']);
  }
  if (steps?.points?.length || energy?.points?.length) {
    const el = h('div', { class: 'chart' });
    add('Steps and active energy per hour', el);
    const tables = [steps, energy].filter(x => x?.points?.length).map(x => [x.points.map(p => p.t + 1800), x.points.map(p => p.v)]);
    const d = tables.length > 1 ? uPlot.join(tables) : tables[0];
    const series = [];
    if (steps?.points?.length) series.push({ label: 'Steps', color: '#2563eb', unit: '', dec: 0, values: d[1], bars: true, fill: '#2563ebaa' });
    if (energy?.points?.length) series.push({ label: 'Active energy', color: '#f97316', unit: 'kcal', dec: 0, values: d[series.length + 1], scale: 'kcal', width: 2 });
    later.push(() => chart(el, { xs: d[0], height: 180, xRange: xr, ...hourAxis, sync: 'day', hooks: { drawClear: [backdrop] }, series }));
    for (const x of [steps, energy]) for (const p of x?.points || []) csvRows.push([fmtLocal(p.t), x.type, csvNum(p.v, 1), prettyUnit(x.unit)]);
  }
  timeline.replaceChildren(charts.length ? card('Timeline', ...charts, h('p', { class: 'small muted' },
    'Violet: asleep. Orange: workouts. Charts move together: drag to move, scroll or pinch to zoom, double-click to reset.')) : card(null, empty('No timeline data for this day.')));
  for (const f of later) f();

  // Sleep and workouts.
  if (night) side.append(card('Sleep that ended this morning', hypnogram(night), h('div', { class: 'stats', style: { marginTop: '12px' } },
    stat('Asleep', fmtHM(night.asleep)), stat('Bedtime', night.start ? fmtTime(night.start) : '—'), stat('Woke up', night.end ? fmtTime(night.end) : '—'),
    stat('Deep', fmtHM(night.stages.deep)), stat('REM', fmtHM(night.stages.rem)))));
  if (ws.length) side.append(card('Workouts', workoutTable(ws, { compact: true })));
  if (gl?.stats?.readings > 20) side.append(card('Blood glucose', h('div', { class: 'stats' }, stat('Average', fmtG(gl.stats.mean), gUnit()),
    stat('Lowest / highest', `${fmtG(gl.stats.min)} / ${fmtG(gl.stats.max)}`), stat('Variability (CV)', fmtNum(gl.stats.cv, 1), '%'), stat('Lows ≥ 15 min', fmtNum(gl.stats.lows))),
    h('div', { style: { marginTop: '12px' } }, rangeBar(gl.stats.ranges)), rangeLegend(gl.stats.ranges, gl.target)));
};

// ---------- settings: tabs, as in ioContacts and ioCalendar (#/settings/account … #/settings/server) ----------
// Each tab loads only what it shows. The account's own tabs come first, then the admins' (users, sign-in, the server
// and its updates).

const SETTINGS_TABS = () => [['account', 'Account'], ['devices', 'Apps and devices'], ['display', 'Display'], ['health', 'Health'], ['goals', 'Goals and alerts'],
  ...(isAdmin() ? [['users', 'Users'], ['signin', 'Sign-in at the proxy'], ['server', 'Server']] : [])];
const MAINT_TABS = [['database', 'Database'], ['uploads', 'Uploads']];

/** The page title and a row of tabs linking to #/<view>/<tab> (#/<view>?tab=<tab>, the older spelling, still works).
 *  Draws at once; the tab fills the returned body when its data is in. */
function tabbedPage(main, view, ic, title, tabs, arg, params) {
  let tab = arg || params?.get('tab');
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  if (arg !== tab) history.replaceState(null, '', `#/${view}/${tab}`);
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const ver = window.healthStatus?.version;
  main.replaceChildren(h('div', { class: 'spage' }, pageTitle(ic, 'slate', title, ver ? h('span', { class: 'muted' }, `ioHealth v${ver}`) : null),
    h('div', { class: 'stabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': String(k === tab),
      onclick: () => { location.hash = `#/${view}/${k}`; } }, l))),
    body));
  return { tab, body };
}

pages.settings = async (main, arg, params) => {
  const { tab, body } = tabbedPage(main, 'settings', 'gear', 'Settings', SETTINGS_TABS(), arg, params);
  const els = await ({ account: setAccount, devices: setDevices, display: setDisplay, health: setHealth, goals: setGoals,
    users: async () => [await usersCard()], signin: async () => [await proxyCard()], server: setServer }[tab])(body);
  if (els) body.replaceChildren(...els.filter(Boolean));
};

const sortedTypeList = async () => (await api('types').catch(() => [])).slice().sort((a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)));

async function setDisplay() {
  const sortedTypes = await sortedTypeList();
  const typeFilter = h('input', { placeholder: 'Filter…', style: { width: '200px' } });
  const typeRows = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2px 16px', marginTop: '10px' } });
  const drawTypes = () => typeRows.replaceChildren(...sortedTypes.filter(t => !typeFilter.value || typeLabel(t.type).toLowerCase().includes(typeFilter.value.toLowerCase()))
    .map(t => h('label', { class: 'row small', style: { gap: '6px', flexWrap: 'nowrap' } },
      h('input', { type: 'checkbox', checked: !(settings.hiddenTypes || []).includes(t.type), onchange: e => {
        const set = new Set(settings.hiddenTypes || []);
        e.target.checked ? set.delete(t.type) : set.add(t.type);
        settings.hiddenTypes = [...set]; saveSettings(); typeListPromise = null;
      } }), typeLabel(t.type), h('span', { class: 'muted' }, fmtCompact(t.count)))));
  typeFilter.addEventListener('input', drawTypes);
  drawTypes();
  return [
    card('Display',
      h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, 'Units'),
        seg([['metric', 'Kilometres'], ['imperial', 'Miles']], settings.units, v => { settings.units = v; saveSettings(); })),
      h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, 'Theme'),
        seg([['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']], settings.theme, v => { settings.theme = v; saveSettings(); applyTheme(); })),
      h('p', { class: 'small muted' }, 'Settings are saved with your account, so every browser sees the same ones.')),
    card('Sections', h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Switch off what you don\'t use; it disappears from the menu, the dashboard and the metric lists.'),
      ...SECTIONS.map(([key, label, what]) => h('label', { class: 'row', style: { gap: '8px', margin: '6px 0' } },
        h('input', { type: 'checkbox', checked: sectionOn(key), onchange: e => {
          const set = new Set(settings.hiddenSections || []);
          e.target.checked ? set.delete(key) : set.add(key);
          settings.hiddenSections = [...set]; saveSettings(); typeListPromise = null; applySections();
        } }), h('b', {}, label), h('span', { class: 'muted small' }, what)))),
    card('Metrics', h('div', { class: 'row spread' }, h('span', { class: 'small muted' }, 'Untick a metric to hide it everywhere (dashboard cards, Metrics, overlays). The number is how many samples you have.'),
      h('span', { class: 'row' }, typeFilter,
        h('button', { onclick: () => { settings.hiddenTypes = []; saveSettings(); typeListPromise = null; drawTypes(); } }, 'Show all'))), typeRows)];
}

async function setHealth() {
  const profile = await api('profile').catch(() => ({}));
  const maxIn = h('input', { type: 'number', min: 120, max: 230, placeholder: String(profile.maxHr || ''), value: settings.maxHr, style: { width: '110px' } });
  const sexNames = { 1: 'female', 2: 'male', 3: 'other' };
  const lowIn = h('input', { type: 'number', min: 50, max: 120, value: settings.glucoseLow || 70, style: { width: '90px' } });
  const highIn = h('input', { type: 'number', min: 100, max: 300, value: settings.glucoseHigh || 180, style: { width: '90px' } });
  return [
    card('Blood glucose',
      h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, 'Unit'),
        seg([['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']], settings.glucoseUnit || 'mg/dL', v => { settings.glucoseUnit = v; saveSettings(); })),
      h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, 'Target range (mg/dL)'), lowIn, '–', highIn,
        h('button', { onclick: () => { settings.glucoseLow = lowIn.value || '70'; settings.glucoseHigh = highIn.value || '180'; saveSettings(); apiCache.clear(); } }, 'Save')),
      h('p', { class: 'small muted' }, 'The usual CGM target is 70–180 mg/dL (3.9–10.0 mmol/L); some use 70–140 (3.9–7.8) for tighter goals. Very low (< 54) and very high (> 250) are fixed.')),
    card('Heart rate',
      h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, 'Maximum heart rate'), maxIn,
        h('button', { onclick: () => { settings.maxHr = maxIn.value; saveSettings(); apiCache.clear(); maxIn.blur(); } }, 'Save'),
        h('span', { class: 'muted small' }, profile.maxHr ? `Without a value: ${profile.maxHr} bpm (${profile.maxHrFrom === 'age' ? '220 − age' : 'highest recorded'})` : '')),
      h('p', { class: 'small muted' }, 'Used for heart rate zones and training load.',
        profile.restingHr ? ` Resting heart rate, 30-day average: ${profile.restingHr} bpm.` : '')),
    card('Profile', h('div', { class: 'stats' }, stat('Age', profile.age ?? '—'), stat('Sex', sexNames[profile.characteristics?.biologicalSex] || '—')),
      h('p', { class: 'small muted' }, 'From the characteristics the iPhone app sends (date of birth, sex). Health data is only read, never changed.'))];
}

async function setGoals() {
  const [sortedTypes, allTypes] = await Promise.all([sortedTypeList(), api('types').catch(() => [])]);
  // Goals: a metric, at least / at most, and a value in the units the app shows.
  const goalTypes = sortedTypes.filter(t => ['quantity', 'category', 'ring'].includes(t.kind) && !typeHidden(t.type));
  const unitOf = t => { const x = allTypes.find(a => a.type === t); return !x ? '' : x.unit === '%' ? '%' : t === 'sleep_analysis' ? 'h per night' : prettyUnit(x.unit); };
  const goalsEl = h('div');
  const drawGoals = () => goalsEl.replaceChildren(...(settings.goals || []).map((g, i) => h('div', { class: 'goal-row' },
    h('select', { onchange: e => { g.type = e.target.value; saveSettings(); drawGoals(); } }, goalTypes.map(t => h('option', { value: t.type, selected: t.type === g.type }, typeLabel(t.type)))),
    h('select', { onchange: e => { g.dir = e.target.value; saveSettings(); } }, [['min', 'at least'], ['max', 'at most']].map(([v, l]) => h('option', { value: v, selected: v === g.dir }, l))),
    h('input', { type: 'number', step: 'any', value: g.value, placeholder: 'value', style: { width: '110px' }, onchange: e => { g.value = e.target.value; saveSettings(); } }),
    h('span', { class: 'muted small' }, g.type === 'sleep_analysis' ? 'hours a night' : unitOf(g.type) + (goalTypes.find(t => t.type === g.type)?.cumulative || g.type.startsWith('activity_') ? ' a day' : '')),
    h('button', { title: 'Remove this goal', onclick: () => { settings.goals.splice(i, 1); saveSettings(); drawGoals(); } }, '✕'))),
    ...((settings.goals || []).length ? [] : [h('p', { class: 'muted small' }, 'No goals yet.')]));
  drawGoals();
  const addGoal = () => {
    const used = new Set((settings.goals || []).map(g => g.type));
    const t = ['step_count', 'body_mass', 'sleep_analysis', 'apple_exercise_time'].find(x => goalTypes.some(g => g.type === x) && !used.has(x)) || goalTypes[0]?.type;
    if (!t) return;
    settings.goals = [...(settings.goals || []), { type: t, dir: t === 'body_mass' ? 'max' : 'min', value: '' }];
    saveSettings(); drawGoals();
  };
  const alertIn = (k, label, unit) => h('div', { class: 'goal-row' }, h('span', { style: { width: '300px' } }, label),
    h('input', { type: 'number', min: 0, step: 'any', value: settings.alerts?.[k] ?? '', placeholder: String(ALERT_DEFAULTS[k]), style: { width: '90px' },
      onchange: e => { settings.alerts = { ...(settings.alerts || {}), [k]: e.target.value }; saveSettings(); } }), h('span', { class: 'muted small' }, unit));
  return [
    card('Goals', h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Goals show on the dashboard cards (and as a dashed line in Metrics), with streaks and whether the trend is heading there. Daily totals such as steps count per day; levels such as weight use the latest reading.'),
      goalsEl, h('button', { onclick: addGoal, style: { marginTop: '6px' } }, '+ Add a goal')),
    card('Alerts on the dashboard', h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Leave a box empty for the default shown in grey; 0 turns that alert off.'),
      alertIn('tir', 'Glucose time in range under (last 7 days)', '%'), alertIn('lows', 'Glucose lows in the last 7 days, at least', 'lows'),
      alertIn('rhr', 'Resting heart rate above your usual by', 'bpm (7 days against the 4 weeks before)'), alertIn('hrv', 'Heart rate variability below your usual by', '%'),
      alertIn('sync', 'No sync from the iPhone for', 'hours'))];
}

// ---- Settings › Server (admins): the installed version and its updates, as ioContacts' and ioCalendar's Server tab

async function setServer(el) {
  const draw = async () => {
    let s;
    try { s = await authApi('api/server'); } catch (e) { el.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    if (!el.isConnected) return;
    const c = s.check, p = s.progress, last = s.lastUpdate;
    const state = h('p', { style: { marginTop: 0 }, class: p.error || (c && c.status === 'error') ? 'error' : '' }, p.running ? 'Updating… ioHealth restarts when it is done, and this page reloads.'
      : p.error ? `The last update failed: ${p.error}`
        : !c ? `You have v${s.version}${s.installed !== 'unknown' ? ` (${s.installed})` : ''}.`
          : c.status === 'current' ? `v${s.version} is the latest version.`
            : c.status === 'update' ? `You have v${s.version}; ${c.remoteVersion ? `v${c.remoteVersion}` : 'a newer build'} is available${c.remoteDate ? ` (${c.remoteDate})` : ''}${c.remoteMessage ? `: ${c.remoteMessage.replace(/^v\d+\.\d+\.\d+:\s*/, '')}` : ''}.`
              : `Could not check: ${c.error}`);
    const post = body => authApi('api/server', { method: 'POST', body });
    el.replaceChildren(card('ioHealth version', state,
      !p.running && !p.error && last ? h('p', { class: 'small ' + (last.ok ? 'muted' : 'error') }, `Last update: ${last.text}`) : null,
      h('div', { class: 'toolbar' },
        h('button', { onclick: async () => { state.className = ''; state.textContent = 'Checking…'; try { await post({ action: 'check' }); } catch (e) { toast(e.message); } refreshStatus(); draw(); } }, 'Check for updates'),
        s.docker ? h('span', { class: 'muted small' }, 'Docker: update by pulling the image (docker compose pull && docker compose up -d).')
          : s.canRun ? h('button', { class: c && c.status === 'update' ? 'primary' : '', disabled: p.running, onclick: async () => {
            if (!await dialog('Update ioHealth', h('p', {}, 'Fetch the newest version, refresh its packages and restart ioHealth? Settings and health data stay; the page reloads when the new version is up.'), [{ label: 'Cancel', value: null }, { label: 'Update now', primary: true, value: true }])) return;
            runUpdate((msg, failed) => { state.className = failed ? 'error' : ''; state.textContent = msg; });
          } }, 'Update now')
            : h('span', { class: 'muted small' }, 'This install cannot update itself from here (run ./update.sh in the app folder).')),
      h('label', { class: 'row', style: { gap: '8px', margin: '10px 0', flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('input', { type: 'checkbox', style: { flex: 'none', marginTop: '3px' }, checked: s.autoCheck, disabled: s.autoCheckLocked, onchange: async e => {
        try { await post({ autoCheck: e.target.checked }); toast('Saved'); refreshStatus(); draw(); } catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
      } }), h('span', {}, 'Check for a new version once a day (only GitHub’s public list of changes is asked; nothing about this server is sent)')),
      s.autoCheckLocked ? h('p', { class: 'muted small' }, 'UPDATE_CHECK=0 in the environment keeps it off.') : null,
      h('p', { class: 'muted small' }, `Follows ${s.repo} (${s.branch}). Database ${s.database}, schema version ${s.schemaVersion}; default time zone ${s.timezone}.`)));
    if (p.running) setTimeout(() => { if (el.isConnected) draw(); }, 4000);
  };
  await draw();
}

const DISMISSED_UPDATE = 'iohealth.updateDismissed';
/** The "a newer version is out" card, for admins, when the daily check found one (as in the other ioThing apps):
 *  Update now runs update.sh from here and the page reloads with the new version; Details opens Settings › Server;
 *  dismissed per version in this browser. */
function updateBanner(u) {
  let b = $('#updbanner');
  let gone = ''; try { gone = localStorage.getItem(DISMISSED_UPDATE) || ''; } catch { /* private mode */ }
  if (!u || gone === u.remote) { if (b) b.remove(); return; }
  if (b && b.dataset.remote === u.remote) return;
  if (b) b.remove();
  const text = h('div', {}, h('b', {}, u.version ? `ioHealth ${u.version} is available` : 'A newer build of ioHealth is available'),
    h('div', { class: 'muted' }, `You have v${window.healthStatus?.version || '?'}. ${(u.message || '').replace(/^v\d+\.\d+\.\d+:\s*/, '').slice(0, 140)}`));
  const more = h('a', { href: '#/settings/server', onclick: () => b.remove() }, h('button', { class: 'small-btn' }, 'Details'));
  const run = u.canRun ? h('button', { class: 'small-btn primary', onclick: async () => {
    if (!await dialog('Update ioHealth', h('p', {}, `Fetch ${u.version ? 'version ' + u.version : 'the latest version'}, refresh the packages and restart ioHealth? The page reloads when the new version is up.`), [{ label: 'Cancel', value: null }, { label: 'Update now', primary: true, value: true }])) return;
    runUpdate((msg, failed) => { run.hidden = more.hidden = true; text.replaceChildren(h('b', {}, failed ? 'The update did not finish' : 'Updating…'), h('div', { class: 'muted' }, msg)); });
  } }, 'Update now') : null;
  b = h('div', { id: 'updbanner', 'data-remote': u.remote }, h('span', { class: 'icwrap' }, icon('spark')), text, run, more,
    h('button', { class: 'iconbtn', title: 'Not now (hidden until the next version)', onclick: () => { try { localStorage.setItem(DISMISSED_UPDATE, u.remote); } catch { /* private mode */ } b.remove(); } }, icon('close')));
  document.body.append(b);
}

/** Running update.sh from the web app, then waiting for the new version: /api/status every 3 s until its version or
 *  commit differs from what was running, then the page reloads. After 3 minutes without a change the update is
 *  reported as not finished. onState(text, failed) gets the words to show. */
async function runUpdate(onState) {
  const stamp = st => `${st.version}|${st.commit || ''}`;
  let was = '';
  try { was = stamp(await api('status', {}, { cache: false })); } catch { /* unknown */ }
  try { await authApi('api/server', { method: 'POST', body: { action: 'update' } }); } catch (e) { onState(e.message, true); return false; }
  onState('Updating… ioHealth restarts when it is done, and the page reloads.', false);
  const until = Date.now() + 180000;
  const t = setInterval(async () => {
    try { const st = await api('status', {}, { cache: false }); if (stamp(st) !== was) { clearInterval(t); location.reload(); return; } } catch { /* restarting */ }
    if (Date.now() > until) {
      clearInterval(t);
      let msg = 'ioHealth did not come back with a new version within 3 minutes.';
      try { const s = await authApi('api/server'); if (s.lastUpdate && !s.lastUpdate.ok) msg = s.lastUpdate.text; } catch { /* still down */ }
      onState(msg, true);
    }
  }, 3000);
  return true;
}

// ---------- maintenance (admins): the data, in tabs as in ioContacts (#/maintenance/database, #/maintenance/uploads) ----------

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

pages.maintenance = async (main, arg, params) => {
  if (!isAdmin()) { main.replaceChildren(h('p', { class: 'empty' }, 'Maintenance is for admins. Sign in as an admin to see it.')); return; }
  const { tab, body } = tabbedPage(main, 'maintenance', 'wrench', 'Maintenance', MAINT_TABS, arg, params);
  body.replaceChildren(...await ({ database: maintDatabase, uploads: maintUploads }[tab])());
};

async function maintDatabase() {
  const m = await authApi('api/maintenance');
  const d = m.database, n = Object.fromEntries(d.tables.map(t => [t.name, t.rows]));
  const row = (label, detail) => h('div', { class: 'srow' }, h('div', {}, h('b', {}, label), h('div', { class: 'note' }, detail)));
  return [card('Database',
    row('Health data', `${d.host}:${d.port}/${d.name}, schema version ${d.schemaVersion}, ${fmtBytes(d.bytes)} on disk. About ${fmtCompact(n.samples)} samples of ${d.types} types; ${fmtCompact(n.workouts)} workouts, ${fmtCompact(n.workout_route_points)} route points, ${fmtCompact(n.heartbeats)} heartbeats, ${fmtCompact(n.activity_summaries)} days of rings.`),
    row('Accounts', `The ioThing suite’s shared auth database: ${m.auth.host}/${m.auth.name}.`),
    row('Hourly rollup', `Charts over months or years read sample_hourly instead of every sample. ${m.rollup.ready} of ${m.rollup.total} types are rolled up${m.rollup.ready < m.rollup.total ? '; the rest is being filled in the background, one type and month at a time' : ''}.`),
    h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Table'), h('th', { class: 'r' }, 'Rows (about)'), h('th', { class: 'r' }, 'Size'))),
      h('tbody', {}, d.tables.map(t => h('tr', {}, h('td', {}, t.name), h('td', { class: 'r num' }, fmtCompact(t.rows)), h('td', { class: 'r num' }, fmtBytes(t.bytes))))))),
    h('p', { class: 'small muted' }, 'Row counts are the database’s own estimates, which it keeps up to date as data arrives; counting every row of the large tables would take many seconds.'))];
}

async function maintUploads() {
  const u = await authApi('api/maintenance/uploads');
  return [card('Uploads', h('p', { class: 'small muted', style: { marginTop: 0 } }, `The last sync of every account (${fmtCompact(u.total)} syncs so far).`),
    u.syncs.length ? h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ['Account', 'Device', 'Started', 'Finished', 'Items'].map(c => h('th', {}, c)))),
      h('tbody', {}, u.syncs.map(x => h('tr', {}, h('td', {}, x.user), h('td', {}, x.device || '—'), h('td', { class: 'small muted' }, fmtAgo(x.started)),
        h('td', { class: 'small muted' }, x.finished ? fmtAgo(x.finished) : 'not finished'), h('td', { class: 'r num' }, fmtCompact(x.items) + (x.fullResync ? ' (full)' : ''))))))) : h('p', { class: 'muted' }, 'No sync yet.'))];
}

// ---------- accounts: sign-in, the account menu, Settings › Account / Users / Sign-in at the proxy ----------
// The same flow as iopix (and ionotes, ioContacts): accounts live in the ioThing suite's shared auth database, so
// one sign-in serves every app on the domain. Health data is private: nothing shows until someone signs in.

let me = { user: null, usersExist: false, isAdmin: false };
const isAdmin = () => !!me.isAdmin;

async function authApi(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.detail || r.statusText);
  return data;
}

async function loadMe() {
  try { me = await authApi('api/auth/me'); } catch { me = { user: null, usersExist: false, isAdmin: false }; }
  return me;
}

/** A dialog: a scrim and a card; buttons are [{label, primary, danger, action}] (action returning false keeps it open).
 *  required: nothing of the app shows behind it and it can't be dismissed. Resolves with the button's value. */
function dialog(title, body, buttons, { required = false, head = null } = {}) {
  return new Promise(resolve => {
    const scrim = h('div', { class: 'scrim' + (required ? ' required' : '') });
    const close = v => { scrim.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && !required) close(null); };
    const acts = h('div', { class: 'acts' }, buttons.filter(Boolean).map(b => h('button', {
      class: (b.primary ? 'primary' : '') + (b.danger ? ' danger' : ''),
      onclick: async () => { if (b.action) { if (await b.action() === false) return; } close(b.value ?? b.label); } }, b.label)));
    scrim.append(h('div', { class: 'dialog' }, head, h('h2', {}, title), body, acts));
    if (!required) scrim.addEventListener('click', e => { if (e.target === scrim) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(scrim);
    const first = scrim.querySelector('input:not([hidden]), button');
    if (first) first.focus();
  });
}

function toast(text, ms = 3000) {
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

const avatar = (a, big = false) => h('span', { class: 'avatar' + (big ? ' big' : '') }, ((a && (a.displayName || a.name)) || '?')[0].toUpperCase());

/** The brand above the sign-in's title, as in iopix: the logo and the name. */
const signinBrand = () => h('div', { class: 'signin-brand' }, h('img', { class: 'logo', src: 'apple-touch-icon.png', alt: '' }),
  h('span', { class: 'brand-name' }, h('span', { class: 'io' }, 'io'), h('span', { class: 'nm' }, 'Health')));

let signingIn = false;
/** iopix's sign-in: a tile per account (one click for an account without a password, a password for the others),
 *  "Other" to type a name. required: ioHealth shows nothing else until someone signs in (no Cancel, no closing). */
async function signIn(required = false) {
  if (signingIn) return;
  signingIn = true;
  try {
    if (!me.usersExist) return await firstAdmin();
    const name = h('input', { type: 'text', placeholder: 'User name', autocomplete: 'username' });
    const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const form = h('div', { class: 'signin-form' }, name, pw);
    const msg = h('p', { class: 'error small' });
    const tiles = h('div', { class: 'accounts' });
    const login = async body => {
      try { await authApi('api/auth/login', { method: 'POST', body }); location.reload(); return true; } catch (e) { msg.textContent = e.message; return false; }
    };
    const submit = () => login({ name: name.value.trim(), password: pw.value });
    for (const i of [name, pw]) i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
    authApi('api/auth/accounts').then(d => {
      if (!d.accounts.length) { name.focus(); return; }
      form.hidden = true;
      tiles.append(...d.accounts.map(a => h('button', { type: 'button', class: 'account', 'data-n': a.name, title: a.passwordless ? `Sign in as ${a.name}` : `${a.name} (password)`,
        onclick: () => {
          if (a.passwordless) { login({ name: a.name }); return; }
          name.value = a.name; form.hidden = false;
          for (const t of tiles.querySelectorAll('.account')) t.classList.toggle('on', t.dataset.n === a.name);
          pw.focus();
        } }, avatar(a, true), h('span', { class: 'nm' }, a.name), a.passwordless ? null : h('span', { class: 'muted tiny' }, 'password'))),
        h('button', { type: 'button', class: 'account', title: 'Type a user name', onclick: () => {
          form.hidden = false; name.value = ''; for (const t of tiles.querySelectorAll('.account')) t.classList.remove('on'); name.focus();
        } }, h('span', { class: 'avatar big other' }, '…'), h('span', { class: 'nm' }, 'Other')));
    }).catch(() => name.focus());
    return await dialog('Sign in', h('div', {}, tiles, form, msg, h('p', { class: 'muted small' }, 'Sign in to see your health data. Each account sees its own.')),
      [required ? null : { label: 'Cancel', value: null }, { label: 'Sign in', primary: true, action: submit }], { required, head: signinBrand() });
  } finally { signingIn = false; }
}

async function firstAdmin() {
  const name = h('input', { type: 'text', placeholder: 'Admin user name', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: 'Password (8 characters or more)', autocomplete: 'new-password' });
  const msg = h('p', { class: 'error small' });
  return dialog('Create the admin account', h('div', {}, h('p', { class: 'muted' }, 'No accounts yet. The first account is the suite admin (admin in ioHealth and the other ioThing apps). Create it from inside your network.'),
    h('div', { class: 'signin-form' }, name, pw), msg), [
    { label: 'Create', primary: true, action: async () => {
      try { await authApi('api/auth/setup', { method: 'POST', body: { name: name.value.trim(), password: pw.value } }); location.reload(); } catch (e) { msg.textContent = e.message; return false; }
    } }], { required: true, head: signinBrand() });
}

async function changePassword() {
  const cur = h('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
  const pw = h('input', { type: 'password', placeholder: 'New password (8 characters or more)', autocomplete: 'new-password' });
  const msg = h('p', { class: 'error small' });
  await dialog('Change your password', h('div', {}, cur, pw, msg), [{ label: 'Cancel' }, { label: 'Change', primary: true, action: async () => {
    try { await authApi('api/auth/password', { method: 'POST', body: { current: cur.value, password: pw.value } }); toast('Password changed; your other sessions are signed out'); }
    catch (e) { msg.textContent = e.message; return false; }
  } }]);
}

async function signOut() {
  try {
    const r = await authApi('api/auth/logout', { method: 'POST' });
    if (r && r.cloudflareLogout) { location.href = r.cloudflareLogout; return; }
  } catch (e) { toast(e.message); }
  location.reload();
}

function menu(anchor, items) {
  const el = h('div', { class: 'menu' });
  const close = () => { el.remove(); document.removeEventListener('click', onDoc, true); };
  const onDoc = e => { if (!el.contains(e.target)) close(); };
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.append(h('hr')); continue; }
    if (it.head) { el.append(h('div', { class: 'head' }, it.head)); continue; }
    el.append(h('button', { type: 'button', onclick: () => { close(); it.action(); } }, it.label));
  }
  const r = anchor.getBoundingClientRect();
  el.style.top = (r.bottom + 6) + 'px';
  el.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  document.body.append(el);
  setTimeout(() => document.addEventListener('click', onDoc, true));
}

function renderUserMenu() {
  const el = $('#usermenu');
  if (!el) return;
  el.textContent = '';
  if (!me.user) {
    el.append(h('button', { class: 'small-btn', onclick: () => signIn(false) }, me.usersExist ? 'Sign in' : 'Set up'));
    return;
  }
  const btn = h('button', { class: 'avatar-btn', title: me.user.name, 'aria-label': 'Account', onclick: () => menu(btn, [
    { head: `${me.user.name} · ${me.user.role}${me.signedInBy === 'cloudflare' ? ' · via Cloudflare' : ''}` },
    { label: 'Account', action: () => { location.hash = '#/settings/account'; } },
    { label: 'Connect the iPhone app', action: () => { location.hash = '#/settings/devices'; } },
    { label: 'Settings', action: () => { location.hash = '#/settings'; } },
    isAdmin() ? { label: 'Maintenance', action: () => { location.hash = '#/maintenance'; } } : null,
    me.user.passwordless ? null : { label: 'Change password', action: changePassword },
    { label: 'Sign out everywhere', action: async () => { await authApi('api/auth/logout_all', { method: 'POST' }); toast('Your other sessions are signed out'); } },
    '-',
    { label: 'Sign out', action: signOut },
  ]) }, avatar(me.user));
  el.append(btn);
}

// ---- Settings › Account and Apps and devices

function copyRow(text) {
  const inp = h('input', { type: 'text', value: text, readonly: true, style: { flex: 1, minWidth: '240px', fontFamily: 'ui-monospace, monospace' }, onclick: e => e.target.select() });
  return h('div', { class: 'toolbar', style: { marginBottom: '6px' } }, inp, h('button', { onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { inp.select(); }
  } }, 'Copy'));
}

/** Settings › Account: who is signed in, the password and the sessions. */
async function setAccount() {
  const u = me.user;
  return [card('You',
    h('div', { class: 'toolbar' }, avatar(u, true), h('div', {}, h('b', {}, u.displayName || u.name), h('div', { class: 'small muted' }, `${u.name} · ${u.role}${u.suiteAdmin ? ' · suite admin' : ''}${u.email ? ' · ' + u.email : ''}`))),
    h('p', { class: 'small muted' }, 'One account for every ioThing app on this domain: the name, password and sessions are the same in ioPix, ioNotes, ioContacts and ioCalendar.')),
  card('Password and sessions',
    h('div', { class: 'toolbar' },
      u.passwordless || me.viaProxy ? null : h('button', { onclick: changePassword }, 'Change password'),
      h('button', { onclick: async () => { await authApi('api/auth/logout_all', { method: 'POST' }); toast('Your other sessions are signed out'); } }, 'Sign out everywhere else'),
      h('button', { onclick: signOut }, 'Sign out')),
    u.passwordless ? h('p', { class: 'small muted' }, 'This account signs in with one click and has no password; an admin can give it one under Users.')
      : me.viaProxy ? h('p', { class: 'small muted' }, 'Signed in through the proxy in front of ioHealth; the password is changed there.') : null)];
}

/** Settings › Apps and devices: what the iPhone app needs (this server's address, the user name, an app password),
 *  the app passwords themselves, and the web app on the phone's home screen. */
async function setDevices() {
  const u = me.user;
  const server = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  const list = h('div');
  const shown = h('div');
  const label = h('input', { type: 'text', placeholder: 'e.g. Alex’s iPhone', value: /iPhone/.test(navigator.userAgent) ? 'iPhone' : '' });
  const draw = async () => {
    const d = await authApi('api/auth/app-passwords').catch(() => ({ items: [] }));
    list.replaceChildren(d.items.length ? h('table', { class: 'grid', style: { width: '100%' } },
      h('thead', {}, h('tr', {}, h('th', {}, 'Device'), h('th', {}, 'Made'), h('th', {}, 'Last used'), h('th', {}, ''))),
      h('tbody', {}, d.items.map(p => h('tr', {}, h('td', {}, p.label), h('td', { class: 'small muted' }, fmtDate(p.created)),
        h('td', { class: 'small muted' }, p.lastUsed ? fmtAgo(p.lastUsed) : 'never'),
        h('td', { style: { textAlign: 'right' } }, h('button', { class: 'small-btn', onclick: async () => {
          if (!await dialog('Revoke app password', h('p', {}, `Revoke “${p.label}”? That device stops syncing until it gets a new one.`), [{ label: 'Cancel', value: null }, { label: 'Revoke', danger: true, value: true }])) return;
          await authApi(`api/auth/app-passwords/${p.id}`, { method: 'DELETE' }); draw();
        } }, 'Revoke'))))))
      : h('p', { class: 'small muted' }, 'No app passwords yet.'));
  };
  await draw();
  const who = u.passwordless ? 'This account signs in with one click, so it cannot have app passwords; an admin can give it a password under Users.'
    : u.role === 'viewer' ? 'This account is a viewer: it can look at its data but not upload any. An admin can make it an editor under Users.' : '';
  const kv = (k, v) => h('div', { class: 'toolbar', style: { margin: '0 0 2px' } }, h('span', { style: { width: '120px' } }, k), copyRow(v));
  return [
    card('iPhone app', h('p', { class: 'small', style: { marginTop: 0 } }, 'The ioHealth app on the iPhone sends the Health data here. In the app, fill in this server’s address, your user name and an app password (below), then tap Test connection and Sync now.'),
      kv('Server address', server), kv('User name', u.name),
      who ? h('p', { class: 'small error' }, who) : null),
    card('App passwords', h('p', { class: 'small', style: { marginTop: 0 } }, 'Give every device or script its own password instead of yours; you can revoke one without touching the others. Use it with your user name; what it sends is yours.'),
      who ? null : h('div', { class: 'toolbar' }, label, h('button', { class: 'primary', onclick: async () => {
        try {
          const r = await authApi('api/auth/app-passwords', { method: 'POST', body: { label: label.value || 'iPhone' } });
          shown.replaceChildren(h('p', { class: 'small' }, h('b', {}, 'Copy it now: '), 'it is shown only once.'), copyRow(r.password));
          label.value = ''; draw();
        } catch (e) { toast(e.message); }
      } }, '+ New app password')),
      shown, list),
    card('On your phone', h('p', { class: 'small', style: { marginTop: 0 } }, 'Add the ioHealth web app to the home screen and it opens full-screen like an app: in Safari on the iPhone, tap Share, then Add to Home Screen. On Android, use Chrome’s menu and Install app. Sign in once there; the session lasts 30 days.'))];
}

// ---- Settings › Users (admins): accounts and their role in ioHealth, as in iopix

async function usersCard() {
  const body = h('div');
  const draw = async () => {
    let d;
    try { d = await authApi('api/users'); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    const name = h('input', { type: 'text', placeholder: 'User name', style: { width: '150px' } });
    const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'new-password', style: { width: '150px' } });
    const email = h('input', { type: 'email', placeholder: 'Email (optional)', autocomplete: 'off', style: { width: '200px' } });
    const role = h('select', {}, d.roles.map(r => h('option', { value: r, selected: r === 'editor' }, r)));
    const run = async (f, after = draw) => { try { await f(); await after(); } catch (e) { toast(e.message); } };
    const post = (path, b) => authApi(path, { method: 'POST', body: b });
    body.replaceChildren(h('table', { class: 'grid', style: { width: '100%' } },
      h('thead', {}, h('tr', {}, ['Account', 'Email', 'Role', 'Password', 'Sign-in list', 'Last sign-in', ''].map(c => h('th', {}, c)))),
      h('tbody', {}, d.users.map(u => h('tr', {},
        h('td', {}, h('span', { class: 'toolbar', style: { margin: 0, gap: '6px' } }, avatar(u), u.name, u.id === me.user.id ? h('span', { class: 'muted small' }, '(you)') : null, u.suiteAdmin ? h('span', { class: 'muted small' }, 'suite admin') : null)),
        h('td', { class: 'small' }, u.email || h('span', { class: 'muted' }, 'none')),
        h('td', {}, h('select', { onchange: e => run(() => post(`api/users/${u.id}`, { role: e.target.value })) }, d.roles.map(r => h('option', { value: r, selected: r === u.role }, r)))),
        h('td', { class: 'small' }, u.passwordless ? h('span', { class: 'muted' }, 'none (one click)') : 'set', ' ',
          h('button', { class: 'small-btn', onclick: async () => {
            const inp = h('input', { type: 'password', placeholder: '8 characters or more', autocomplete: 'new-password' });
            if (await dialog(`New password for ${u.name}`, inp, [{ label: 'Cancel', value: null }, { label: 'Set', primary: true, value: true }]) && inp.value) run(() => post(`api/users/${u.id}`, { password: inp.value }));
          } }, 'Set')),
        h('td', { style: { textAlign: 'center' } }, h('input', { type: 'checkbox', checked: u.listed !== false, title: 'Offered on the sign-in screen',
          onchange: e => run(() => post(`api/users/${u.id}`, { listed: e.target.checked })) })),
        h('td', { class: 'small muted' }, u.last_login ? fmtDate(u.last_login) : 'never'),
        h('td', { style: { textAlign: 'right' } }, u.id !== me.user.id ? h('button', { class: 'small-btn', onclick: async () => {
          if (!await dialog('Delete account', h('p', {}, `Delete ${u.name}? Their health data stays in the database until an admin removes it.`), [{ label: 'Cancel', value: null }, { label: 'Delete', danger: true, value: true }])) return;
          run(() => post(`api/users/${u.id}`, { delete: true }));
        } }, 'Delete') : null))))),
      h('div', { class: 'toolbar', style: { marginTop: '10px' } }, name, email, pw, role, h('button', { class: 'primary', onclick: () => run(async () => {
        await post('api/users', { name: name.value.trim(), email: email.value.trim(), password: pw.value, role: role.value }); toast(`Added ${name.value.trim()}`);
      }) }, '+ Add account')));
  };
  await draw();
  return card('Users', h('p', { class: 'small muted', style: { marginTop: 0 } }, 'The ioThing suite’s shared accounts (the same as in ioPix, ioNotes and ioContacts), with each one’s role in ioHealth: a viewer sees their own data, an editor can also upload it from the iPhone app, an admin can also manage accounts. Every account sees only its own health data.'), body);
}

// ---- Settings › Sign-in at the proxy (admins): Cloudflare Access or another proxy in front

async function proxyCard() {
  let st;
  try { st = await authApi('api/auth/proxy'); } catch (e) { return card('Sign-in at the proxy', h('p', { class: 'error' }, e.message)); }
  const v = st.values, fixed = new Set(st.fromEnv || []);
  const field = (k, ph) => h('input', { type: 'text', value: v[k] || '', placeholder: ph, disabled: fixed.has(k), 'data-k': k, style: { width: '300px', maxWidth: '100%' } });
  const sel = (k, opts) => h('select', { 'data-k': k, disabled: fixed.has(k) }, opts.map(([val, l]) => h('option', { value: val, selected: (v[k] || '') === val }, l)));
  const fields = [sel('AUTH_PROXY', [['off', 'Off'], ['cloudflare', 'Cloudflare Access'], ['haproxy', 'HAProxy'], ['nginx', 'nginx'], ['caddy', 'Caddy'], ['traefik', 'Traefik'], ['header', 'Another proxy']]),
    field('CF_ACCESS_TEAM', 'myteam.cloudflareaccess.com'), field('CF_ACCESS_AUD', 'the Access application’s AUD tag'),
    field('AUTH_PROXY_HEADER', 'header(s) with the user (other proxies)'), field('AUTH_PROXY_TRUSTED', '127.0.0.1, ::1 (the proxy’s address)'),
    sel('AUTH_PROXY_CREATE', [['', 'show the sign-in screen'], ['deny', 'refuse them'], ['viewer', 'make them a viewer account'], ['editor', 'make them an editor account']])];
  if (!v.AUTH_PROXY) fields[0].value = 'off';
  const labels = ['Proxy', 'Cloudflare team', 'Cloudflare AUD', 'User header', 'Proxy address', 'Someone with no account'];
  const seen = st.seen && st.seen.aud ? h('p', { class: 'small' }, `Last Cloudflare Access request: team ${st.seen.iss || '?'}, AUD ${Array.isArray(st.seen.aud) ? st.seen.aud.join(', ') : st.seen.aud}, ${st.seen.email || ''}`) : null;
  return card('Sign-in at the proxy',
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'With Cloudflare Access (a Cloudflare Tunnel with an Access policy) or a proxy with Authelia, Authentik or oauth2-proxy in front, ioHealth takes that sign-in: the person is matched to an account by email, then by name. Saved for the whole suite, as in ioPix. Settings in the container’s environment win.'),
    ...fields.map((f, i) => h('div', { class: 'toolbar' }, h('span', { style: { width: '160px' } }, labels[i]), f)),
    seen, fixed.size ? h('p', { class: 'small muted' }, 'Fixed in the environment: ' + [...fixed].join(', ')) : null,
    h('button', { class: 'primary', onclick: async () => {
      const body = {};
      for (const f of fields) if (!f.disabled) body[f.dataset.k] = f.value;
      try { await authApi('api/auth/proxy', { method: 'POST', body }); toast('Saved'); } catch (e) { toast(e.message); }
    } }, 'Save'));
}

// ---------- start ----------

loadMe().then(async () => {
  renderUserMenu();
  if (!me.user) { signIn(true); return; }
  document.body.classList.toggle('noadmin', !isAdmin());
  buildNav();
  await loadSettings();
  applyTheme();
  applySections();
  refreshStatus();
  setInterval(refreshStatus, 60000);
  render();
});
