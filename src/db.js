'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'logbook.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('candidate','staff','manager')),
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  academic_title TEXT,
  department_role TEXT,
  can_approve INTEGER NOT NULL DEFAULT 1,
  signature_path TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT,
  program_type TEXT NOT NULL CHECK (program_type IN ('Master','MD')),
  training_start_date TEXT,
  expected_completion_date TEXT,
  training_year INTEGER NOT NULL DEFAULT 1,
  main_supervisor_id INTEGER REFERENCES staff(id),
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS activity_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  form TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  activity_type_id INTEGER NOT NULL REFERENCES activity_types(id),
  form TEXT NOT NULL,
  title TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  location TEXT,
  supervisor_id INTEGER REFERENCES staff(id),
  candidate_role TEXT,
  description TEXT,
  count_value INTEGER NOT NULL DEFAULT 1,
  details TEXT,
  training_year INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TEXT,
  approved_by INTEGER REFERENCES staff(id),
  approved_at TEXT,
  staff_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_act_cand ON activities(candidate_id, status);
CREATE INDEX IF NOT EXISTS ix_act_sup ON activities(supervisor_id, status);
CREATE INDEX IF NOT EXISTS ix_act_date ON activities(activity_date);
CREATE TABLE IF NOT EXISTS activity_reviews (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_rev_act ON activity_reviews(activity_id);
CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY,
  program_type TEXT NOT NULL,
  training_year INTEGER NOT NULL DEFAULT 0,
  activity_type_id INTEGER NOT NULL REFERENCES activity_types(id),
  required_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (program_type, training_year, activity_type_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  flash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
};
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const one = (sql, ...p) => stmt(sql).get(...norm(p)) || null;
const all = (sql, ...p) => stmt(sql).all(...norm(p));
const run = (sql, ...p) => stmt(sql).run(...norm(p));
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, one, all, run, tx, DATA_DIR, UPLOAD_DIR, DB_FILE, ROOT };
