'use strict';
// Creates the default activity categories, requirements and settings.
// With DEMO data enabled (default), also creates sample staff, candidates and ~1 year of logbook entries.
const { one, run, tx } = require('./db');
const { hashPassword } = require('./crypto');
const { DEFAULT_SETTINGS, list } = require('./domain');
const { toISODate } = require('./util');

const TYPES = [
  ['clinic', 'Clinic attendance', 'clinic', 'Outpatient, ICI and duplex clinic sessions'],
  ['op_assist', 'Operations – observed / assisted', 'operation', 'Operations where the candidate observed or assisted'],
  ['op_surgeon', 'Operations – surgeon under supervision / first surgeon', 'operation', 'Operations performed by the candidate'],
  ['procedure', 'Procedures', 'procedure', 'Diagnostic and office procedures'],
  ['lecture', 'Lectures & teaching', 'lecture', 'Lectures, journal clubs, seminars, workshops'],
  ['research', 'Research meetings', 'research', 'Thesis and research meetings'],
  ['case_presentation', 'Case presentations', 'case', 'Cases presented by the candidate'],
  ['other', 'Other activities', 'other', 'Other recorded activities'],
];
const REQUIREMENTS = {
  Master: { clinic: 280, op_assist: 60, op_surgeon: 30, procedure: 150, lecture: 60, research: 20 },
  MD: { clinic: 150, op_assist: 20, op_surgeon: 80, procedure: 100, lecture: 60, research: 30, case_presentation: 10 },
};
const DEMO_PASSWORD = 'Logbook@2026';

function seedBase() {
  if (one('SELECT COUNT(*) n FROM activity_types').n > 0) return false;
  tx(() => {
    TYPES.forEach(([code, name, form, desc], i) => run('INSERT INTO activity_types(code,name,form,description,sort_order) VALUES (?,?,?,?,?)', code, name, form, desc, i + 1));
    for (const [prog, reqs] of Object.entries(REQUIREMENTS)) {
      for (const [code, n] of Object.entries(reqs)) {
        const t = one('SELECT id FROM activity_types WHERE code=?', code);
        run('INSERT INTO requirements(program_type, training_year, activity_type_id, required_count) VALUES (?,?,?,?)', prog, 0, t.id, n);
      }
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)', k, v);
  });
  return true;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function seedDemo() {
  if (one('SELECT COUNT(*) n FROM users').n > 0) return false;
  const rnd = mulberry32(20261107);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pw = hashPassword(DEMO_PASSWORD);
  const ts = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const now = new Date();
  const monthsAgo = (m) => { const d = new Date(now); d.setMonth(d.getMonth() - m); d.setHours(0, 0, 0, 0); return d; };

  tx(() => {
    const addUser = (name, email, role, phone) => Number(run('INSERT INTO users(name,email,password_hash,role,phone,created_at) VALUES (?,?,?,?,?,?)', name, email, pw, role, phone, ts(monthsAgo(36))).lastInsertRowid);
    const addStaff = (name, email, role, title, deptRole, can = 1) => {
      const uid = addUser(name, email, role, '+20 10 ' + String(Math.floor(1e7 + rnd() * 9e7)).slice(0, 8));
      return { uid, sid: Number(run('INSERT INTO staff(user_id, academic_title, department_role, can_approve) VALUES (?,?,?,?)', uid, title, deptRole, can).lastInsertRowid), name, speed: 1 };
    };
    const head = addStaff('Prof. Mohamed Abdel-Rahman', 'manager@andrology.edu', 'manager', 'Professor', 'Head of Department');
    const staff = [
      head,
      addStaff('Prof. Khaled Mansour', 'k.mansour@andrology.edu', 'staff', 'Professor', 'Training Program Director'),
      addStaff('Dr. Amr Fathy', 'a.fathy@andrology.edu', 'staff', 'Assistant Professor', 'Clinical Supervisor'),
      addStaff('Dr. Mona Said', 'm.said@andrology.edu', 'staff', 'Lecturer', 'Clinical Supervisor'),
      addStaff('Dr. Tarek Nabil', 't.nabil@andrology.edu', 'staff', 'Lecturer', 'Clinical Supervisor'),
    ];
    const speeds = [1.2, 1.5, 0.8, 2.2, 6.5]; // approval speed in days (Tarek is slow → demo of delay metrics)
    staff.forEach((s, i) => { s.speed = speeds[i]; });

    const people = [
      ['Dr. Ahmed Hassan', 'MD', 20, 1.0, 1], ['Dr. Sara Mahmoud', 'Master', 9, 0.6, 2], ['Dr. Omar Youssef', 'MD', 31, 0.97, 1],
      ['Dr. Nour Ibrahim', 'Master', 18, 1.05, 3], ['Dr. Youssef Adel', 'MD', 8, 0.88, 4], ['Dr. Mariam Khalil', 'Master', 30, 0.62, 2],
      ['Dr. Karim Salah', 'MD', 16, 1.12, 3], ['Dr. Hana Mostafa', 'Master', 4, 0.9, 4],
    ];
    const types = Object.fromEntries(require('./db').all('SELECT code, id FROM activity_types').map((t) => [t.code, t.id]));
    const opNames = list('operation_names').filter((x) => x !== 'Other');
    const procNames = list('procedure_names').filter((x) => x !== 'Other');
    const clinics = list('clinic_types');
    const teach = list('teaching_types');
    const dx = list('diagnosis_categories');
    const locs = list('locations');
    const goodComments = ['Well documented.', 'Good work — keep it up.', 'Verified against theatre list.', 'Good clinical reasoning.', 'Confirmed attendance.', ''];
    const rejComments = ['Supervisor was not on duty on this date.', 'Duplicate entry — already recorded.', 'Date conflicts with clinic roster.'];
    const corrComments = ['Please add the patient code.', "Role should be 'Assistant' — please correct.", 'Please attach the attendance sheet.'];
    const topics = ['Sperm DNA fragmentation: clinical value', 'Management of non-obstructive azoospermia', 'Penile prosthesis complications', 'Hormonal evaluation of the infertile male', 'Premature ejaculation guidelines update', 'Varicocele repair and pregnancy outcomes', 'Thesis protocol review', 'Data collection progress', 'Statistical analysis plan', "Peyronie's disease: traction vs surgery"];

    people.forEach(([name, prog, months, perf, supIdx], i) => {
      const email = name.replace(/^Dr\.\s*/, '').toLowerCase().replace(/\s+/g, '.') + '@student.andrology.edu';
      const uid = addUser(name, email, 'candidate', '+20 11 ' + String(Math.floor(1e7 + rnd() * 9e7)).slice(0, 8));
      const start = monthsAgo(months);
      const end = new Date(start); end.setMonth(end.getMonth() + 36);
      const year = Math.min(3, Math.floor(months / 12) + 1);
      const sup = staff[supIdx];
      const cid = Number(run(`INSERT INTO candidates(user_id, university_id, program_type, training_start_date, expected_completion_date, training_year, main_supervisor_id)
        VALUES (?,?,?,?,?,?,?)`, uid, `${prog === 'MD' ? 'MD' : 'MS'}-${2023 + Math.floor((36 - months) / 12)}-${String(101 + i).padStart(4, '0')}`, prog, toISODate(start), toISODate(end), year, sup.sid).lastInsertRowid);

      const frac = Math.min(1, (now - start) / (end - start));
      for (const [code, reqN] of Object.entries(REQUIREMENTS[prog])) {
        const unit = code === 'procedure' ? 2 : 1;
        const n = Math.max(0, Math.round((reqN * frac * perf * (0.85 + rnd() * 0.3)) / unit));
        for (let k = 0; k < n; k++) {
          const d = new Date(start.getTime() + Math.pow(rnd(), 0.85) * (now - start));
          const date = toISODate(d);
          const s = rnd() < 0.55 ? sup : pick(staff.slice(1));
          let form, title, role, details = {}, count = 1, loc = pick(locs.slice(0, 3));
          if (code === 'clinic') { form = 'clinic'; title = pick(clinics); role = pick(['Assistant', 'Primary evaluator under supervision', 'Assistant']); details = { clinic_type: title, patients_seen: 4 + Math.floor(rnd() * 18) }; loc = locs[2]; }
          else if (code === 'op_assist' || code === 'op_surgeon') { form = 'operation'; title = pick(opNames); role = code === 'op_assist' ? pick(['Observer', 'Assistant']) : pick(['Surgeon under supervision', 'Surgeon under supervision', 'First surgeon']); details = { operation_name: title, patient_code: 'AND-' + (10000 + Math.floor(rnd() * 89999)), patient_age: 18 + Math.floor(rnd() * 45), diagnosis_category: pick(dx) }; loc = locs[1]; }
          else if (code === 'procedure') { form = 'procedure'; title = pick(procNames); role = pick(['Performed under supervision', 'Performed independently', 'Observer']); count = 1 + Math.floor(rnd() * 3); details = { procedure_name: title, patient_code: 'AND-' + (10000 + Math.floor(rnd() * 89999)), diagnosis_category: pick(dx) }; }
          else if (code === 'lecture') { form = 'lecture'; title = pick(topics.slice(0, 6).concat(topics.slice(9))); role = 'Attendee'; details = { teaching_type: pick(teach), lecturer: pick(staff).name }; loc = locs[3]; }
          else if (code === 'research') { form = 'research'; title = pick(topics.slice(6, 9)); role = pick(['Attendee', 'Presenter']); }
          else { form = 'case'; title = `Case: ${pick(dx)}`; role = 'Presenter'; details = { patient_code: 'AND-' + (10000 + Math.floor(rnd() * 89999)), diagnosis_category: pick(dx) }; loc = locs[3]; }

          const age = (now - d) / 86400000;
          const r = rnd();
          let status;
          if (age < 21) status = r < 0.5 ? 'pending' : r < 0.82 ? 'approved' : r < 0.9 ? 'correction' : r < 0.96 ? 'draft' : 'rejected';
          else status = r < 0.93 ? 'approved' : r < 0.975 ? 'rejected' : (r < 0.99 || age > 60) ? 'correction' : 'pending';
          if (s === staff[4] && age < 30 && rnd() < 0.5) status = 'pending';

          const submitted = new Date(d.getTime() + (2 + rnd() * 30) * 3600000);
          if (submitted > now) submitted.setTime(now.getTime() - 3600000);
          const reviewed = new Date(submitted.getTime() + s.speed * (0.3 + rnd() * 1.4) * 86400000);
          if (reviewed > now) reviewed.setTime(now.getTime() - 600000);
          const decided = ['approved', 'rejected', 'correction'].includes(status);
          const comment = status === 'approved' ? pick(goodComments) : status === 'rejected' ? pick(rejComments) : status === 'correction' ? pick(corrComments) : null;
          const aid = Number(run(`INSERT INTO activities(candidate_id, activity_type_id, form, title, activity_date, location, supervisor_id, candidate_role, description, count_value, details, training_year, status, submitted_at, approved_by, approved_at, staff_comment, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            cid, types[code], form, title, date, loc, s.sid, role, '', count, JSON.stringify(details), Math.min(year, Math.floor((d - start) / (365 * 86400000)) + 1),
            status, status === 'draft' ? null : ts(submitted), decided ? s.sid : null, decided ? ts(reviewed) : null, comment || null, ts(submitted), ts(decided ? reviewed : submitted)).lastInsertRowid);
          if (status !== 'draft') run('INSERT INTO activity_reviews(activity_id,user_id,action,comment,created_at) VALUES (?,?,?,?,?)', aid, uid, 'submitted', null, ts(submitted));
          if (decided) run('INSERT INTO activity_reviews(activity_id,user_id,action,comment,created_at) VALUES (?,?,?,?,?)', aid, s.uid, status, comment || null, ts(reviewed));
        }
      }
    });
    run("INSERT INTO audit_logs(user_id, action, table_name, record_id, new_value, created_at) VALUES (NULL,'system.seed','users',NULL,'Demo data created',datetime('now'))");
  });
  return true;
}

module.exports = { seedBase, seedDemo, DEMO_PASSWORD };
