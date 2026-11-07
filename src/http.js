'use strict';
// Minimal web framework: routing, sessions, CSRF, body parsing (urlencoded + multipart), static files.
const fs = require('node:fs');
const path = require('node:path');
const { one, run, ROOT } = require('./db');
const { token } = require('./crypto');
const { nowTs } = require('./util');

const routes = [];
function add(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '\\/?$');
  routes.push({ method, re, keys, opts, handler });
}
const get = (p, o, h) => add('GET', p, o, h);
const post = (p, o, h) => add('POST', p, o, h);

const MAX_BODY = 20 * 1024 * 1024;
const SESSION_HOURS = 12;

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Upload too large (max 20 MB).'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function addField(obj, k, v) {
  if (k in obj) obj[k] = [].concat(obj[k], v); else obj[k] = v;
}

function parseMultipart(buf, boundary) {
  const fields = {}, files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  if (pos < 0) return { fields, files };
  pos += delim.length;
  while (pos < buf.length) {
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing --
    pos += 2; // CRLF
    const next = buf.indexOf(delim, pos);
    if (next < 0) break;
    const part = buf.subarray(pos, next - 2);
    const hEnd = part.indexOf('\r\n\r\n');
    if (hEnd >= 0) {
      const head = part.subarray(0, hEnd).toString('utf8');
      const body = part.subarray(hEnd + 4);
      const name = (/name="([^"]*)"/i.exec(head) || [])[1];
      const filename = (/filename="([^"]*)"/i.exec(head) || [])[1];
      const ctype = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
      if (name != null) {
        if (filename !== undefined) {
          if (filename && body.length) (files[name] ||= []).push({ filename: path.basename(filename.replace(/\\/g, '/')), mime: ctype || 'application/octet-stream', data: Buffer.from(body) });
        } else addField(fields, name, body.toString('utf8'));
      }
    }
    pos = next + delim.length;
  }
  return { fields, files };
}

async function parseBody(req) {
  const type = String(req.headers['content-type'] || '');
  const buf = await readBody(req);
  if (type.startsWith('multipart/form-data')) {
    const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    return b ? parseMultipart(buf, b[1] || b[2]) : { fields: {}, files: {} };
  }
  const fields = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) addField(fields, k, v);
  return { fields, files: {} };
}

// ---------- Sessions ----------
function loadSession(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  const s = one("SELECT * FROM sessions WHERE id=? AND expires_at > datetime('now')", sid);
  return s;
}
function expiry(hours) { return new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' '); }
function newSession(res, userId = null) {
  const id = token(24);
  run('INSERT INTO sessions(id, user_id, csrf, expires_at, created_at) VALUES (?,?,?,?,?)', id, userId, token(16), expiry(userId ? SESSION_HOURS : 2), nowTs());
  setCookie(res, id, userId ? SESSION_HOURS : 2);
  return one('SELECT * FROM sessions WHERE id=?', id);
}
function setCookie(res, id, hours) {
  res.setHeader('Set-Cookie', `sid=${id}; ${cookieAttrs(res.req)}; Max-Age=${Math.round(hours * 3600)}`);
}

// Over HTTPS the cookie is SameSite=None + Partitioned so sign-in also works when the app is embedded (e.g. in Google Sites).
function cookieAttrs(req) {
  return req.secure ? 'HttpOnly; Path=/; Secure; SameSite=None; Partitioned' : 'HttpOnly; Path=/; SameSite=Lax';
}

// ---------- Static ----------
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
function serveStatic(req, res) {
  const rel = decodeURIComponent(req.path.replace(/^\/public\//, ''));
  const file = path.join(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

// ---------- Main handler ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; form-action 'self'; frame-ancestors ${process.env.FRAME_ANCESTORS || "'self' https://sites.google.com https://*.googleusercontent.com https://*.google.com"}; base-uri 'self'`,
};

function createHandler({ renderError, onUser }) {
  return async function handle(req, res) {
    res.req = req;
    const url = new URL(req.url, 'http://local');
    req.path = url.pathname;
    req.query = Object.fromEntries(url.searchParams);
    req.ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    req.secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

    res.html = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(String(body)); };
    res.redirect = (to) => { res.writeHead(303, { Location: to }); res.end(); };
    res.send = (buf, { type, filename, inline = false }) => {
      res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(filename).replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'no-store' });
      res.end(buf);
    };
    req.flash = (type, msg) => {
      if (!req.session) return;
      const list = JSON.parse(req.session.flash || '[]'); list.push({ type, msg });
      req.session.flash = JSON.stringify(list);
      run('UPDATE sessions SET flash=? WHERE id=?', req.session.flash, req.session.id);
    };
    req.takeFlash = () => {
      if (!req.session?.flash) return [];
      const list = JSON.parse(req.session.flash);
      run('UPDATE sessions SET flash=NULL WHERE id=?', req.session.id);
      req.session.flash = null;
      return list;
    };

    try {
      if (req.path.startsWith('/public/')) return serveStatic(req, res);
      if (req.path === '/favicon.ico') { req.path = '/public/favicon.svg'; return serveStatic(req, res); }

      let match = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(req.path);
        if (m) { match = r; req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); break; }
      }
      req.session = loadSession(req) || newSession(res);
      if (req.session.user_id) {
        req.user = one("SELECT * FROM users WHERE id=? AND status='active'", req.session.user_id);
        if (req.user) onUser?.(req);
      }
      if (!match) return res.html(renderError(req, 404, 'Page not found', 'The page you requested does not exist.'), 404);
      const { opts } = match;

      if (opts.auth !== false && !req.user) return res.redirect('/login' + (req.method === 'GET' ? `?next=${encodeURIComponent(req.url)}` : ''));
      if (opts.roles && !opts.roles.includes(req.user.role)) return res.html(renderError(req, 403, 'Access denied', 'Your account does not have permission to view this page.'), 403);
      if (req.user?.must_change_password && !['/profile', '/logout'].includes(req.path)) {
        req.flash('warning', 'Please set a new password before continuing.');
        return res.redirect('/profile');
      }
      if (req.method === 'POST') {
        const { fields, files } = await parseBody(req);
        req.body = fields; req.files = files;
        if (fields._csrf !== req.session.csrf) {
          // Stale form (e.g. the server restarted): send the user back instead of showing an error page.
          if (req.path === '/login') return res.redirect('/login?expired=1');
          req.flash('warning', 'Your session expired, so that action was not saved. Please try again.');
          const ref = String(req.headers.referer || '').replace(/^https?:\/\/[^/]+/, '');
          return res.redirect(ref.startsWith('/') && !ref.startsWith('//') ? ref : '/');
        }
      } else { req.body = {}; req.files = {}; }
      await match.handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.html(renderError(req, err.status || 500, err.status === 413 ? 'Upload too large' : 'Something went wrong', err.status ? err.message : 'An unexpected error occurred. It has been logged.'), err.status || 500);
    }
  };
}

module.exports = { get, post, createHandler, newSession, setCookie, cookieAttrs };
