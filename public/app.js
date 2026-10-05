import { STRINGS } from './i18n.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOODS = ['😊', '🥰', '😂', '🤩', '😌', '🥹', '😴', '🤒', '😢', '😤', '🤔', '🎉'];
const JOURNAL_EMOJIS = ['📔', '🌙', '🌸', '🍓', '🧸', '☕', '🎈', '🌿', '⛺', '🎬', '🍕', '🐾', '🌊', '🎵', '✈️', '🏡', '💌', '⭐', '🌻', '🍰', '🎮', '📚', '🚲', '💫'];
const AVATARS = ['🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦄', '🐹', '🐮', '🐷', '🐙'];
const COLORS = ['peach', 'pink', 'lavender', 'mint', 'sky', 'butter', 'sage', 'coral'];
const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const POLL_MS = 45000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  user: null,
  journals: [],
  view: store.get('gunce-view') || 'all', // 'all' or a journal id (string)
  year: 0,
  month: 0,
  selected: '',
  entries: [],
  range: null,
  stats: null,
  lang: store.get('gunce-lang') || ((navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'tr'),
};

const t = (key, ...args) => {
  const v = STRINGS[state.lang][key] ?? STRINGS.tr[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
};
const errorText = (code) => STRINGS[state.lang].errors[code] || STRINGS[state.lang].errors.server_error;

// ---------------------------------------------------------------------------
// Dates — plain arithmetic so every year from 1 to 9999 behaves the same.
// ---------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const parse = (s) => s.split('-').map(Number);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

// Howard Hinnant's days-from-civil / civil-from-days.
function toDays(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function fromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
const weekdayOf = (y, m, d) => (((toDays(y, m, d) % 7) + 7 + 3) % 7); // 0 = Monday
const addDays = (s, n) => ymd(...fromDays(toDays(...parse(s)) + n));
const inRange = (y) => y >= MIN_YEAR && y <= MAX_YEAR;

function todayStr() {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate());
}
const monthName = (m) => new Intl.DateTimeFormat(t('locale'), { month: 'long' }).format(new Date(2024, m - 1, 1));
const weekdayName = (i, style = 'long') => new Intl.DateTimeFormat(t('locale'), { weekday: style }).format(new Date(2024, 0, 1 + i));
const cap = (s) => s.charAt(0).toLocaleUpperCase(t('locale')) + s.slice(1);

function formatLong(s) {
  const [y, m, d] = parse(s);
  const wd = weekdayName(weekdayOf(y, m, d));
  return state.lang === 'tr' ? `${d} ${monthName(m)} ${y}, ${wd}` : `${wd}, ${d} ${monthName(m)} ${y}`;
}
function formatShort(s) {
  const [y, m, d] = parse(s);
  return `${d} ${monthName(m)} ${y}`;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);

function toast(text, kind = 'ok') {
  const el = h('div', { class: `toast toast-${kind}` }, text);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(data.error || 'server_error', res.status);
    if (res.status === 401 && state.user && !url.startsWith('/api/auth')) {
      state.user = null;
      renderAuth();
    }
    throw err;
  }
  return data;
}

function showError(err) {
  if (err.code === 'offline') toast(t('offline'), 'err');
  else toast(errorText(err.code), 'err');
}

// ---------------------------------------------------------------------------
// Theme & language
// ---------------------------------------------------------------------------

function applyTheme(theme = store.get('gunce-theme') || 'auto') {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}
function setLang(lang) {
  state.lang = lang;
  store.set('gunce-lang', lang);
  document.documentElement.lang = lang;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function modal({ title, body, footer, className = '', onClose }) {
  closeNav();
  let closeBtn;
  const dlg = h('dialog', { class: `modal ${className}` },
    h('div', { class: 'modal-inner' },
      h('div', { class: 'modal-head' },
        h('h2', {}, title),
        (closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), title: t('close') }, '✕'))),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null));
  const close = () => { if (dlg.open) dlg.close(); };
  closeBtn.addEventListener('click', close);
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (downOnBackdrop && e.target === dlg) close(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

function confirmDialog(message, { okText = t('delete'), danger = true } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const okBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button' }, okText);
    const { close } = modal({
      title: '🤔',
      className: 'modal-small',
      body: h('p', { class: 'confirm-text' }, message),
      footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, t('cancel')), okBtn],
      onClose: () => resolve(ok),
    });
    okBtn.addEventListener('click', () => { ok = true; close(); });
    okBtn.focus();
  });
}

const anyDialogOpen = () => !!document.querySelector('dialog[open]');

// ---------------------------------------------------------------------------
// Auth screen
// ---------------------------------------------------------------------------

const pendingInvite = () => sessionStorage.getItem('gunce-invite');

function renderAuth(mode = 'login') {
  document.title = 'Günce';
  const app = $('#app');
  app.className = 'auth-screen';
  const isLogin = mode === 'login';
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const field = (name, label, type, hint, attrs = {}) =>
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      h('input', { name, type, required: name !== 'displayName', ...attrs }),
      hint ? h('span', { class: 'field-hint' }, hint) : null);

  const form = h('form', { class: 'auth-form', novalidate: true },
    field('username', t('username'), 'text', isLogin ? null : t('usernameHint'), { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 24 }),
    isLogin ? null : field('displayName', t('displayName'), 'text', t('displayNameHint'), { autocomplete: 'nickname', maxlength: 40 }),
    field('password', t('password'), 'password', isLogin ? null : t('passwordHint'), { autocomplete: isLogin ? 'current-password' : 'new-password', maxlength: 200 }),
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isLogin ? t('login') : t('register')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    err.hidden = true;
    try {
      const { user } = await api('POST', isLogin ? '/api/auth/login' : '/api/auth/register', { ...fd, lang: state.lang });
      await enter(user);
    } catch (ex) {
      err.textContent = ex.code === 'offline' ? t('offline') : errorText(ex.code);
      err.hidden = false;
      btn.disabled = false;
    }
  });

  const langToggle = h('div', { class: 'lang-toggle' },
    ['tr', 'en'].map((l) => h('button', {
      type: 'button',
      class: state.lang === l ? 'active' : '',
      onclick: () => { setLang(l); renderAuth(mode); },
    }, l.toUpperCase())));

  app.replaceChildren(
    h('div', { class: 'floaties', 'aria-hidden': 'true' }, ['🌸', '⭐', '🍓', '☁️', '💌', '🌙', '🧸', '🌿'].map((e, i) => h('span', { class: `floaty f${i}` }, e))),
    h('main', { class: 'auth-card' },
      langToggle,
      h('div', { class: 'brand brand-big' }, h('img', { src: '/icon.svg', alt: '', width: 56, height: 56 }), h('span', {}, 'Günce')),
      h('p', { class: 'tagline' }, t('tagline')),
      pendingInvite() ? h('p', { class: 'invite-note' }, '💌 ', t('invitedNote')) : null,
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(isLogin), class: isLogin ? 'active' : '', onclick: () => renderAuth('login') }, t('login')),
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(!isLogin), class: !isLogin ? 'active' : '', onclick: () => renderAuth('register') }, t('register'))),
      form));
  form.querySelector('input').focus();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const journalById = (id) => state.journals.find((j) => String(j.id) === String(id));
const journalName = (j) => j?.name || (j?.kind === 'personal' ? t('myJournal') : '');
const personalJournal = () => state.journals.find((j) => j.kind === 'personal');
const viewParam = () => (state.view === 'all' ? 'all' : state.view);

async function loadJournals() {
  const { journals } = await api('GET', '/api/journals');
  state.journals = journals;
  if (state.view !== 'all' && !journalById(state.view)) setView('all', false);
}

function gridRange(y, m) {
  const first = ymd(y, m, 1);
  const start = addDays(first, -weekdayOf(y, m, 1));
  const cells = 42; // always six weeks, so the grid keeps the same size every month
  return { start, end: addDays(start, cells - 1), cells };
}

async function loadMonth() {
  const { start, end } = gridRange(state.year, state.month);
  const from = start < '0001-01-01' ? '0001-01-01' : start;
  const to = end > '9999-12-31' || end.length > 10 ? '9999-12-31' : end;
  const key = `${viewParam()}|${from}|${to}`;
  const [{ entries }, stats] = await Promise.all([
    api('GET', `/api/entries?journal=${viewParam()}&from=${from}&to=${to}`),
    api('GET', `/api/stats?journal=${viewParam()}`),
  ]);
  state.entries = entries;
  state.stats = stats;
  state.range = key;
}

async function refresh({ journals = false } = {}) {
  try {
    if (journals) await loadJournals();
    await loadMonth();
    renderSidebar();
    renderCalendar();
    renderDay();
  } catch (err) {
    if (err.status !== 401) showError(err);
  }
}

function setView(view, reload = true) {
  state.view = String(view);
  store.set('gunce-view', state.view);
  if (reload) {
    closeNav();
    refresh();
  }
}

function goToMonth(y, m) {
  if (m < 1) { y -= 1; m = 12; }
  if (m > 12) { y += 1; m = 1; }
  if (!inRange(y)) return;
  state.year = y;
  state.month = m;
  // Keep the selected day inside the visible month.
  const [sy, sm, sd] = parse(state.selected);
  if (sy !== y || sm !== m) state.selected = ymd(y, m, Math.min(sd, daysIn(y, m)));
  refresh();
}

function selectDate(s, { open = true } = {}) {
  const [y, m] = parse(s);
  if (!inRange(y)) return;
  state.selected = s;
  history.replaceState(null, '', '#' + s);
  if (y !== state.year || m !== state.month) {
    state.year = y;
    state.month = m;
    refresh();
  } else {
    renderCalendar();
    renderDay();
  }
  if (open) openDaySheet();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

async function enter(user) {
  state.user = user;
  setLang(user.lang || state.lang);
  const invite = pendingInvite();
  if (location.pathname.startsWith('/join/')) history.replaceState(null, '', '/');
  if (invite) {
    sessionStorage.removeItem('gunce-invite');
    try {
      const { journal } = await api('POST', '/api/join', { code: invite });
      state.view = String(journal.id);
      store.set('gunce-view', state.view);
      setTimeout(() => toast(t('joined', journalName(journal))), 300);
    } catch (err) {
      setTimeout(() => showError(err), 300);
    }
  }
  const fromHash = /^#\d{4}-\d{2}-\d{2}$/.test(location.hash) ? location.hash.slice(1) : '';
  state.selected = fromHash && inRange(parse(fromHash)[0]) && parse(fromHash)[1] <= 12 ? fromHash : todayStr();
  [state.year, state.month] = parse(state.selected);
  renderShell();
  await refresh({ journals: true });
}

function renderShell() {
  restorePanelFlags();
  const app = $('#app');
  app.className = 'shell';
  app.replaceChildren(
    h('div', { class: 'nav-scrim', onclick: closeNav }),
    h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': t('menu') }),
    h('main', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn nav-toggle', type: 'button', 'aria-label': t('menu'), onclick: openNav }, '☰'),
        h('div', { class: 'brand brand-small' }, h('img', { src: '/icon.svg', alt: '', width: 28, height: 28 }), h('span', {}, 'Günce')),
        h('button', { class: 'avatar-btn', type: 'button', id: 'topbar-avatar', 'aria-label': t('profile'), onclick: openProfile })),
      h('section', { class: 'calendar', id: 'calendar' })),
    h('div', { class: 'day-scrim', onclick: () => document.body.classList.remove('day-open') }),
    h('aside', { class: 'day', id: 'day' }),
    h('button', { class: 'fab', type: 'button', 'aria-label': t('addEntry'), onclick: () => openEditor(null, state.selected) }, '+'));
}

const openNav = () => document.body.classList.add('nav-open');
const closeNav = () => document.body.classList.remove('nav-open');

// Desktop panel layout, remembered per browser: a mini sidebar, a hidden day panel or a wide day panel.
const PANEL_FLAGS = { 'side-mini': 'gunce-side-mini', 'day-hidden': 'gunce-day-hidden', 'day-wide': 'gunce-day-wide' };
const panelFlag = (cls) => document.body.classList.contains(cls);
function setPanelFlag(cls, on) {
  document.body.classList.toggle(cls, on);
  store.set(PANEL_FLAGS[cls], on ? '1' : '');
}
function restorePanelFlags() {
  for (const [cls, key] of Object.entries(PANEL_FLAGS)) document.body.classList.toggle(cls, store.get(key) === '1');
}
const isDrawerLayout = () => matchMedia('(max-width: 1180px)').matches;

function openDaySheet() {
  document.body.classList.add('day-open');
  if (panelFlag('day-hidden')) setPanelFlag('day-hidden', false);
}
function closeDaySheet() {
  if (isDrawerLayout()) document.body.classList.remove('day-open');
  else setPanelFlag('day-hidden', true);
}
function toggleSidebar() {
  setPanelFlag('side-mini', !panelFlag('side-mini'));
  renderSidebar();
}
function toggleWideDay() {
  setPanelFlag('day-wide', !panelFlag('day-wide'));
  renderDay();
}

function renderSidebar() {
  const side = $('#sidebar');
  if (!side) return;
  const u = state.user;
  const item = (view, emoji, label, color, extra) =>
    h('div', { class: `nav-item c-${color} ${String(state.view) === String(view) ? 'active' : ''}` },
      h('button', { type: 'button', class: 'nav-main', title: label, onclick: () => setView(view) },
        h('span', { class: 'nav-emoji' }, emoji),
        h('span', { class: 'nav-label' }, label)),
      extra);
  const settingsBtn = (j) => h('button', {
    type: 'button', class: 'icon-btn nav-gear', 'aria-label': t('journalSettings'), title: t('journalSettings'),
    onclick: (e) => { e.stopPropagation(); openJournalModal(j); },
  }, '⚙︎');
  const faces = (j) => h('span', { class: 'faces' }, j.members.slice(0, 4).map((m) => h('span', { class: 'face', title: m.displayName }, m.avatar)));

  const personal = personalJournal();
  const shared = state.journals.filter((j) => j.kind === 'shared');

  side.replaceChildren(
    h('div', { class: 'brand-row' },
      h('div', { class: 'brand' }, h('img', { src: '/icon.svg', alt: '', width: 36, height: 36 }), h('span', {}, 'Günce')),
      h('button', {
        type: 'button', class: 'icon-btn small side-toggle', onclick: toggleSidebar,
        'aria-label': panelFlag('side-mini') ? t('expandSidebar') : t('collapseSidebar'),
        title: panelFlag('side-mini') ? t('expandSidebar') : t('collapseSidebar'),
      }, panelFlag('side-mini') ? '»' : '«')),
    h('nav', { class: 'nav' },
      item('all', '🌈', t('allJournals'), 'rainbow'),
      personal ? item(personal.id, personal.emoji, journalName(personal), personal.color, settingsBtn(personal)) : null,
      h('div', { class: 'nav-section' },
        h('span', {}, t('shared')),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('newShared'), title: t('newShared'), onclick: () => openJournalModal(null) }, '+')),
      shared.map((j) => item(j.id, j.emoji, j.name, j.color, [faces(j), settingsBtn(j)])),
      h('button', { type: 'button', class: 'nav-add', title: t('newShared'), onclick: () => openJournalModal(null) }, h('span', { class: 'nav-emoji' }, '✨'), h('span', { class: 'nav-label' }, t('newShared'))),
      h('button', { type: 'button', class: 'nav-add', title: t('joinWithCode'), onclick: () => openJoinModal() }, h('span', { class: 'nav-emoji' }, '🔑'), h('span', { class: 'nav-label' }, t('joinWithCode')))),
    h('div', { class: 'side-foot' },
      h('button', { type: 'button', class: 'me', title: t('profile'), onclick: openProfile },
        h('span', { class: 'me-avatar' }, u.avatar),
        h('span', { class: 'me-text' }, h('strong', {}, u.displayName), h('small', {}, '@' + u.username))),
      h('p', { class: 'hint' }, t('shortcutsHint'))));

  const top = $('#topbar-avatar');
  if (top) top.textContent = u.avatar;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function entriesByDate() {
  const map = new Map();
  for (const e of state.entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

function renderCalendar() {
  const cal = $('#calendar');
  if (!cal) return;
  const { year: y, month: m } = state;
  const { start, cells } = gridRange(y, m);
  const byDate = entriesByDate();
  const today = todayStr();
  const monthPrefix = ymd(y, m, 1).slice(0, 7);
  const monthEntries = state.entries.filter((e) => e.date.startsWith(monthPrefix));
  const monthDays = new Set(monthEntries.map((e) => e.date)).size;
  const view = state.view === 'all' ? null : journalById(state.view);
  document.title = `${cap(monthName(m))} ${y} · Günce`;

  const grid = h('div', { class: 'grid', role: 'grid' });
  for (let i = 0; i < cells; i++) {
    const date = addDays(start, i);
    const [dy, dm, dd] = parse(date);
    const outside = dm !== m || dy !== y;
    const valid = inRange(dy) && date.length === 10;
    const list = byDate.get(date) || [];
    const chips = list.map((e) => {
      const j = journalById(e.journalId);
      return h('span', { class: `chip c-${j?.color || 'peach'}` },
        h('span', { class: 'chip-mood' }, e.mood || j?.emoji || '•'),
        h('span', { class: 'chip-text' }, e.title || e.body));
    });
    grid.append(h('button', {
      type: 'button',
      role: 'gridcell',
      class: ['cell', outside && 'outside', date === today && 'today', date === state.selected && 'selected', list.length && 'has'].filter(Boolean).join(' '),
      disabled: !valid,
      'aria-label': `${valid ? formatLong(date) : ''}${list.length ? ' · ' + t('entriesCount', list.length) : ''}`,
      'aria-selected': String(date === state.selected),
      onclick: () => selectDate(date),
    },
      h('span', { class: 'cell-num' }, dd),
      list.length ? h('span', { class: 'cell-chips' }, chips, h('span', { class: 'more', hidden: true })) : null,
      list.length ? h('span', { class: 'cell-dots', 'aria-hidden': 'true' }, list.slice(0, 4).map((e) => h('i', { class: `dot c-${journalById(e.journalId)?.color || 'peach'}` }))) : null));
  }

  const stats = state.stats;
  cal.replaceChildren(
    h('div', { class: 'cal-head' },
      h('div', { class: 'cal-title-wrap' },
        view ? h('span', { class: `view-pill c-${view.color}` }, view.emoji, ' ', journalName(view), view.kind === 'shared' ? h('span', { class: 'faces' }, view.members.slice(0, 5).map((mm) => h('span', { class: 'face', title: mm.displayName }, mm.avatar))) : null)
          : h('span', { class: 'view-pill c-rainbow' }, '🌈 ', t('allJournals')),
        h('button', { type: 'button', class: 'cal-title', onclick: openMonthPicker, title: t('pickMonth') },
          h('span', {}, cap(monthName(m))), ' ', h('span', { class: 'cal-year' }, y), h('span', { class: 'caret' }, '▾'))),
      h('div', { class: 'cal-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('search'), title: t('search') + ' (/)', onclick: openSearch }, '🔍'),
        h('button', { type: 'button', class: 'icon-btn day-reopen', 'aria-label': t('showDay'), title: t('showDay'), onclick: openDaySheet }, '📖'),
        h('div', { class: 'seg' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('prev'), title: t('prev'), onclick: () => goToMonth(y, m - 1), disabled: y === MIN_YEAR && m === 1 }, '‹'),
          h('button', { type: 'button', class: 'btn btn-soft', onclick: () => selectDate(todayStr(), { open: false }) }, t('today')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('next'), title: t('next'), onclick: () => goToMonth(y, m + 1), disabled: y === MAX_YEAR && m === 12 }, '›')))),
    h('p', { class: 'cal-summary' },
      t('monthSummary', monthEntries.length, monthDays),
      stats && stats.entries ? h('span', { class: 'muted total' }, h('span', { class: 'sep' }, ' · '), t('totalSummary', stats.entries, formatShort(stats.first))) : null),
    h('div', { class: 'weekdays', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: i >= 5 ? 'weekend' : '' }, weekdayName(i, 'short')))),
    grid);
  fitChips();
  gridObserver.disconnect();
  gridObserver.observe(grid);
}

// Cells have a fixed height, so show as many chips as fit and sum up the rest as "+N".
function fitChips() {
  for (const box of document.querySelectorAll('.cell-chips')) {
    const chips = [...box.querySelectorAll('.chip')];
    const more = box.querySelector('.more');
    chips.forEach((c) => { c.hidden = false; });
    more.hidden = true;
    let hidden = 0;
    // The "+N" badge sits in the corner, so only the chips themselves need to fit.
    for (let i = chips.length - 1; i > 0 && box.scrollHeight > box.clientHeight + 1; i--) {
      chips[i].hidden = true;
      more.hidden = false;
      more.textContent = `+${++hidden}`;
    }
  }
}
let fitFrame = 0;
const gridObserver = new ResizeObserver(() => {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitChips);
});

function openMonthPicker() {
  let year = state.year;
  const yearInput = h('input', { type: 'number', min: MIN_YEAR, max: MAX_YEAR, value: String(year), class: 'year-input', 'aria-label': t('year') });
  const months = h('div', { class: 'month-grid' });
  const draw = () => {
    months.replaceChildren(...Array.from({ length: 12 }, (_, i) => h('button', {
      type: 'button',
      class: `month-btn ${year === state.year && i + 1 === state.month ? 'active' : ''}`,
      onclick: () => { close(); goToMonth(year, i + 1); },
    }, cap(monthName(i + 1)))));
  };
  const step = (d) => { year = Math.min(MAX_YEAR, Math.max(MIN_YEAR, year + d)); yearInput.value = year; draw(); };
  yearInput.addEventListener('input', () => {
    const v = parseInt(yearInput.value, 10);
    if (inRange(v)) { year = v; draw(); }
  });
  draw();
  const { close } = modal({
    title: t('pickMonth'),
    className: 'modal-small',
    body: [
      h('div', { class: 'year-row' },
        h('button', { type: 'button', class: 'icon-btn', onclick: () => step(-10), 'aria-label': '-10' }, '«'),
        h('button', { type: 'button', class: 'icon-btn', onclick: () => step(-1), 'aria-label': '-1' }, '‹'),
        yearInput,
        h('button', { type: 'button', class: 'icon-btn', onclick: () => step(1), 'aria-label': '+1' }, '›'),
        h('button', { type: 'button', class: 'icon-btn', onclick: () => step(10), 'aria-label': '+10' }, '»')),
      months,
    ],
  });
  yearInput.select();
}

// ---------------------------------------------------------------------------
// Day panel
// ---------------------------------------------------------------------------

let memoriesToken = 0;

function entryCard(e, { compact = false } = {}) {
  const j = journalById(e.journalId);
  const showJournal = state.view === 'all' && j;
  if (compact) {
    const diff = parse(state.selected)[0] - parse(e.date)[0];
    return h('button', { type: 'button', class: `memory c-${j?.color || 'peach'}`, onclick: () => selectDate(e.date) },
      h('span', { class: 'memory-mood' }, e.mood || j?.emoji || '📔'),
      h('span', { class: 'memory-text' },
        h('small', {}, t('yearsAgo', diff), ' · ', parse(e.date)[0]),
        h('strong', {}, e.title || e.body.slice(0, 80))));
  }
  const by = e.author ? `${e.author.avatar} ${e.author.displayName}` : t('deletedUser');
  return h('article', { class: `entry c-${j?.color || 'peach'}` },
    h('div', { class: 'entry-top' },
      h('span', { class: 'entry-mood' }, e.mood || j?.emoji || '📔'),
      h('div', { class: 'entry-headline' },
        e.time ? h('span', { class: 'entry-time' }, e.time) : null,
        e.title ? h('h3', {}, e.title) : null,
        e.place ? h('span', { class: 'entry-place' }, '📍 ', e.place) : null),
      h('div', { class: 'entry-actions' },
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('edit'), title: t('edit'), onclick: () => openEditor(e) }, '✏️'),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('delete'), title: t('delete'), onclick: () => deleteEntry(e) }, '🗑️'))),
    e.body ? h('p', { class: 'entry-body' }, e.body) : null,
    h('footer', { class: 'entry-foot' },
      j && (j.kind === 'shared' || showJournal) ? h('span', {}, by) : null,
      e.editedBy ? h('span', { class: 'muted' }, '· ', t('editedBy', e.editedBy)) : null,
      showJournal ? h('span', { class: `tag c-${j.color}` }, j.emoji, ' ', journalName(j)) : null));
}

function renderDay() {
  const day = $('#day');
  if (!day) return;
  const s = state.selected;
  const list = state.entries.filter((e) => e.date === s);
  const [y, m, d] = parse(s);
  const memories = h('div', { class: 'memories' });

  const wide = panelFlag('day-wide');
  day.replaceChildren(
    // Fixed toolbar: day arrows on the left, size/close on the right, whatever the date says.
    h('div', { class: 'day-tools' },
      h('div', { class: 'seg day-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('prevDay'), title: t('prevDay'), onclick: () => selectDate(addDays(s, -1), { open: false }) }, '‹'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('nextDay'), title: t('nextDay'), onclick: () => selectDate(addDays(s, 1), { open: false }) }, '›')),
      h('button', { type: 'button', class: 'btn btn-ghost small day-wide-btn', onclick: toggleWideDay, 'aria-pressed': String(wide) },
        wide ? '⤡ ' : '⤢ ', wide ? t('shrinkDay') : t('expandDay')),
      h('button', { type: 'button', class: 'icon-btn small sheet-close', 'aria-label': t('hideDay'), title: t('hideDay'), onclick: closeDaySheet }, '✕')),
    h('div', { class: 'day-head' },
      h('div', { class: 'day-date' },
        h('span', { class: 'day-num' }, d),
        h('span', { class: 'day-meta' },
          h('strong', {}, weekdayName(weekdayOf(y, m, d))),
          h('span', {}, `${cap(monthName(m))} ${y}`)))),
    h('button', { type: 'button', class: 'btn btn-primary btn-block add-btn', onclick: () => openEditor(null, s) }, '＋ ', t('addEntry')),
    list.length
      ? h('div', { class: 'entries' }, list.map((e) => entryCard(e)))
      : h('button', { type: 'button', class: 'empty', onclick: () => openEditor(null, s) },
        h('span', { class: 'empty-art', 'aria-hidden': 'true' }, '🌷'),
        h('span', {}, h('strong', {}, t('emptyDay'))),
        h('span', { class: 'muted' }, t('emptyDayHint'))),
    memories);

  const token = ++memoriesToken;
  api('GET', `/api/entries/memories?date=${s}&journal=${viewParam()}`)
    .then(({ entries }) => {
      if (token !== memoriesToken || !entries.length) return;
      memories.replaceChildren(h('h4', {}, '✨ ', t('memories')), ...entries.map((e) => entryCard(e, { compact: true })));
    })
    .catch(() => {});
}

async function deleteEntry(e) {
  if (!(await confirmDialog(t('deleteEntryConfirm')))) return;
  try {
    await api('DELETE', `/api/entries/${e.id}`);
    toast(t('entryDeleted'));
    refresh({ journals: true });
  } catch (err) {
    showError(err);
  }
}

// ---------------------------------------------------------------------------
// Entry editor
// ---------------------------------------------------------------------------

function openEditor(entry, date) {
  const editing = !!entry;
  const lastJournal = store.get('gunce-last-journal');
  let journalId = editing ? entry.journalId
    : state.view !== 'all' ? Number(state.view)
      : (journalById(lastJournal) || personalJournal())?.id;
  let mood = editing ? entry.mood : '';
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const journalPicker = h('div', { class: 'pick-row journal-pick', role: 'radiogroup', 'aria-label': t('journal') });
  const drawJournals = () => journalPicker.replaceChildren(...state.journals.map((j) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(j.id === journalId),
    class: `pick-chip c-${j.color} ${j.id === journalId ? 'active' : ''}`,
    onclick: () => { journalId = j.id; drawJournals(); },
  }, j.emoji, ' ', journalName(j))));
  drawJournals();

  const moodPicker = h('div', { class: 'pick-row mood-pick', role: 'radiogroup', 'aria-label': t('mood') });
  const drawMoods = () => moodPicker.replaceChildren(...MOODS.map((md) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(md === mood), class: `mood-btn ${md === mood ? 'active' : ''}`,
    onclick: () => { mood = mood === md ? '' : md; drawMoods(); },
  }, md)));
  drawMoods();

  const v = entry || {};
  const body = h('textarea', { name: 'body', rows: 7, maxlength: 20000, placeholder: t('bodyPlaceholder') });
  body.value = v.body || '';
  const autosize = () => { body.style.height = 'auto'; body.style.height = Math.min(body.scrollHeight + 4, window.innerHeight * 0.5) + 'px'; };
  body.addEventListener('input', autosize);

  const form = h('form', { class: 'editor', novalidate: true },
    state.journals.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('journal')), journalPicker) : null,
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('date')),
        h('input', { name: 'date', type: 'date', required: true, min: '0001-01-01', max: '9999-12-31', value: v.date || date })),
      h('label', { class: 'field field-time' }, h('span', { class: 'field-label' }, t('time'), h('small', {}, ` (${t('optional')})`)),
        h('input', { name: 'time', type: 'time', value: v.time || '' }))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('mood')), moodPicker),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('title')),
      h('input', { name: 'title', type: 'text', maxlength: 120, placeholder: t('titlePlaceholder'), value: v.title || '' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('place'), h('small', {}, ` (${t('optional')})`)),
      h('input', { name: 'place', type: 'text', maxlength: 120, placeholder: t('placePlaceholder'), value: v.place || '' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('body')), body),
    err);

  const save = async () => {
    const fd = Object.fromEntries(new FormData(form));
    const payload = { date: fd.date, time: fd.time, title: fd.title, place: fd.place, body: fd.body, mood };
    err.hidden = true;
    saveBtn.disabled = true;
    try {
      if (editing) await api('PATCH', `/api/entries/${entry.id}`, { ...payload, journalId });
      else await api('POST', `/api/journals/${journalId}/entries`, payload);
      store.set('gunce-last-journal', String(journalId));
      close();
      toast(t('entrySaved'));
      if (fd.date && fd.date !== state.selected) selectDate(fd.date, { open: false });
      refresh({ journals: true });
    } catch (ex) {
      err.textContent = ex.code === 'offline' ? t('offline') : errorText(ex.code);
      err.hidden = false;
      saveBtn.disabled = false;
    }
  };
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, t('save'));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });

  const { close } = modal({
    title: editing ? t('editEntry') : `${t('newEntry')} · ${formatShort(date)}`,
    className: 'modal-editor',
    body: form,
    footer: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('cancel')), saveBtn],
  });
  requestAnimationFrame(autosize);
  form.querySelector(editing ? 'textarea' : 'input[name=title]').focus();
}

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------

function openJournalModal(journal) {
  const editing = !!journal;
  const personal = journal?.kind === 'personal';
  let emoji = journal?.emoji || JOURNAL_EMOJIS[1 + Math.floor(Math.random() * (JOURNAL_EMOJIS.length - 1))];
  let color = journal?.color || COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))];
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const preview = h('div', { class: 'journal-preview' });
  const drawPreview = () => {
    preview.className = `journal-preview c-${color}`;
    preview.replaceChildren(h('span', {}, emoji));
  };
  const emojiGrid = h('div', { class: 'pick-row emoji-pick' });
  const drawEmojis = () => emojiGrid.replaceChildren(...JOURNAL_EMOJIS.map((em) => h('button', {
    type: 'button', class: `mood-btn ${em === emoji ? 'active' : ''}`, onclick: () => { emoji = em; drawEmojis(); drawPreview(); },
  }, em)));
  const colorRow = h('div', { class: 'pick-row color-pick' });
  const drawColors = () => colorRow.replaceChildren(...COLORS.map((c) => h('button', {
    type: 'button', class: `swatch c-${c} ${c === color ? 'active' : ''}`, 'aria-label': c, title: c, onclick: () => { color = c; drawColors(); drawPreview(); },
  })));
  drawEmojis(); drawColors(); drawPreview();

  const nameInput = h('input', {
    name: 'name', type: 'text', maxlength: 60, required: !personal,
    placeholder: personal ? t('personalNamePlaceholder') : t('journalNamePlaceholder'), value: journal?.name || '',
  });

  const form = h('form', { class: 'editor', novalidate: true },
    h('div', { class: 'journal-name-row' }, preview,
      h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, t('journalName')), nameInput)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('icon')), emojiGrid),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('color')), colorRow),
    err);

  const sections = [form];

  if (editing && journal.kind === 'shared') {
    const link = `${location.origin}/join/${journal.inviteCode}`;
    const copy = async (text) => {
      try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { prompt('', text); }
    };
    sections.push(
      h('section', { class: 'panel' },
        h('h3', {}, '💌 ', t('invite')),
        h('p', { class: 'muted' }, t('inviteHint')),
        h('div', { class: 'invite-code' }, journal.inviteCode),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-soft', onclick: () => copy(link) }, '🔗 ', t('copyLink')),
          h('button', { type: 'button', class: 'btn btn-soft', onclick: () => copy(journal.inviteCode) }, t('copyCode')),
          journal.isOwner ? h('button', {
            type: 'button', class: 'btn btn-ghost', onclick: async () => {
              if (!(await confirmDialog(t('newCodeConfirm'), { okText: t('newCode'), danger: false }))) return;
              try {
                const { journal: updated } = await api('POST', `/api/journals/${journal.id}/invite`, {});
                close(); await refresh({ journals: true }); openJournalModal(updated);
              } catch (ex) { showError(ex); }
            },
          }, '🔄 ', t('newCode')) : null)),
      h('section', { class: 'panel' },
        h('h3', {}, '👥 ', t('members'), ` (${journal.members.length})`),
        h('ul', { class: 'members' }, journal.members.map((mb) => h('li', {},
          h('span', { class: 'face big' }, mb.avatar),
          h('span', { class: 'member-name' }, h('strong', {}, mb.displayName), h('small', {}, '@' + mb.username,
            mb.id === journal.ownerId ? ` · ${t('owner')}` : '', mb.id === state.user.id ? ` · ${t('you')}` : '')),
          journal.isOwner && mb.id !== state.user.id ? h('button', {
            type: 'button', class: 'btn btn-ghost small', onclick: async () => {
              if (!(await confirmDialog(t('removeMemberConfirm', mb.displayName), { okText: t('removeMember') }))) return;
              try {
                const { journal: updated } = await api('DELETE', `/api/journals/${journal.id}/members/${mb.id}`);
                close(); await refresh({ journals: true }); openJournalModal(updated);
              } catch (ex) { showError(ex); }
            },
          }, t('removeMember')) : null)))));
  }

  if (editing) {
    const alone = journal.members.length <= 1;
    sections.push(h('section', { class: 'panel panel-quiet' },
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-ghost', href: `/api/journals/${journal.id}/export`, download: `gunce-${journal.id}.json` }, '💾 ', t('exportJson')),
        journal.kind === 'shared' && !alone ? h('button', {
          type: 'button', class: 'btn btn-danger-soft', onclick: async () => {
            if (!(await confirmDialog(t('leaveConfirm'), { okText: t('leave') }))) return;
            try { await api('POST', `/api/journals/${journal.id}/leave`, {}); close(); setView('all', false); refresh({ journals: true }); } catch (ex) { showError(ex); }
          },
        }, '👋 ', t('leave')) : null,
        journal.kind === 'shared' && journal.isOwner ? h('button', {
          type: 'button', class: 'btn btn-danger-soft', onclick: async () => {
            if (!(await confirmDialog(t('deleteJournalConfirm', journal.name)))) return;
            try { await api('DELETE', `/api/journals/${journal.id}`); close(); setView('all', false); refresh({ journals: true }); } catch (ex) { showError(ex); }
          },
        }, '🗑️ ', t('deleteJournal')) : null)));
  }

  const save = async () => {
    err.hidden = true;
    const payload = { name: nameInput.value, emoji, color };
    try {
      const { journal: j } = editing
        ? await api('PATCH', `/api/journals/${journal.id}`, payload)
        : await api('POST', '/api/journals', payload);
      close();
      if (!editing) {
        state.view = String(j.id);
        store.set('gunce-view', state.view);
        await refresh({ journals: true });
        openJournalModal(j); // straight to the invite code
      } else {
        toast(t('saved'));
        refresh({ journals: true });
      }
    } catch (ex) {
      err.textContent = errorText(ex.code);
      err.hidden = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  const { close } = modal({
    title: editing ? `${journal.emoji} ${journalName(journal)}` : `✨ ${t('newShared')}`,
    className: 'modal-editor',
    body: sections,
    footer: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('cancel')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, editing ? t('save') : t('create'))],
  });
  if (!editing) nameInput.focus();
}

function openJoinModal(prefill = '') {
  const input = h('input', { type: 'text', class: 'code-input', maxlength: 12, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'ABCD2345', value: prefill, 'aria-label': t('inviteCode') });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const join = async () => {
    err.hidden = true;
    try {
      const { journal } = await api('POST', '/api/join', { code: input.value });
      close();
      toast(t('joined', journalName(journal)));
      state.view = String(journal.id);
      store.set('gunce-view', state.view);
      refresh({ journals: true });
    } catch (ex) {
      err.textContent = errorText(ex.code);
      err.hidden = false;
    }
  };
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); join(); } },
    h('p', { class: 'muted' }, t('joinHint')), input, err);
  const { close } = modal({
    title: `🔑 ${t('joinTitle')}`,
    className: 'modal-small',
    body: form,
    footer: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('cancel')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: join }, t('join'))],
  });
  input.focus();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function openSearch() {
  const input = h('input', { type: 'search', class: 'search-input', placeholder: t('searchPlaceholder'), 'aria-label': t('search') });
  const results = h('div', { class: 'results' });
  let timer, token = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const my = ++token;
      if (!q) return results.replaceChildren();
      try {
        const { entries } = await api('GET', `/api/entries/search?journal=${viewParam()}&q=${encodeURIComponent(q)}`);
        if (my !== token) return;
        results.replaceChildren(...(entries.length ? entries.map((e) => {
          const j = journalById(e.journalId);
          return h('button', { type: 'button', class: `result c-${j?.color || 'peach'}`, onclick: () => { close(); selectDate(e.date); } },
            h('span', { class: 'memory-mood' }, e.mood || j?.emoji || '📔'),
            h('span', { class: 'memory-text' },
              h('small', {}, formatShort(e.date), j ? ` · ${j.emoji} ${journalName(j)}` : ''),
              h('strong', {}, e.title || e.body.slice(0, 80)),
              e.title && e.body ? h('span', { class: 'snippet' }, e.body.slice(0, 140)) : null));
        }) : [h('p', { class: 'muted center' }, t('noResults'))]));
      } catch (ex) { showError(ex); }
    }, 250);
  });
  const { close } = modal({ title: `🔍 ${t('search')}`, className: 'modal-search', body: [input, results] });
  input.focus();
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function openProfile() {
  const u = state.user;
  let avatar = u.avatar;
  let lang = state.lang;
  let theme = store.get('gunce-theme') || 'auto';
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const avatarRow = h('div', { class: 'pick-row emoji-pick' });
  const drawAvatars = () => avatarRow.replaceChildren(...AVATARS.map((a) => h('button', {
    type: 'button', class: `mood-btn ${a === avatar ? 'active' : ''}`, onclick: () => { avatar = a; drawAvatars(); },
  }, a)));
  drawAvatars();

  const segmented = (options, get, set) => {
    const wrap = h('div', { class: 'segmented' });
    const draw = () => wrap.replaceChildren(...options.map(([val, label]) => h('button', {
      type: 'button', class: get() === val ? 'active' : '', onclick: () => { set(val); draw(); },
    }, label)));
    draw();
    return wrap;
  };

  const nameInput = h('input', { type: 'text', maxlength: 40, value: u.displayName });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', placeholder: t('currentPassword') });
  const next = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('newPassword') });
  const delPw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: t('deleteAccountConfirm') });

  const save = async () => {
    err.hidden = true;
    const payload = { displayName: nameInput.value, avatar, lang };
    if (next.value) Object.assign(payload, { currentPassword: cur.value, newPassword: next.value });
    try {
      const { user } = await api('PATCH', '/api/me', payload);
      state.user = user;
      store.set('gunce-theme', theme);
      applyTheme(theme);
      setLang(user.lang);
      close();
      toast(t('saved'));
      renderShell();
      refresh({ journals: true });
    } catch (ex) {
      err.textContent = errorText(ex.code);
      err.hidden = false;
    }
  };

  const { close } = modal({
    title: `${u.avatar} ${t('profile')}`,
    className: 'modal-editor',
    body: [
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('avatar')), avatarRow),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('displayName')), nameInput),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('language')), segmented([['tr', 'Türkçe'], ['en', 'English']], () => lang, (v) => { lang = v; })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('theme')),
          segmented([['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]], () => theme, (v) => { theme = v; applyTheme(v); }))),
      h('details', { class: 'panel' }, h('summary', {}, '🔒 ', t('changePassword')), h('div', { class: 'stack' }, cur, next)),
      err,
      h('section', { class: 'panel panel-quiet' },
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn btn-soft', onclick: async () => {
              await api('POST', '/api/auth/logout', {}).catch(() => {});
              state.user = null;
              close();
              renderAuth();
            },
          }, '👋 ', t('logout')))),
      h('details', { class: 'panel panel-danger' }, h('summary', {}, t('deleteAccount')),
        h('p', { class: 'muted' }, t('deleteAccountHint')),
        h('div', { class: 'stack' }, delPw,
          h('button', {
            type: 'button', class: 'btn btn-danger', onclick: async () => {
              try {
                await api('DELETE', '/api/me', { password: delPw.value });
                state.user = null;
                close();
                renderAuth('register');
              } catch (ex) { showError(ex); }
            },
          }, t('deleteAccount')))),
    ],
    footer: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('cancel')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, t('save'))],
    onClose: () => applyTheme(),
  });
}

// ---------------------------------------------------------------------------
// Keyboard, polling, boot
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (!state.user || anyDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowLeft') goToMonth(state.year, state.month - 1);
  else if (e.key === 'ArrowRight') goToMonth(state.year, state.month + 1);
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEditor(null, state.selected); }
  else if (e.key === '/') { e.preventDefault(); openSearch(); }
  else if (e.key === 't' || e.key === 'T') selectDate(todayStr(), { open: false });
  else if (e.key === '[') toggleSidebar();
  else if (e.key === ']') { if (panelFlag('day-hidden')) openDaySheet(); else closeDaySheet(); }
  else if (e.key === 'Escape') { closeNav(); document.body.classList.remove('day-open'); }
});

// Friends may be writing in a shared journal at the same time; pick up their changes quietly.
setInterval(() => {
  if (state.user && document.visibilityState === 'visible' && !anyDialogOpen()) refresh({ journals: true });
}, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (state.user && document.visibilityState === 'visible' && !anyDialogOpen()) refresh({ journals: true });
});

async function boot() {
  applyTheme();
  const joinMatch = /^\/join\/([A-Za-z0-9]+)/.exec(location.pathname);
  if (joinMatch) sessionStorage.setItem('gunce-invite', joinMatch[1]);
  try {
    const { user } = await api('GET', '/api/me');
    await enter(user);
  } catch {
    setLang(state.lang);
    renderAuth(joinMatch ? 'register' : 'login');
  }
}

boot();
