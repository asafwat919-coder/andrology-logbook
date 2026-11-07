'use strict';
// Business rules: statuses, activity forms, settings, progress & risk, notifications, audit trail.
const { one, all, run } = require('./db');
const { today, nowTs, parseDate, clamp } = require('./util');

const STATUS = {
  draft:      { label: 'Draft',               cls: 'draft' },
  pending:    { label: 'Pending Approval',    cls: 'pending' },
  approved:   { label: 'Approved',            cls: 'approved' },
  rejected:   { label: 'Rejected',            cls: 'rejected' },
  correction: { label: 'Correction Required', cls: 'correction' },
};

const DEFAULT_SETTINGS = {
  department_name: 'Department of Andrology, Sexology & STDs',
  institution_name: 'Faculty of Medicine',
  approval_delay_days: '7',
  followup_gap: '10',
  risk_gap: '25',
  clinic_types: ['Andrology Outpatient clinic', 'Male infertility clinic', 'ICI clinic', 'Penile duplex clinic', 'Scrotal duplex clinic', 'Sexual dysfunction clinic'].join('\n'),
  clinic_roles: ['Observer', 'Assistant', 'Primary evaluator under supervision'].join('\n'),
  operation_names: ['Varicocelectomy', 'Microsurgical varicocelectomy', 'Testicular sperm extraction (TESE)', 'Micro-TESE', 'Hydrocelectomy', 'Penile prosthesis implantation', 'Testicular needle biopsy', 'Penile curvature correction', 'Orchidopexy', 'Other'].join('\n'),
  operation_roles: ['Observer', 'Assistant', 'Surgeon under supervision', 'First surgeon'].join('\n'),
  procedure_names: ['Penile duplex ultrasound', 'Scrotal duplex ultrasound', 'Intracavernosal injection (ICI) test', 'Semen analysis interpretation', 'Testicular fine-needle aspiration', 'Low-intensity shockwave therapy', 'PRP injection', 'Other'].join('\n'),
  procedure_roles: ['Observer', 'Performed under supervision', 'Performed independently'].join('\n'),
  teaching_types: ['Department lecture', 'Journal club', 'Case discussion', 'Seminar', 'Grand round', 'Workshop', 'Conference', 'Online lecture'].join('\n'),
  diagnosis_categories: ['Male infertility', 'Azoospermia', 'Varicocele', 'Erectile dysfunction', "Peyronie's disease", 'Hypogonadism', 'Ejaculatory dysfunction', 'Undescended testis', 'Hydrocele', 'Other'].join('\n'),
  locations: ['University Hospital – Andrology Unit', 'Main Operating Theatre', 'Outpatient Building', 'Department Lecture Hall', 'Online'].join('\n'),
};

function getSettings() {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings')) s[r.key] = r.value;
  return s;
}
const list = (key) => String(getSettings()[key] || '').split('\n').map((x) => x.trim()).filter(Boolean);
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}

// ---------- Activity forms ----------
// Each form describes the fields the candidate fills. `typeFor` maps a submission to a requirement category.
const SURGEON_ROLES = ['Surgeon under supervision', 'First surgeon'];
const FORMS = {
  clinic: {
    label: 'Clinic attendance', icon: 'stethoscope', blurb: 'Outpatient, ICI and duplex clinics',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'clinic_type', label: 'Clinic type', type: 'select', options: () => list('clinic_types'), required: true, detail: true },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'candidate_role', label: 'Your role', type: 'select', options: () => list('clinic_roles'), required: true },
      { name: 'patients_seen', label: 'Number of patients seen', type: 'number', min: 0, max: 200, detail: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Notes', type: 'textarea', wide: true },
    ],
    title: (b) => b.clinic_type,
    typeFor: () => 'clinic',
  },
  operation: {
    label: 'Operation / surgery', icon: 'scalpel', blurb: 'Theatre cases with your role',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'operation_name', label: 'Operation', type: 'select', options: () => list('operation_names'), required: true, detail: true },
      { name: 'other_title', label: 'Operation name (if Other)', type: 'text', detail: true, showIf: 'operation_name=Other' },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'candidate_role', label: 'Your role', type: 'select', options: () => list('operation_roles'), required: true },
      { name: 'patient_code', label: 'Patient code', type: 'patient', required: true, detail: true },
      { name: 'patient_age', label: 'Patient age', type: 'number', min: 0, max: 120, detail: true },
      { name: 'diagnosis_category', label: 'Diagnosis category', type: 'select', options: () => list('diagnosis_categories'), detail: true, optional: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Notes', type: 'textarea', wide: true },
    ],
    title: (b) => (b.operation_name === 'Other' && b.other_title ? b.other_title : b.operation_name),
    typeFor: (b) => (SURGEON_ROLES.includes(b.candidate_role) ? 'op_surgeon' : 'op_assist'),
  },
  procedure: {
    label: 'Procedure', icon: 'syringe', blurb: 'Diagnostic & office procedures',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'procedure_name', label: 'Procedure', type: 'select', options: () => list('procedure_names'), required: true, detail: true },
      { name: 'other_title', label: 'Procedure name (if Other)', type: 'text', detail: true, showIf: 'procedure_name=Other' },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'candidate_role', label: 'Your role', type: 'select', options: () => list('procedure_roles'), required: true },
      { name: 'count_value', label: 'Number performed', type: 'number', min: 1, max: 100, required: true, default: 1 },
      { name: 'patient_code', label: 'Patient code(s)', type: 'patient', detail: true },
      { name: 'diagnosis_category', label: 'Diagnosis category', type: 'select', options: () => list('diagnosis_categories'), detail: true, optional: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Notes', type: 'textarea', wide: true },
    ],
    title: (b) => (b.procedure_name === 'Other' && b.other_title ? b.other_title : b.procedure_name),
    typeFor: () => 'procedure',
  },
  lecture: {
    label: 'Lecture / teaching', icon: 'lecture', blurb: 'Lectures, journal clubs, workshops',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'teaching_type', label: 'Type of teaching', type: 'select', options: () => list('teaching_types'), required: true, detail: true },
      { name: 'title', label: 'Lecture title', type: 'text', required: true, wide: true },
      { name: 'lecturer', label: 'Lecturer', type: 'text', required: true, detail: true },
      { name: 'supervisor_id', label: 'Verifying staff member', type: 'supervisor', required: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Notes / key learning points', type: 'textarea', wide: true },
    ],
    title: (b) => b.title,
    typeFor: () => 'lecture',
    role: 'Attendee',
  },
  research: {
    label: 'Research meeting', icon: 'flask', blurb: 'Thesis & research group meetings',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'title', label: 'Meeting topic', type: 'text', required: true, wide: true },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'candidate_role', label: 'Your role', type: 'select', options: () => ['Attendee', 'Presenter'], required: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Outcome / notes', type: 'textarea', wide: true },
    ],
    title: (b) => b.title,
    typeFor: () => 'research',
  },
  case: {
    label: 'Case presentation', icon: 'presentation', blurb: 'Cases you presented',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'title', label: 'Case title', type: 'text', required: true, wide: true },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'patient_code', label: 'Patient code', type: 'patient', detail: true },
      { name: 'diagnosis_category', label: 'Diagnosis category', type: 'select', options: () => list('diagnosis_categories'), detail: true, optional: true },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Summary', type: 'textarea', wide: true },
    ],
    title: (b) => b.title,
    typeFor: () => 'case_presentation',
    role: 'Presenter',
  },
  other: {
    label: 'Other activity', icon: 'dots', blurb: 'Anything else worth recording',
    fields: [
      { name: 'activity_date', label: 'Date', type: 'date', required: true },
      { name: 'title', label: 'Activity title', type: 'text', required: true, wide: true },
      { name: 'supervisor_id', label: 'Supervisor', type: 'supervisor', required: true },
      { name: 'candidate_role', label: 'Your role', type: 'text' },
      { name: 'count_value', label: 'Count', type: 'number', min: 1, max: 100, default: 1 },
      { name: 'location', label: 'Location', type: 'location' },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    title: (b) => b.title,
    typeFor: () => 'other',
  },
};

const typeByCode = (code) => one('SELECT * FROM activity_types WHERE code=?', code);
const activeTypes = () => all('SELECT * FROM activity_types WHERE is_active=1 ORDER BY sort_order');

// ---------- People ----------
const CANDIDATE_SQL = `SELECT c.*, u.name, u.email, u.phone, u.status AS account_status, u.last_login_at,
  su.name AS supervisor_name FROM candidates c JOIN users u ON u.id=c.user_id
  LEFT JOIN staff s ON s.id=c.main_supervisor_id LEFT JOIN users su ON su.id=s.user_id`;
const getCandidate = (id) => one(`${CANDIDATE_SQL} WHERE c.id=?`, id);
const candidateByUser = (uid) => one(`${CANDIDATE_SQL} WHERE c.user_id=?`, uid);
const staffByUser = (uid) => one('SELECT s.*, u.name, u.email FROM staff s JOIN users u ON u.id=s.user_id WHERE s.user_id=?', uid);
const approvers = () => all(`SELECT s.id, u.name, s.academic_title FROM staff s JOIN users u ON u.id=s.user_id
  WHERE s.can_approve=1 AND u.status='active' ORDER BY u.name`);

// ---------- Progress & risk ----------
function expectedPct(c) {
  const s = parseDate(c.training_start_date), e = parseDate(c.expected_completion_date);
  if (!s || !e || e <= s) return null;
  return clamp(((Date.now() - s) / (e - s)) * 100, 0, 100);
}

function candidateProgress(c, settings = getSettings()) {
  const rows = all(`SELECT at.id, at.code, at.name, at.form, at.sort_order,
      COALESCE((SELECT SUM(required_count) FROM requirements r WHERE r.activity_type_id=at.id AND r.program_type=?),0) AS required
    FROM activity_types at WHERE at.is_active=1 ORDER BY at.sort_order`, c.program_type);
  const counts = all(`SELECT activity_type_id AS t, status, SUM(count_value) AS n, COUNT(*) AS k
    FROM activities WHERE candidate_id=? GROUP BY activity_type_id, status`, c.id);
  const totals = { draft: 0, pending: 0, approved: 0, rejected: 0, correction: 0, all: 0 };
  const byType = {};
  for (const r of counts) {
    (byType[r.t] ||= {})[r.status] = r.n;
    totals[r.status] = (totals[r.status] || 0) + r.k;
    if (r.status !== 'draft') totals.all += r.k;
  }
  let reqSum = 0, doneSum = 0;
  const categories = rows.map((r) => {
    const b = byType[r.id] || {};
    const approved = b.approved || 0;
    const required = r.required;
    if (required > 0) { reqSum += required; doneSum += Math.min(approved, required); }
    return {
      ...r, approved, pending: b.pending || 0, rejected: b.rejected || 0, correction: b.correction || 0,
      remaining: Math.max(0, required - approved),
      pct: required > 0 ? clamp((approved / required) * 100, 0, 100) : null,
    };
  }).filter((r) => r.required > 0 || r.approved > 0 || r.pending > 0);
  const overall = reqSum > 0 ? (doneSum / reqSum) * 100 : 0;
  const expected = expectedPct(c);
  return { categories, totals, overall, expected, risk: riskOf(overall, expected, settings), required: reqSum, completed: doneSum };
}

function riskOf(overall, expected, settings = getSettings()) {
  if (overall >= 99.5) return { key: 'complete', label: 'Completed' };
  if (expected == null) return { key: 'ok', label: 'On track' };
  const gap = expected - overall;
  if (gap >= Number(settings.risk_gap || 25)) return { key: 'risk', label: 'At risk' };
  if (gap >= Number(settings.followup_gap || 10)) return { key: 'follow', label: 'Needs follow-up' };
  return { key: 'ok', label: 'On track' };
}

function allCandidateProgress(where = "c.status='active'", ...params) {
  const settings = getSettings();
  return all(`${CANDIDATE_SQL} WHERE ${where} ORDER BY u.name`, ...params).map((c) => ({ ...c, progress: candidateProgress(c, settings) }));
}

// ---------- Notifications ----------
function notify(userId, { kind = 'info', title, body = '', link = '', dedupe = null }) {
  if (!userId) return;
  run(`INSERT INTO notifications(user_id, kind, title, body, link, dedupe_key) VALUES (?,?,?,?,?,?)
       ON CONFLICT(dedupe_key) DO NOTHING`, userId, kind, title, body, link, dedupe);
}
const managers = () => all("SELECT id FROM users WHERE role='manager' AND status='active'");
const unreadCount = (uid) => one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0', uid).n;

// Periodic checks: behind schedule, near completion, deadlines, delayed approvals, repeated rejections.
function runAlerts() {
  const s = getSettings();
  const month = today().slice(0, 7);
  const delay = Number(s.approval_delay_days || 7);
  const mgrs = managers();
  for (const c of allCandidateProgress()) {
    const p = c.progress;
    const link = `/candidates/${c.id}`;
    if (p.risk.key === 'risk') {
      for (const m of mgrs) notify(m.id, { kind: 'warning', title: `${c.name} is behind schedule`, body: `Overall progress ${Math.round(p.overall)}% vs ${Math.round(p.expected)}% expected.`, link, dedupe: `behind:${c.id}:${m.id}:${month}` });
    }
    if (p.overall >= 90 && p.overall < 100) {
      for (const m of mgrs) notify(m.id, { kind: 'success', title: `${c.name} is near completion`, body: `${Math.round(p.overall)}% of requirements approved.`, link, dedupe: `near:${c.id}:${m.id}` });
    }
    const end = parseDate(c.expected_completion_date);
    if (end && p.overall < 100) {
      const daysLeft = (end - Date.now()) / 86400000;
      if (daysLeft > 0 && daysLeft <= 120) notify(c.user_id, { kind: 'warning', title: 'Training deadline approaching', body: `${Math.ceil(daysLeft)} days left — ${Math.round(100 - p.overall)}% of requirements remain.`, link: '/progress', dedupe: `deadline:${c.id}:${month}` });
    }
    if (p.expected != null && p.expected - p.overall >= Number(s.followup_gap || 10)) {
      notify(c.user_id, { kind: 'warning', title: 'Requirements incomplete', body: `You are at ${Math.round(p.overall)}% — expected about ${Math.round(p.expected)}% by now.`, link: '/progress', dedupe: `incomplete:${c.id}:${month}` });
    }
    const rej = one(`SELECT COUNT(*) n FROM activities WHERE candidate_id=? AND status='rejected' AND approved_at >= datetime('now','-30 days')`, c.id).n;
    if (rej >= 3) for (const m of mgrs) notify(m.id, { kind: 'danger', title: `${c.name} has ${rej} rejected activities`, body: 'Rejected in the last 30 days.', link, dedupe: `rej:${c.id}:${m.id}:${month}` });
  }
  const late = all(`SELECT a.supervisor_id, s.user_id, u.name, COUNT(*) n FROM activities a JOIN staff s ON s.id=a.supervisor_id JOIN users u ON u.id=s.user_id
    WHERE a.status='pending' AND a.submitted_at <= datetime('now', ?) GROUP BY a.supervisor_id`, `-${delay} days`);
  const week = `${month}-w${Math.ceil(new Date().getDate() / 7)}`;
  for (const l of late) {
    notify(l.user_id, { kind: 'warning', title: `${l.n} approval${l.n > 1 ? 's are' : ' is'} overdue`, body: `Waiting more than ${delay} days.`, link: '/staff/pending', dedupe: `late:${l.user_id}:${week}` });
    for (const m of mgrs) if (m.id !== l.user_id) notify(m.id, { kind: 'warning', title: `Approval delay: ${l.name}`, body: `${l.n} item(s) pending over ${delay} days.`, link: '/reports/supervisors', dedupe: `latemgr:${l.user_id}:${m.id}:${week}` });
  }
}

// ---------- Audit ----------
function audit(req, action, table, recordId, oldValue, newValue) {
  const ser = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  run('INSERT INTO audit_logs(user_id, action, table_name, record_id, old_value, new_value, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
    req?.user?.id ?? null, action, table, recordId ?? null, ser(oldValue), ser(newValue), req?.ip ?? null, nowTs());
}

module.exports = {
  STATUS, FORMS, SURGEON_ROLES, DEFAULT_SETTINGS, getSettings, setSetting, list, typeByCode, activeTypes,
  CANDIDATE_SQL, getCandidate, candidateByUser, staffByUser, approvers,
  candidateProgress, allCandidateProgress, riskOf, expectedPct,
  notify, managers, unreadCount, runAlerts, audit,
};
