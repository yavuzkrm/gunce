const path = require('path');
const crypto = require('crypto');
const express = require('express');

const SESSION_COOKIE = 'gunce_sid';
const SESSION_DAYS = 60;
const COLORS = ['peach', 'pink', 'lavender', 'mint', 'sky', 'butter', 'sage', 'coral'];
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- small helpers ----------

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function inviteCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
// Dates are plain strings so any year from 0001 to 9999 works the same way.
function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function str(v, max, { required = false, field = 'field' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail(400, `invalid_${field}`);
  v = v.trim();
  if (required && !v) fail(400, `missing_${field}`);
  if (v.length > max) fail(400, `too_long_${field}`);
  return v;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.count > max) return res.status(429).json({ error: 'too_many_attempts' });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

// ---------- app ----------

function createApp(db, { secureCookies = false, authRateLimit = 30 } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, display_name, password_hash, avatar, lang) VALUES (?, ?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertJournal: db.prepare('INSERT INTO journals (name, emoji, color, kind, owner_id, invite_code) VALUES (?, ?, ?, ?, ?, ?)'),
    insertMember: db.prepare('INSERT OR IGNORE INTO journal_members (journal_id, user_id) VALUES (?, ?)'),
    membership: db.prepare('SELECT j.* FROM journals j JOIN journal_members m ON m.journal_id = j.id WHERE j.id = ? AND m.user_id = ?'),
    journalsFor: db.prepare(`
      SELECT j.*, (SELECT COUNT(*) FROM entries e WHERE e.journal_id = j.id) AS entry_count
      FROM journals j JOIN journal_members m ON m.journal_id = j.id
      WHERE m.user_id = ?
      ORDER BY (j.kind = 'personal') DESC, j.created_at, j.id`),
    membersOf: db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar FROM journal_members m JOIN users u ON u.id = m.user_id
      WHERE m.journal_id = ? ORDER BY m.joined_at, u.id`),
    journalByCode: db.prepare('SELECT * FROM journals WHERE invite_code = ?'),
    entryWithAccess: db.prepare(`
      SELECT e.* FROM entries e JOIN journal_members m ON m.journal_id = e.journal_id
      WHERE e.id = ? AND m.user_id = ?`),
  };

  const ENTRY_SELECT = `
    SELECT e.*, a.display_name AS author_name, a.avatar AS author_avatar, b.display_name AS editor_name
    FROM entries e
    JOIN journal_members m ON m.journal_id = e.journal_id AND m.user_id = @uid
    LEFT JOIN users a ON a.id = e.author_id
    LEFT JOIN users b ON b.id = e.updated_by`;

  // ---------- serializers ----------

  const userOut = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar, lang: u.lang });

  function journalOut(j, uid) {
    return {
      id: j.id,
      name: j.name,
      emoji: j.emoji,
      color: j.color,
      kind: j.kind,
      ownerId: j.owner_id,
      isOwner: j.owner_id === uid,
      inviteCode: j.kind === 'shared' ? j.invite_code : null,
      entryCount: j.entry_count ?? undefined,
      members: q.membersOf.all(j.id).map((m) => ({ id: m.id, username: m.username, displayName: m.display_name, avatar: m.avatar })),
    };
  }

  const entryOut = (e) => ({
    id: e.id,
    journalId: e.journal_id,
    date: e.date,
    time: e.time || '',
    title: e.title,
    body: e.body,
    mood: e.mood,
    place: e.place,
    author: e.author_id ? { id: e.author_id, displayName: e.author_name, avatar: e.author_avatar } : null,
    editedBy: e.updated_by && e.updated_by !== e.author_id ? e.editor_name : null,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  });

  // ---------- middleware ----------

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use('/api', express.json({ limit: '100kb' }));

  // Mutations must be JSON: browsers can't send cross-site JSON without CORS preflight,
  // which together with SameSite cookies keeps CSRF out.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'json_required' });
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      req.sessionHash = sha256(token);
      req.user = q.sessionUser.get(req.sessionHash, Date.now()) || null;
    }
    next();
  });

  const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  const authLimit = rateLimiter({ windowMs: 10 * 60 * 1000, max: authRateLimit });

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + SESSION_DAYS * 864e5;
    q.purgeSessions.run(Date.now());
    q.insertSession.run(sha256(token), userId, expires);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: SESSION_DAYS * 864e5,
      path: '/',
    });
  }

  function requireJournal(id, uid) {
    const j = q.membership.get(Number(id), uid);
    if (!j) fail(404, 'journal_not_found');
    return j;
  }

  // Hands a shared journal to its longest-standing other member, or deletes it if nobody is left.
  function handOverOrDelete(journal, leavingUserId) {
    const next = db
      .prepare('SELECT user_id FROM journal_members WHERE journal_id = ? AND user_id != ? ORDER BY joined_at, user_id LIMIT 1')
      .get(journal.id, leavingUserId);
    if (next) db.prepare('UPDATE journals SET owner_id = ? WHERE id = ?').run(next.user_id, journal.id);
    else db.prepare('DELETE FROM journals WHERE id = ?').run(journal.id);
  }

  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  // ---------- auth ----------

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/auth/register', authLimit, wrap((req, res) => {
    const username = str(req.body.username, 24, { required: true, field: 'username' }).toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) fail(400, 'invalid_username');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 6) fail(400, 'weak_password');
    if (password.length > 200) fail(400, 'too_long_password');
    const displayName = str(req.body.displayName, 40, { field: 'displayName' }) || username;
    const lang = req.body.lang === 'en' ? 'en' : 'tr';
    if (q.userByName.get(username)) fail(409, 'username_taken');

    const user = db.transaction(() => {
      const { lastInsertRowid: uid } = q.insertUser.run(username, displayName, hashPassword(password), '🐻', lang);
      const { lastInsertRowid: jid } = q.insertJournal.run('', '📔', 'peach', 'personal', uid, null);
      q.insertMember.run(jid, uid);
      return q.userById.get(uid);
    })();
    startSession(res, user.id);
    res.status(201);
    return { user: userOut(user) };
  }));

  app.post('/api/auth/login', authLimit, wrap((req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = q.userByName.get(username);
    if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'wrong_credentials');
    startSession(res, user.id);
    return { user: userOut(user) };
  }));

  app.post('/api/auth/logout', wrap((req, res) => {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  app.get('/api/me', auth, wrap((req) => ({ user: userOut(req.user) })));

  app.patch('/api/me', auth, wrap((req) => {
    const u = req.user;
    const b = req.body;
    const displayName = b.displayName !== undefined ? str(b.displayName, 40, { required: true, field: 'displayName' }) : u.display_name;
    const avatar = b.avatar !== undefined ? str(b.avatar, 16, { required: true, field: 'avatar' }) : u.avatar;
    const lang = b.lang !== undefined ? (b.lang === 'en' ? 'en' : 'tr') : u.lang;
    let hash = u.password_hash;
    if (b.newPassword !== undefined) {
      if (!verifyPassword(String(b.currentPassword || ''), u.password_hash)) fail(403, 'wrong_password');
      if (typeof b.newPassword !== 'string' || b.newPassword.length < 6) fail(400, 'weak_password');
      if (b.newPassword.length > 200) fail(400, 'too_long_password');
      hash = hashPassword(b.newPassword);
    }
    db.prepare('UPDATE users SET display_name = ?, avatar = ?, lang = ?, password_hash = ? WHERE id = ?').run(displayName, avatar, lang, hash, u.id);
    if (hash !== u.password_hash) {
      // Changing the password signs out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, req.sessionHash);
    }
    return { user: userOut(q.userById.get(u.id)) };
  }));

  app.delete('/api/me', auth, wrap((req, res) => {
    const u = req.user;
    if (!verifyPassword(String((req.body && req.body.password) || ''), u.password_hash)) fail(403, 'wrong_password');
    db.transaction(() => {
      for (const j of db.prepare("SELECT * FROM journals WHERE owner_id = ? AND kind = 'shared'").all(u.id)) handOverOrDelete(j, u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    })();
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- journals ----------

  app.get('/api/journals', auth, wrap((req) => ({
    journals: q.journalsFor.all(req.user.id).map((j) => journalOut(j, req.user.id)),
  })));

  function journalFields(b, current = {}) {
    const name = b.name !== undefined ? str(b.name, 60, { field: 'name' }) : current.name;
    const emoji = b.emoji !== undefined ? str(b.emoji, 16, { required: true, field: 'emoji' }) : current.emoji || '📔';
    const color = b.color !== undefined ? b.color : current.color || 'peach';
    if (!COLORS.includes(color)) fail(400, 'invalid_color');
    return { name, emoji, color };
  }

  app.post('/api/journals', auth, wrap((req, res) => {
    const f = journalFields(req.body);
    if (!f.name) fail(400, 'missing_name');
    const id = db.transaction(() => {
      const { lastInsertRowid } = q.insertJournal.run(f.name, f.emoji, f.color, 'shared', req.user.id, inviteCode());
      q.insertMember.run(lastInsertRowid, req.user.id);
      return lastInsertRowid;
    })();
    res.status(201);
    return { journal: journalOut(q.membership.get(id, req.user.id), req.user.id) };
  }));

  app.patch('/api/journals/:id', auth, wrap((req) => {
    const j = requireJournal(req.params.id, req.user.id);
    const f = journalFields(req.body, j);
    if (j.kind === 'shared' && !f.name) fail(400, 'missing_name');
    db.prepare('UPDATE journals SET name = ?, emoji = ?, color = ? WHERE id = ?').run(f.name, f.emoji, f.color, j.id);
    return { journal: journalOut(q.membership.get(j.id, req.user.id), req.user.id) };
  }));

  app.delete('/api/journals/:id', auth, wrap((req) => {
    const j = requireJournal(req.params.id, req.user.id);
    if (j.kind === 'personal') fail(400, 'cannot_delete_personal');
    if (j.owner_id !== req.user.id) fail(403, 'owner_only');
    db.prepare('DELETE FROM journals WHERE id = ?').run(j.id);
    return { ok: true };
  }));

  app.post('/api/journals/:id/invite', auth, wrap((req) => {
    const j = requireJournal(req.params.id, req.user.id);
    if (j.kind !== 'shared') fail(400, 'not_shared');
    if (j.owner_id !== req.user.id) fail(403, 'owner_only');
    db.prepare('UPDATE journals SET invite_code = ? WHERE id = ?').run(inviteCode(), j.id);
    return { journal: journalOut(q.membership.get(j.id, req.user.id), req.user.id) };
  }));

  app.post('/api/journals/:id/leave', auth, wrap((req) => {
    const j = requireJournal(req.params.id, req.user.id);
    if (j.kind === 'personal') fail(400, 'cannot_leave_personal');
    db.transaction(() => {
      if (j.owner_id === req.user.id) handOverOrDelete(j, req.user.id);
      db.prepare('DELETE FROM journal_members WHERE journal_id = ? AND user_id = ?').run(j.id, req.user.id);
    })();
    return { ok: true };
  }));

  app.delete('/api/journals/:id/members/:userId', auth, wrap((req) => {
    const j = requireJournal(req.params.id, req.user.id);
    if (j.kind !== 'shared') fail(400, 'not_shared');
    if (j.owner_id !== req.user.id) fail(403, 'owner_only');
    const target = Number(req.params.userId);
    if (target === req.user.id) fail(400, 'cannot_remove_self');
    db.prepare('DELETE FROM journal_members WHERE journal_id = ? AND user_id = ?').run(j.id, target);
    return { journal: journalOut(q.membership.get(j.id, req.user.id), req.user.id) };
  }));

  app.post('/api/join', auth, wrap((req) => {
    const code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const j = code && q.journalByCode.get(code);
    if (!j) fail(404, 'invalid_code');
    q.insertMember.run(j.id, req.user.id);
    return { journal: journalOut(q.membership.get(j.id, req.user.id), req.user.id) };
  }));

  app.get('/api/journals/:id/export', auth, wrap((req, res) => {
    const j = requireJournal(req.params.id, req.user.id);
    const entries = db.prepare(`${ENTRY_SELECT} WHERE e.journal_id = @jid ORDER BY e.date, e.time, e.id`).all({ uid: req.user.id, jid: j.id });
    res.set('Content-Disposition', `attachment; filename="gunce-${j.id}.json"`);
    return {
      app: 'gunce',
      exportedAt: new Date().toISOString(),
      journal: journalOut(j, req.user.id),
      entries: entries.map(entryOut),
    };
  }));

  // ---------- entries ----------

  // Resolves ?journal=all|<id> into the list of journal ids the user may read.
  function scope(req) {
    if (!req.query.journal || req.query.journal === 'all') return null;
    return requireJournal(req.query.journal, req.user.id).id;
  }

  app.get('/api/entries', auth, wrap((req) => {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to)) fail(400, 'invalid_date');
    const jid = scope(req);
    const rows = db
      .prepare(`${ENTRY_SELECT} WHERE e.date BETWEEN @from AND @to ${jid ? 'AND e.journal_id = @jid' : ''} ORDER BY e.date, e.time IS NULL, e.time, e.id LIMIT 5000`)
      .all({ uid: req.user.id, from, to, jid });
    return { entries: rows.map(entryOut) };
  }));

  app.get('/api/entries/search', auth, wrap((req) => {
    const text = String(req.query.q || '').trim().slice(0, 100);
    if (!text) return { entries: [] };
    const like = `%${text.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const jid = scope(req);
    const rows = db
      .prepare(`${ENTRY_SELECT} WHERE (e.title LIKE @like ESCAPE '\\' OR e.body LIKE @like ESCAPE '\\' OR e.place LIKE @like ESCAPE '\\')
        ${jid ? 'AND e.journal_id = @jid' : ''} ORDER BY e.date DESC, e.id DESC LIMIT 60`)
      .all({ uid: req.user.id, like, jid });
    return { entries: rows.map(entryOut) };
  }));

  // "On this day" in earlier (and later) years.
  app.get('/api/entries/memories', auth, wrap((req) => {
    const { date } = req.query;
    if (!validDate(date)) fail(400, 'invalid_date');
    const jid = scope(req);
    const rows = db
      .prepare(`${ENTRY_SELECT} WHERE substr(e.date, 6) = @md AND e.date != @date ${jid ? 'AND e.journal_id = @jid' : ''} ORDER BY e.date DESC, e.id LIMIT 30`)
      .all({ uid: req.user.id, md: date.slice(5), date, jid });
    return { entries: rows.map(entryOut) };
  }));

  app.get('/api/stats', auth, wrap((req) => {
    const jid = scope(req);
    const filter = jid ? 'AND e.journal_id = @jid' : '';
    const p = { uid: req.user.id, jid };
    const base = `FROM entries e JOIN journal_members m ON m.journal_id = e.journal_id AND m.user_id = @uid WHERE 1 ${filter}`;
    const totals = db.prepare(`SELECT COUNT(*) AS entries, COUNT(DISTINCT e.date) AS days, MIN(e.date) AS first ${base}`).get(p);
    return { entries: totals.entries, days: totals.days, first: totals.first };
  }));

  function entryFields(b, current = {}) {
    const pick = (k, max) => (b[k] !== undefined ? str(b[k], max, { field: k }) : current[k] || '');
    const f = {
      date: b.date !== undefined ? b.date : current.date,
      time: pick('time', 5),
      title: pick('title', 60),
      body: pick('body', 20000),
      mood: pick('mood', 16),
      place: pick('place', 80),
    };
    if (!validDate(f.date)) fail(400, 'invalid_date');
    if (f.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) fail(400, 'invalid_time');
    if (!f.title && !f.body) fail(400, 'empty_entry');
    return f;
  }

  const getEntry = (id, uid) => db.prepare(`${ENTRY_SELECT} WHERE e.id = @id`).get({ uid, id });

  app.post('/api/journals/:id/entries', auth, wrap((req, res) => {
    const j = requireJournal(req.params.id, req.user.id);
    const f = entryFields(req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO entries (journal_id, date, time, title, body, mood, place, author_id, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(j.id, f.date, f.time || null, f.title, f.body, f.mood, f.place, req.user.id, req.user.id);
    res.status(201);
    return { entry: entryOut(getEntry(lastInsertRowid, req.user.id)) };
  }));

  app.patch('/api/entries/:id', auth, wrap((req) => {
    const e = q.entryWithAccess.get(Number(req.params.id), req.user.id);
    if (!e) fail(404, 'entry_not_found');
    const f = entryFields(req.body, e);
    let journalId = e.journal_id;
    if (req.body.journalId !== undefined && Number(req.body.journalId) !== e.journal_id) {
      journalId = requireJournal(req.body.journalId, req.user.id).id;
    }
    db.prepare(`UPDATE entries SET journal_id = ?, date = ?, time = ?, title = ?, body = ?, mood = ?, place = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(journalId, f.date, f.time || null, f.title, f.body, f.mood, f.place, req.user.id, e.id);
    return { entry: entryOut(getEntry(e.id, req.user.id)) };
  }));

  app.delete('/api/entries/:id', auth, wrap((req) => {
    const e = q.entryWithAccess.get(Number(req.params.id), req.user.id);
    if (!e) fail(404, 'entry_not_found');
    db.prepare('DELETE FROM entries WHERE id = ?').run(e.id);
    return { ok: true };
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // ---------- static frontend ----------

  const pub = path.join(__dirname, '..', 'public');
  // no-cache = always revalidate via ETag, so a new version shows up right after a deploy or restart.
  app.use(express.static(pub, { index: 'index.html', setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  app.get(['/join/:code', '/app'], (req, res) => res.sendFile(path.join(pub, 'index.html')));

  // ---------- errors ----------

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp, validDate };
