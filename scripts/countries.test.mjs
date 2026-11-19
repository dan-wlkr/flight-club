// Tests for the MusicBrainz country lookup against a fake MusicBrainz. Run: node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MB_DELAY_MS = '0';
const { findCountry } = await import('./countries.mjs');

const artists = {
  a1: { id: 'a1', name: 'Opus Kink', country: 'GB' },
  a2: { id: 'a2', name: 'Fcukers', country: 'US' },
  a3: { id: 'a3', name: 'Madi Diaz', country: 'US' },
  a4: { id: 'a4', name: 'Area Only', country: null, area: { 'iso-3166-1-codes': ['IE'] } },
  a5: { id: 'a5', name: 'Worldwide Act', country: 'XW' },
};
let calls, flaky;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = new URL(url); calls.push(u.pathname + u.search);
  const q = u.searchParams.get('query') || '';
  if (flaky && flaky-- > 0) return json({}, 503);
  if (u.pathname === '/ws/2/isrc/GBISRC0001') return json({ recordings: [{ title: 'Low Roader', 'artist-credit': [{ name: 'Opus Kink', artist: { id: 'a1', name: 'Opus Kink' } }] }] });
  if (u.pathname.startsWith('/ws/2/isrc/')) return json({}, 404);
  if (u.pathname.startsWith('/ws/2/artist/')) return json(artists[u.pathname.split('/').pop()] ?? {}, artists[u.pathname.split('/').pop()] ? 200 : 404);
  if (u.pathname === '/ws/2/recording') {
    if (q.includes('Noid')) return json({ recordings: [{ score: 100, title: 'Noid', 'artist-credit': [{ name: 'Yves Tumor', artist: { id: 'a2', name: 'Yves Tumor' } }] }] });
    if (q.includes('Falling Down')) return json({ recordings: [{ score: 70, title: 'Falling Down', 'artist-credit': [{ name: 'Someone', artist: { id: 'a1', name: 'Someone' } }] }] });
    return json({ recordings: [] });
  }
  if (u.pathname === '/ws/2/artist') {
    if (q.includes('Madi Diaz')) return json({ artists: [{ score: 100, name: 'Madi Diaz', country: 'US' }, { score: 95, name: 'Madi Diaz', country: 'US', disambiguation: 'other' }] });
    if (q.includes('Fine')) return json({ artists: [{ score: 100, name: 'Fine', country: 'DK' }, { score: 100, name: 'Fine', country: 'US', disambiguation: 'punk band' }] });
    if (q.includes('Mystery')) return json({ artists: [{ score: 100, name: 'Mystery', country: null }] });
    if (q.includes('Area Only')) return json({ artists: [{ score: 100, name: 'Area Only', country: null, area: { 'iso-3166-1-codes': ['IE'] } }] });
    if (q.includes('Worldwide')) return json({ artists: [{ score: 100, name: 'Worldwide Act', country: 'XW' }] });
    return json({ artists: [] });
  }
  return json({}, 404);
};
const run = (t) => { calls = []; flaky = 0; return findCountry(t); };

test('uses the ISRC first and looks the artist up by id', async () => {
  const r = await run({ artist: 'Opus Kink', title: 'Low Roader', isrc: 'GBISRC0001' });
  assert.deepEqual(r, { country: 'United Kingdom', via: 'ISRC' });
  assert.ok(calls[0].startsWith('/ws/2/isrc/GBISRC0001'));
});
test('falls back to the recording search when the ISRC is unknown', async () => {
  const r = await run({ artist: 'Yves Tumor', title: 'Noid', isrc: 'NOPE' });
  assert.equal(r.via, 'recording'); assert.equal(r.country, 'United States');
});
test('ignores a weak recording match and uses the name search', async () => {
  const r = await run({ artist: 'Madi Diaz', title: 'Falling Down' });
  assert.equal(r.country, 'United States'); assert.equal(r.via, 'name (all matches agree)');
});
test('refuses to guess when namesakes disagree', async () => {
  const r = await run({ artist: 'Fine', title: 'Goodbye brain' });
  assert.equal(r.country, null); assert.match(r.reason, /several artists share this name: Denmark, United States \(punk band\)/);
});
test('says so when no country is listed, or nothing is found', async () => {
  assert.match((await run({ artist: 'Mystery', title: 'x' })).reason, /no country listed/);
  assert.match((await run({ artist: 'Nobody At All', title: 'x' })).reason, /not found/);
});
test('uses the area code when the artist has no country, and skips [Worldwide]', async () => {
  assert.equal((await run({ artist: 'Area Only', title: 'x' })).country, 'Ireland');
  assert.equal((await run({ artist: 'Worldwide Act', title: 'x' })).country, null);
});
test('retries when MusicBrainz is busy', async () => {
  calls = []; flaky = 2;
  const r = await findCountry({ artist: 'Madi Diaz', title: 'x' });
  assert.equal(r.country, 'United States'); assert.ok(calls.length >= 3);
});
test('retries after a dropped connection', async () => {
  calls = []; flaky = 0;
  const real = globalThis.fetch; let dropped = 2;
  globalThis.fetch = async (...a) => { if (dropped-- > 0) throw new TypeError('fetch failed'); return real(...a); };
  try { const r = await findCountry({ artist: 'Madi Diaz', title: 'x' }); assert.equal(r.country, 'United States'); }
  finally { globalThis.fetch = real; }
});
