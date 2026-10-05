const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp, validDate } = require('../server/app');

let server, base;

before(async () => {
  const app = createApp(openDb(':memory:'), { authRateLimit: 1000 });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// A tiny cookie-keeping client, one per simulated person.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const ayse = client();
const mert = client();
const stranger = client();
let personalId, sharedId, entryId;

test('date validation accepts any year and rejects impossible dates', () => {
  assert.ok(validDate('0001-01-01'));
  assert.ok(validDate('1987-06-15'));
  assert.ok(validDate('2024-02-29'));
  assert.ok(!validDate('2023-02-29'));
  assert.ok(!validDate('1900-02-29'));
  assert.ok(validDate('2000-02-29'));
  assert.ok(!validDate('2026-13-01'));
  assert.ok(!validDate('26-01-01'));
});

test('register creates a session and exactly one personal journal', async () => {
  let r = await ayse('POST', '/api/auth/register', { username: 'Ayse', password: 'secret1', displayName: 'Ayşe' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.username, 'ayse');
  r = await mert('POST', '/api/auth/register', { username: 'mert', password: 'secret2' });
  assert.equal(r.status, 201);
  await stranger('POST', '/api/auth/register', { username: 'stranger', password: 'secret3' });

  r = await ayse('GET', '/api/journals');
  assert.equal(r.data.journals.length, 1);
  assert.equal(r.data.journals[0].kind, 'personal');
  personalId = r.data.journals[0].id;
});

test('register validation', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/register', { username: 'AYSE', password: 'whatever' })).data.error, 'username_taken');
  assert.equal((await c('POST', '/api/auth/register', { username: 'a b', password: 'whatever' })).data.error, 'invalid_username');
  assert.equal((await c('POST', '/api/auth/register', { username: 'okname', password: '123' })).data.error, 'weak_password');
});

test('login / logout / me', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/me')).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { username: 'ayse', password: 'nope' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { username: 'AYSE', password: 'secret1' })).status, 200);
  assert.equal((await c('GET', '/api/me')).data.user.displayName, 'Ayşe');
  await c('POST', '/api/auth/logout', {});
  assert.equal((await c('GET', '/api/me')).status, 401);
});

test('mutations require JSON', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('personal entries: any year, CRUD, privacy', async () => {
  let r = await ayse('POST', `/api/journals/${personalId}/entries`, { date: '1998-03-14', title: 'Eski defterden', body: 'Kağıttan aktardım', mood: '🥹' });
  assert.equal(r.status, 201);
  r = await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-10-05', time: '09:30', title: 'Kahvaltı', body: 'Simit ve çay', mood: '😊' });
  entryId = r.data.entry.id;
  assert.equal(r.data.entry.author.displayName, 'Ayşe');

  assert.equal((await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-10-05' })).data.error, 'empty_entry');
  assert.equal((await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-02-30', title: 'x' })).data.error, 'invalid_date');
  assert.equal((await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-02-03', time: '25:00', title: 'x' })).data.error, 'invalid_time');
  assert.equal((await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-02-03', title: 'x'.repeat(61) })).data.error, 'too_long_title');
  assert.equal((await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2026-02-03', title: 'x', place: 'p'.repeat(81) })).data.error, 'too_long_place');

  r = await ayse('GET', '/api/entries?journal=all&from=2026-10-01&to=2026-10-31');
  assert.equal(r.data.entries.length, 1);
  r = await ayse('GET', `/api/entries?journal=${personalId}&from=1998-03-01&to=1998-03-31`);
  assert.equal(r.data.entries[0].title, 'Eski defterden');

  // Others can't see or touch it.
  assert.equal((await mert('GET', `/api/entries?journal=${personalId}&from=2026-10-01&to=2026-10-31`)).status, 404);
  assert.equal((await mert('PATCH', `/api/entries/${entryId}`, { title: 'hack' })).status, 404);
  assert.equal((await mert('DELETE', `/api/entries/${entryId}`)).status, 404);
  assert.equal((await mert('GET', '/api/entries?journal=all&from=0001-01-01&to=9999-12-31')).data.entries.length, 0);

  r = await ayse('PATCH', `/api/entries/${entryId}`, { body: 'Simit, çay ve peynir' });
  assert.equal(r.data.entry.body, 'Simit, çay ve peynir');
  assert.equal(r.data.entry.title, 'Kahvaltı');
});

test('personal journal cannot be deleted or left', async () => {
  assert.equal((await ayse('DELETE', `/api/journals/${personalId}`)).data.error, 'cannot_delete_personal');
  assert.equal((await ayse('POST', `/api/journals/${personalId}/leave`, {})).data.error, 'cannot_leave_personal');
});

test('shared journal: create, invite, both members can edit', async () => {
  let r = await ayse('POST', '/api/journals', { name: 'Ayşe & Mert', emoji: '🌙', color: 'lavender' });
  assert.equal(r.status, 201);
  sharedId = r.data.journal.id;
  const code = r.data.journal.inviteCode;
  assert.match(code, /^[A-Z2-9]{8}$/);

  assert.equal((await mert('POST', '/api/join', { code: 'WRONG123' })).status, 404);
  r = await mert('POST', '/api/join', { code: code.toLowerCase() });
  assert.equal(r.data.journal.members.length, 2);
  assert.equal(r.data.journal.isOwner, false);

  r = await mert('POST', `/api/journals/${sharedId}/entries`, { date: '2026-10-05', time: '21:00', title: 'Akşam', body: 'Sahilde yürüdük', place: 'Moda', mood: '🥰' });
  const shared = r.data.entry.id;
  r = await ayse('PATCH', `/api/entries/${shared}`, { body: 'Sahilde yürüdük, dondurma yedik' });
  assert.equal(r.data.entry.editedBy, 'Ayşe');
  assert.equal(r.data.entry.author.displayName, 'mert');

  r = await ayse('GET', '/api/entries?journal=all&from=2026-10-05&to=2026-10-05');
  assert.equal(r.data.entries.length, 2);
  assert.deepEqual(r.data.entries.map((e) => e.time), ['09:30', '21:00']);

  // Stranger is not a member.
  assert.equal((await stranger('GET', `/api/entries?journal=${sharedId}&from=2026-10-01&to=2026-10-31`)).status, 404);
});

test('owner-only actions', async () => {
  assert.equal((await mert('POST', `/api/journals/${sharedId}/invite`, {})).status, 403);
  assert.equal((await mert('DELETE', `/api/journals/${sharedId}`)).status, 403);
  const old = (await ayse('GET', '/api/journals')).data.journals.find((j) => j.id === sharedId).inviteCode;
  const r = await ayse('POST', `/api/journals/${sharedId}/invite`, {});
  assert.notEqual(r.data.journal.inviteCode, old);
  assert.equal((await stranger('POST', '/api/join', { code: old })).status, 404);
});

test('search and memories', async () => {
  let r = await ayse('GET', '/api/entries/search?q=dondurma');
  assert.equal(r.data.entries.length, 1);
  r = await ayse('GET', '/api/entries/search?q=100%');
  assert.equal(r.data.entries.length, 0);
  await ayse('POST', `/api/journals/${personalId}/entries`, { date: '2019-10-05', title: 'Yedi yıl önce' });
  r = await ayse('GET', '/api/entries/memories?date=2026-10-05');
  assert.deepEqual(r.data.entries.map((e) => e.title), ['Yedi yıl önce']);
  r = await ayse('GET', '/api/stats?journal=all');
  assert.equal(r.data.entries, 4);
  assert.equal(r.data.first, '1998-03-14');
});

test('moving an entry between journals requires membership', async () => {
  const r = await ayse('PATCH', `/api/entries/${entryId}`, { journalId: sharedId });
  assert.equal(r.data.entry.journalId, sharedId);
  assert.equal((await ayse('PATCH', `/api/entries/${entryId}`, { journalId: 99999 })).status, 404);
  await ayse('PATCH', `/api/entries/${entryId}`, { journalId: personalId });
});

test('export', async () => {
  const r = await ayse('GET', `/api/journals/${sharedId}/export`);
  assert.equal(r.data.app, 'gunce');
  assert.equal(r.data.entries.length, 1);
});

test('owner leaving hands the journal over; members can be removed', async () => {
  await stranger('POST', '/api/join', { code: (await ayse('GET', '/api/journals')).data.journals.find((j) => j.id === sharedId).inviteCode });
  let r = await ayse('DELETE', `/api/journals/${sharedId}/members/${(await stranger('GET', '/api/me')).data.user.id}`);
  assert.equal(r.data.journal.members.length, 2);

  await ayse('POST', `/api/journals/${sharedId}/leave`, {});
  r = await mert('GET', '/api/journals');
  const j = r.data.journals.find((x) => x.id === sharedId);
  assert.equal(j.isOwner, true);
  assert.equal(j.members.length, 1);
  assert.equal((await ayse('GET', '/api/journals')).data.journals.length, 1);
});

test('profile update and password change', async () => {
  let r = await ayse('PATCH', '/api/me', { displayName: 'Ayşecik', avatar: '🐰', lang: 'en' });
  assert.equal(r.data.user.avatar, '🐰');
  assert.equal(r.data.user.lang, 'en');
  assert.equal((await ayse('PATCH', '/api/me', { currentPassword: 'bad', newPassword: 'newsecret' })).status, 403);
  assert.equal((await ayse('PATCH', '/api/me', { currentPassword: 'secret1', newPassword: 'newsecret' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/login', { username: 'ayse', password: 'newsecret' })).status, 200);
});

test('deleting an account hands over owned shared journals', async () => {
  const r = await mert('POST', '/api/journals', { name: 'Kamp', emoji: '⛺', color: 'mint' });
  await stranger('POST', '/api/join', { code: r.data.journal.inviteCode });
  assert.equal((await mert('DELETE', '/api/me', { password: 'wrong' })).status, 403);
  assert.equal((await mert('DELETE', '/api/me', { password: 'secret2' })).status, 200);
  assert.equal((await mert('GET', '/api/me')).status, 401);
  const js = (await stranger('GET', '/api/journals')).data.journals;
  const kamp = js.find((j) => j.name === 'Kamp');
  assert.equal(kamp.isOwner, true);
  // The journal mert was alone in is gone.
  assert.equal(js.some((j) => j.id === sharedId), false);
});

test('static frontend and join links are served', async () => {
  for (const p of ['/', '/join/ABCD2345']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>/);
  }
});
