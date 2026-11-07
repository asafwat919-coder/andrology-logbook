'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { get } = require('../http');
const { one, all, UPLOAD_DIR } = require('../db');
const { html, num, fmtDate, fmtDateTime, nowTs, today, MONTHS, toISODate } = require('../util');
const D = require('../domain');
const ui = require('../ui');
const { workbook, XLSX_MIME } = require('../xlsx');
const { ACT_SQL } = require('./activities');
const { supervisorPerformance } = require('./admin');

function resolveCandidate(req) {
  const id = req.params.id;
  if (id === 'me') return req.user.role === 'candidate' ? D.candidateByUser(req.user.id) : null;
  const c = D.getCandidate(id);
  if (!c) return null;
  if (req.user.role === 'manager') return c;
  if (req.user.role === 'candidate') return c.user_id === req.user.id ? c : null;
  const st = D.staffByUser(req.user.id);
  const ok = st && (c.main_supervisor_id === st.id || one('SELECT 1 x FROM activities WHERE candidate_id=? AND supervisor_id=? LIMIT 1', c.id, st.id));
  return ok ? c : null;
}

function reportDoc(req, { title, back, xlsx, body, orientation = 'portrait' }) {
  const s = D.getSettings();
  return ui.bare(title, html`
  <div class="report-toolbar no-print">
    <a class="btn ghost" href="${back}">${ui.icon('arrowLeft')} Back</a>
    <div class="spacer"></div>
    ${xlsx ? html`<a class="btn" href="${xlsx}">${ui.icon('table')} Excel</a>` : ''}
    <button class="btn primary" data-print>${ui.icon('printer')} Print / Save as PDF</button>
  </div>
  <article class="report ${orientation}">
    <header class="r-head">
      <div class="r-brand">${ui.LOGO}<div><strong>${s.institution_name}</strong><span>${s.department_name}</span></div></div>
      <div class="r-meta"><span>Generated ${fmtDateTime(nowTs())} UTC</span><span>by ${req.user.name}</span></div>
    </header>
    <h1 class="r-title">${title}</h1>
    ${body}
    <footer class="r-foot">Electronic Andrology Logbook · Confidential training record · No patient-identifying information is included.</footer>
  </article>`, 'report-body');
}

// Signature images
get('/signature/:sid', (req, res) => {
  const s = one('SELECT signature_path FROM staff WHERE id=?', req.params.sid);
  const file = s?.signature_path && path.join(UPLOAD_DIR, path.basename(s.signature_path));
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.send(fs.readFileSync(file), { type: file.endsWith('.png') ? 'image/png' : 'image/jpeg', filename: 'signature', inline: true });
});

// ---------- Candidate report ----------
function candidateData(c) {
  const p = D.candidateProgress(c);
  const acts = all(`${ACT_SQL} WHERE a.candidate_id=? AND a.status<>'draft' ORDER BY at.sort_order, a.activity_date`, c.id);
  const comments = all(`SELECT r.comment, r.action, r.created_at, u.name, a.title FROM activity_reviews r JOIN activities a ON a.id=r.activity_id JOIN users u ON u.id=r.user_id
    WHERE a.candidate_id=? AND r.comment IS NOT NULL AND r.comment<>'' ORDER BY r.created_at DESC LIMIT 30`, c.id);
  return { p, acts, comments };
}

get('/reports/candidate/:id.xlsx', (req, res) => {
  const c = resolveCandidate(req);
  if (!c) return res.redirect('/');
  const { p, acts } = candidateData(c);
  const buf = workbook([
    { name: 'Summary', title: `Logbook report — ${c.name}`, subtitle: `${c.program_type} · Year ${c.training_year} · ${fmtDate(c.training_start_date)} → ${fmtDate(c.expected_completion_date)} · Overall ${Math.round(p.overall)}% (${p.risk.label})`,
      columns: [{ header: 'Category', width: 48 }, { header: 'Required', width: 11 }, { header: 'Approved', width: 11 }, { header: 'Pending', width: 11 }, { header: 'Rejected', width: 11 }, { header: 'Remaining', width: 11 }, { header: 'Progress %', width: 12 }],
      rows: p.categories.map((k) => [k.name, k.required, k.approved, k.pending, k.rejected, k.remaining, k.pct == null ? '' : Math.round(k.pct)]).concat([['TOTAL', p.required, p.completed, '', '', p.required - p.completed, Math.round(p.overall)]]) },
    { name: 'Activities', columns: [{ header: 'Date', width: 12 }, { header: 'Category', width: 36 }, { header: 'Activity', width: 36 }, { header: 'Role', width: 26 }, { header: 'Supervisor', width: 26 }, { header: 'Count', width: 8 }, { header: 'Location', width: 26 }, { header: 'Status', width: 18 }, { header: 'Reviewed by', width: 24 }, { header: 'Reviewed on', width: 18 }, { header: 'Comment', width: 40 }],
      rows: acts.map((a) => [a.activity_date, a.type_name, a.title, a.candidate_role, a.supervisor_name, a.count_value, a.location, D.STATUS[a.status]?.label, a.reviewer_name, a.approved_at, a.staff_comment]) },
  ]);
  D.audit(req, 'export.candidate_report', 'candidates', c.id, null, { format: 'xlsx' });
  res.send(buf, { type: XLSX_MIME, filename: `logbook-${c.name.replace(/^Dr\.\s*/, '').replace(/\s+/g, '-')}-${today()}.xlsx` });
});

get('/reports/candidate/:id', (req, res) => {
  const c = resolveCandidate(req);
  if (!c) return res.redirect('/');
  const { p, acts, comments } = candidateData(c);
  const approved = acts.filter((a) => a.status === 'approved');
  const other = acts.filter((a) => a.status !== 'approved');
  const groups = p.categories.map((k) => ({ k, rows: approved.filter((a) => a.activity_type_id === k.id) })).filter((g) => g.rows.length);
  const sup = c.main_supervisor_id ? one('SELECT signature_path FROM staff WHERE id=?', c.main_supervisor_id) : null;
  const kv = (k, v) => html`<div><span>${k}</span><strong>${v || '—'}</strong></div>`;
  const body = html`
  <section class="r-section r-grid">
    ${kv('Candidate', c.name)}${kv('University ID', c.university_id)}${kv('Email', c.email)}${kv('Phone', c.phone)}
    ${kv('Program', `${c.program_type} — training year ${c.training_year}`)}${kv('Training period', `${fmtDate(c.training_start_date)} – ${fmtDate(c.expected_completion_date)}`)}
    ${kv('Main supervisor', c.supervisor_name)}${kv('Status', c.status)}
  </section>
  <section class="r-section">
    <h2>Progress summary <span class="r-pill">${Math.round(p.overall)}% complete · ${p.risk.label}</span></h2>
    <table class="r-table"><thead><tr><th>Category</th><th>Required</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Remaining</th><th>Progress</th></tr></thead>
    <tbody>${p.categories.map((k) => html`<tr><td>${k.name}</td><td>${k.required || '—'}</td><td><b>${k.approved}</b></td><td>${k.pending}</td><td>${k.rejected}</td><td>${k.required ? k.remaining : '—'}</td><td>${k.pct == null ? '—' : html`<div class="r-bar"><i style="width:${k.pct.toFixed(0)}%"></i></div> ${Math.round(k.pct)}%`}</td></tr>`)}</tbody>
    <tfoot><tr><td>Total</td><td>${p.required}</td><td>${p.completed}</td><td>${p.totals.pending}</td><td>${p.totals.rejected}</td><td>${p.required - p.completed}</td><td>${Math.round(p.overall)}%${p.expected != null ? ` (expected ${Math.round(p.expected)}%)` : ''}</td></tr></tfoot></table>
  </section>
  <section class="r-section">
    <h2>Approved activities <span class="r-pill">${approved.length}</span></h2>
    ${groups.length ? groups.map((g) => html`<h3>${g.k.name} <em>${g.rows.length} entries</em></h3>
      <table class="r-table compact"><thead><tr><th>Date</th><th>Activity</th><th>Role</th><th>Supervisor</th><th>Count</th><th>Approved</th></tr></thead>
      <tbody>${g.rows.map((a) => html`<tr><td>${fmtDate(a.activity_date)}</td><td>${a.title}</td><td>${a.candidate_role || '—'}</td><td>${a.supervisor_name || '—'}</td><td>${a.count_value}</td><td>${fmtDate(a.approved_at)}</td></tr>`)}</tbody></table>`) : html`<p class="muted">No approved activities yet.</p>`}
  </section>
  <section class="r-section">
    <h2>Pending, rejected and correction-required <span class="r-pill">${other.length}</span></h2>
    ${other.length ? html`<table class="r-table compact"><thead><tr><th>Date</th><th>Category</th><th>Activity</th><th>Supervisor</th><th>Status</th><th>Comment</th></tr></thead>
    <tbody>${other.map((a) => html`<tr><td>${fmtDate(a.activity_date)}</td><td>${a.type_name}</td><td>${a.title}</td><td>${a.supervisor_name || '—'}</td><td>${D.STATUS[a.status]?.label}</td><td>${a.staff_comment || ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}
  </section>
  <section class="r-section">
    <h2>Supervisor comments</h2>
    ${comments.length ? html`<ul class="r-comments">${comments.map((x) => html`<li><b>${x.name}</b> · ${fmtDate(x.created_at)} · <em>${x.title}</em><br>“${x.comment}”</li>`)}</ul>` : html`<p class="muted">No comments recorded.</p>`}
  </section>
  <section class="r-section r-sign">
    <div><div class="sig-space"></div><span>Candidate</span><strong>${c.name}</strong></div>
    <div><div class="sig-space">${sup?.signature_path ? html`<img src="/signature/${c.main_supervisor_id}" alt="Signature">` : ''}</div><span>Main supervisor</span><strong>${c.supervisor_name || ''}</strong></div>
    <div><div class="sig-space"></div><span>Head of department</span><strong>&nbsp;</strong></div>
    <div><div class="sig-space"></div><span>Date</span><strong>&nbsp;</strong></div>
  </section>`;
  D.audit(req, 'export.candidate_report', 'candidates', c.id, null, { format: 'print' });
  const back = req.user.role === 'candidate' ? '/progress' : `/candidates/${c.id}`;
  res.html(reportDoc(req, { title: 'Candidate Logbook Report', back, xlsx: `/reports/candidate/${req.params.id}.xlsx`, body }));
});

// ---------- Manager report ----------
function managerData() {
  const list = D.allCandidateProgress();
  const types = D.activeTypes();
  const sup = supervisorPerformance();
  const keys = [], labels = [];
  const d = new Date(); d.setDate(1);
  for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); keys.push(toISODate(m).slice(0, 7)); labels.push(`${MONTHS[m.getMonth()]} ${m.getFullYear()}`); }
  const mrows = all(`SELECT substr(activity_date,1,7) ym, at.code, COUNT(*) n FROM activities a JOIN activity_types at ON at.id=a.activity_type_id WHERE a.status<>'draft' AND activity_date>=? GROUP BY ym, at.code`, keys[0] + '-01');
  const monthly = keys.map((k, i) => { const row = { label: labels[i], total: 0 }; for (const t of types) { const n = mrows.find((r) => r.ym === k && r.code === t.code)?.n || 0; row[t.code] = n; row.total += n; } return row; });
  const pendingTotal = one("SELECT COUNT(*) n FROM activities WHERE status='pending'").n;
  return { list, types, sup, monthly, pendingTotal };
}
const shortType = (n) => n.replace('Operations – ', 'Ops ').replace('observed / assisted', 'assist.').replace('surgeon under supervision / first surgeon', 'surgeon').replace('Lectures & teaching', 'Lectures').replace('Clinic attendance', 'Clinics').replace('Research meetings', 'Research').replace('Case presentations', 'Cases').replace('Other activities', 'Other');

get('/admin/reports', { roles: ['manager'] }, (req, res) => {
  const cands = D.allCandidateProgress("c.status IN ('active','graduated')");
  const tile = (href, ic, t, d, xlsx) => html`<div class="card report-tile"><span class="stat-ic t-teal">${ui.icon(ic)}</span><h3>${t}</h3><p>${d}</p><div class="rt-actions"><a class="btn primary sm" href="${href}">${ui.icon('printer')} View / PDF</a>${xlsx ? html`<a class="btn sm" href="${xlsx}">${ui.icon('table')} Excel</a>` : ''}</div></div>`;
  res.html(ui.layout(req, {
    title: 'Reports', subtitle: 'Accreditation, exam and internal-evaluation reports — printable, PDF or Excel',
    body: html`<div class="grid g-1-1-1">
      ${tile('/reports/manager', 'chart', 'Department (manager) report', 'All candidates, progress by category, pending approvals, staff performance, monthly volume and candidates at risk.', '/reports/manager.xlsx')}
      ${tile('/reports/supervisors', 'shield', 'Supervisor report', 'Activities approved by each supervisor, pending items, candidates supervised and average approval time.', '/reports/supervisors.xlsx')}
      ${tile('/admin/audit', 'history', 'Audit log export', 'Full audit trail of logins, edits, approvals and settings changes for accreditation.', '/admin/audit.xlsx')}
    </div>
    ${ui.card('Candidate reports', html`<div class="table-wrap"><table class="table"><thead><tr><th>Candidate</th><th>Program</th><th class="w-prog">Progress</th><th></th></tr></thead><tbody>
      ${cands.map((c) => html`<tr><td>${ui.avatarName(c.name, c.university_id)}</td><td>${ui.programBadge(c.program_type)} Year ${c.training_year}</td><td>${ui.bar(c.progress.overall, { expected: c.progress.expected })}</td>
      <td class="row-actions"><a class="btn sm" href="/reports/candidate/${c.id}">${ui.icon('printer')} Report</a><a class="btn sm ghost" href="/reports/candidate/${c.id}.xlsx">${ui.icon('table')} Excel</a></td></tr>`)}</tbody></table></div>`, { cls: 'flush', sub: 'Personal data, approved activities, pending/rejected items, comments, progress summary and signature section' })}`,
  }));
});

get('/reports/manager.xlsx', { roles: ['manager'] }, (req, res) => {
  const { list, types, sup, monthly } = managerData();
  const buf = workbook([
    { name: 'Candidates', title: 'Department training report', subtitle: `${D.getSettings().department_name} · ${fmtDate(today())}`,
      columns: [{ header: 'Candidate', width: 24 }, { header: 'University ID', width: 14 }, { header: 'Program', width: 9 }, { header: 'Year', width: 6 }, { header: 'Main supervisor', width: 24 }, { header: 'Overall %', width: 10 }, { header: 'Expected %', width: 10 }, { header: 'Pending', width: 9 }, { header: 'Rejected', width: 9 }, { header: 'Risk', width: 16 },
        ...types.map((t) => ({ header: `${shortType(t.name)} (appr./req.)`, width: 16 }))],
      rows: list.map((c) => [c.name, c.university_id, c.program_type, c.training_year, c.supervisor_name, Math.round(c.progress.overall), c.progress.expected == null ? '' : Math.round(c.progress.expected), c.progress.totals.pending, c.progress.totals.rejected, c.progress.risk.label,
        ...types.map((t) => { const k = c.progress.categories.find((x) => x.id === t.id); return k ? `${k.approved} / ${k.required}` : ''; })]) },
    { name: 'Supervisors', columns: [{ header: 'Supervisor', width: 26 }, { header: 'Title', width: 20 }, { header: 'Pending', width: 10 }, { header: 'Overdue', width: 10 }, { header: 'Approved (all)', width: 14 }, { header: 'Reviewed 30d', width: 13 }, { header: 'Avg approval days', width: 17 }, { header: 'Candidates', width: 11 }],
      rows: sup.map((s) => [s.name, s.academic_title, s.pending, s.overdue, s.approved_all, s.reviewed_30, s.avg_days == null ? '' : Math.round(s.avg_days * 10) / 10, s.candidates]) },
    { name: 'Monthly volume', columns: [{ header: 'Month', width: 12 }, ...types.map((t) => ({ header: shortType(t.name), width: 12 })), { header: 'Total', width: 10 }],
      rows: monthly.map((m) => [m.label, ...types.map((t) => m[t.code]), m.total]) },
  ]);
  D.audit(req, 'export.manager_report', null, null, null, { format: 'xlsx' });
  res.send(buf, { type: XLSX_MIME, filename: `department-report-${today()}.xlsx` });
});

get('/reports/manager', { roles: ['manager'] }, (req, res) => {
  const { list, types, sup, monthly, pendingTotal } = managerData();
  const atRisk = list.filter((c) => ['risk', 'follow'].includes(c.progress.risk.key));
  const avg = list.length ? list.reduce((a, c) => a + c.progress.overall, 0) / list.length : 0;
  const body = html`
  <section class="r-kpis"><div><b>${list.length}</b><span>Active candidates</span></div><div><b>${Math.round(avg)}%</b><span>Average progress</span></div><div><b>${pendingTotal}</b><span>Pending approvals</span></div><div><b>${atRisk.length}</b><span>Need follow-up / at risk</span></div></section>
  <section class="r-section"><h2>Candidate progress by category <span class="r-pill">approved / required</span></h2>
    <table class="r-table compact"><thead><tr><th>Candidate</th><th>Prog.</th><th>Yr</th>${types.map((t) => html`<th>${shortType(t.name)}</th>`)}<th>Overall</th><th>Pend.</th><th>Status</th></tr></thead>
    <tbody>${list.map((c) => html`<tr><td>${c.name}</td><td>${c.program_type}</td><td>${c.training_year}</td>${types.map((t) => { const k = c.progress.categories.find((x) => x.id === t.id); return html`<td>${k && k.required ? `${k.approved}/${k.required}` : k?.approved || '—'}</td>`; })}<td><b>${Math.round(c.progress.overall)}%</b></td><td>${c.progress.totals.pending}</td><td>${c.progress.risk.label}</td></tr>`)}</tbody></table></section>
  <section class="r-section"><h2>Candidates at risk</h2>
    ${atRisk.length ? html`<table class="r-table compact"><thead><tr><th>Candidate</th><th>Program</th><th>Progress</th><th>Expected</th><th>Gap</th><th>Main supervisor</th><th>Status</th></tr></thead><tbody>${atRisk.map((c) => html`<tr><td>${c.name}</td><td>${c.program_type} Y${c.training_year}</td><td>${Math.round(c.progress.overall)}%</td><td>${Math.round(c.progress.expected)}%</td><td><b>${Math.round(c.progress.expected - c.progress.overall)} pts</b></td><td>${c.supervisor_name || '—'}</td><td>${c.progress.risk.label}</td></tr>`)}</tbody></table>` : html`<p class="muted">All candidates are on track.</p>`}</section>
  <section class="r-section"><h2>Staff approval performance</h2>
    <table class="r-table compact"><thead><tr><th>Supervisor</th><th>Pending</th><th>Overdue</th><th>Approved (all time)</th><th>Reviewed (30 days)</th><th>Avg approval time</th><th>Candidates</th></tr></thead>
    <tbody>${sup.map((s) => html`<tr><td>${s.name}</td><td>${s.pending}</td><td>${s.overdue}</td><td>${s.approved_all}</td><td>${s.reviewed_30}</td><td>${s.avg_days == null ? '—' : s.avg_days.toFixed(1) + ' days'}</td><td>${s.candidates}</td></tr>`)}</tbody></table></section>
  <section class="r-section"><h2>Monthly activity volume <span class="r-pill">submitted entries</span></h2>
    <table class="r-table compact"><thead><tr><th>Month</th>${types.map((t) => html`<th>${shortType(t.name)}</th>`)}<th>Total</th></tr></thead>
    <tbody>${monthly.map((m) => html`<tr><td>${m.label}</td>${types.map((t) => html`<td>${m[t.code] || '—'}</td>`)}<td><b>${m.total}</b></td></tr>`)}</tbody></table></section>`;
  D.audit(req, 'export.manager_report', null, null, null, { format: 'print' });
  res.html(reportDoc(req, { title: 'Department Training Report', back: '/admin/reports', xlsx: '/reports/manager.xlsx', body, orientation: 'landscape' }));
});

// ---------- Supervisor report ----------
function supData(req) {
  let sup = supervisorPerformance();
  if (req.user.role === 'staff') { const st = D.staffByUser(req.user.id); sup = sup.filter((s) => s.id === st?.id); }
  return sup.map((s) => ({
    ...s,
    rejected: one("SELECT COUNT(*) n FROM activities WHERE approved_by=? AND status='rejected'", s.id).n,
    corrections: one("SELECT COUNT(*) n FROM activities WHERE approved_by=? AND status='correction'", s.id).n,
    cands: all(`SELECT DISTINCT u.name, c.program_type FROM activities a JOIN candidates c ON c.id=a.candidate_id JOIN users u ON u.id=c.user_id WHERE a.supervisor_id=? OR c.main_supervisor_id=? ORDER BY u.name`, s.id, s.id),
    pendingItems: all(`${ACT_SQL} WHERE a.supervisor_id=? AND a.status='pending' ORDER BY a.submitted_at`, s.id),
  }));
}
get('/reports/supervisors.xlsx', { roles: ['staff', 'manager'] }, (req, res) => {
  const data = supData(req);
  const buf = workbook([
    { name: 'Supervisors', title: 'Supervisor report', subtitle: fmtDate(today()), columns: [{ header: 'Supervisor', width: 26 }, { header: 'Approved', width: 10 }, { header: 'Rejected', width: 10 }, { header: 'Corrections', width: 12 }, { header: 'Pending', width: 10 }, { header: 'Overdue', width: 10 }, { header: 'Avg approval days', width: 17 }, { header: 'Candidates supervised', width: 60 }],
      rows: data.map((s) => [s.name, s.approved_all, s.rejected, s.corrections, s.pending, s.overdue, s.avg_days == null ? '' : Math.round(s.avg_days * 10) / 10, s.cands.map((c) => c.name).join(', ')]) },
    { name: 'Pending items', columns: [{ header: 'Supervisor', width: 26 }, { header: 'Candidate', width: 24 }, { header: 'Activity', width: 34 }, { header: 'Date', width: 12 }, { header: 'Submitted', width: 18 }],
      rows: data.flatMap((s) => s.pendingItems.map((a) => [s.name, a.candidate_name, a.title, a.activity_date, a.submitted_at])) },
  ]);
  D.audit(req, 'export.supervisor_report', null, null, null, { format: 'xlsx' });
  res.send(buf, { type: XLSX_MIME, filename: `supervisor-report-${today()}.xlsx` });
});
get('/reports/supervisors', { roles: ['staff', 'manager'] }, (req, res) => {
  const data = supData(req);
  const delay = Number(D.getSettings().approval_delay_days || 7);
  const body = html`
  <section class="r-section"><h2>Summary</h2>
    <table class="r-table"><thead><tr><th>Supervisor</th><th>Approved</th><th>Rejected</th><th>Corrections</th><th>Pending</th><th>Overdue (&gt; ${delay}d)</th><th>Avg approval time</th><th>Candidates</th></tr></thead>
    <tbody>${data.map((s) => html`<tr><td><b>${s.name}</b><br><small>${s.academic_title || ''}</small></td><td>${s.approved_all}</td><td>${s.rejected}</td><td>${s.corrections}</td><td>${s.pending}</td><td>${s.overdue}</td><td>${s.avg_days == null ? '—' : s.avg_days.toFixed(1) + ' days'}</td><td>${s.cands.length}</td></tr>`)}</tbody></table></section>
  ${data.map((s) => html`<section class="r-section"><h2>${s.name} <span class="r-pill">${s.pending} pending</span></h2>
    <p class="r-note"><b>Candidates supervised:</b> ${s.cands.map((c) => `${c.name} (${c.program_type})`).join(', ') || '—'}</p>
    ${s.pendingItems.length ? html`<table class="r-table compact"><thead><tr><th>Candidate</th><th>Activity</th><th>Activity date</th><th>Submitted</th><th>Waiting</th></tr></thead><tbody>${s.pendingItems.map((a) => html`<tr><td>${a.candidate_name}</td><td>${a.title}</td><td>${fmtDate(a.activity_date)}</td><td>${fmtDate(a.submitted_at)}</td><td>${Math.floor((Date.now() - new Date(a.submitted_at.replace(' ', 'T') + 'Z')) / 86400000)} days</td></tr>`)}</tbody></table>` : html`<p class="muted">No pending items.</p>`}
  </section>`)}`;
  D.audit(req, 'export.supervisor_report', null, null, null, { format: 'print' });
  res.html(reportDoc(req, { title: 'Supervisor Report', back: req.user.role === 'manager' ? '/admin/reports' : '/staff', xlsx: '/reports/supervisors.xlsx', body }));
});
