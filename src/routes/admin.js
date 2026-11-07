'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { get, post } = require('../http');
const { db, one, all, run, tx, DATA_DIR } = require('../db');
const { html, num, fmtDate, fmtDateTime, timeAgo, nowTs, today, qs } = require('../util');
const { hashPassword, tempPassword } = require('../crypto');
const D = require('../domain');
const ui = require('../ui');
const charts = require('../charts');
const { workbook, XLSX_MIME } = require('../xlsx');
const { listActivities, filterBar, activityTable } = require('./activities');
const { monthlySeries } = require('./candidate');
const { approvalStats, candidateRows } = require('./staff');

const M = { roles: ['manager'] };

function supervisorPerformance() {
  const delay = Number(D.getSettings().approval_delay_days || 7);
  return all(`SELECT s.id, u.name, s.academic_title,
      (SELECT COUNT(*) FROM activities a WHERE a.supervisor_id=s.id AND a.status='pending') pending,
      (SELECT COUNT(*) FROM activities a WHERE a.supervisor_id=s.id AND a.status='pending' AND a.submitted_at <= datetime('now', ?)) overdue,
      (SELECT COUNT(*) FROM activities a WHERE a.approved_by=s.id AND a.status='approved') approved_all,
      (SELECT COUNT(*) FROM activities a WHERE a.approved_by=s.id AND a.approved_at >= datetime('now','-30 days')) reviewed_30,
      (SELECT AVG(julianday(a.approved_at)-julianday(a.submitted_at)) FROM activities a WHERE a.approved_by=s.id AND a.approved_at IS NOT NULL) avg_days,
      (SELECT COUNT(DISTINCT a.candidate_id) FROM activities a WHERE a.supervisor_id=s.id) candidates
    FROM staff s JOIN users u ON u.id=s.user_id WHERE s.can_approve=1 ORDER BY pending DESC, u.name`, `-${delay} days`);
}

// ---------- Dashboard ----------
get('/admin', M, (req, res) => {
  const list = D.allCandidateProgress();
  const s = approvalStats(null);
  const avg = list.length ? list.reduce((a, c) => a + c.progress.overall, 0) / list.length : 0;
  const attention = list.filter((c) => ['risk', 'follow'].includes(c.progress.risk.key));
  const m = monthlySeries(null);
  const st = all(`SELECT status, COUNT(*) n FROM activities WHERE status<>'draft' AND activity_date >= date('now','-12 months') GROUP BY status`);
  const stMap = Object.fromEntries(st.map((r) => [r.status, r.n]));
  const sup = supervisorPerformance();
  const maxPend = Math.max(1, ...sup.map((x) => x.pending));
  // Master vs MD comparison by category (average % of requirement approved)
  const types = D.activeTypes();
  const cmp = types.map((t) => {
    const avgFor = (prog) => {
      const xs = list.filter((c) => c.program_type === prog).map((c) => c.progress.categories.find((k) => k.id === t.id)).filter((k) => k && k.required > 0);
      return xs.length ? xs.reduce((a, k) => a + k.pct, 0) / xs.length : null;
    };
    return { label: t.name.replace('Operations – ', 'Ops – ').replace(' / first surgeon', ''), a: avgFor('Master'), b: avgFor('MD') };
  }).filter((r) => r.a != null || r.b != null);
  const cnt = (p) => list.filter((c) => c.program_type === p).length;

  const body = html`
  <div class="stats five">
    ${ui.stat('Active candidates', num(list.length), { ic: 'users', tone: 'teal', foot: `${cnt('Master')} Master · ${cnt('MD')} MD`, href: '/admin/candidates' })}
    ${ui.stat('Average progress', `${Math.round(avg)}%`, { ic: 'target', tone: 'blue', foot: 'Of program requirements approved' })}
    ${ui.stat('Pending approvals', num(s.pending), { ic: 'clock', tone: 'amber', foot: html`<span class="${s.overdue ? 'neg' : ''}">${s.overdue} overdue > ${s.delay} days</span>`, href: '/staff/pending' })}
    ${ui.stat('Need follow-up', num(attention.length), { ic: 'alert', tone: attention.length ? 'red' : 'green', foot: `${list.filter((c) => c.progress.risk.key === 'risk').length} at risk`, href: '/admin/candidates?risk=attention' })}
    ${ui.stat('Avg approval time', s.avgDays == null ? '—' : html`${s.avgDays.toFixed(1)}<small> days</small>`, { ic: 'trend', tone: 'violet', foot: 'Last 90 days', href: '/reports/supervisors' })}
  </div>
  <div class="grid g-2-1">
    ${ui.card('Activity volume by month', charts.columnChart({ labels: m.labels, series: [{ name: 'Submitted', cls: 's2', values: m.submitted }, { name: 'Approved', cls: 's1', values: m.approved }], height: 250 }), { sub: 'All candidates · last 12 months' })}
    ${ui.card('Status distribution', charts.donut([
      { label: 'Approved', value: stMap.approved || 0, cls: 'c-approved' }, { label: 'Pending', value: stMap.pending || 0, cls: 'c-pending' },
      { label: 'Correction', value: stMap.correction || 0, cls: 'c-correction' }, { label: 'Rejected', value: stMap.rejected || 0, cls: 'c-rejected' },
    ], { center: num(st.reduce((a, r) => a + r.n, 0)), sub: 'entries' }), { sub: 'Last 12 months' })}
  </div>
  ${ui.card('Candidate progress', candidateRows(list, { showSup: true }), { cls: 'flush', sub: 'The marker on each bar shows expected progress for the time elapsed', actions: html`<a class="btn sm" href="/reports/manager.xlsx">${ui.icon('table')} Export</a><a class="btn sm ghost" href="/admin/candidates">Manage ${ui.icon('arrowRight')}</a>` })}
  <div class="grid g-1-1">
    ${ui.card('Master vs MD — average progress by category', charts.pairedBars(cmp, { aName: 'Master', bName: 'MD' }))}
    ${ui.card('Supervisor approval performance', html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Supervisor</th><th class="w-mini">Pending</th><th class="num">Overdue</th><th class="num">Reviewed (30d)</th><th class="num">Avg time</th></tr></thead>
      <tbody>${sup.map((x) => html`<tr><td>${ui.avatarName(x.name, x.academic_title)}</td><td><div class="mini-bar"><i style="width:${((x.pending / maxPend) * 100).toFixed(1)}%"></i><b>${x.pending}</b></div></td>
        <td class="num ${x.overdue ? 'neg strong' : ''}">${x.overdue || '—'}</td><td class="num">${x.reviewed_30}</td><td class="num ${x.avg_days > s.delay ? 'neg' : ''}">${x.avg_days == null ? '—' : x.avg_days.toFixed(1) + ' d'}</td></tr>`)}</tbody></table></div>`, { cls: 'flush', actions: html`<a class="btn sm ghost" href="/reports/supervisors">Report ${ui.icon('arrowRight')}</a>` })}
  </div>`;
  res.html(ui.layout(req, {
    title: 'Department Dashboard', subtitle: `Training overview as of ${fmtDate(today())}`,
    actions: html`<a class="btn" href="/reports/manager">${ui.icon('printer')} Monthly report</a><a class="btn primary" href="/admin/candidates/new">${ui.icon('plus')} New candidate</a>`,
    body,
  }));
});

// ---------- Candidates ----------
get('/admin/candidates', M, (req, res) => {
  const f = req.query;
  const w = ['1=1'], p = [];
  if (f.status) { w.push('c.status=?'); p.push(f.status); } else if (!f.all) w.push("c.status='active'");
  if (f.program) { w.push('c.program_type=?'); p.push(f.program); }
  if (f.q) { w.push('(u.name LIKE ? OR u.email LIKE ? OR c.university_id LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  let list = D.allCandidateProgress(w.join(' AND '), ...p);
  if (f.risk === 'attention') list = list.filter((c) => ['risk', 'follow'].includes(c.progress.risk.key));
  res.html(ui.layout(req, {
    title: 'Candidates', subtitle: `${list.length} candidate${list.length === 1 ? '' : 's'}`,
    actions: html`<a class="btn" href="/reports/manager.xlsx">${ui.icon('table')} Export</a><a class="btn primary" href="/admin/candidates/new">${ui.icon('plus')} New candidate</a>`,
    body: html`<form class="filters card" method="get">
      <label class="f-search">${ui.icon('search')}<input type="search" name="q" value="${f.q || ''}" placeholder="Name, email or university ID"></label>
      <label><span>Program</span>${ui.select('program', ['Master', 'MD'], f.program, { placeholder: 'All programs' })}</label>
      <label><span>Status</span>${ui.select('status', ['active', 'graduated', 'suspended', 'withdrawn'], f.status, { placeholder: 'Active' })}</label>
      <label><span>Progress</span>${ui.select('risk', [['attention', 'Needs follow-up / at risk']], f.risk, { placeholder: 'All' })}</label>
      <div class="f-actions"><button class="btn primary sm">${ui.icon('filter')} Apply</button></div></form>
      ${ui.card('', candidateRows(list, { showSup: true }), { cls: 'flush' })}`,
  }));
});

function candidateForm(req, c = {}, errors = {}) {
  const sups = D.approvers();
  const e = (k) => (errors[k] ? html`<em class="err">${errors[k]}</em>` : '');
  const v = (k) => c[k] ?? '';
  return html`<form method="post" class="card form-card">${ui.csrf(req)}
    <header class="card-head"><div><h2>Candidate profile</h2><p>Personal data, program and supervision</p></div></header>
    <div class="form-grid">
      <label class="field"><span>Full name<b class="req">*</b></span><input name="name" value="${v('name')}" required placeholder="Dr. …">${e('name')}</label>
      <label class="field"><span>University ID</span><input name="university_id" value="${v('university_id')}"></label>
      <label class="field"><span>Email<b class="req">*</b></span><input type="email" name="email" value="${v('email')}" required>${e('email')}</label>
      <label class="field"><span>Phone</span><input name="phone" value="${v('phone')}"></label>
      <label class="field"><span>Program type<b class="req">*</b></span>${ui.select('program_type', ['Master', 'MD'], v('program_type'), { required: true })}</label>
      <label class="field"><span>Training year<b class="req">*</b></span>${ui.select('training_year', [1, 2, 3, 4], v('training_year') || 1, { placeholder: false })}</label>
      <label class="field"><span>Training start date<b class="req">*</b></span><input type="date" name="training_start_date" value="${v('training_start_date')}" required>${e('training_start_date')}</label>
      <label class="field"><span>Expected completion date<b class="req">*</b></span><input type="date" name="expected_completion_date" value="${v('expected_completion_date')}" required>${e('expected_completion_date')}</label>
      <label class="field"><span>Main supervisor<b class="req">*</b></span>${ui.select('main_supervisor_id', sups.map((s) => [s.id, s.name]), v('main_supervisor_id'), { required: true })}</label>
      <label class="field"><span>Status</span>${ui.select('status', ['active', 'graduated', 'suspended', 'withdrawn'], v('status') || 'active', { placeholder: false })}</label>
    </div>
    <footer class="form-foot"><a class="btn ghost" href="/admin/candidates">Cancel</a><div class="spacer"></div><button class="btn primary">${ui.icon('check')} Save candidate</button></footer>
  </form>`;
}

function userFieldsValid(b, existingUserId) {
  const errors = {};
  if (!String(b.name || '').trim()) errors.name = 'Name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || ''))) errors.email = 'Enter a valid email.';
  else if (one('SELECT id FROM users WHERE email=? AND id<>?', String(b.email).trim(), existingUserId || 0)) errors.email = 'This email is already in use.';
  return errors;
}

get('/admin/candidates/new', M, (req, res) => res.html(ui.layout(req, { title: 'New Candidate', crumbs: [['/admin/candidates', 'Candidates'], [null, 'New']], body: candidateForm(req, { training_start_date: today() }) })));
post('/admin/candidates/new', M, (req, res) => {
  const b = req.body;
  const errors = userFieldsValid(b);
  if (!b.training_start_date) errors.training_start_date = 'Required.';
  if (!b.expected_completion_date || b.expected_completion_date <= b.training_start_date) errors.expected_completion_date = 'Must be after the start date.';
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: 'New Candidate', body: candidateForm(req, b, errors) }), 422);
  const pw = tempPassword();
  const id = tx(() => {
    const uid = Number(run("INSERT INTO users(name,email,password_hash,role,phone,must_change_password,created_at) VALUES (?,?,?,'candidate',?,1,?)", b.name.trim(), b.email.trim().toLowerCase(), hashPassword(pw), b.phone || null, nowTs()).lastInsertRowid);
    const cid = Number(run('INSERT INTO candidates(user_id,university_id,program_type,training_start_date,expected_completion_date,training_year,main_supervisor_id,status) VALUES (?,?,?,?,?,?,?,?)',
      uid, b.university_id || null, b.program_type, b.training_start_date, b.expected_completion_date, Number(b.training_year || 1), Number(b.main_supervisor_id) || null, b.status || 'active').lastInsertRowid);
    D.audit(req, 'candidate.create', 'candidates', cid, null, { ...b, _csrf: undefined });
    return cid;
  });
  req.flash('success', `Candidate created. Temporary password: ${pw} — share it securely; they must change it at first sign-in.`);
  res.redirect(`/candidates/${id}`);
});
get('/admin/candidates/:id/edit', M, (req, res) => {
  const c = D.getCandidate(req.params.id);
  if (!c) return res.redirect('/admin/candidates');
  res.html(ui.layout(req, {
    title: `Edit ${c.name}`, crumbs: [['/admin/candidates', 'Candidates'], [`/candidates/${c.id}`, c.name], [null, 'Edit']],
    actions: html`<form method="post" action="/admin/users/${c.user_id}/reset-password">${ui.csrf(req)}<button class="btn" data-confirm="Generate a new temporary password for this user?">${ui.icon('key')} Reset password</button></form>`,
    body: candidateForm(req, c),
  }));
});
post('/admin/candidates/:id/edit', M, (req, res) => {
  const c = D.getCandidate(req.params.id);
  if (!c) return res.redirect('/admin/candidates');
  const b = req.body;
  const errors = userFieldsValid(b, c.user_id);
  if (!b.expected_completion_date || b.expected_completion_date <= b.training_start_date) errors.expected_completion_date = 'Must be after the start date.';
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: `Edit ${c.name}`, body: candidateForm(req, { ...c, ...b }, errors) }), 422);
  tx(() => {
    run('UPDATE users SET name=?, email=?, phone=? WHERE id=?', b.name.trim(), b.email.trim().toLowerCase(), b.phone || null, c.user_id);
    run('UPDATE candidates SET university_id=?, program_type=?, training_start_date=?, expected_completion_date=?, training_year=?, main_supervisor_id=?, status=? WHERE id=?',
      b.university_id || null, b.program_type, b.training_start_date, b.expected_completion_date, Number(b.training_year || 1), Number(b.main_supervisor_id) || null, b.status, c.id);
    D.audit(req, 'candidate.update', 'candidates', c.id, c, { ...b, _csrf: undefined });
  });
  req.flash('success', 'Candidate updated.');
  res.redirect(`/candidates/${c.id}`);
});

post('/admin/users/:id/reset-password', M, (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id);
  if (!u) return res.redirect('/admin');
  const pw = tempPassword();
  run('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', hashPassword(pw), u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  D.audit(req, 'user.password_reset', 'users', u.id);
  req.flash('success', `New temporary password for ${u.name}: ${pw}`);
  res.redirect(req.headers.referer && new URL(req.headers.referer, 'http://x').pathname.startsWith('/admin') ? new URL(req.headers.referer, 'http://x').pathname : '/admin');
});

// ---------- Staff ----------
get('/admin/staff', M, (req, res) => {
  const list = all(`SELECT s.*, u.name, u.email, u.role, u.status, u.last_login_at,
    (SELECT COUNT(*) FROM candidates c WHERE c.main_supervisor_id=s.id AND c.status='active') n_cand,
    (SELECT COUNT(*) FROM activities a WHERE a.supervisor_id=s.id AND a.status='pending') pending
    FROM staff s JOIN users u ON u.id=s.user_id ORDER BY u.status, u.name`);
  res.html(ui.layout(req, {
    title: 'Staff', subtitle: 'Supervisors, approval permissions and accounts',
    actions: html`<a class="btn primary" href="/admin/staff/new">${ui.icon('plus')} New staff member</a>`,
    body: ui.card('', html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Academic title</th><th>Department role</th><th>Access</th><th class="num">Main candidates</th><th class="num">Pending</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((s) => html`<tr><td>${ui.avatarName(s.name, s.email)}</td><td>${s.academic_title || '—'}</td><td>${s.department_role || '—'}</td>
        <td>${s.role === 'manager' ? html`<span class="pill pill-md">Manager</span>` : ''} ${s.can_approve ? html`<span class="pill pill-ok">Can approve</span>` : html`<span class="pill">View only</span>`}</td>
        <td class="num">${s.n_cand}</td><td class="num">${s.pending || '—'}</td><td>${s.last_login_at ? timeAgo(s.last_login_at) : 'Never'}</td>
        <td>${s.status === 'active' ? html`<span class="badge b-approved"><i></i>Active</span>` : html`<span class="badge b-draft"><i></i>Inactive</span>`}</td>
        <td class="row-actions"><a class="btn sm ghost" href="/admin/staff/${s.id}/edit">${ui.icon('edit')} Edit</a></td></tr>`)}</tbody></table></div>`, { cls: 'flush' }),
  }));
});

function staffForm(req, s = {}, errors = {}) {
  const e = (k) => (errors[k] ? html`<em class="err">${errors[k]}</em>` : '');
  const v = (k) => s[k] ?? '';
  return html`<form method="post" class="card form-card" enctype="multipart/form-data">${ui.csrf(req)}
    <header class="card-head"><div><h2>Staff profile</h2><p>Account, academic title and approval permissions</p></div></header>
    <div class="form-grid">
      <label class="field"><span>Full name<b class="req">*</b></span><input name="name" value="${v('name')}" required placeholder="Prof. / Dr. …">${e('name')}</label>
      <label class="field"><span>Email<b class="req">*</b></span><input type="email" name="email" value="${v('email')}" required>${e('email')}</label>
      <label class="field"><span>Academic title</span>${ui.select('academic_title', ['Professor', 'Assistant Professor', 'Lecturer', 'Assistant Lecturer', 'Consultant', 'Specialist'], v('academic_title'))}</label>
      <label class="field"><span>Department role</span><input name="department_role" value="${v('department_role')}" placeholder="e.g. Clinical Supervisor"></label>
      <label class="field"><span>Portal access</span>${ui.select('role', [['staff', 'Staff / Supervisor'], ['manager', 'Department Manager / Admin']], v('role') || 'staff', { placeholder: false })}</label>
      <label class="field"><span>Account status</span>${ui.select('status', [['active', 'Active'], ['inactive', 'Inactive']], v('status') || 'active', { placeholder: false })}</label>
      <label class="field check"><input type="checkbox" name="can_approve" value="1" ${s.can_approve === 0 ? '' : 'checked'}><span>Can approve candidate activities</span></label>
      <label class="field"><span>Signature image (optional)</span><input type="file" name="signature" accept=".png,.jpg,.jpeg">${s.signature_path ? html`<small>A signature is on file — it appears on printed reports.</small>` : html`<small>Shown in the signature section of printed reports.</small>`}</label>
    </div>
    <footer class="form-foot"><a class="btn ghost" href="/admin/staff">Cancel</a><div class="spacer"></div><button class="btn primary">${ui.icon('check')} Save staff member</button></footer>
  </form>`;
}
function saveSignature(req, staffId) {
  const f = (req.files.signature || [])[0];
  if (!f || !/\.(png|jpe?g)$/i.test(f.filename) || f.data.length > 2 * 1024 * 1024) return;
  const name = `sig-${staffId}${path.extname(f.filename).toLowerCase()}`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), f.data);
  run('UPDATE staff SET signature_path=? WHERE id=?', name, staffId);
}
get('/admin/staff/new', M, (req, res) => res.html(ui.layout(req, { title: 'New Staff Member', crumbs: [['/admin/staff', 'Staff'], [null, 'New']], body: staffForm(req) })));
post('/admin/staff/new', M, (req, res) => {
  const b = req.body;
  const errors = userFieldsValid(b);
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: 'New Staff Member', body: staffForm(req, b, errors) }), 422);
  const pw = tempPassword();
  const sid = tx(() => {
    const uid = Number(run('INSERT INTO users(name,email,password_hash,role,status,must_change_password,created_at) VALUES (?,?,?,?,?,1,?)', b.name.trim(), b.email.trim().toLowerCase(), hashPassword(pw), b.role === 'manager' ? 'manager' : 'staff', b.status === 'inactive' ? 'inactive' : 'active', nowTs()).lastInsertRowid);
    const id = Number(run('INSERT INTO staff(user_id,academic_title,department_role,can_approve) VALUES (?,?,?,?)', uid, b.academic_title || null, b.department_role || null, b.can_approve ? 1 : 0).lastInsertRowid);
    D.audit(req, 'staff.create', 'staff', id, null, { ...b, _csrf: undefined });
    return id;
  });
  saveSignature(req, sid);
  req.flash('success', `Staff account created. Temporary password: ${pw}`);
  res.redirect('/admin/staff');
});
get('/admin/staff/:id/edit', M, (req, res) => {
  const s = one('SELECT s.*, u.name, u.email, u.role, u.status FROM staff s JOIN users u ON u.id=s.user_id WHERE s.id=?', req.params.id);
  if (!s) return res.redirect('/admin/staff');
  res.html(ui.layout(req, {
    title: `Edit ${s.name}`, crumbs: [['/admin/staff', 'Staff'], [null, s.name]],
    actions: html`<form method="post" action="/admin/users/${s.user_id}/reset-password">${ui.csrf(req)}<button class="btn" data-confirm="Generate a new temporary password for this user?">${ui.icon('key')} Reset password</button></form>`,
    body: staffForm(req, s),
  }));
});
post('/admin/staff/:id/edit', M, (req, res) => {
  const s = one('SELECT s.*, u.name, u.email, u.role, u.status FROM staff s JOIN users u ON u.id=s.user_id WHERE s.id=?', req.params.id);
  if (!s) return res.redirect('/admin/staff');
  const b = req.body;
  const errors = userFieldsValid(b, s.user_id);
  if (s.user_id === req.user.id && (b.role !== 'manager' || b.status !== 'active')) errors.name = 'You cannot remove your own manager access or deactivate yourself.';
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: `Edit ${s.name}`, body: staffForm(req, { ...s, ...b, can_approve: b.can_approve ? 1 : 0 }, errors) }), 422);
  tx(() => {
    run('UPDATE users SET name=?, email=?, role=?, status=? WHERE id=?', b.name.trim(), b.email.trim().toLowerCase(), b.role === 'manager' ? 'manager' : 'staff', b.status === 'inactive' ? 'inactive' : 'active', s.user_id);
    run('UPDATE staff SET academic_title=?, department_role=?, can_approve=? WHERE id=?', b.academic_title || null, b.department_role || null, b.can_approve ? 1 : 0, s.id);
    if (b.status === 'inactive') run('DELETE FROM sessions WHERE user_id=?', s.user_id);
    D.audit(req, 'staff.update', 'staff', s.id, s, { ...b, _csrf: undefined });
  });
  saveSignature(req, s.id);
  req.flash('success', 'Staff member updated.');
  res.redirect('/admin/staff');
});

// ---------- All activities ----------
get('/admin/activities', M, (req, res) => {
  const r = listActivities(req.query, { managerView: true }, { page: req.query.page });
  res.html(ui.layout(req, {
    title: 'Activities', subtitle: `${num(r.total)} submitted entries across all candidates`,
    actions: html`<a class="btn" href="/admin/activities.xlsx${qs(req.query)}">${ui.icon('table')} Export to Excel</a>`,
    body: html`${filterBar(req, { base: '/admin/activities', show: ['q', 'supervisor', 'status', 'year', 'program', 'nodraft'] })}${ui.card('', html`${activityTable(r.rows, { showCandidate: true, actions: 'review' })}${ui.pager(r.page, r.pages, req.query, '/admin/activities')}`, { cls: 'flush' })}`,
  }));
});
get('/admin/activities.xlsx', M, (req, res) => {
  const { rows } = listActivities(req.query, { managerView: true }, { per: 0 });
  const buf = workbook([{ name: 'Activities', title: 'Logbook activities export', subtitle: `Generated ${fmtDateTime(nowTs())} UTC`, columns: [
    { header: 'ID', width: 8 }, { header: 'Candidate', width: 24 }, { header: 'Program', width: 9 }, { header: 'Category', width: 34 }, { header: 'Activity', width: 34 }, { header: 'Date', width: 12 },
    { header: 'Role', width: 26 }, { header: 'Supervisor', width: 26 }, { header: 'Count', width: 8 }, { header: 'Status', width: 18 }, { header: 'Submitted', width: 18 }, { header: 'Reviewed', width: 18 }, { header: 'Staff comment', width: 40 }],
    rows: rows.map((a) => [a.id, a.candidate_name, a.program_type, a.type_name, a.title, a.activity_date, a.candidate_role, a.supervisor_name, a.count_value, D.STATUS[a.status]?.label, a.submitted_at, a.approved_at, a.staff_comment]) }]);
  D.audit(req, 'export.activities', 'activities', null, null, { count: rows.length });
  res.send(buf, { type: XLSX_MIME, filename: `activities-${today()}.xlsx` });
});

// ---------- Requirements ----------
get('/admin/requirements', M, (req, res) => {
  const prog = req.query.program === 'MD' ? 'MD' : 'Master';
  const types = all('SELECT * FROM activity_types ORDER BY sort_order');
  const reqs = all('SELECT * FROM requirements WHERE program_type=?', prog);
  const val = (t, y) => reqs.find((r) => r.activity_type_id === t && r.training_year === y)?.required_count ?? '';
  const years = [0, 1, 2, 3];
  const body = html`
  <div class="seg big"><a class="${prog === 'Master' ? 'on' : ''}" href="?program=Master">Master program</a><a class="${prog === 'MD' ? 'on' : ''}" href="?program=MD">MD program</a></div>
  <form method="post" class="card flush">${ui.csrf(req)}<input type="hidden" name="program" value="${prog}">
    <header class="card-head"><div><h2>${prog} requirements</h2><p>Required number of <strong>approved</strong> activities. Use “Whole program” for overall targets; optional yearly targets add to the total.</p></div></header>
    <div class="table-wrap"><table class="table req-edit"><thead><tr><th>Activity category</th><th>Whole program</th><th>Year 1</th><th>Year 2</th><th>Year 3</th><th class="num">Total</th></tr></thead>
    <tbody>${types.map((t) => html`<tr class="${t.is_active ? '' : 'muted'}"><td><div class="cat"><span class="act-ic sm">${ui.icon(ui.typeIcon(t.form))}</span><div><strong>${t.name}</strong>${t.is_active ? '' : html`<em> (inactive)</em>`}</div></div></td>
      ${years.map((y) => html`<td><input type="number" min="0" max="5000" name="r_${t.id}_${y}" value="${val(t.id, y)}" placeholder="0" class="num-in" data-sum-row="${t.id}"></td>`)}
      <td class="num strong" data-sum-out="${t.id}">${years.reduce((a, y) => a + Number(val(t.id, y) || 0), 0) || '—'}</td></tr>`)}</tbody></table></div>
    <footer class="form-foot"><span class="muted">Changes apply immediately to all ${prog} candidates' progress and are recorded in the audit log.</span><div class="spacer"></div><button class="btn primary">${ui.icon('check')} Save requirements</button></footer>
  </form>`;
  res.html(ui.layout(req, { title: 'Training Requirements', subtitle: 'Define required numbers per program, training year and activity category', body }));
});
post('/admin/requirements', M, (req, res) => {
  const prog = req.body.program === 'MD' ? 'MD' : 'Master';
  const before = all('SELECT activity_type_id, training_year, required_count FROM requirements WHERE program_type=?', prog);
  tx(() => {
    run('DELETE FROM requirements WHERE program_type=?', prog);
    for (const [k, v] of Object.entries(req.body)) {
      const m = /^r_(\d+)_(\d)$/.exec(k);
      const n = Math.max(0, Math.min(5000, parseInt(v, 10) || 0));
      if (m && n > 0) run('INSERT INTO requirements(program_type, training_year, activity_type_id, required_count) VALUES (?,?,?,?)', prog, Number(m[2]), Number(m[1]), n);
    }
    D.audit(req, 'requirements.update', 'requirements', null, before, all('SELECT activity_type_id, training_year, required_count FROM requirements WHERE program_type=?', prog));
  });
  req.flash('success', `${prog} requirements saved.`);
  res.redirect(`/admin/requirements?program=${prog}`);
});

// ---------- Settings ----------
const LIST_KEYS = [['clinic_types', 'Clinic types'], ['clinic_roles', 'Clinic roles'], ['operation_names', 'Operations'], ['operation_roles', 'Operation roles'], ['procedure_names', 'Procedures'], ['procedure_roles', 'Procedure roles'], ['teaching_types', 'Teaching types'], ['diagnosis_categories', 'Diagnosis categories'], ['locations', 'Locations']];
get('/admin/settings', M, (req, res) => {
  const s = D.getSettings();
  const types = all('SELECT * FROM activity_types ORDER BY sort_order');
  const size = fs.existsSync(path.join(DATA_DIR, 'logbook.db')) ? fs.statSync(path.join(DATA_DIR, 'logbook.db')).size : 0;
  const body = html`<form method="post" class="stack">${ui.csrf(req)}
    <div class="grid g-1-1">
      ${ui.card('Department', html`<div class="form-stack">
        <label class="field"><span>Institution</span><input name="institution_name" value="${s.institution_name}"></label>
        <label class="field"><span>Department name</span><input name="department_name" value="${s.department_name}"></label></div>`)}
      ${ui.card('Monitoring thresholds', html`<div class="form-stack">
        <label class="field"><span>Approval considered delayed after (days)</span><input type="number" min="1" max="60" name="approval_delay_days" value="${s.approval_delay_days}"></label>
        <label class="field"><span>“Needs follow-up” when progress is behind expected by (percentage points)</span><input type="number" min="1" max="100" name="followup_gap" value="${s.followup_gap}"></label>
        <label class="field"><span>“At risk” when behind expected by (percentage points)</span><input type="number" min="1" max="100" name="risk_gap" value="${s.risk_gap}"></label></div>`)}
    </div>
    ${ui.card('Activity categories', html`<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Display name</th><th>Form</th><th>Active</th></tr></thead><tbody>
      ${types.map((t) => html`<tr><td><code>${t.code}</code></td><td><input name="type_name_${t.id}" value="${t.name}" class="in-cell"></td><td>${D.FORMS[t.form]?.label || t.form}</td><td><label class="switch"><input type="checkbox" name="type_active_${t.id}" value="1" ${t.is_active ? 'checked' : ''}><span></span></label></td></tr>`)}
    </tbody></table></div>`, { cls: 'flush', sub: 'Operations are split automatically by the candidate role: Observer/Assistant vs Surgeon under supervision/First surgeon.' })}
    ${ui.card('Drop-down lists', html`<div class="lists-grid">${LIST_KEYS.map(([k, l]) => html`<label class="field"><span>${l}</span><textarea name="${k}" rows="7">${s[k]}</textarea><small>One option per line</small></label>`)}</div>`)}
    <div class="sticky-save"><button class="btn primary">${ui.icon('check')} Save settings</button></div>
  </form>
  ${ui.card('Backup & data', html`<div class="backup"><span class="stat-ic t-blue">${ui.icon('database')}</span><div><strong>Database backup</strong><p>Download a consistent snapshot of the full database (${(size / 1048576).toFixed(1)} MB). Schedule regular backups of the <code>data/</code> folder on the server as well.</p></div><a class="btn" href="/admin/backup">${ui.icon('download')} Download backup</a></div>`)}`;
  res.html(ui.layout(req, { title: 'Settings', subtitle: 'Department details, thresholds, categories and drop-down options', body }));
});
post('/admin/settings', M, (req, res) => {
  const b = req.body;
  const before = D.getSettings();
  tx(() => {
    for (const k of ['institution_name', 'department_name']) if (b[k] != null) D.setSetting(k, String(b[k]).trim().slice(0, 200));
    for (const k of ['approval_delay_days', 'followup_gap', 'risk_gap']) if (b[k]) D.setSetting(k, String(Math.max(1, Math.min(100, parseInt(b[k], 10) || 1))));
    for (const [k] of LIST_KEYS) if (b[k] != null) D.setSetting(k, String(b[k]).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('\n'));
    for (const t of all('SELECT * FROM activity_types')) {
      const name = String(b[`type_name_${t.id}`] || t.name).trim().slice(0, 120) || t.name;
      run('UPDATE activity_types SET name=?, is_active=? WHERE id=?', name, b[`type_active_${t.id}`] ? 1 : 0, t.id);
    }
    D.audit(req, 'settings.update', 'settings', null, before, D.getSettings());
  });
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
});
get('/admin/backup', M, (req, res) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(file);
  fs.unlinkSync(file);
  D.audit(req, 'system.backup_download', null, null);
  res.send(buf, { type: 'application/octet-stream', filename: `andrology-logbook-backup-${today()}.db` });
});

// ---------- Audit log ----------
function auditQuery(f) {
  const w = ['1=1'], p = [];
  if (f.action) { w.push('l.action LIKE ?'); p.push(`${f.action}%`); }
  if (f.user) { w.push('l.user_id=?'); p.push(Number(f.user)); }
  if (f.from) { w.push('l.created_at>=?'); p.push(f.from); }
  if (f.to) { w.push('l.created_at<?'); p.push(f.to + ' 23:59:59'); }
  return { where: w.join(' AND '), p };
}
get('/admin/audit', M, (req, res) => {
  const { where, p } = auditQuery(req.query);
  const total = one(`SELECT COUNT(*) n FROM audit_logs l WHERE ${where}`, ...p).n;
  const per = 40, pages = Math.max(1, Math.ceil(total / per)), page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const rows = all(`SELECT l.*, u.name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`, ...p, per, (page - 1) * per);
  const actions = all('SELECT DISTINCT substr(action,1,instr(action,\'.\')-1) a FROM audit_logs WHERE instr(action,\'.\')>0 ORDER BY a').map((r) => r.a);
  const users = all('SELECT id, name FROM users ORDER BY name');
  const short = (v) => { if (!v) return ''; const s = String(v); return s.length > 140 ? s.slice(0, 140) + '…' : s; };
  res.html(ui.layout(req, {
    title: 'Audit Log', subtitle: `${num(total)} recorded actions — logins, edits, approvals, exports and settings changes`,
    actions: html`<a class="btn" href="/admin/audit.xlsx${qs(req.query)}">${ui.icon('table')} Export for accreditation</a>`,
    body: html`<form class="filters card" method="get">
      <label><span>Area</span>${ui.select('action', actions, req.query.action, { placeholder: 'All areas' })}</label>
      <label><span>User</span>${ui.select('user', users.map((u) => [u.id, u.name]), req.query.user, { placeholder: 'All users' })}</label>
      <label><span>From</span><input type="date" name="from" value="${req.query.from || ''}"></label><label><span>To</span><input type="date" name="to" value="${req.query.to || ''}"></label>
      <div class="f-actions"><button class="btn primary sm">${ui.icon('filter')} Apply</button></div></form>
      ${ui.card('', html`<div class="table-wrap"><table class="table audit"><thead><tr><th>Time (UTC)</th><th>User</th><th>Action</th><th>Record</th><th>Change</th><th>IP</th></tr></thead><tbody>
      ${rows.map((l) => html`<tr><td class="nowrap">${fmtDateTime(l.created_at)}</td><td>${l.name || 'System'}</td><td><code class="act">${l.action}</code></td><td class="nowrap">${l.table_name ? `${l.table_name}${l.record_id ? ' #' + l.record_id : ''}` : '—'}</td>
        <td class="change">${l.old_value ? html`<div class="old">${short(l.old_value)}</div>` : ''}${l.new_value ? html`<div class="new">${short(l.new_value)}</div>` : ''}</td><td class="muted nowrap">${l.ip || ''}</td></tr>`)}
      </tbody></table></div>${ui.pager(page, pages, req.query, '/admin/audit')}`, { cls: 'flush' })}`,
  }));
});
get('/admin/audit.xlsx', M, (req, res) => {
  const { where, p } = auditQuery(req.query);
  const rows = all(`SELECT l.*, u.name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE ${where} ORDER BY l.id DESC LIMIT 50000`, ...p);
  D.audit(req, 'export.audit_log', 'audit_logs', null, null, { count: rows.length });
  res.send(workbook([{ name: 'Audit log', title: 'Audit trail export', subtitle: `${D.getSettings().department_name} · generated ${fmtDateTime(nowTs())} UTC`, columns: [{ header: 'ID', width: 8 }, { header: 'Time (UTC)', width: 20 }, { header: 'User', width: 26 }, { header: 'Action', width: 26 }, { header: 'Table', width: 14 }, { header: 'Record', width: 9 }, { header: 'Old value', width: 50 }, { header: 'New value', width: 50 }, { header: 'IP', width: 16 }],
    rows: rows.map((l) => [l.id, l.created_at, l.name || 'System', l.action, l.table_name, l.record_id, l.old_value, l.new_value, l.ip]) }]), { type: XLSX_MIME, filename: `audit-log-${today()}.xlsx` });
});

module.exports = { supervisorPerformance };
