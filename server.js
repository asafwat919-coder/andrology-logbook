'use strict';
// Electronic Andrology Logbook — entry point.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js 22.13 or newer is required (found ${process.versions.node}). Download the LTS version from https://nodejs.org`);
  process.exit(1);
}
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const http = require('node:http');
const { createHandler } = require('./src/http');
const { run } = require('./src/db');
const { seedBase, seedDemo } = require('./src/seed');
const D = require('./src/domain');
const ui = require('./src/ui');
const { html } = require('./src/util');

seedBase();
if (process.env.DEMO !== '0' && seedDemo()) console.log('• Demo data created (set DEMO=0 to start with an empty department).');
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const { one } = require('./src/db');
  if (!one('SELECT id FROM users WHERE email=?', process.env.ADMIN_EMAIL)) {
    const { hashPassword } = require('./src/crypto');
    const uid = Number(run("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'manager')", process.env.ADMIN_NAME || 'Department Manager', process.env.ADMIN_EMAIL, hashPassword(process.env.ADMIN_PASSWORD)).lastInsertRowid);
    run("INSERT INTO staff(user_id, academic_title, department_role, can_approve) VALUES (?, 'Professor', 'Head of Department', 1)", uid);
    console.log(`• Manager account created for ${process.env.ADMIN_EMAIL}`);
  }
}

require('./src/routes/common');
require('./src/routes/activities');
require('./src/routes/candidate');
require('./src/routes/staff');
require('./src/routes/admin');
require('./src/routes/reports');

function renderError(req, status, title, message) {
  const body = html`<div class="error-page"><div class="err-code">${status}</div><h2>${title}</h2><p>${message}</p><a class="btn primary" href="/">Go to dashboard</a></div>`;
  if (req.user && req.session) { try { return ui.layout(req, { title, body }); } catch { /* fall through */ } }
  return ui.bare(title, html`<div class="auth-body center">${body}</div>`);
}

const server = http.createServer(createHandler({ renderError }));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`\n  Electronic Andrology Logbook is running\n  → http://localhost:${PORT}\n`);
});

// Housekeeping: expired sessions + periodic progress/approval alerts.
function housekeeping() {
  try {
    run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
    D.runAlerts();
  } catch (e) { console.error('Housekeeping failed:', e.message); }
}
setTimeout(housekeeping, 1500);
setInterval(housekeeping, 6 * 3600 * 1000).unref();
