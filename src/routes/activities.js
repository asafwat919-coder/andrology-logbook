'use strict';
// Activity entry, detail, approval workflow and shared listing helpers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { get, post } = require('../http');
const { one, all, run, tx, UPLOAD_DIR } = require('../db');
const { html, raw, fmtDate, fmtDateTime, timeAgo, today, nowTs, qs, initials, daysBetween } = require('../util');
const D = require('../domain');
const ui = require('../ui');

const ACT_SQL = `SELECT a.*, at.name AS type_name, at.code AS type_code, cu.name AS candidate_name, c.program_type, c.user_id AS cand_user,
  c.main_supervisor_id, c.university_id, su.name AS supervisor_name, ru.name AS reviewer_name,
  (SELECT COUNT(*) FROM attachments f WHERE f.activity_id=a.id) AS n_files
  FROM activities a JOIN activity_types at ON at.id=a.activity_type_id JOIN candidates c ON c.id=a.candidate_id JOIN users cu ON cu.id=c.user_id
  LEFT JOIN staff s ON s.id=a.supervisor_id LEFT JOIN users su ON su.id=s.user_id
  LEFT JOIN staff rs ON rs.id=a.approved_by LEFT JOIN users ru ON ru.id=rs.user_id`;
const getActivity = (id) => one(`${ACT_SQL} WHERE a.id=?`, id);

function canView(req, a) {
  if (req.user.role === 'manager') return true;
  if (req.user.role === 'candidate') return a.cand_user === req.user.id;
  const st = D.staffByUser(req.user.id);
  return !!st && (a.supervisor_id === st.id || a.main_supervisor_id === st.id);
}
function canReview(req, a) {
  if (a.status !== 'pending') return false;
  if (req.user.role === 'manager') return true;
  const st = D.staffByUser(req.user.id);
  return !!st && st.can_approve && a.supervisor_id === st.id;
}

// ---------- Listing helpers ----------
function buildFilter(f, scope = {}) {
  const w = ['1=1'], p = [];
  if (scope.candidateId) { w.push('a.candidate_id=?'); p.push(scope.candidateId); w.push("a.status<>'deleted'"); }
  if (scope.staffId) { w.push('(a.supervisor_id=? OR c.main_supervisor_id=?)'); p.push(scope.staffId, scope.staffId); w.push("a.status<>'draft'"); }
  if (scope.reviewerOnly) { w.push('a.supervisor_id=?'); p.push(scope.reviewerOnly); }
  if (scope.managerView || scope.noDraft) w.push("a.status<>'draft'");
  if (f.from) { w.push('a.activity_date>=?'); p.push(f.from); }
  if (f.to) { w.push('a.activity_date<=?'); p.push(f.to); }
  if (f.type) { w.push('a.activity_type_id=?'); p.push(Number(f.type)); }
  if (f.supervisor) { w.push('a.supervisor_id=?'); p.push(Number(f.supervisor)); }
  if (f.status) { w.push('a.status=?'); p.push(f.status); }
  if (f.year) { w.push('a.training_year=?'); p.push(Number(f.year)); }
  if (f.program) { w.push('c.program_type=?'); p.push(f.program); }
  if (f.candidate) { w.push('a.candidate_id=?'); p.push(Number(f.candidate)); }
  if (f.q) { w.push('(a.title LIKE ? OR cu.name LIKE ? OR a.description LIKE ?)'); const q = `%${f.q}%`; p.push(q, q, q); }
  return { where: w.join(' AND '), params: p };
}
function listActivities(f, scope, { page = 1, per = 25, order = 'a.activity_date DESC, a.id DESC' } = {}) {
  const { where, params } = buildFilter(f, scope);
  const total = one(`SELECT COUNT(*) n FROM activities a JOIN candidates c ON c.id=a.candidate_id JOIN users cu ON cu.id=c.user_id WHERE ${where}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = per ? all(`${ACT_SQL} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per) : all(`${ACT_SQL} WHERE ${where} ORDER BY ${order}`, ...params);
  return { rows, total, page, pages };
}

function filterBar(req, { base, show = [], extra = '' }) {
  const f = req.query;
  const types = D.activeTypes();
  const sups = D.approvers();
  const has = (k) => show.includes(k);
  const anyActive = ['from', 'to', 'type', 'supervisor', 'status', 'year', 'program', 'candidate', 'q'].some((k) => f[k]);
  return html`<form class="filters card" method="get" action="${base}">
    ${has('q') ? html`<label class="f-search">${ui.icon('search')}<input type="search" name="q" value="${f.q || ''}" placeholder="Search activity or candidate…"></label>` : ''}
    <label><span>From</span><input type="date" name="from" value="${f.from || ''}"></label>
    <label><span>To</span><input type="date" name="to" value="${f.to || ''}"></label>
    <label><span>Type</span>${ui.select('type', types.map((t) => [t.id, t.name]), f.type, { placeholder: 'All types' })}</label>
    ${has('supervisor') ? html`<label><span>Supervisor</span>${ui.select('supervisor', sups.map((s) => [s.id, s.name]), f.supervisor, { placeholder: 'All supervisors' })}</label>` : ''}
    ${has('status') ? html`<label><span>Status</span>${ui.select('status', Object.entries(D.STATUS).filter(([k]) => !(has('nodraft') && k === 'draft')).map(([k, v]) => [k, v.label]), f.status, { placeholder: 'All statuses' })}</label>` : ''}
    ${has('year') ? html`<label><span>Training year</span>${ui.select('year', [[1, 'Year 1'], [2, 'Year 2'], [3, 'Year 3'], [4, 'Year 4']], f.year, { placeholder: 'All years' })}</label>` : ''}
    ${has('program') ? html`<label><span>Program</span>${ui.select('program', ['Master', 'MD'], f.program, { placeholder: 'All programs' })}</label>` : ''}
    ${extra}
    <div class="f-actions"><button class="btn primary sm">${ui.icon('filter')} Apply</button>${anyActive ? html`<a class="btn ghost sm" href="${base}">Clear</a>` : ''}</div>
  </form>`;
}

function activityTable(rows, { showCandidate = false, select = false, actions = 'view', emptyMsg = 'No activities match these filters.' } = {}) {
  if (!rows.length) return ui.empty('Nothing here yet', emptyMsg);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>${select ? html`<th class="cb"><input type="checkbox" data-check-all aria-label="Select all"></th>` : ''}
      ${showCandidate ? html`<th>Candidate</th>` : ''}<th>Activity</th><th>Date</th><th>Role</th><th>Supervisor</th><th class="num">Count</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((a) => {
      const overdue = a.status === 'pending' && daysBetween(a.submitted_at, nowTs()) > Number(D.getSettings().approval_delay_days || 7);
      return html`<tr>
      ${select ? html`<td class="cb">${a.status === 'pending' ? html`<input type="checkbox" name="ids" value="${a.id}" aria-label="Select">` : ''}</td>` : ''}
      ${showCandidate ? html`<td>${ui.avatarName(a.candidate_name, `${a.program_type} · ${a.university_id || ''}`)}</td>` : ''}
      <td><a class="act-cell" href="/activities/${a.id}"><span class="act-ic">${ui.icon(ui.typeIcon(a.form))}</span><div><strong>${a.title}</strong><span>${a.type_name}${a.n_files ? html` · ${ui.icon('paperclip', 'xs')} ${a.n_files}` : ''}</span></div></a></td>
      <td class="nowrap">${fmtDate(a.activity_date)}</td>
      <td>${a.candidate_role || '—'}</td>
      <td>${a.supervisor_name || '—'}</td>
      <td class="num">${a.count_value}</td>
      <td>${ui.badge(a.status)}${a.status === 'pending' && a.submitted_at ? html`<div class="sub-note${overdue ? ' late' : ''}">${overdue ? ui.icon('alert', 'xs') : ''}${timeAgo(a.submitted_at)}</div>` : ''}</td>
      <td class="row-actions">${actions === 'review' && a.status === 'pending' ? html`<a class="btn sm primary" href="/activities/${a.id}?from=pending">Review</a>` : (a.status === 'draft' || a.status === 'correction') && actions === 'own' ? html`<a class="btn sm" href="/activities/${a.id}/edit">${ui.icon('edit')} Edit</a>` : html`<a class="btn sm ghost" href="/activities/${a.id}">View</a>`}</td>
    </tr>`;
    })}</tbody></table></div>`;
}

// ---------- Form rendering ----------
function fieldHtml(fd, v, err, ctx) {
  const val = v[fd.name] ?? (fd.default ?? '');
  const req = fd.required ? raw('required') : '';
  let input;
  switch (fd.type) {
    case 'date': input = html`<input type="date" name="${fd.name}" value="${val || today()}" max="${today()}" ${req}>`; break;
    case 'number': input = html`<input type="number" name="${fd.name}" value="${val}" min="${fd.min ?? 0}" max="${fd.max ?? 9999}" ${req}>`; break;
    case 'textarea': input = html`<textarea name="${fd.name}" rows="3" maxlength="2000" placeholder="Optional">${val}</textarea>`; break;
    case 'select': {
      const opts = fd.options();
      if (val && !opts.includes(val)) opts.push(val);
      input = ui.select(fd.name, opts, val, { required: fd.required, placeholder: fd.optional ? 'Not specified' : 'Select…' });
      break;
    }
    case 'supervisor': input = ui.select(fd.name, ctx.supervisors.map((s) => [s.id, `${s.name}${s.academic_title ? ' — ' + s.academic_title : ''}`]), val || ctx.defaultSupervisor, { required: true }); break;
    case 'location': input = html`<input type="text" name="${fd.name}" value="${val}" list="locations" maxlength="120" placeholder="e.g. University Hospital">`; break;
    case 'patient': input = html`<input type="text" name="${fd.name}" value="${val}" maxlength="60" ${req} placeholder="e.g. AND-10234" pattern="[A-Za-z0-9\\-\\/,\\s]*[0-9][A-Za-z0-9\\-\\/,\\s]*" title="Use the hospital patient code (must contain digits). Never enter patient names.">`; break;
    default: input = html`<input type="text" name="${fd.name}" value="${val}" maxlength="200" ${req}>`;
  }
  const help = fd.type === 'patient' ? html`<small>${ui.icon('lock', 'xs')} Hospital code only — never record patient names.</small>` : '';
  return html`<label class="field${fd.wide ? ' wide' : ''}${err ? ' has-err' : ''}"${fd.showIf ? raw(` data-show-if="${fd.showIf}"`) : ''}><span>${fd.label}${fd.required ? html`<b class="req">*</b>` : ''}</span>${input}${err ? html`<em class="err">${err}</em>` : help}</label>`;
}

function activityForm(req, { formKey, values = {}, errors = {}, activity = null, candidate }) {
  const form = D.FORMS[formKey];
  const ctx = { supervisors: D.approvers(), defaultSupervisor: candidate.main_supervisor_id };
  const action = activity ? `/activities/${activity.id}/edit` : `/activities/new?form=${formKey}`;
  const files = activity ? all('SELECT * FROM attachments WHERE activity_id=?', activity.id) : [];
  const tabs = !activity ? html`<div class="type-picker">${Object.entries(D.FORMS).map(([k, f]) => html`<a class="type-opt${k === formKey ? ' on' : ''}" href="/activities/new?form=${k}"><span>${ui.icon(f.icon)}</span><div><strong>${f.label}</strong><em>${f.blurb}</em></div></a>`)}</div>` : '';
  return html`${tabs}
  <form class="card form-card" method="post" action="${action}" enctype="multipart/form-data">
    ${ui.csrf(req)}<input type="hidden" name="form" value="${formKey}">
    <header class="card-head"><div class="form-title"><span class="act-ic lg">${ui.icon(form.icon)}</span><div><h2>${form.label}</h2><p>${activity ? 'Update the details below and resubmit for approval.' : 'Fields marked * are required. Your supervisor will be notified when you submit.'}</p></div></div></header>
    ${activity?.status === 'correction' && activity.staff_comment ? html`<div class="callout warn">${ui.icon('rotate')}<div><strong>Correction requested by ${activity.reviewer_name || 'supervisor'}</strong><p>${activity.staff_comment}</p></div></div>` : ''}
    ${Object.keys(errors).length ? html`<div class="flash flash-danger">${ui.icon('xCircle')}<span>Please fix the highlighted fields.</span></div>` : ''}
    <div class="form-grid">
      ${form.fields.map((fd) => fieldHtml(fd, values, errors[fd.name], ctx))}
      <div class="field wide"><span>Evidence (optional)</span>
        <label class="drop">${ui.icon('paperclip')}<div><strong>Attach files</strong><em>PDF, images or Word — up to 10 MB each, max 5 files</em></div><input type="file" name="evidence" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" data-file-input></label>
        <div class="file-names" data-file-names></div>
        ${files.length ? html`<ul class="files">${files.map((f) => html`<li>${ui.icon('file')}<a href="/files/${f.id}" target="_blank">${f.file_name}</a><label class="rm"><input type="checkbox" name="remove_file" value="${f.id}"> Remove</label></li>`)}</ul>` : ''}
      </div>
    </div>
    <datalist id="locations">${D.list('locations').map((l) => html`<option value="${l}">`)}</datalist>
    <footer class="form-foot">
      <a class="btn ghost" href="${activity ? `/activities/${activity.id}` : '/logbook'}">Cancel</a>
      <div class="spacer"></div>
      <button class="btn" name="action" value="draft">${ui.icon('file')} Save as draft</button>
      <button class="btn primary" name="action" value="submit">${ui.icon('send')} ${activity?.status === 'correction' ? 'Resubmit for approval' : 'Submit for approval'}</button>
    </footer>
  </form>`;
}

function validate(formKey, body, candidate) {
  const form = D.FORMS[formKey];
  const errors = {}, values = {};
  const sups = D.approvers().map((s) => String(s.id));
  for (const fd of form.fields) {
    let v = String(body[fd.name] ?? '').trim();
    values[fd.name] = v;
    if (fd.showIf) { const [k, want] = fd.showIf.split('='); if (String(body[k]) !== want) { values[fd.name] = ''; continue; } if (!v) { errors[fd.name] = 'Please enter the name.'; continue; } }
    if (fd.required && !v) { errors[fd.name] = 'This field is required.'; continue; }
    if (!v) continue;
    if (fd.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[fd.name] = 'Invalid date.';
      else if (v > today()) errors[fd.name] = 'Date cannot be in the future.';
      else if (candidate.training_start_date && v < candidate.training_start_date) errors[fd.name] = `Date is before your training start (${fmtDate(candidate.training_start_date)}).`;
    }
    if (fd.type === 'number') { const n = Number(v); if (!Number.isInteger(n) || n < (fd.min ?? 0) || n > (fd.max ?? 9999)) errors[fd.name] = `Enter a whole number between ${fd.min ?? 0} and ${fd.max ?? 9999}.`; }
    if (fd.type === 'supervisor' && !sups.includes(v)) errors[fd.name] = 'Choose a supervisor from the list.';
    if (fd.type === 'patient' && (!/\d/.test(v) || !/^[A-Za-z0-9\-/,\s]+$/.test(v))) errors[fd.name] = 'Use the hospital patient code (letters/digits, must contain digits). Do not enter names.';
    if (fd.type === 'select' && !fd.options().includes(v)) errors[fd.name] = 'Choose a value from the list.';
  }
  return { errors, values };
}

function saveFiles(req, activityId) {
  const files = (req.files.evidence || []).slice(0, 5);
  const allowed = /\.(pdf|png|jpe?g|webp|docx?)$/i;
  const errors = [];
  for (const f of files) {
    if (!allowed.test(f.filename)) { errors.push(`${f.filename}: file type not allowed`); continue; }
    if (f.data.length > 10 * 1024 * 1024) { errors.push(`${f.filename}: larger than 10 MB`); continue; }
    const stored = `${activityId}-${crypto.randomBytes(8).toString('hex')}${path.extname(f.filename).toLowerCase()}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.data);
    const id = run('INSERT INTO attachments(activity_id, file_name, file_path, mime, size, uploaded_at) VALUES (?,?,?,?,?,?)', activityId, f.filename, stored, f.mime, f.data.length, nowTs()).lastInsertRowid;
    D.audit(req, 'attachment.upload', 'attachments', Number(id), null, { activity_id: activityId, file: f.filename });
  }
  for (const rid of [].concat(req.body.remove_file || [])) {
    const f = one('SELECT * FROM attachments WHERE id=? AND activity_id=?', rid, activityId);
    if (f) { run('DELETE FROM attachments WHERE id=?', f.id); try { fs.unlinkSync(path.join(UPLOAD_DIR, f.file_path)); } catch {} D.audit(req, 'attachment.delete', 'attachments', f.id, { file: f.file_name }, null); }
  }
  return errors;
}

function persist(req, { formKey, values, candidate, existing }) {
  const form = D.FORMS[formKey];
  const submit = req.body.action === 'submit';
  const details = {};
  for (const fd of form.fields) if (fd.detail && values[fd.name] !== '') details[fd.name] = fd.type === 'number' ? Number(values[fd.name]) : values[fd.name];
  const type = D.typeByCode(form.typeFor(values));
  const rec = {
    activity_type_id: type.id, form: formKey, title: String(form.title(values) || form.label).slice(0, 200), activity_date: values.activity_date,
    location: values.location || null, supervisor_id: Number(values.supervisor_id), candidate_role: values.candidate_role || form.role || null,
    description: values.description || null, count_value: Number(values.count_value || 1), details: JSON.stringify(details),
  };
  const now = nowTs();
  let id;
  tx(() => {
    if (existing) {
      id = existing.id;
      const status = submit ? 'pending' : existing.status;
      run(`UPDATE activities SET activity_type_id=?, form=?, title=?, activity_date=?, location=?, supervisor_id=?, candidate_role=?, description=?, count_value=?, details=?, status=?, submitted_at=COALESCE(?, submitted_at), updated_at=? WHERE id=?`,
        rec.activity_type_id, rec.form, rec.title, rec.activity_date, rec.location, rec.supervisor_id, rec.candidate_role, rec.description, rec.count_value, rec.details, status, submit ? now : null, now, id);
      D.audit(req, submit ? 'activity.resubmit' : 'activity.update', 'activities', id, pick(existing), rec);
      if (submit) run('INSERT INTO activity_reviews(activity_id,user_id,action,created_at) VALUES (?,?,?,?)', id, req.user.id, existing.status === 'correction' ? 'resubmitted' : 'submitted', now);
    } else {
      id = Number(run(`INSERT INTO activities(candidate_id, activity_type_id, form, title, activity_date, location, supervisor_id, candidate_role, description, count_value, details, training_year, status, submitted_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, candidate.id, rec.activity_type_id, rec.form, rec.title, rec.activity_date, rec.location, rec.supervisor_id, rec.candidate_role, rec.description, rec.count_value, rec.details, candidate.training_year, submit ? 'pending' : 'draft', submit ? now : null, now, now).lastInsertRowid);
      D.audit(req, submit ? 'activity.submit' : 'activity.draft', 'activities', id, null, rec);
      if (submit) run('INSERT INTO activity_reviews(activity_id,user_id,action,created_at) VALUES (?,?,?,?)', id, req.user.id, 'submitted', now);
    }
  });
  if (submit) {
    const sup = one('SELECT user_id FROM staff WHERE id=?', rec.supervisor_id);
    const resub = existing?.status === 'correction';
    D.notify(sup?.user_id, { kind: 'info', title: resub ? 'Corrected activity resubmitted' : 'New activity needs approval', body: `${candidate.name}: ${rec.title} (${fmtDate(rec.activity_date)})`, link: `/activities/${id}?from=pending` });
  }
  return { id, submit };
}
const pick = (a) => ({ title: a.title, activity_date: a.activity_date, supervisor_id: a.supervisor_id, candidate_role: a.candidate_role, status: a.status, count_value: a.count_value, details: a.details });

// ---------- Routes: create / edit ----------
get('/activities/new', { roles: ['candidate'] }, (req, res) => {
  const candidate = D.candidateByUser(req.user.id);
  let formKey = D.FORMS[req.query.form] ? req.query.form : 'clinic';
  let values = {};
  if (req.query.from) {
    const src = getActivity(req.query.from);
    if (src && src.cand_user === req.user.id) { formKey = src.form; values = { ...JSON.parse(src.details || '{}'), ...src, activity_date: today() }; values.supervisor_id = src.supervisor_id; }
  }
  res.html(ui.layout(req, {
    title: 'Add Activity', subtitle: 'Choose the activity type, fill in the details and submit for supervisor approval.',
    crumbs: [['/candidate', 'Dashboard'], [null, 'Add activity']],
    body: activityForm(req, { formKey, values, candidate }),
  }));
});

post('/activities/new', { roles: ['candidate'] }, (req, res) => {
  const candidate = D.candidateByUser(req.user.id);
  const formKey = D.FORMS[req.body.form] ? req.body.form : 'clinic';
  if (candidate.status !== 'active') { req.flash('danger', `Your training status is "${candidate.status}" — new entries are disabled.`); return res.redirect('/candidate'); }
  const { errors, values } = validate(formKey, req.body, candidate);
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: 'Add Activity', crumbs: [['/candidate', 'Dashboard'], [null, 'Add activity']], body: activityForm(req, { formKey, values, errors, candidate }) }), 422);
  const { id, submit } = persist(req, { formKey, values, candidate });
  const ferr = saveFiles(req, id);
  if (ferr.length) req.flash('warning', `Some files were skipped: ${ferr.join('; ')}`);
  req.flash('success', submit ? 'Activity submitted — your supervisor has been notified.' : 'Draft saved. Submit it when ready.');
  res.redirect(req.body.again ? `/activities/new?form=${formKey}` : `/activities/${id}`);
});

function editable(req, a) { return a && a.cand_user === req.user.id && ['draft', 'correction'].includes(a.status); }

get('/activities/:id/edit', { roles: ['candidate'] }, (req, res) => {
  const a = getActivity(req.params.id);
  if (!editable(req, a)) { req.flash('warning', 'Only drafts and activities returned for correction can be edited.'); return res.redirect(a ? `/activities/${a.id}` : '/logbook'); }
  const candidate = D.candidateByUser(req.user.id);
  const values = { ...a, ...JSON.parse(a.details || '{}') };
  res.html(ui.layout(req, { title: 'Edit Activity', crumbs: [['/logbook', 'My Logbook'], [`/activities/${a.id}`, a.title], [null, 'Edit']], body: activityForm(req, { formKey: a.form, values, activity: a, candidate }) }));
});

post('/activities/:id/edit', { roles: ['candidate'] }, (req, res) => {
  const a = getActivity(req.params.id);
  if (!editable(req, a)) return res.redirect('/logbook');
  const candidate = D.candidateByUser(req.user.id);
  const { errors, values } = validate(a.form, req.body, candidate);
  if (Object.keys(errors).length) return res.html(ui.layout(req, { title: 'Edit Activity', body: activityForm(req, { formKey: a.form, values, errors, activity: a, candidate }) }), 422);
  const { submit } = persist(req, { formKey: a.form, values, candidate, existing: a });
  const ferr = saveFiles(req, a.id);
  if (ferr.length) req.flash('warning', `Some files were skipped: ${ferr.join('; ')}`);
  req.flash('success', submit ? 'Activity submitted for approval.' : 'Changes saved.');
  res.redirect(`/activities/${a.id}`);
});

post('/activities/:id/delete', { roles: ['candidate'] }, (req, res) => {
  const a = getActivity(req.params.id);
  if (!a || a.cand_user !== req.user.id || a.status !== 'draft') { req.flash('danger', 'Only drafts can be deleted.'); return res.redirect('/logbook'); }
  for (const f of all('SELECT * FROM attachments WHERE activity_id=?', a.id)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.file_path)); } catch {} }
  run('DELETE FROM activities WHERE id=?', a.id);
  D.audit(req, 'activity.delete', 'activities', a.id, pick(a), null);
  req.flash('success', 'Draft deleted.');
  res.redirect('/logbook');
});

// ---------- Detail + review ----------
const ACTION_LABEL = { submitted: ['Submitted for approval', 'send', 'info'], resubmitted: ['Resubmitted after correction', 'rotate', 'info'], approved: ['Approved', 'checkCircle', 'success'], rejected: ['Rejected', 'xCircle', 'danger'], correction: ['Correction requested', 'rotate', 'warning'] };
const DETAIL_LABELS = { clinic_type: 'Clinic type', patients_seen: 'Patients seen', operation_name: 'Operation', procedure_name: 'Procedure', other_title: 'Specified name', patient_code: 'Patient code', patient_age: 'Patient age', diagnosis_category: 'Diagnosis category', teaching_type: 'Type of teaching', lecturer: 'Lecturer' };

get('/activities/:id', (req, res) => {
  const a = getActivity(req.params.id);
  if (!a || !canView(req, a)) return res.html(ui.layout(req, { title: 'Not found', body: ui.empty('Activity not found', 'It may have been deleted, or you do not have access to it.') }), 404);
  const details = JSON.parse(a.details || '{}');
  const files = all('SELECT * FROM attachments WHERE activity_id=?', a.id);
  const history = all('SELECT r.*, u.name FROM activity_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE activity_id=? ORDER BY r.created_at, r.id', a.id);
  const kv = (k, v) => (v === '' || v == null ? '' : html`<div class="kv"><span>${k}</span><strong>${v}</strong></div>`);
  const isOwner = a.cand_user === req.user.id;
  const reviewable = canReview(req, a);
  const cand = D.getCandidate(a.candidate_id);

  const main = ui.card('', html`
    <div class="act-hero"><span class="act-ic xl">${ui.icon(ui.typeIcon(a.form))}</span><div><div class="eyebrow">${a.type_name}</div><h2>${a.title}</h2><div class="act-meta">${ui.badge(a.status)}<span>${ui.icon('calendar', 'xs')} ${fmtDate(a.activity_date)}</span><span>${ui.icon('user', 'xs')} ${a.candidate_role || '—'}</span></div></div></div>
    <div class="kv-grid">
      ${kv('Candidate', a.candidate_name)}${kv('Program', a.program_type)}${kv('Supervisor', a.supervisor_name)}${kv('Location', a.location)}
      ${kv('Count', a.count_value)}${kv('Training year', a.training_year ? `Year ${a.training_year}` : '')}
      ${Object.entries(details).filter(([k]) => !(k === 'operation_name' || k === 'procedure_name') || details.other_title == null).map(([k, v]) => kv(DETAIL_LABELS[k] || k, v))}
      ${kv('Submitted', a.submitted_at ? fmtDateTime(a.submitted_at) : 'Not yet submitted')}${kv('Last edited', fmtDateTime(a.updated_at))}
      ${a.approved_at ? kv(a.status === 'approved' ? 'Approved' : 'Reviewed', `${fmtDateTime(a.approved_at)} by ${a.reviewer_name || '—'}`) : ''}
    </div>
    ${a.description ? html`<div class="desc"><span>Notes</span><p>${a.description}</p></div>` : ''}
    ${a.staff_comment ? html`<div class="callout ${a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : 'warn'}">${ui.icon('mail')}<div><strong>Supervisor comment${a.reviewer_name ? ` — ${a.reviewer_name}` : ''}</strong><p>${a.staff_comment}</p></div></div>` : ''}
    <div class="evidence"><h3>${ui.icon('paperclip')} Evidence</h3>${files.length ? html`<ul class="files">${files.map((f) => html`<li>${ui.icon('file')}<a href="/files/${f.id}" target="_blank">${f.file_name}</a><em>${Math.ceil((f.size || 0) / 1024)} KB · ${fmtDate(f.uploaded_at)}</em></li>`)}</ul>` : html`<p class="muted">No files attached.</p>`}</div>
  `);

  const review = reviewable ? ui.card('Review decision', html`<form method="post" action="/activities/${a.id}/review" class="form-stack review-form">${ui.csrf(req)}<input type="hidden" name="from" value="${req.query.from || ''}">
      <label class="field"><span>Comment to candidate</span><textarea name="comment" rows="4" maxlength="1000" placeholder="Required when rejecting or requesting a correction"></textarea></label>
      <div class="decision">
        <button class="btn success" name="decision" value="approved">${ui.icon('check')} Approve</button>
        <button class="btn warn" name="decision" value="correction">${ui.icon('rotate')} Request correction</button>
        <button class="btn danger" name="decision" value="rejected">${ui.icon('x')} Reject</button>
      </div>
      <p class="hint">Approved activities count toward the candidate's requirements immediately. Every decision is recorded in the audit log.</p>
    </form>`, { cls: 'review-card' }) : '';

  const candCard = !isOwner && cand ? (() => {
    const p = D.candidateProgress(cand);
    return ui.card('Candidate', html`<div class="cand-mini">${ui.avatarName(cand.name, `${cand.program_type} · Year ${cand.training_year} · ${cand.university_id || ''}`)}${ui.riskBadge(p.risk)}</div>
      <div class="mini-prog"><span>Overall progress</span>${ui.bar(p.overall, { expected: p.expected })}</div>
      <a class="link-more" href="/candidates/${cand.id}">View full profile ${ui.icon('arrowRight', 'xs')}</a>`);
  })() : '';

  const timeline = ui.card('History', history.length ? html`<ol class="timeline">${history.map((h) => { const [l, ic, tone] = ACTION_LABEL[h.action] || [h.action, 'clock', 'info']; return html`<li><span class="tl-ic t-${tone}">${ui.icon(ic)}</span><div><strong>${l}</strong><span>${h.name || 'System'} · ${fmtDateTime(h.created_at)}</span>${h.comment ? html`<p>“${h.comment}”</p>` : ''}</div></li>`; })}</ol>` : html`<p class="muted pad">Draft — not yet submitted.</p>`);

  const actions = isOwner ? html`
    ${editable(req, a) ? html`<a class="btn primary" href="/activities/${a.id}/edit">${ui.icon('edit')} ${a.status === 'correction' ? 'Correct & resubmit' : 'Edit draft'}</a>` : ''}
    <a class="btn" href="/activities/new?from=${a.id}">${ui.icon('plus')} Duplicate</a>
    ${a.status === 'draft' ? html`<form method="post" action="/activities/${a.id}/delete">${ui.csrf(req)}<button class="btn ghost danger-text" data-confirm="Delete this draft permanently?">${ui.icon('trash')} Delete</button></form>` : ''}` : '';
  const back = req.query.from === 'pending' ? ['/staff/pending', 'Pending approvals'] : req.user.role === 'candidate' ? ['/logbook', 'My Logbook'] : req.user.role === 'manager' ? ['/admin/activities', 'Activities'] : ['/staff/approved', 'Activities'];
  res.html(ui.layout(req, {
    title: 'Activity details', crumbs: [back, [null, `#${a.id}`]], actions,
    body: html`<div class="grid g-2-1"><div class="stack">${main}</div><div class="stack">${review}${candCard}${timeline}</div></div>`,
  }));
});

function decide(req, a, decision, comment) {
  const st = D.staffByUser(req.user.id);
  const now = nowTs();
  tx(() => {
    run('UPDATE activities SET status=?, approved_by=?, approved_at=?, staff_comment=?, updated_at=? WHERE id=?', decision, st?.id ?? null, now, comment || null, now, a.id);
    run('INSERT INTO activity_reviews(activity_id,user_id,action,comment,created_at) VALUES (?,?,?,?,?)', a.id, req.user.id, decision, comment || null, now);
    D.audit(req, `activity.${decision}`, 'activities', a.id, { status: a.status }, { status: decision, comment });
  });
  const msg = { approved: ['success', 'Activity approved', 'It now counts toward your requirements.'], rejected: ['danger', 'Activity rejected', comment], correction: ['warning', 'Correction requested', comment] }[decision];
  D.notify(a.cand_user, { kind: msg[0], title: `${msg[1]}: ${a.title}`, body: `${msg[2] || ''}${req.user.name ? ` — ${req.user.name}` : ''}`, link: `/activities/${a.id}` });
}

post('/activities/:id/review', { roles: ['staff', 'manager'] }, (req, res) => {
  const a = getActivity(req.params.id);
  if (!a || !canReview(req, a)) { req.flash('danger', 'This activity is no longer awaiting your review.'); return res.redirect('/staff/pending'); }
  const decision = req.body.decision;
  const comment = String(req.body.comment || '').trim().slice(0, 1000);
  if (!['approved', 'rejected', 'correction'].includes(decision)) return res.redirect(`/activities/${a.id}`);
  if (decision !== 'approved' && !comment) { req.flash('danger', 'Please add a comment explaining the rejection or the correction needed.'); return res.redirect(`/activities/${a.id}?from=${req.body.from || ''}`); }
  decide(req, a, decision, comment);
  req.flash('success', `${D.STATUS[decision].label}: ${a.candidate_name} — ${a.title}.`);
  if (req.body.from === 'pending') {
    const st = D.staffByUser(req.user.id);
    const next = req.user.role === 'manager' ? one("SELECT id FROM activities WHERE status='pending' ORDER BY submitted_at LIMIT 1") : one("SELECT id FROM activities WHERE status='pending' AND supervisor_id=? ORDER BY submitted_at LIMIT 1", st?.id);
    return res.redirect(next ? `/activities/${next.id}?from=pending` : '/staff/pending');
  }
  res.redirect(`/activities/${a.id}`);
});

post('/activities/bulk-approve', { roles: ['staff', 'manager'] }, (req, res) => {
  const ids = [].concat(req.body.ids || []);
  let n = 0;
  for (const id of ids) { const a = getActivity(id); if (a && canReview(req, a)) { decide(req, a, 'approved', String(req.body.comment || '').trim()); n++; } }
  req.flash(n ? 'success' : 'warning', n ? `${n} activit${n === 1 ? 'y' : 'ies'} approved.` : 'Select at least one pending activity.');
  res.redirect(req.body.back && String(req.body.back).startsWith('/') ? req.body.back : '/staff/pending');
});

module.exports = { ACT_SQL, getActivity, listActivities, filterBar, activityTable, buildFilter, canView };
