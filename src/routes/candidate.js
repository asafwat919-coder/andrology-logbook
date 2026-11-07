'use strict';
const { get } = require('../http');
const { all, one } = require('../db');
const { html, fmtDate, timeAgo, num, MONTHS, toISODate } = require('../util');
const D = require('../domain');
const ui = require('../ui');
const charts = require('../charts');
const { listActivities, filterBar, activityTable } = require('./activities');

function progressTable(p, { compact = false } = {}) {
  if (!p.categories.length) return ui.empty('No requirements defined', 'The department has not set requirements for this program yet.');
  return html`<div class="table-wrap"><table class="table req-table">
    <thead><tr><th>Category</th><th class="num">Required</th><th class="num">Approved</th>${compact ? '' : html`<th class="num">Pending</th>`}<th class="num">Remaining</th><th class="w-prog">Progress</th></tr></thead>
    <tbody>${p.categories.map((c) => html`<tr><td><div class="cat"><span class="act-ic sm">${ui.icon(ui.typeIcon(c.form))}</span>${c.name}</div></td>
      <td class="num">${c.required || '—'}</td><td class="num strong">${num(c.approved)}</td>${compact ? '' : html`<td class="num muted">${c.pending || '—'}</td>`}
      <td class="num">${c.required ? num(c.remaining) : '—'}</td><td>${c.pct == null ? html`<span class="muted">Not required</span>` : ui.bar(c.pct)}</td></tr>`)}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${num(p.required)}</td><td class="num strong">${num(p.completed)}</td>${compact ? '' : html`<td></td>`}<td class="num">${num(p.required - p.completed)}</td><td>${ui.bar(p.overall, { expected: p.expected })}</td></tr></tfoot>
  </table></div>`;
}

function monthlySeries(candidateId) {
  const labels = [], keys = [];
  const d = new Date(); d.setDate(1);
  for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); keys.push(toISODate(m).slice(0, 7)); labels.push(MONTHS[m.getMonth()]); }
  const rows = all(`SELECT substr(activity_date,1,7) ym, SUM(CASE WHEN status<>'draft' THEN 1 ELSE 0 END) sub, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) ok
    FROM activities WHERE ${candidateId ? 'candidate_id=? AND ' : ''} activity_date >= ? GROUP BY ym`, ...(candidateId ? [candidateId] : []), keys[0] + '-01');
  const map = Object.fromEntries(rows.map((r) => [r.ym, r]));
  return { labels, submitted: keys.map((k) => map[k]?.sub || 0), approved: keys.map((k) => map[k]?.ok || 0) };
}

function timelineCard(c, p) {
  const s = c.training_start_date, e = c.expected_completion_date;
  const exp = p.expected ?? 0;
  return html`<div class="tline">
    <div class="tline-row"><span>Started ${fmtDate(s)}</span><span>Expected completion ${fmtDate(e)}</span></div>
    <div class="tline-track"><span class="tl-time" style="width:${exp.toFixed(1)}%"></span><span class="tl-prog" style="width:${p.overall.toFixed(1)}%"></span></div>
    <div class="tline-legend"><span><i class="s-time"></i>Time elapsed ${Math.round(exp)}%</span><span><i class="s-prog"></i>Requirements approved ${Math.round(p.overall)}%</span></div>
  </div>`;
}

get('/candidate', { roles: ['candidate'] }, (req, res) => {
  const c = D.candidateByUser(req.user.id);
  const p = D.candidateProgress(c);
  const t = p.totals;
  const comments = all(`SELECT a.id, a.title, a.status, r.comment, r.created_at, u.name FROM activity_reviews r JOIN activities a ON a.id=r.activity_id JOIN users u ON u.id=r.user_id
    WHERE a.candidate_id=? AND r.comment IS NOT NULL AND r.comment<>'' AND r.action IN ('approved','rejected','correction') ORDER BY r.created_at DESC LIMIT 5`, c.id);
  const recent = listActivities({}, { candidateId: c.id }, { per: 6, order: 'a.updated_at DESC' }).rows;
  const needs = one("SELECT COUNT(*) n FROM activities WHERE candidate_id=? AND status IN ('correction','draft')", c.id).n;
  const m = monthlySeries(c.id);
  const first = req.user.name.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ')[0];

  const body = html`
  <section class="hero card">
    <div class="hero-main">
      <div class="eyebrow">${c.program_type} Program · Training year ${c.training_year}</div>
      <h2>Welcome back, Dr. ${first}</h2>
      <p>Main supervisor <strong>${c.supervisor_name || '—'}</strong> · University ID ${c.university_id || '—'}</p>
      ${timelineCard(c, p)}
    </div>
    <div class="hero-ring">${charts.ring(p.overall, { size: 150, label: 'overall' })}${ui.riskBadge(p.risk)}</div>
  </section>
  ${needs ? html`<a class="callout warn link" href="/logbook?status=${one("SELECT COUNT(*) n FROM activities WHERE candidate_id=? AND status='correction'", c.id).n ? 'correction' : 'draft'}">${ui.icon('rotate')}<div><strong>${needs} activit${needs === 1 ? 'y needs' : 'ies need'} your attention</strong><p>Drafts to submit or corrections requested by your supervisor.</p></div>${ui.icon('arrowRight')}</a>` : ''}
  <div class="stats">
    ${ui.stat('Total submitted', num(t.all), { ic: 'send', tone: 'teal', href: '/logbook' })}
    ${ui.stat('Approved', num(t.approved), { ic: 'checkCircle', tone: 'green', href: '/logbook?status=approved' })}
    ${ui.stat('Pending approval', num(t.pending), { ic: 'clock', tone: 'amber', href: '/logbook?status=pending' })}
    ${ui.stat('Rejected / correction', html`${num(t.rejected)}<small> / ${num(t.correction)}</small>`, { ic: 'xCircle', tone: 'red', href: '/logbook?status=rejected' })}
  </div>
  <div class="grid g-2-1">
    ${ui.card('Requirements progress', progressTable(p, { compact: true }), { sub: 'Only approved activities count toward requirements', actions: html`<a class="btn sm ghost" href="/progress">Details ${ui.icon('arrowRight')}</a>` })}
    <div class="stack">
      ${ui.card('Recent supervisor comments', comments.length ? html`<ul class="comments">${comments.map((x) => html`<li><a href="/activities/${x.id}"><span class="avatar xs">${x.name.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span><div><div class="c-top"><strong>${x.name}</strong>${ui.badge(x.status)}</div><p>“${x.comment}”</p><span>${x.title} · ${timeAgo(x.created_at)}</span></div></a></li>`)}</ul>` : ui.empty('No comments yet', 'Supervisor feedback will appear here.'))}
    </div>
  </div>
  <div class="grid g-2-1">
    ${ui.card('Recently updated', activityTable(recent, { actions: 'own' }), { cls: 'flush', actions: html`<a class="btn sm ghost" href="/logbook">View logbook ${ui.icon('arrowRight')}</a>` })}
    ${ui.card('Monthly activity', charts.columnChart({ labels: m.labels, series: [{ name: 'Submitted', cls: 's2', values: m.submitted }, { name: 'Approved', cls: 's1', values: m.approved }], height: 300 }), { sub: 'Last 12 months' })}
  </div>`;
  res.html(ui.layout(req, { title: 'Dashboard', actions: html`<a class="btn primary" href="/activities/new">${ui.icon('plus')} Add activity</a>`, body }));
});

get('/logbook', { roles: ['candidate'] }, (req, res) => {
  const c = D.candidateByUser(req.user.id);
  const r = listActivities(req.query, { candidateId: c.id }, { page: req.query.page });
  const { pager } = ui;
  res.html(ui.layout(req, {
    title: 'My Logbook', subtitle: `${num(r.total)} entr${r.total === 1 ? 'y' : 'ies'} · filter by date, type, supervisor, status or training year`,
    actions: html`<a class="btn" href="/reports/candidate/me.xlsx">${ui.icon('table')} Export Excel</a><a class="btn primary" href="/activities/new">${ui.icon('plus')} Add activity</a>`,
    body: html`${filterBar(req, { base: '/logbook', show: ['supervisor', 'status', 'year', 'q'] })}
      ${ui.card('', html`${activityTable(r.rows, { actions: 'own', emptyMsg: 'Start by adding your first activity.' })}${pager(r.page, r.pages, req.query, '/logbook')}`, { cls: 'flush' })}`,
  }));
});

get('/progress', { roles: ['candidate'] }, (req, res) => {
  const c = D.candidateByUser(req.user.id);
  const p = D.candidateProgress(c);
  const byYear = all(`SELECT training_year y, COUNT(*) n, SUM(CASE WHEN status='approved' THEN count_value ELSE 0 END) ok FROM activities WHERE candidate_id=? AND status<>'draft' GROUP BY training_year ORDER BY y`, c.id);
  const roles = all(`SELECT candidate_role r, COUNT(*) n FROM activities WHERE candidate_id=? AND form='operation' AND status='approved' GROUP BY candidate_role ORDER BY n DESC`, c.id);
  const ops = all(`SELECT title, COUNT(*) n FROM activities WHERE candidate_id=? AND form='operation' AND status='approved' GROUP BY title ORDER BY n DESC LIMIT 8`, c.id);
  const maxOps = Math.max(1, ...ops.map((o) => o.n));
  const body = html`
  <div class="grid g-1-2">
    ${ui.card('Overall', html`<div class="ring-center">${charts.ring(p.overall, { size: 170, label: 'approved' })}${ui.riskBadge(p.risk)}</div>${timelineCard(c, p)}`)}
    ${ui.card('Requirements by category', progressTable(p), { cls: 'flush' })}
  </div>
  <div class="grid g-1-1-1">
    ${ui.card('Approved operations by role', roles.length ? charts.donut(roles.map((r, i) => ({ label: r.r || '—', value: r.n, cls: ['s1', 's2', 's3', 's4'][i % 4] })), { center: num(roles.reduce((a, r) => a + r.n, 0)), sub: 'operations' }) : ui.empty('No operations yet', 'Approved operations will be summarised here.'))}
    ${ui.card('Most frequent operations', ops.length ? html`<ul class="hbars">${ops.map((o) => html`<li><span>${o.title}</span><div><i style="width:${((o.n / maxOps) * 100).toFixed(1)}%"></i></div><b>${o.n}</b></li>`)}</ul>` : ui.empty('No operations yet', ''))}
    ${ui.card('By training year', byYear.length ? html`<table class="table"><thead><tr><th>Year</th><th class="num">Submitted</th><th class="num">Approved count</th></tr></thead><tbody>${byYear.map((y) => html`<tr><td>Year ${y.y}</td><td class="num">${num(y.n)}</td><td class="num strong">${num(y.ok)}</td></tr>`)}</tbody></table>` : ui.empty('No data', ''), { cls: 'flush' })}
  </div>`;
  res.html(ui.layout(req, { title: 'Progress', subtitle: 'Approved activities counted against your program requirements', actions: html`<a class="btn" href="/reports/candidate/me">${ui.icon('printer')} Logbook report</a>`, body }));
});

module.exports = { progressTable, monthlySeries, timelineCard };
