'use strict';
// Small helpers: safe HTML templating, dates, formatting.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s == null ? '' : String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]));

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

// Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``.
function html(strings, ...vals) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < vals.length) out += render(vals[i]);
  }
  return new Raw(out);
}

const pad = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISODate(new Date());
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(s) {
  if (!s) return null;
  const str = String(s);
  const d = str.length <= 10 ? new Date(str + 'T00:00:00') : new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}
function fmtDate(s) {
  const d = parseDate(s);
  return d ? `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}
function fmtDateTime(s) {
  const d = parseDate(s);
  return d ? `${fmtDate(toISODate(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
}
function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return null;
  return (db - da) / 86400000;
}
function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return '—';
  const sec = (Date.now() - d) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(s);
}
const initials = (name) => String(name || '?').replace(/^(Prof\.|Dr\.)\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n) => `${Math.round(n || 0)}%`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

module.exports = { raw, esc, html, render, Raw, today, nowTs, toISODate, parseDate, fmtDate, fmtDateTime, daysBetween, timeAgo, initials, num, pct, clamp, qs, MONTHS };
