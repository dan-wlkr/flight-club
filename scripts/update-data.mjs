// Rebuilds data.js from the Flight Club playlist on Spotify.
//
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN in the environment.
// Tracks already in data.js keep their genres, label and curator name, so only new tracks cost
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
  });
}
tracks.sort((a, b) => a.at.localeCompare(b.at));

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
out.push(...notes);
console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');

await writeFile(FILE, `window.FC_TRACKS=${JSON.stringify(tracks)};\n\nwindow.FC_COUNTRY=${JSON.stringify(countries)};\n`);
