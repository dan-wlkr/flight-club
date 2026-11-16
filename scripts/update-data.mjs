// Rebuilds data.js from the Flight Club playlist on Spotify.
//
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN in the environment;
// LASTFM_API_KEY is optional and switches genres from Deezer to Last.fm tags.
// Popularity and genres come from Deezer (Spotify stopped returning them). Tracks already in data.js
// keep their label and curator name, so only new tracks cost
// extra API calls and hand edits to existing rows survive. window.FC_COUNTRY is hand-maintained
// and is written back untouched; scripts/genre-overrides.json holds hand-set genres per artist; new lead artists without a country are listed in the output.
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

const notes = [];

const tracks = [];
for (const { it, tr } of rows) {
  const was = old.get(tr.id);
  // Spotify no longer returns labels or genres; Deezer fills these in below.
  const g = was?.g ?? [], lb = was?.lb ?? '';
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

// ---- popularity and genres from Deezer ----
// Spotify no longer returns popularity or genres for this app. p comes from Deezer's track "rank"
// (roughly 0 to 1,000,000), scaled to 0-100, and g from the Deezer album's genres, lower-cased.
// Tracks Deezer can't match keep their previous values.
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
  if (t.isrc) { const hit = await deezer(`/track/isrc:${encodeURIComponent(t.isrc)}`); if (hit?.rank != null) return [hit]; }
  const title = core(t.n), lead = norm(t.ar[0]);
  let found = [];
  for (const q of [`artist:"${t.ar[0]}" track:"${t.n.replace(/"/g, '')}"`, `artist:"${t.ar[0]}" track:"${title}"`, `${t.ar[0]} ${title}`]) {
    const res = await deezer(`/search/track?limit=15&q=${encodeURIComponent(q)}`);
    const byArtist = (res?.data ?? []).filter((d) => { const da = norm(d.artist?.name); return da === lead || da.includes(lead) || lead.includes(da); });
    // Deezer lists the same song on many releases, some with a near-zero rank, so take the
    // most-played copy with the same title; only fall back to a looser title match if there is none.
    const exact = byArtist.filter((d) => core(d.title) === title);
    const loose = byArtist.filter((d) => { const dt = core(d.title); return dt.startsWith(title) || title.startsWith(dt); });
    const hits = exact.length ? exact : loose.filter((d) => Math.abs(d.duration * 1000 - t.ms) <= 12000);
    found = [...found, ...hits.filter((d) => !found.some((f) => f.id === d.id))].sort((a, b) => b.rank - a.rank);
    // A very low rank usually means only an obscure copy turned up; the next, looser search may find the main one.
    if (found.length && found[0].rank >= 30000) break;
  }
  return found.length ? found : null;
};
// Optional: with LASTFM_API_KEY set, genres come from Last.fm's listener tags for the lead artist,
// which are far more specific than Deezer's. Deezer's genres remain the fallback.
const LASTFM = (process.env.LASTFM_API_KEY ?? '').trim();
const NOT_GENRES = /^(seen live|favou?rites?|favou?rite (artists?|bands?|songs?)|awesome|love|loved|beautiful|cool|good|great|amazing|best|all|spotify|check out|albums i own|vinyl|under \d+ listeners|(fe)?male vocalists?|(fe)?male vocals?|vocalists?|singers?|bands?|duos?|[0-9]{2,4}s?|usa?|uk|american|british|english|irish|scottish|welsh|canadian|australian|french|swedish|norwegian|danish|german|european|sweden|norway|denmark|ireland|england|scotland|wales|france|germany|canada|australia|united states|united kingdom|birmingham|producers?|new york|london|brooklyn|chicago|philadelphia|los angeles|california|texas|dublin|manchester)$/;
// One spelling per genre, so the charts don't split "hip hop" from "hip-hop".
const ALIAS = { 'hip hop': 'hip-hop', hiphop: 'hip-hop', lofi: 'lo-fi', 'lo fi': 'lo-fi', 'r&b': 'rnb', 'r and b': 'rnb', 'alt country': 'alt-country', 'synth pop': 'synthpop', 'post punk': 'post-punk', 'post rock': 'post-rock', 'trip hop': 'trip-hop', 'singer songwriter': 'singer-songwriter' };
// Hand corrections by lead artist, for when Last.fm mixes up two acts with the same name.
const OVERRIDES = JSON.parse(await readFile(new URL('./genre-overrides.json', import.meta.url), 'utf8'));
const lfCache = new Map();
const lastfm = async (method, params) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(250);
    const res = await fetch('https://ws.audioscrobbler.com/2.0/?' + new URLSearchParams({ method, ...params, autocorrect: '1', api_key: LASTFM, format: 'json' }));
    const body = await res.json().catch(() => null);
    if (body && !body.error) return body;
    if (body?.error === 6) return null; // not found
    if (body && ![8, 11, 16, 29].includes(body.error)) throw new Error(`Last.fm error ${body.error}: ${body.message}`);
    await sleep(2000 * (attempt + 1));
  }
  throw new Error('Last.fm is not responding');
};
const pickTags = (body, names) => {
  const seen = new Set(names.map(norm)), out = [];
  for (const tag of body?.toptags?.tag ?? []) {
    const raw = String(tag.name).toLowerCase().trim(), name = ALIAS[raw] ?? raw, key = norm(name);
    if (!key || seen.has(key) || NOT_GENRES.test(name) || name.length > 30) continue;
    if (out.length && +tag.count < 25) break; // tags arrive strongest first, scored 0-100
    seen.add(key);
    out.push(name);
    if (out.length === 3) break;
  }
  return out;
};
const lastfmGenres = (t) => {
  const artist = t.ar[0];
  if (!lfCache.has(artist)) lfCache.set(artist, lastfm('artist.gettoptags', { artist }).then((b) => pickTags(b, t.ar)));
  return lfCache.get(artist).then(async (tags) => tags.length ? tags : pickTags(await lastfm('track.gettoptags', { artist, track: t.n }), [...t.ar, t.n]));
};

const dzAlbums = new Map();
const dzAlbum = (id) => dzAlbums.get(id) ?? dzAlbums.set(id, deezer(`/album/${id}`)).get(id);
const unmatched = [], noGenre = [];
let fromLastfm = 0;
try {
  const scored = [];
  for (const t of tracks) {
    const hits = await findOnDeezer(t);
    if (!hits) { unmatched.push(t); continue; }
    // Genres and label sit on the album. Some releases carry no genres, so try the next copies too.
    let g = [], lb = '';
    for (const id of [...new Set(hits.map((d) => d.album?.id).filter(Boolean))].slice(0, 4)) {
      const album = await dzAlbum(id);
      lb ||= album?.label ?? '';
      g = [...new Set((album?.genres?.data ?? []).map((x) => String(x.name).toLowerCase()))];
      if (g.length) break;
    }
    const source = OVERRIDES[t.ar[0]] ?? (LASTFM ? await lastfmGenres(t) : []);
    if (source.length) { g = source; fromLastfm++; }
    scored.push({ t, hit: hits[0], p: Math.max(0, Math.min(100, Math.round(hits[0].rank / 10000))), g, lb });
  }
  // Only apply once every lookup has finished, so a half-finished run can't leave mixed sources.
  for (const { t, hit, p, g, lb } of scored) {
    console.log(`popularity ${String(old.get(t.id)?.p ?? '-').padStart(3)} -> ${String(p).padStart(3)}  ${t.n} / ${t.ar[0]}  [Deezer: ${hit.title} / ${hit.artist?.name}, rank ${hit.rank}]  genres: ${g.join(', ') || 'none'}`);
    t.p = p;
    t.g = g;
    if (!g.length) noGenre.push(t);
    // Spotify no longer returns album labels either, so new tracks take theirs from Deezer.
    if (!t.lb) t.lb = lb;
  }
  notes.push(`Popularity from Deezer for ${scored.length} of ${tracks.length} tracks. Genres: ${LASTFM ? `${fromLastfm} from Last.fm, the rest from Deezer` : 'all from Deezer (no LASTFM_API_KEY set)'}.`);
  if (unmatched.length) notes.push(`Not found on Deezer (popularity and genres left as they were): ${unmatched.map((t) => `${t.n} by ${t.ar[0]}`).join('; ')}`);
  if (noGenre.length) notes.push(`No genre found for ${noGenre.length} tracks: ${noGenre.map((t) => `${t.n} by ${t.ar[0]}`).join('; ')}`);
} catch (e) {
  console.warn(`::warning::Popularity and genre lookup failed (${e.message}); popularity and genres left unchanged this run.`);
  notes.push(`Popularity and genre lookup failed (${e.message}); both left unchanged this run.`);
}
for (const t of tracks) delete t.isrc;

// ---- report and write ----
const now = new Set(tracks.map((t) => t.id));
const added = tracks.filter((t) => !old.has(t.id)), removed = oldTracks.filter((t) => !now.has(t.id));
const line = (t) => `${t.n} by ${t.ar.join(', ')} (${t.by})`;
const noCountry = [...new Set(tracks.map((t) => t.ar[0]).filter((a) => a && !(a in countries)))];
const blank = added.filter((t) => !t.lb);

const out = [`Playlist has ${tracks.length} tracks: ${added.length} added, ${removed.length} removed.`];
added.forEach((t) => out.push(`- Added: ${line(t)}`));
removed.forEach((t) => out.push(`- Removed: ${line(t)}`));
if (noCountry.length) out.push(`Artists with no country in window.FC_COUNTRY (shown as "Unknown"): ${noCountry.join(', ')}`);
if (blank.length) out.push(`New tracks with no label: ${blank.map((t) => t.n).join(', ')}`);
out.push(...notes);
console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');

await writeFile(FILE, `window.FC_TRACKS=${JSON.stringify(tracks)};\n\nwindow.FC_COUNTRY=${JSON.stringify(countries)};\n`);
