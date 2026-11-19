// Works out an artist's country from MusicBrainz (free, no key). Spotify has no country data, so this
// fills in artists missing from window.FC_COUNTRY. It tries, most precise first:
//   1. the track's ISRC (the exact recording, so no namesake mix-ups)
//   2. a search for the recording by title and artist
//   3. a search for the artist by name, accepted only when every exact-name match agrees on the country
// MusicBrainz asks for at most one request a second and a descriptive User-Agent.
//   MB_CONTACT  optional contact (an email or URL) added to the User-Agent if MusicBrainz ever asks for one
//   MB_DELAY_MS gap between requests in milliseconds (default 1100; tests set 0)

const BASE = 'https://musicbrainz.org/ws/2';
const UA = 'playlist-update-script/1.0' + (process.env.MB_CONTACT ? ` ( ${process.env.MB_CONTACT} )` : '');
const DELAY = process.env.MB_DELAY_MS != null ? +process.env.MB_DELAY_MS : 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;
const mb = async (path, params = {}) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequest + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let res;
    try {
      res = await fetch(`${BASE}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch (e) {                                  // a dropped connection: try again before giving up
      if (attempt === 3) throw e;
      await sleep(DELAY ? 2000 * (attempt + 1) : 0);
      continue;
    }
    if (res.status === 503 || res.status === 429) { await sleep(DELAY ? 3000 * (attempt + 1) : 0); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
    return res.json();
  }
  throw new Error('MusicBrainz is busy');
};

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const coreTitle = (t) => norm(String(t).replace(/\s+[-\u2013]\s+.*$/, '').replace(/\s*[([].*$/, '')) || norm(t);
const quote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  if (!/^[A-Z]{2}$/.test(code || '') || ['XE', 'XW', 'XU', 'ZZ'].includes(code)) return null;   // [Europe], [Worldwide], [Unknown]
  try { const n = regions.of(code); return n && n !== code ? n : null; } catch { return null; }
};
const artistCountry = (a) => countryName(a?.country) || countryName(a?.area?.['iso-3166-1-codes']?.[0]);

const creditedArtists = (recording) => (recording['artist-credit'] ?? []).map((c) => c.artist).filter(Boolean);

// Returns { country, via } on success, or { country: null, reason } when it can't be sure.
export const findCountry = async ({ artist, title, isrc }) => {
  const want = norm(artist);

  // 1. ISRC: the exact recording.
  if (isrc) {
    const body = await mb(`/isrc/${encodeURIComponent(isrc)}`, { inc: 'artists' });
    for (const rec of body?.recordings ?? []) {
      const a = creditedArtists(rec).find((x) => norm(x.name) === want);
      if (a) { const full = await mb(`/artist/${a.id}`); const country = artistCountry(full); if (country) return { country, via: 'ISRC' }; }
    }
  }

  // 2. The recording, by title and artist.
  if (title) {
    const body = await mb('/recording', { query: `recording:${quote(title)} AND artist:${quote(artist)}`, limit: '5' });
    for (const rec of body?.recordings ?? []) {
      if ((rec.score ?? 0) < 90 || coreTitle(rec.title) !== coreTitle(title)) continue;
      const a = creditedArtists(rec).find((x) => norm(x.name) === want);
      if (a) { const full = await mb(`/artist/${a.id}`); const country = artistCountry(full); if (country) return { country, via: 'recording' }; }
    }
  }

  // 3. The artist by name, only if every exact-name match with a country agrees.
  const body = await mb('/artist', { query: `artist:${quote(artist)}`, limit: '8' });
  const exact = (body?.artists ?? []).filter((a) => (a.score ?? 0) >= 90 && norm(a.name) === want);
  if (!exact.length) return { country: null, reason: 'not found on MusicBrainz' };
  const withCountry = exact.map((a) => ({ a, country: artistCountry(a) })).filter((x) => x.country);
  const countries = [...new Set(withCountry.map((x) => x.country))];
  if (countries.length === 1) return { country: countries[0], via: exact.length > 1 ? 'name (all matches agree)' : 'name' };
  if (!countries.length) return { country: null, reason: 'found, but no country listed' };
  return { country: null, reason: `several artists share this name: ${withCountry.map((x) => `${x.country}${x.a.disambiguation ? ` (${x.a.disambiguation})` : ''}`).join(', ')}` };
};
