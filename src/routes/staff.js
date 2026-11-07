'use strict';
const { get } = require('../http');
const { all, one } = require('../db');
const { html, num, fmtDate, timeAgo } = require('../util');
const D = require('../domain');
const ui = require('../ui');
const charts = require('../charts');
const { listActivities, filterBar, activityTable } = require('./activities');
const { progressTable, monthlySeries, timelineCard } = require('./candidate');

const staffId = (req) => D.staffByUser(req.user.id)?.id ?? -1;

function approvalStats(sid) {
  const delay = Number(D.getSettings().approval_delay_days || 7);
  const w = sid == null ? '' : 'AND supervisor_id=?';
  const p = sid == null ? [] : [sid];
  return {
    pending: one(`SELECT COUNT(*) n FROM activities WHERE status='pending' ${w}`, ...p).n,
    overdue: one(`SELECT COUNT(*) n FROM activities WHERE status='pending' AND submitted_at <= datetime('now', ?) ${w}`, `-${delay} days`, ...p).n,
    month: one(`SELECT COUNT(*) n FROM activities WHERE status='approved' AND approved_at >= date('now','start of month') ${w.replace('supervisor_id', 'approved_by')}`, ...p).n,
    avgDays: one(`SELECT AVG(julianday(approved_at)-julianday(submitted_at)) d FROM activities WHERE approved_at IS NOT NULL AND approved_at >= datetime('now','-90 days') ${w.replace('supervisor_id', 'approved_by')}`, ...p).d,
    delay,
  };
}

function candidateRows(list, { showSup = false } = {}) {
  if (!list.length) return ui.empty('No candidates', 'Candidates assigned to you will appear here.');
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>Candidate</th><th>Program</th><th class="num">Year</th>${showSup ? html`<th>Main supervisor</th>` : ''}<th class="w-prog">Overall progress</th><th class="num">Pending</th><th class="num">Rejected</th><th>Status</th></tr></thead>
    <tbody>${list.map((c) => html`<tr class="row-link" data-href="/candidates/${c.id}">
      <td><a href="/candidates/${c.id}">${ui.avatarName(c.name, c.university_id)}</a></td><td>${ui.programBadge(c.program_type)}</td><td class="num">${c.training_year}</td>
      ${showSup ? html`<td>${c.supervisor_name || '—'}</td>` : ''}
      <td>${ui.bar(c.progress.overall, { expected: c.progress.expected })}</td>
      <td class="num">${c.progress.totals.pending || '—'}</td><td class="num">${c.progress.totals.rejected || '—'}</td>
      <td>${ui.riskBadge(c.progress.risk)}</td></tr>`)}</tbody></table></div>`;
}

get('/staff', { roles: ['staff'] }, (req, res) => {
  const sid = staffId(req);
  const s = approvalStats(sid);
  const queue = listActivities({ status: 'pending' }, { reviewerOnly: sid }, { per: 6, order: 'a.submitted_at ASC' }).rows;
  const mine = D.allCandidateProgress("c.status='active' AND (c.main_supervisor_id=? OR c.id IN (SELECT candidate_id FROM activities WHERE supervisor_id=?))", sid, sid);
  const body = html`
  <div class="stats">
    ${ui.stat('Waiting for my approval', num(s.pending), { ic: 'clock', tone: 'amber', href: '/staff/pending' })}
    ${ui.stat(`Overdue (> ${s.delay} days)`, num(s.overdue), { ic: 'alert', tone: s.overdue ? 'red' : 'green', href: '/staff/pending' })}
    ${ui.stat('Approved this month', num(s.month), { ic: 'checkCircle', tone: 'green', href: '/staff/approved' })}
    ${ui.stat('Average approval time', s.avgDays == null ? '—' : html`${s.avgDays.toFixed(1)}<small> days</small>`, { ic: 'trend', tone: 'teal', foot: 'Last 90 days' })}
  </div>
  <div class="grid g-2-1">
    ${ui.card('Approval queue', html`<form method="post" action="/activities/bulk-approve">${ui.csrf(req)}<input type="hidden" name="back" value="/staff">${activityTable(queue, { showCandidate: true, actions: 'review', emptyMsg: 'No activities are waiting for your approval. 🎉' })}</form>`, { cls: 'flush', sub: 'Oldest submissions first', actions: html`<a class="btn sm ghost" href="/staff/pending">Open queue ${ui.icon('arrowRight')}</a>` })}
    ${ui.card('My candidates', mine.length ? html`<ul class="cand-list">${mine.slice(0, 8).map((c) => html`<li><a href="/candidates/${c.id}">${ui.avatarName(c.name, `${c.program_type} · Year ${c.training_year}`)}<div class="cl-r">${ui.bar(c.progress.overall, { expected: c.progress.expected })}${ui.riskBadge(c.progress.risk)}</div></a></li>`)}</ul>` : ui.empty('No candidates', ''), { actions: html`<a class="btn sm ghost" href="/staff/candidates">All ${ui.icon('arrowRight')}</a>` })}
  </div>`;
  res.html(ui.layout(req, { title: 'Supervisor Dashboard', subtitle: 'Review submissions and follow the candidates you supervise', body }));
});

get('/staff/pending', { roles: ['staff', 'manager'] }, (req, res) => {
  const isMgr = req.user.role === 'manager';
  const scope = isMgr && req.query.scope !== 'mine' ? { managerView: true } : { reviewerOnly: staffId(req) };
  const r = listActivities({ ...req.query, status: 'pending' }, scope, { page: req.query.page, per: 50, order: 'a.submitted_at ASC' });
  const s = approvalStats(isMgr && req.query.scope !== 'mine' ? null : staffId(req));
  res.html(ui.layout(req, {
    title: 'Pending Approvals', subtitle: `${num(r.total)} activit${r.total === 1 ? 'y' : 'ies'} awaiting review${s.overdue ? ` · ${s.overdue} overdue (> ${s.delay} days)` : ''}`,
    actions: isMgr ? html`<div class="seg"><a class="${req.query.scope !== 'mine' ? 'on' : ''}" href="/staff/pending">All supervisors</a><a class="${req.query.scope === 'mine' ? 'on' : ''}" href="/staff/pending?scope=mine">Assigned to me</a></div>` : '',
    body: html`${filterBar(req, { base: '/staff/pending', show: isMgr ? ['supervisor', 'program', 'q'] : ['program', 'q'], extra: isMgr && req.query.scope ? html`<input type="hidden" name="scope" value="${req.query.scope}">` : '' })}
    <form method="post" action="/activities/bulk-approve" class="card flush">${ui.csrf(req)}<input type="hidden" name="back" value="${req.url}">
      ${r.rows.length ? html`<div class="bulkbar"><span data-selected-count>0 selected</span><input type="text" name="comment" placeholder="Optional comment for bulk approval" maxlength="300"><button class="btn success sm" data-confirm="Approve all selected activities?">${ui.icon('check')} Approve selected</button></div>` : ''}
      ${activityTable(r.rows, { showCandidate: true, select: true, actions: 'review', emptyMsg: 'Nothing is waiting for review. Great job keeping up!' })}
      ${ui.pager(r.page, r.pages, req.query, '/staff/pending')}
    </form>`,
  }));
});

get('/staff/approved', { roles: ['staff'] }, (req, res) => {
  const sid = staffId(req);
  const q = { ...req.query };
  const r = listActivities(q, { staffId: sid }, { page: req.query.page, order: 'COALESCE(a.approved_at, a.submitted_at) DESC' });
  res.html(ui.layout(req, {
    title: 'Reviewed Activities', subtitle: 'Activities you supervise or that belong to your candidates',
    body: html`${filterBar(req, { base: '/staff/approved', show: ['status', 'program', 'q', 'nodraft'] })}${ui.card('', html`${activityTable(r.rows, { showCandidate: true })}${ui.pager(r.page, r.pages, req.query, '/staff/approved')}`, { cls: 'flush' })}`,
  }));
});

get('/staff/candidates', { roles: ['staff'] }, (req, res) => {
  const sid = staffId(req);
  const list = D.allCandidateProgress("c.status='active' AND (c.main_supervisor_id=? OR c.id IN (SELECT candidate_id FROM activities WHERE supervisor_id=?))", sid, sid);
  res.html(ui.layout(req, { title: 'My Candidates', subtitle: 'Candidates you are main supervisor for, or whose activities you supervise', body: ui.card('', candidateRows(list, { showSup: true }), { cls: 'flush' }) }));
});

// Candidate profile — staff (if related) and managers.
get('/candidates/:id', { roles: ['staff', 'manager'] }, (req, res) => {
  const c = D.getCandidate(req.params.id);
  if (!c) return res.redirect('/');
  if (req.user.role === 'staff') {
    const sid = staffId(req);
    const related = c.main_supervisor_id === sid || one('SELECT 1 x FROM activities WHERE candidate_id=? AND supervisor_id=? LIMIT 1', c.id, sid);
    if (!related) return res.html(ui.layout(req, { title: 'Access denied', body: ui.empty('Not your candidate', 'You can only view candidates you supervise.') }), 403);
  }
  const p = D.candidateProgress(c);
  const m = monthlySeries(c.id);
  const r = listActivities(req.query, { candidateId: c.id, noDraft: true }, { page: req.query.page, per: 15 });
  const kv = (k, v) => html`<div class="kv"><span>${k}</span><strong>${v || '—'}</strong></div>`;
  const body = html`
  <section class="hero card">
    <div class="hero-main">
      <div class="who lg"><span class="avatar lg">${c.name.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span><div><h2>${c.name}</h2><span>${c.email} · ${c.phone || ''}</span></div></div>
      <div class="kv-grid tight">${kv('Program', html`${ui.programBadge(c.program_type)} Year ${c.training_year}`)}${kv('University ID', c.university_id)}${kv('Main supervisor', c.supervisor_name)}${kv('Status', c.status)}</div>
      ${timelineCard(c, p)}
    </div>
    <div class="hero-ring">${charts.ring(p.overall, { size: 150, label: 'overall' })}${ui.riskBadge(p.risk)}</div>
  </section>
  <div class="grid g-2-1">
    ${ui.card('Requirements progress', progressTable(p), { cls: 'flush' })}
    ${ui.card('Monthly activity', charts.columnChart({ labels: m.labels, series: [{ name: 'Submitted', cls: 's2', values: m.submitted }, { name: 'Approved', cls: 's1', values: m.approved }], height: 260 }))}
  </div>
  ${filterBar(req, { base: `/candidates/${c.id}`, show: ['status', 'year', 'supervisor', 'nodraft'] })}
  ${ui.card('Logbook entries', html`${activityTable(r.rows, { actions: 'review' })}${ui.pager(r.page, r.pages, req.query, `/candidates/${c.id}`)}`, { cls: 'flush' })}`;
  res.html(ui.layout(req, {
    title: c.name, crumbs: [[req.user.role === 'manager' ? '/admin/candidates' : '/staff/candidates', 'Candidates'], [null, c.name]],
    actions: html`<a class="btn" href="/reports/candidate/${c.id}.xlsx">${ui.icon('table')} Excel</a><a class="btn" href="/reports/candidate/${c.id}">${ui.icon('printer')} Report</a>${req.user.role === 'manager' ? html`<a class="btn primary" href="/admin/candidates/${c.id}/edit">${ui.icon('edit')} Edit</a>` : ''}`,
    body,
  }));
});

module.exports = { approvalStats, candidateRows };
