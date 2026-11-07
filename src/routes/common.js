'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { get, post, newSession, cookieAttrs } = require('../http');
const { one, all, run, UPLOAD_DIR } = require('../db');
const { html, raw, fmtDateTime, timeAgo, nowTs, initials } = require('../util');
const { verifyPassword, hashPassword, passwordProblem } = require('../crypto');
const { audit, getSettings, candidateByUser, staffByUser } = require('../domain');
const ui = require('../ui');
const { DEMO_PASSWORD } = require('../seed');

const HOME = { candidate: '/candidate', staff: '/staff', manager: '/admin' };
const failures = new Map(); // simple brute-force protection: key -> { n, until }

get('/', (req, res) => res.redirect(HOME[req.user.role]));
get('/healthz', { auth: false }, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); });

function loginPage(req, { email = '', error = '', next = '' } = {}) {
  const s = getSettings();
  const demo = process.env.DEMO !== '0' && one("SELECT COUNT(*) n FROM users WHERE email='manager@andrology.edu'").n > 0;
  const demoUsers = demo ? [
    ['manager@andrology.edu', 'Department Manager', 'Prof. Mohamed Abdel-Rahman', 'shield'],
    ['k.mansour@andrology.edu', 'Staff / Supervisor', 'Prof. Khaled Mansour', 'checkCircle'],
    ['ahmed.hassan@student.andrology.edu', 'Candidate (MD)', 'Dr. Ahmed Hassan', 'user'],
    ['sara.mahmoud@student.andrology.edu', 'Candidate (Master)', 'Dr. Sara Mahmoud', 'user'],
  ] : [];
  return ui.bare('Sign in', html`
<div class="auth">
  <section class="auth-hero">
    <div class="auth-hero-inner">
      <div class="auth-brand">${ui.LOGO}<div><strong>Electronic Andrology Logbook</strong><span>${s.department_name}</span></div></div>
      <h1>Every clinic, case and lecture —<br><em>documented, verified, counted.</em></h1>
      <p>A secure, role-based training record for Master and MD candidates, with supervisor approval and real-time progress monitoring.</p>
      <ul class="auth-points">
        <li>${ui.icon('clipboard')}<div><strong>Log activities in seconds</strong><span>Clinics, operations, procedures, lectures and research meetings.</span></div></li>
        <li>${ui.icon('checkCircle')}<div><strong>Supervisor approval workflow</strong><span>Approve, reject or request correction — with comments.</span></div></li>
        <li>${ui.icon('chart')}<div><strong>Automatic progress tracking</strong><span>Requirements, risk flags and accreditation-ready reports.</span></div></li>
      </ul>
      <div class="auth-foot">${ui.icon('lock')} Encrypted sessions · Role-based access · Full audit trail</div>
    </div>
  </section>
  <section class="auth-panel">
    <form class="auth-form" method="post" action="/login" autocomplete="on">
      <input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="next" value="${next}">
      <div class="auth-mobile-brand">${ui.LOGO}<strong>Andrology Logbook</strong></div>
      <h2>Sign in</h2>
      <p class="muted">Use your department email and password.</p>
      ${error ? html`<div class="flash flash-danger">${ui.icon('xCircle')}<span>${error}</span></div>` : ''}
      <label class="field"><span>Email / username</span><div class="input-ic">${ui.icon('mail')}<input type="email" name="email" value="${email}" required autofocus autocomplete="username" placeholder="name@andrology.edu"></div></label>
      <label class="field"><span>Password</span><div class="input-ic">${ui.icon('lock')}<input type="password" name="password" required autocomplete="current-password" placeholder="••••••••••"></div></label>
      <button class="btn primary block lg" type="submit">Sign in ${ui.icon('arrowRight')}</button>
      <p class="hint">Access is role-based: candidates, supervisors and department managers each see their own portal after signing in.</p>
      ${demoUsers.length ? html`<div class="demo">
        <div class="demo-head"><span>Demo accounts</span><em>password: <code>${DEMO_PASSWORD}</code></em></div>
        ${demoUsers.map(([e, role, name]) => html`<button type="button" class="demo-user" data-fill-email="${e}" data-fill-password="${DEMO_PASSWORD}"><span class="avatar xs">${initials(name)}</span><div><strong>${role}</strong><span>${name}</span></div>${ui.icon('arrowRight')}</button>`)}
      </div>` : ''}
    </form>
  </section>
</div>`, 'auth-body');
}

get('/login', { auth: false }, (req, res) => {
  if (req.user) return res.redirect(HOME[req.user.role]);
  res.html(loginPage(req, { next: req.query.next || '', error: req.query.expired ? 'Your session expired. Please sign in again.' : '' }));
});

post('/login', { auth: false }, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  const f = failures.get(key);
  if (f && f.until > Date.now()) return res.html(loginPage(req, { email, error: 'Too many failed attempts. Please wait 10 minutes and try again.' }), 429);
  const user = one('SELECT * FROM users WHERE email=?', email);
  if (!user || !verifyPassword(req.body.password, user.password_hash) || user.status !== 'active') {
    const n = (f?.n || 0) + 1;
    failures.set(key, { n, until: n >= 5 ? Date.now() + 10 * 60000 : 0 });
    audit(req, 'auth.login_failed', 'users', user?.id, null, { email });
    return res.html(loginPage(req, { email, error: user && user.status !== 'active' ? 'This account is inactive. Contact the department administrator.' : 'Incorrect email or password.' }), 401);
  }
  failures.delete(key);
  run('DELETE FROM sessions WHERE id=?', req.session.id);
  req.session = newSession(res, user.id);
  req.user = user;
  run('UPDATE users SET last_login_at=? WHERE id=?', nowTs(), user.id);
  audit(req, 'auth.login', 'users', user.id);
  const next = String(req.body.next || '');
  res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : HOME[user.role]);
});

post('/logout', (req, res) => {
  audit(req, 'auth.logout', 'users', req.user.id);
  run('DELETE FROM sessions WHERE id=?', req.session.id);
  res.setHeader('Set-Cookie', `sid=; ${cookieAttrs(req)}; Max-Age=0`);
  res.redirect('/login');
});

// ---------- Notifications ----------
get('/notifications', (req, res) => {
  const list = all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 200', req.user.id);
  const ic = { success: 'checkCircle', danger: 'xCircle', warning: 'alert', info: 'bell' };
  const body = ui.card('', list.length ? html`<ul class="notif-list">${list.map((n) => html`
    <li class="${n.is_read ? '' : 'unread'}"><a href="/notifications/${n.id}"><span class="n-ic t-${n.kind}">${ui.icon(ic[n.kind] || 'bell')}</span>
    <div><strong>${n.title}</strong><p>${n.body}</p></div><time>${timeAgo(n.created_at)}</time></a></li>`)}</ul>` : ui.empty('You are all caught up', 'Notifications about approvals, corrections and deadlines appear here.'), { cls: 'flush' });
  res.html(ui.layout(req, {
    title: 'Notifications', subtitle: 'Approvals, corrections, deadlines and alerts',
    actions: list.some((n) => !n.is_read) ? html`<form method="post" action="/notifications/read-all">${ui.csrf(req)}<button class="btn">${ui.icon('check')} Mark all as read</button></form>` : '',
    body,
  }));
});
get('/notifications/:id', (req, res) => {
  const n = one('SELECT * FROM notifications WHERE id=? AND user_id=?', req.params.id, req.user.id);
  if (!n) return res.redirect('/notifications');
  run('UPDATE notifications SET is_read=1 WHERE id=?', n.id);
  res.redirect(n.link || '/notifications');
});
post('/notifications/read-all', (req, res) => {
  run('UPDATE notifications SET is_read=1 WHERE user_id=?', req.user.id);
  res.redirect('/notifications');
});

// ---------- Profile ----------
get('/profile', (req, res) => {
  const u = req.user;
  const cand = u.role === 'candidate' ? candidateByUser(u.id) : null;
  const st = u.role !== 'candidate' ? staffByUser(u.id) : null;
  const row = (k, v) => html`<div class="kv"><span>${k}</span><strong>${v || '—'}</strong></div>`;
  const info = html`<div class="profile-head"><span class="avatar lg">${initials(u.name)}</span><div><h3>${u.name}</h3><p>${u.email}</p></div></div>
  <div class="kv-grid">
    ${row('Role', { candidate: 'Candidate', staff: 'Staff member', manager: 'Department manager' }[u.role])}
    ${row('Phone', u.phone)}
    ${cand ? [row('University ID', cand.university_id), row('Program', cand.program_type), row('Training year', `Year ${cand.training_year}`), row('Main supervisor', cand.supervisor_name), row('Training start', ui.fmtDate(cand.training_start_date)), row('Expected completion', ui.fmtDate(cand.expected_completion_date)), row('Status', cand.status)] : ''}
    ${st ? [row('Academic title', st.academic_title), row('Department role', st.department_role), row('Approval permission', st.can_approve ? 'Can approve activities' : 'View only')] : ''}
    ${row('Last sign-in', fmtDateTime(u.last_login_at))}
  </div>`;
  const pw = html`<form method="post" action="/profile/password" class="form-stack">${ui.csrf(req)}
    ${u.must_change_password ? html`<div class="flash flash-warning">${ui.icon('alert')}<span>Your account uses a temporary password. Please choose a new one.</span></div>` : ''}
    <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
    <label class="field"><span>New password</span><input type="password" name="password" required minlength="10" autocomplete="new-password"><small>At least 10 characters, with letters, numbers and an uppercase letter or symbol.</small></label>
    <label class="field"><span>Confirm new password</span><input type="password" name="confirm" required autocomplete="new-password"></label>
    <div><button class="btn primary">${ui.icon('key')} Update password</button></div></form>`;
  res.html(ui.layout(req, { title: 'Profile', subtitle: 'Your account details and security', body: html`<div class="grid g-2-1">${ui.card('Account', info)}${ui.card('Change password', pw)}</div>` }));
});
post('/profile/password', (req, res) => {
  const { current, password, confirm } = req.body;
  if (!verifyPassword(current, req.user.password_hash)) { req.flash('danger', 'Current password is incorrect.'); return res.redirect('/profile'); }
  if (password !== confirm) { req.flash('danger', 'New passwords do not match.'); return res.redirect('/profile'); }
  const p = passwordProblem(password);
  if (p) { req.flash('danger', p); return res.redirect('/profile'); }
  run('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', hashPassword(password), req.user.id);
  run('DELETE FROM sessions WHERE user_id=? AND id<>?', req.user.id, req.session.id);
  audit(req, 'user.password_changed', 'users', req.user.id);
  req.flash('success', 'Password updated. Other sessions were signed out.');
  res.redirect(HOME[req.user.role]);
});

// ---------- Attachments ----------
get('/files/:id', (req, res) => {
  const f = one(`SELECT f.*, a.candidate_id, a.supervisor_id, c.user_id AS cand_user, c.main_supervisor_id FROM attachments f
    JOIN activities a ON a.id=f.activity_id JOIN candidates c ON c.id=a.candidate_id WHERE f.id=?`, req.params.id);
  if (!f) return res.html('Not found', 404);
  const st = staffByUser(req.user.id);
  const ok = req.user.role === 'manager' || f.cand_user === req.user.id || (st && (st.id === f.supervisor_id || st.id === f.main_supervisor_id));
  if (!ok) return res.html('Forbidden', 403);
  const file = path.join(UPLOAD_DIR, path.basename(f.file_path));
  if (!fs.existsSync(file)) return res.html('File missing', 404);
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime || '');
  res.send(fs.readFileSync(file), { type: f.mime || 'application/octet-stream', filename: f.file_name, inline });
});

module.exports = { HOME };
