// Rebuilds data.js from the Flight Club playlist on Spotify.
//
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN in the environment.
// Popularity comes from Deezer (Spotify stopped returning it). Tracks already in data.js keep their
// genres, label and curator name, so only new tracks cost
// extra API calls and hand edits to existing rows survive. window.FC_COUNTRY is hand-maintained
// and is written back untouched; new lead artists without a country are listed in the output.
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const PLAYLIST = process.env.SPOTIFY_PLAYLIST_ID || '1noTAUTrixdczkgwNdt3PN';
const FILE = new URL('../data.js', import.meta.url);
const API = 'https://api.spotify.com/v1';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing environment variable ${k}`); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- existing data ----
const src = await readFile(FILE, 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp(`window\\.${name}=([\\s\\S]*?);\\s*(?=window\\.|$)`));
  if (!m) throw new Error(`Could not find window.${name} in data.js`);
  return JSON.parse(m[1]);
};
const oldTracks = grab('FC_TRACKS'), countries = grab('FC_COUNTRY');
const old = new Map(oldTracks.map((t) => [t.id, t]));

// ---- Spotify ----
const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${need('SPOTIFY_CLIENT_ID')}:${need('SPOTIFY_CLIENT_SECRET')}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: need('SPOTIFY_REFRESH_TOKEN') }),
});
if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenRes.status} ${await tokenRes.text()}`);
const token = await tokenRes.json();
if (token.refresh_token && token.refresh_token !== process.env.SPOTIFY_REFRESH_TOKEN) {
  console.warn('::warning::Spotify issued a new refresh token. If later runs fail to authorise, repeat the one-off authorise step and update the SPOTIFY_REFRESH_TOKEN secret.');
}

const get = async (url, { optional = false } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : API + url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (res.status === 429 && attempt < 5) { await sleep((+res.headers.get('retry-after') || 2) * 1000); continue; }
    if (res.status >= 500 && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.ok) return res.json();
    if (optional) { console.warn(`::warning::${url} returned ${res.status}; leaving that detail blank`); return null; }
    const err = new Error(`${url} returned ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
};

// The endpoint was renamed from /tracks to /items in 2026; try the new name, fall back to the old.
const items = [];
let url = `/playlists/${PLAYLIST}/items?limit=50`;
try { await get(url); } catch (e) { if (e.status !== 403 && e.status !== 404) throw e; url = `/playlists/${PLAYLIST}/tracks?limit=50`; }
while (url) { const page = await get(url); items.push(...page.items); url = page.next; }

const rows = items
  .map((it) => ({ it, tr: it.item ?? it.track }))
  .filter(({ tr }) => tr && tr.id && (tr.type ?? 'track') === 'track' && !tr.is_local);
if (!rows.length) throw new Error('Spotify returned no tracks; refusing to overwrite data.js');

// Curator names: learn "Spotify user id -> name" from tracks we already have.
const votes = new Map();
for (const { it, tr } of rows) {
  const uid = it.added_by?.id, name = old.get(tr.id)?.by;
  if (!uid || !name) continue;
  const v = votes.get(uid) ?? votes.set(uid, new Map()).get(uid);
  v.set(name, (v.get(name) ?? 0) + 1);
}
const curator = new Map([...votes].map(([uid, v]) => [uid, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
const nameFor = async (uid) => {
  if (!uid) return 'Unknown';
  if (!curator.has(uid)) {
    const u = await get(`/users/${encodeURIComponent(uid)}`, { optional: true });
    curator.set(uid, u?.display_name || uid);
    notes.push(`New curator: Spotify user \`${uid}\` shown as "${curator.get(uid)}".`);
  }
  return curator.get(uid);
};

const notes = [], albums = new Map(), artists = new Map();
const cached = (map, key, path) => map.get(key) ?? map.set(key, get(path, { optional: true })).get(key);

const tracks = [];
for (const { it, tr } of rows) {
  const was = old.get(tr.id);
  let g = was?.g, lb = was?.lb;
  if (!was) {
    const album = tr.album?.id ? await cached(albums, tr.album.id, `/albums/${tr.album.id}`) : null;
    lb = album?.label ?? tr.album?.label ?? '';
    g = [];
    for (const a of tr.artists ?? []) {
      const full = a.id ? await cached(artists, a.id, `/artists/${a.id}`) : null;
      for (const x of full?.genres ?? []) if (!g.includes(x)) g.push(x);
    }
  }
  tracks.push({
    id: tr.id,
    n: tr.name,
    al: tr.album?.name ?? was?.al ?? '',
    ar: (tr.artists ?? []).map((a) => a.name),
    rd: tr.album?.release_date ?? was?.rd ?? '',
    ms: tr.duration_ms,
    by: was?.by ?? await nameFor(it.added_by?.id),
    at: it.added_at,
    g,
    lb,
    p: tr.popularity ?? was?.p ?? 0,
    isrc: tr.external_ids?.isrc,
  });
}
tracks.sort((a, b) => a.at.localeCompare(b.at));

// ---- popularity from Deezer ----
// Spotify no longer returns popularity for this app, so p comes from Deezer's track "rank"
// (roughly 0 to 1,000,000), scaled to 0-100. Tracks Deezer can't match keep their previous value.
const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const core = (title) => norm(String(title).replace(/\s+[-\u2013]\s+.*$/, '').replace(/\s*[([].*$/, '')) || norm(title);
const deezer = async (path) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(150);
    const res = await fetch('https://api.deezer.com' + path);
    const body = res.ok ? await res.json() : null;
    if (body && !body.error) return body;
    if (body?.error?.code === 800) return null; // no data
    if (body?.error?.code !== 4 && res.ok) return null; // 4 = rate limit, worth a retry
    await sleep(2000 * (attempt + 1));
  }
  throw new Error('Deezer is not responding');
};
const findOnDeezer = async (t) => {
  if (t.isrc) { const hit = await deezer(`/track/isrc:${encodeURIComponent(t.isrc)}`); if (hit?.rank != null) return hit; }
  const title = core(t.n), lead = norm(t.ar[0]);
  for (const q of [`artist:"${t.ar[0]}" track:"${t.n.replace(/"/g, '')}"`, `artist:"${t.ar[0]}" track:"${title}"`, `${t.ar[0]} ${title}`]) {
    const res = await deezer(`/search/track?limit=15&q=${encodeURIComponent(q)}`);
    const hits = (res?.data ?? []).filter((d) => {
      const dt = core(d.title), da = norm(d.artist?.name);
      return (dt === title || dt.startsWith(title) || title.startsWith(dt)) && (da === lead || da.includes(lead) || lead.includes(da));
    });
    if (!hits.length) continue;
    // Prefer the same recording (similar length), then the most-played version of it.
    const close = hits.filter((d) => Math.abs(d.duration * 1000 - t.ms) <= 12000);
    return (close.length ? close : hits).sort((a, b) => b.rank - a.rank)[0];
  }
  return null;
};
const unmatched = [];
try {
  const scored = [];
  for (const t of tracks) {
    const hit = await findOnDeezer(t);
    if (hit) scored.push([t, Math.max(0, Math.min(100, Math.round(hit.rank / 10000))), hit]);
    else unmatched.push(t);
  }
  // Only apply once every lookup has finished, so a half-finished run can't leave mixed sources.
  for (const [t, p, hit] of scored) {
    console.log(`popularity ${String(old.get(t.id)?.p ?? '-').padStart(3)} -> ${String(p).padStart(3)}  ${t.n} / ${t.ar[0]}  [Deezer: ${hit.title} / ${hit.artist?.name}, rank ${hit.rank}]`);
    t.p = p;
  }
  notes.push(`Popularity from Deezer for ${scored.length} of ${tracks.length} tracks.`);
  if (unmatched.length) notes.push(`Not found on Deezer (popularity left as it was): ${unmatched.map((t) => `${t.n} by ${t.ar[0]}`).join('; ')}`);
} catch (e) {
  console.warn(`::warning::Deezer lookup failed (${e.message}); popularity left unchanged this run.`);
  notes.push('Deezer lookup failed; popularity left unchanged this run.');
}
for (const t of tracks) delete t.isrc;

// ---- report and write ----
const now = new Set(tracks.map((t) => t.id));
const added = tracks.filter((t) => !old.has(t.id)), removed = oldTracks.filter((t) => !now.has(t.id));
const line = (t) => `${t.n} by ${t.ar.join(', ')} (${t.by})`;
const noCountry = [...new Set(tracks.map((t) => t.ar[0]).filter((a) => a && !(a in countries)))];
const blank = added.filter((t) => !t.lb || !t.g.length);

const out = [`Playlist has ${tracks.length} tracks: ${added.length} added, ${removed.length} removed.`];
added.forEach((t) => out.push(`- Added: ${line(t)}`));
removed.forEach((t) => out.push(`- Removed: ${line(t)}`));
if (noCountry.length) out.push(`Artists with no country in window.FC_COUNTRY (shown as "Unknown"): ${noCountry.join(', ')}`);
if (blank.length) out.push(`New tracks missing a label or genres from Spotify: ${blank.map((t) => t.n).join(', ')}`);
// Diagnostic: does Spotify still send album labels and artist genres? (Only fetched for new tracks otherwise.)
{
  const tr = rows[0].tr;
  const album = tr.album?.id ? await cached(albums, tr.album.id, `/albums/${tr.album.id}`) : null;
  const artist = tr.artists?.[0]?.id ? await cached(artists, tr.artists[0].id, `/artists/${tr.artists[0].id}`) : null;
  out.push(`Spotify check: album label ${album && 'label' in album ? 'present' : 'missing'}, artist genres ${artist && 'genres' in artist ? 'present' : 'missing'}.`);
}
out.push(...notes);
console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');

await writeFile(FILE, `window.FC_TRACKS=${JSON.stringify(tracks)};\n\nwindow.FC_COUNTRY=${JSON.stringify(countries)};\n`);
