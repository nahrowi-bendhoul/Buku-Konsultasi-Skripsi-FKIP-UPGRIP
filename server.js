'use strict';
/* Server Buku Konsultasi Skripsi FKIP UPGRIP. Tanpa dependensi: cukup Node.js 18 ke atas.
   Peran: admin (prodi), dosen, mhs (mahasiswa). Data di DATA_DIR/db.json. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const TRUST = process.env.TRUST_PROXY === '1';
const SESSION_MS = 7 * 24 * 3600 * 1000;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DBF = path.join(DATA_DIR, 'db.json');
const SIGD = path.join(DATA_DIR, 'sig'); fs.mkdirSync(SIGD, { recursive: true });

/* ---------- penyimpanan ---------- */
let db = { users: {}, entries: [], sessions: {}, secret: crypto.randomBytes(32).toString('hex'), seq: 1 };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') { console.error('db.json rusak:', e.message); process.exit(1); } }
let dirty = false, wt = null, lastBackup = '';
function save(now) { dirty = true; if (now) return flush(); if (!wt) wt = setTimeout(flush, 250); }
function flush() {
  clearTimeout(wt); wt = null; if (!dirty) return; dirty = false;
  const t = DBF + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DBF);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackup) { lastBackup = day; try { fs.copyFileSync(DBF, path.join(DATA_DIR, 'cadangan-' + day + '.json')); const olds = fs.readdirSync(DATA_DIR).filter(f => /^cadangan-/.test(f)).sort(); olds.slice(0, -14).forEach(f => fs.unlinkSync(path.join(DATA_DIR, f))); } catch (e) { } }
}
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

/* ---------- util ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));
async function hashPw(pw) { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(pw, s)).toString('hex'); }
async function checkPw(pw, st) { const [s, h] = String(st).split(':'); const k = await scrypt(pw, Buffer.from(s, 'hex')); const a = Buffer.from(h, 'hex'); return a.length === k.length && crypto.timingSafeEqual(a, k); }
const DUMMY = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tempPw = () => Array.from(crypto.randomBytes(9), b => ALPHA[b % ALPHA.length]).join('');
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/;
const kodeOf = id => { const h = crypto.createHmac('sha256', db.secret).update('entry:' + id).digest(); return Array.from(h.subarray(0, 8), b => ALPHA[b % 32]).join(''); };
const maskNim = n => n.length <= 4 ? '****' : n.slice(0, 2) + '*'.repeat(n.length - 4) + n.slice(-2);
const userByName = u => Object.values(db.users).find(x => x.username === u);
const pub = u => ({ id: u.id, username: u.username, role: u.role, nama: u.nama, nim: u.nim || '', p1: u.p1 || '', p2: u.p2 || '', v: u.v || '', mustChange: !!u.mustChange, hasSig: !!u.sig });

/* ---------- pembatas laju ---------- */
const hits = new Map();
function limit(key, max, ms) { const n = Date.now(), r = hits.get(key); if (!r || r.reset < n) { hits.set(key, { n: 1, reset: n + ms }); return true; } r.n++; return r.n <= max; }
setInterval(() => { const n = Date.now(); for (const [k, r] of hits) if (r.reset < n) hits.delete(k); for (const [k, s] of Object.entries(db.sessions)) if (s.exp < n) delete db.sessions[k]; save(); }, 600000).unref();
const ipOf = req => (TRUST && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

/* ---------- HTTP dasar ---------- */
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function baseHeaders(h) { return Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' }, h || {}); }
function send(res, code, obj, extra) { const b = JSON.stringify(obj); res.writeHead(code, baseHeaders(Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra))); res.end(b); }
const fail = (res, code, msg, extra) => send(res, code, Object.assign({ error: msg }, extra));
function body(req) {
  return new Promise((ok, no) => {
    let n = 0; const c = [];
    req.on('data', d => { n += d.length; if (n > 1048576) { no(Object.assign(new Error('terlalu_besar'), { status: 413 })); req.destroy(); } else c.push(d); });
    req.on('end', () => { if (!c.length) return ok({}); try { const j = JSON.parse(Buffer.concat(c).toString('utf8')); ok(j && typeof j === 'object' ? j : {}); } catch (e) { no(Object.assign(new Error('json_salah'), { status: 400 })); } });
    req.on('error', no);
  });
}
const isHttps = req => !!req.socket.encrypted || (TRUST && req.headers['x-forwarded-proto'] === 'https');
const cookieOf = (req, n) => { const m = String(req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(n + '=')); return m ? m.slice(n.length + 1) : ''; };
function sessionOf(req) { const t = cookieOf(req, 'bk_sess'); if (!t) return null; const s = db.sessions[sha(t)]; if (!s || s.exp < Date.now()) return null; const u = db.users[s.uid]; return u ? { user: u, key: sha(t) } : null; }
function setSess(req, res, uid) {
  const t = crypto.randomBytes(32).toString('base64url'); db.sessions[sha(t)] = { uid, exp: Date.now() + SESSION_MS }; save();
  return 'bk_sess=' + t + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_MS / 1000) + (isHttps(req) ? '; Secure' : '');
}
const clearCookie = req => 'bk_sess=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (isHttps(req) ? '; Secure' : '');

/* ---------- API ---------- */
const USERNAME = /^[a-z0-9._@-]{3,40}$/, NIMRE = /^[A-Za-z0-9._-]{3,30}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
function goodPw(pw, u) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 100 && pw.toLowerCase() !== (u.username || '').toLowerCase(); }
/* gambar paraf disimpan sebagai berkas terpisah (db.json tetap kecil) */
function putSig(s) { if (!s) return ''; const h = sha(s), f = path.join(SIGD, h); if (!fs.existsSync(f)) fs.writeFileSync(f, s); return h; }
const sigCache = new Map();
function getSig(h) { if (!h || !/^[0-9a-f]{64}$/.test(h)) return ''; if (sigCache.has(h)) return sigCache.get(h); let s = ''; try { s = fs.readFileSync(path.join(SIGD, h), 'utf8'); } catch (e) { } if (sigCache.size > 300) sigCache.clear(); sigCache.set(h, s); return s; }
const entryOut = e => ({ id: e.id, nim: e.nim, peran: e.peran, dosen: e.dosenNama, tgl: e.tgl, topik: e.topik, saran: e.saran, sig: getSig(e.sigH), kode: e.kode, ts: e.ts });

async function createUser(spec) {
  const role = ['dosen', 'mhs', 'admin'].includes(spec.role) ? spec.role : null; if (!role) return { error: 'peran_salah' };
  const nama = str(spec.nama, 80); if (!nama) return { error: 'nama_kosong' };
  let username = String(spec.username || '').trim().toLowerCase(), nim = '';
  if (role === 'mhs') { nim = str(spec.nim, 30).toUpperCase(); if (!NIMRE.test(nim)) return { error: 'nim_salah' }; username = nim.toLowerCase(); }
  if (!USERNAME.test(username)) return { error: 'username_salah' };
  if (userByName(username)) return { error: 'sudah_ada' };
  const pw = tempPw(), id = 'u' + (db.seq++);
  const u = { id, username, role, nama, nim, hash: await hashPw(pw), mustChange: true, created: Date.now() };
  if (role === 'mhs') { u.p1 = str(spec.p1, 40).toLowerCase(); u.p2 = str(spec.p2, 40).toLowerCase(); u.v = str(spec.v, 40).toLowerCase(); }
  db.users[id] = u; save();
  return { user: pub(u), tempPassword: pw };
}

async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m !== 'GET' && m !== 'HEAD' && (req.headers['x-bk'] !== '1' || !/^application\/json/.test(req.headers['content-type'] || ''))) return fail(res, 400, 'permintaan_tidak_valid');
  if (p === '/api/ping' && m === 'GET') return send(res, 200, { bk: 1, in: !!sessionOf(req) });

  if (p === '/api/login' && m === 'POST') {
    const b = await body(req), un = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
    const ip = ipOf(req);
    if (!limit('ip:' + ip, 300, 600000) || !limit('u:' + ip + ':' + un, 8, 600000)) return fail(res, 429, 'terlalu_banyak_percobaan');
    const u = userByName(un); const ok = await checkPw(pw.slice(0, 200), u ? u.hash : DUMMY);
    if (!u || !ok) return fail(res, 401, 'login_gagal');
    const ck = setSess(req, res, u.id); return send(res, 200, { user: pub(u) }, { 'Set-Cookie': ck });
  }
  if (p === '/api/verify' || p.startsWith('/api/verify/')) {
    if (m !== 'GET') return fail(res, 405, 'metode');
    if (!limit('v:' + ipOf(req), 40, 600000)) return fail(res, 429, 'terlalu_banyak_percobaan');
    const kode = decodeURIComponent(p.slice('/api/verify/'.length)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const e = kode.length === 8 && db.entries.find(x => x.kode === kode);
    if (!e) return fail(res, 404, 'tidak_ditemukan');
    return send(res, 200, { ok: true, kode, peran: e.peran, dosen: e.dosenNama, nim: maskNim(e.nim), tgl: e.tgl, topik: e.topik, saran: e.saran.slice(0, 300), ts: e.ts });
  }

  const S = sessionOf(req);
  if (!S) return fail(res, 401, 'belum_login');
  const U = S.user;
  if (p === '/api/logout' && m === 'POST') { delete db.sessions[S.key]; save(); return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) }); }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: pub(U), sig: U.role === 'dosen' ? (U.sig || '') : undefined });
  if (p === '/api/password' && m === 'POST') {
    const b = await body(req);
    if (!limit('pw:' + U.id, 10, 600000)) return fail(res, 429, 'terlalu_banyak_percobaan');
    if (!(await checkPw(String(b.old || '').slice(0, 200), U.hash))) return fail(res, 403, 'sandi_lama_salah');
    if (!goodPw(b.neu, U)) return fail(res, 400, 'sandi_lemah');
    if (b.neu === b.old) return fail(res, 400, 'sandi_sama');
    U.hash = await hashPw(b.neu); U.mustChange = false;
    Object.keys(db.sessions).forEach(k => { if (db.sessions[k].uid === U.id && k !== S.key) delete db.sessions[k]; }); save();
    return send(res, 200, { ok: true });
  }
  if (U.mustChange) return fail(res, 403, 'ganti_password');

  /* mahasiswa */
  if (p === '/api/mhs/entries' && m === 'GET') {
    if (U.role !== 'mhs') return fail(res, 403, 'bukan_mahasiswa');
    return send(res, 200, { entries: db.entries.filter(e => e.nim === U.nim).sort((a, b) => a.ts - b.ts).map(entryOut) });
  }

  /* dosen */
  if (p.startsWith('/api/dosen/')) {
    if (U.role !== 'dosen') return fail(res, 403, 'bukan_dosen');
    const mine = () => Object.values(db.users).filter(x => x.role === 'mhs' && (x.p1 === U.username || x.p2 === U.username || x.v === U.username));
    const rolesOf = s => [s.p1 === U.username && 'P1', s.p2 === U.username && 'P2', s.v === U.username && 'V'].filter(Boolean);
    if (p === '/api/dosen/mahasiswa' && m === 'GET') return send(res, 200, { mahasiswa: mine().sort((a, b) => a.nama.localeCompare(b.nama)).map(s => ({ nim: s.nim, nama: s.nama, peran: rolesOf(s) })) });
    if (p === '/api/dosen/sig' && m === 'PUT') {
      const b = await body(req); const sg = String(b.sig || '');
      if (sg && (!IMG.test(sg) || sg.length > 200000)) return fail(res, 400, 'paraf_tidak_valid');
      if (sg) U.sig = sg; else delete U.sig; save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/dosen/entries' && m === 'POST') {
      const b = await body(req);
      if (!limit('en:' + U.id, 120, 3600000)) return fail(res, 429, 'terlalu_banyak_percobaan');
      const nim = str(b.nim, 30).toUpperCase(), s = Object.values(db.users).find(x => x.role === 'mhs' && x.nim === nim);
      if (!s) return fail(res, 404, 'mahasiswa_tidak_ada');
      const rs = rolesOf(s); if (!rs.length) return fail(res, 403, 'bukan_bimbingan_anda');
      const peran = b.peran ? String(b.peran) : (rs.length === 1 ? rs[0] : '');
      if (!rs.includes(peran)) return fail(res, 400, 'peran_salah');
      const tgl = DATE.test(String(b.tgl || '')) ? b.tgl : null; if (!tgl) return fail(res, 400, 'tanggal_salah');
      const saran = str(b.saran, 4000), topik = str(b.topik, 120), sig = String(b.sig || '');
      if (sig && (!IMG.test(sig) || sig.length > 200000)) return fail(res, 400, 'paraf_tidak_valid');
      if (!saran && !sig) return fail(res, 400, 'isi_kosong');
      const id = 'e' + (db.seq++), e = { id, nim, peran, dosenId: U.id, dosenNama: U.nama, tgl, topik, saran, sigH: putSig(sig), ts: Date.now() };
      e.kode = kodeOf(id); db.entries.push(e); save(true);
      return send(res, 201, { entry: entryOut(e) });
    }
    if (p === '/api/dosen/entries' && m === 'GET') {
      const nim = str(url.searchParams.get('nim'), 30).toUpperCase(), ms = mine();
      let list;
      if (nim) { if (!ms.some(s => s.nim === nim)) return fail(res, 403, 'bukan_bimbingan_anda'); list = db.entries.filter(e => e.nim === nim); }
      else list = db.entries.filter(e => e.dosenId === U.id);
      list = list.sort((a, b) => b.ts - a.ts).slice(0, 30);
      const nm = Object.fromEntries(Object.values(db.users).filter(x => x.role === 'mhs').map(x => [x.nim, x.nama]));
      return send(res, 200, { entries: list.map(e => Object.assign(entryOut(e), { mhs: nm[e.nim] || '' })) });
    }
    return fail(res, 404, 'tidak_ada');
  }

  /* admin */
  if (p.startsWith('/api/admin/')) {
    if (U.role !== 'admin') return fail(res, 403, 'bukan_admin');
    if (p === '/api/admin/users' && m === 'GET') return send(res, 200, { users: Object.values(db.users).map(pub).sort((a, b) => (a.role + a.nama).localeCompare(b.role + b.nama)) });
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await body(req); const list = Array.isArray(b.users) ? b.users.slice(0, 500) : [b];
      const out = [], errs = [];
      for (const s of list) { const r = await createUser(s); if (r.error) errs.push({ spec: str(s.nim || s.username || s.nama, 40), error: r.error }); else out.push(r); }
      return send(res, 200, { created: out, errors: errs });
    }
    const um = p.match(/^\/api\/admin\/users\/(u\d+)(\/reset)?$/);
    if (um) {
      const T = db.users[um[1]]; if (!T) return fail(res, 404, 'tidak_ada');
      if (um[2] && m === 'POST') { const pw = tempPw(); T.hash = await hashPw(pw); T.mustChange = true; Object.keys(db.sessions).forEach(k => { if (db.sessions[k].uid === T.id) delete db.sessions[k]; }); save(); return send(res, 200, { tempPassword: pw }); }
      if (m === 'PATCH') {
        const b = await body(req);
        if (b.nama !== undefined) { const n = str(b.nama, 80); if (n) T.nama = n; }
        if (T.role === 'mhs') ['p1', 'p2', 'v'].forEach(k => { if (b[k] !== undefined) T[k] = str(b[k], 40).toLowerCase(); });
        save(); return send(res, 200, { user: pub(T) });
      }
      if (m === 'DELETE') { if (T.id === U.id) return fail(res, 400, 'tidak_bisa_hapus_diri'); delete db.users[T.id]; Object.keys(db.sessions).forEach(k => { if (db.sessions[k].uid === T.id) delete db.sessions[k]; }); save(); return send(res, 200, { ok: true }); }
    }
    if (p === '/api/admin/entries' && m === 'GET') {
      const nim = str(url.searchParams.get('nim'), 30).toUpperCase();
      const list = (nim ? db.entries.filter(e => e.nim === nim) : db.entries).sort((a, b) => b.ts - a.ts).slice(0, 200);
      return send(res, 200, { entries: list.map(entryOut) });
    }
    const em = p.match(/^\/api\/admin\/entries\/(e\d+)$/);
    if (em && m === 'DELETE') { const i = db.entries.findIndex(e => e.id === em[1]); if (i < 0) return fail(res, 404, 'tidak_ada'); db.entries.splice(i, 1); save(); return send(res, 200, { ok: true }); }
    return fail(res, 404, 'tidak_ada');
  }
  return fail(res, 404, 'tidak_ada');
}

/* ---------- berkas statis (daftar putih) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const files = {};
function loadStatic() {
  fs.readdirSync(PUB).forEach(f => {
    const ext = path.extname(f), full = path.join(PUB, f); if (!TYPES[ext] || !fs.statSync(full).isFile()) return;
    const raw = fs.readFileSync(full), text = /^\.(html|js|json|webmanifest|txt)$/.test(ext);
    files['/' + f] = { raw, gz: text ? zlib.gzipSync(raw, { level: 6 }) : null, type: TYPES[ext], cache: f === 'index.html' || f === 'sw.js' || ext === '.html' ? 'no-cache' : 'public, max-age=86400' };
  });
  files['/'] = files['/index.html']; files['/admin'] = files['/admin.html']; files['/verifikasi'] = files['/verifikasi.html'];
}
loadStatic();
function serve(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, baseHeaders()); return res.end(); }
  const f = files[url.pathname]; if (!f) { res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })); return res.end('Tidak ditemukan'); }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, baseHeaders({ 'Content-Type': f.type, 'Cache-Control': f.cache, 'Vary': 'Accept-Encoding', 'Content-Length': (gz ? f.gz : f.raw).length, ...(gz ? { 'Content-Encoding': 'gzip' } : {}) }));
  res.end(req.method === 'HEAD' ? undefined : (gz ? f.gz : f.raw));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serve(req, res, url);
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.message);
    console.error('galat:', e); if (!res.headersSent) fail(res, 500, 'galat_server'); else res.end();
  }
});
server.requestTimeout = 30000; server.headersTimeout = 15000;

/* ---------- admin awal ---------- */
(async () => {
  if (!Object.values(db.users).some(u => u.role === 'admin')) {
    const pw = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8 ? process.env.ADMIN_PASSWORD : tempPw();
    const id = 'u' + (db.seq++);
    db.users[id] = { id, username: 'admin', role: 'admin', nama: 'Admin Prodi', nim: '', hash: await hashPw(pw), mustChange: true, created: Date.now() }; save(true);
    console.log('==============================================\nAKUN ADMIN DIBUAT\n  nama pengguna : admin\n  kata sandi    : ' + pw + '\n  (wajib diganti saat login pertama; ini hanya tampil sekali)\n==============================================');
  }
  server.listen(PORT, () => console.log('Server berjalan di port ' + PORT));
})();
module.exports = { server };
