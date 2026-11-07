'use strict';
// Layout + reusable UI components.
const { html, raw, esc, fmtDate, initials, qs } = require('./util');
const { STATUS, unreadCount, getSettings } = require('./domain');
const { one } = require('./db');

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M8 7h7M8 11h5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 5v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6M9 18h3"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17-5-5 5-5M5 12h11"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  stethoscope: '<path d="M5 3H4v5a5 5 0 0 0 10 0V3h-1"/><path d="M9 13v1.5a5.5 5.5 0 0 0 11 0V12"/><circle cx="20" cy="10" r="2"/>',
  scalpel: '<path d="M14.5 9.5 4 20h4.5L18 10.5z"/><path d="m14.5 9.5 5-5a1.4 1.4 0 0 1 2 2l-3 4"/>',
  syringe: '<path d="m18 2 4 4M17 3l4 4M19 5 8.5 15.5M14 4l6 6M10 8l6 6-7.5 7.5H4v-4.5z"/><path d="m2 22 2-2"/>',
  lecture: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 9h6M7 12h4"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
  presentation: '<path d="M3 4h18M5 4v10h14V4M12 14v4M8 21l4-3 4 3"/><path d="m9 11 2-2 2 2 2-3"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  paperclip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
};
const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

const LOGO = raw(`<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="url(#lg)"/><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b7a8c"/><stop offset="1" stop-color="#0b3f52"/></linearGradient></defs><path d="M11 12.5c3-1.6 6.2-1.6 9 0v16c-2.8-1.6-6-1.6-9 0z" fill="#fff" opacity=".95"/><path d="M20 12.5c2.8-1.6 6-1.6 9 0v16c-3-1.6-6.2-1.6-9 0z" fill="#fff" opacity=".7"/><circle cx="20" cy="21" r="0" /><path d="m14 21 2.2 2.2L20.5 18" fill="none" stroke="#c99a3b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

const NAV = {
  candidate: [
    ['Overview', [['/candidate', 'Dashboard', 'grid'], ['/activities/new', 'Add Activity', 'plus'], ['/logbook', 'My Logbook', 'book'], ['/progress', 'Progress', 'target']]],
    ['Account', [['/reports/candidate/me', 'Logbook Report', 'file'], ['/notifications', 'Notifications', 'bell'], ['/profile', 'Profile', 'user']]],
  ],
  staff: [
    ['Supervision', [['/staff', 'Dashboard', 'grid'], ['/staff/pending', 'Pending Approvals', 'clock', 'pending'], ['/staff/approved', 'Reviewed Activities', 'checkCircle'], ['/staff/candidates', 'My Candidates', 'users']]],
    ['Account', [['/reports/supervisors', 'Supervisor Report', 'file'], ['/notifications', 'Notifications', 'bell'], ['/profile', 'Profile', 'user']]],
  ],
  manager: [
    ['Monitoring', [['/admin', 'Dashboard', 'grid'], ['/admin/candidates', 'Candidates', 'users'], ['/admin/staff', 'Staff', 'shield'], ['/admin/activities', 'Activities', 'book'], ['/staff/pending', 'Approvals', 'clock', 'pending']]],
    ['Administration', [['/admin/requirements', 'Requirements', 'target'], ['/admin/reports', 'Reports', 'file'], ['/admin/settings', 'Settings', 'settings'], ['/admin/audit', 'Audit Log', 'history']]],
    ['Account', [['/notifications', 'Notifications', 'bell'], ['/profile', 'Profile', 'user']]],
  ],
};
const ROLE_LABEL = { candidate: 'Candidate Portal', staff: 'Staff Approval Portal', manager: 'Manager Portal' };

function pendingForUser(user) {
  if (user.role === 'manager') return one("SELECT COUNT(*) n FROM activities WHERE status='pending'").n;
  if (user.role === 'staff') return one("SELECT COUNT(*) n FROM activities a JOIN staff s ON s.id=a.supervisor_id WHERE a.status='pending' AND s.user_id=?", user.id).n;
  return 0;
}

function head(title) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Electronic Andrology Logbook</title>
<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap">
<link rel="stylesheet" href="/public/app.css"></head>`;
}

function flashes(req) {
  const list = req.takeFlash ? req.takeFlash() : [];
  if (!list.length) return '';
  const ic = { success: 'checkCircle', danger: 'xCircle', warning: 'alert', info: 'bell' };
  return html`<div class="flash-stack">${list.map((f) => html`<div class="flash flash-${f.type}" role="status">${icon(ic[f.type] || 'bell')}<span>${f.msg}</span><button class="flash-x" data-dismiss aria-label="Dismiss">${icon('x')}</button></div>`)}</div>`;
}

function layout(req, { title, subtitle, actions, body, active, crumbs }) {
  const u = req.user;
  const s = getSettings();
  const current = active || req.path;
  const pend = pendingForUser(u);
  const unread = unreadCount(u.id);
  const nav = NAV[u.role].map(([group, items]) => html`<div class="nav-group"><div class="nav-label">${group}</div>${items.map(([href, label, ic, badge]) => {
    const on = current === href || (href !== '/candidate' && href !== '/staff' && href !== '/admin' && current.startsWith(href + '/'));
    const count = badge === 'pending' ? pend : href === '/notifications' ? unread : 0;
    return html`<a class="nav-item${on ? ' active' : ''}" href="${href}">${icon(ic)}<span>${label}</span>${count ? html`<em class="nav-badge">${count > 99 ? '99+' : count}</em>` : ''}</a>`;
  })}</div>`);
  return html`${head(title)}<body class="app">
<aside class="sidebar" id="sidebar">
  <a class="brand" href="/">${LOGO}<div><strong>Andrology Logbook</strong><span>Electronic Training Record</span></div></a>
  <nav class="nav">${nav}</nav>
  <div class="side-foot">
    <div class="me"><span class="avatar">${initials(u.name)}</span><div><strong>${u.name}</strong><span>${ROLE_LABEL[u.role]}</span></div></div>
    <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="icon-btn ghost-dark" title="Sign out" aria-label="Sign out">${icon('logout')}</button></form>
  </div>
</aside>
<div class="scrim" data-toggle-sidebar></div>
<div class="main">
  <header class="topbar">
    <button class="icon-btn menu-btn" data-toggle-sidebar aria-label="Menu">${icon('menu')}</button>
    <div class="topbar-org"><span>${s.institution_name}</span><strong>${s.department_name}</strong></div>
    <div class="topbar-actions">
      <a class="icon-btn bell${unread ? ' has' : ''}" href="/notifications" aria-label="Notifications">${icon('bell')}${unread ? html`<i>${unread > 9 ? '9+' : unread}</i>` : ''}</a>
      <a class="top-user" href="/profile"><span class="avatar sm">${initials(u.name)}</span><span class="top-user-name">${u.name}</span></a>
    </div>
  </header>
  <main class="content">
    ${flashes(req)}
    <div class="page-head">
      <div>${crumbs ? html`<div class="crumbs">${crumbs.map(([h, l], i) => html`${i ? html`<span>/</span>` : ''}${h ? html`<a href="${h}">${l}</a>` : html`<em>${l}</em>`}`)}</div>` : ''}
        <h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
      ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
    </div>
    ${body}
  </main>
  <footer class="foot"><span>${icon('lock')} Secure session · All edits and approvals are audit-logged · No patient names are stored</span><span>Electronic Andrology Logbook v1.0</span></footer>
</div>
${EMBED_OPEN}<script src="/public/app.js"></script></body></html>`;
}

const EMBED_OPEN = raw('<a class="embed-open" href="/" target="_blank" rel="noopener" hidden data-embed-open><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>Open in new tab</a>');
function bare(title, body, cls = '') {
  return html`${head(title)}<body class="${cls}">${body}${EMBED_OPEN}<script src="/public/app.js"></script></body></html>`;
}

// ---------- Components ----------
const badge = (status) => { const s = STATUS[status] || { label: status, cls: 'draft' }; return html`<span class="badge b-${s.cls}"><i></i>${s.label}</span>`; };
const RISK_CLS = { ok: 'approved', follow: 'pending', risk: 'rejected', complete: 'complete' };
const riskBadge = (r) => html`<span class="badge b-${RISK_CLS[r.key]}"><i></i>${r.label}</span>`;
const programBadge = (p) => html`<span class="pill pill-${p === 'MD' ? 'md' : 'ms'}">${p}</span>`;

function bar(value, { expected = null, tone = '', label = true } = {}) {
  const v = Math.max(0, Math.min(100, value || 0));
  const t = tone || (v >= 100 ? 'done' : '');
  return html`<div class="bar-wrap"><div class="bar ${t}"><span style="width:${v.toFixed(1)}%"></span>${expected != null ? html`<b class="bar-exp" style="left:${Math.min(100, expected).toFixed(1)}%" title="Expected ${Math.round(expected)}%"></b>` : ''}</div>${label ? html`<em>${Math.round(v)}%</em>` : ''}</div>`;
}

function stat(label, value, { ic = 'chart', tone = 'teal', foot = '', href = '' } = {}) {
  const inner = html`<div class="stat-top"><span class="stat-ic t-${tone}">${icon(ic)}</span><span class="stat-label">${label}</span></div><div class="stat-value">${value}</div>${foot ? html`<div class="stat-foot">${foot}</div>` : ''}`;
  return href ? html`<a class="card stat link" href="${href}">${inner}</a>` : html`<div class="card stat">${inner}</div>`;
}

function card(title, body, { actions = '', cls = '', sub = '' } = {}) {
  return html`<section class="card ${cls}">${title ? html`<header class="card-head"><div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>${actions ? html`<div class="card-actions">${actions}</div>` : ''}</header>` : ''}${body}</section>`;
}

const empty = (title, text, action = '') => html`<div class="empty">${icon('clipboard')}<strong>${title}</strong><p>${text}</p>${action}</div>`;
const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
const avatarName = (name, sub = '') => html`<div class="who"><span class="avatar xs">${initials(name)}</span><div><strong>${name}</strong>${sub ? html`<span>${sub}</span>` : ''}</div></div>`;

function select(name, options, value, { placeholder = '', required = false, cls = '' } = {}) {
  return html`<select name="${name}" ${raw(required ? 'required' : '')} class="${cls}">${placeholder !== false ? html`<option value="">${placeholder || 'Select…'}</option>` : ''}${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return html`<option value="${v}" ${raw(String(v) === String(value ?? '') ? 'selected' : '')}>${l}</option>`;
  })}</select>`;
}

function pager(page, pages, query, base) {
  if (pages <= 1) return '';
  const link = (p, l, dis) => (dis ? html`<span class="pg dis">${l}</span>` : html`<a class="pg${p === page ? ' on' : ''}" href="${base}${qs({ ...query, page: p })}">${l}</a>`);
  const nums = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(link(p, p));
  return html`<nav class="pager">${link(page - 1, '‹ Prev', page <= 1)}${nums}${link(page + 1, 'Next ›', page >= pages)}<span class="pg-info">Page ${page} of ${pages}</span></nav>`;
}

const typeIcon = (form) => ({ clinic: 'stethoscope', operation: 'scalpel', procedure: 'syringe', lecture: 'lecture', research: 'flask', case: 'presentation' }[form] || 'dots');

module.exports = { icon, LOGO, layout, bare, head, badge, riskBadge, programBadge, bar, stat, card, empty, csrf, avatarName, select, pager, typeIcon, esc, fmtDate };
