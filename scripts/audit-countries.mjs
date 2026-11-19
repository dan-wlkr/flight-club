// Read-only check: looks up every artist already in window.FC_COUNTRY on MusicBrainz and reports where it
// agrees or disagrees with the hand-kept list. Writes nothing. Run in GitHub Actions (MusicBrainz isn't
// reachable from every network): node scripts/audit-countries.mjs
import { readFile, appendFile } from 'node:fs/promises';
import { findCountry } from './countries.mjs';

const src = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const grab = (name) => JSON.parse(src.match(new RegExp(`window\\.${name}=([\\s\\S]*?);\\s*(?=window\\.|$)`))[1]);
const tracks = grab('FC_TRACKS'), countries = grab('FC_COUNTRY');

const firstTrack = new Map();
for (const t of tracks) if (!firstTrack.has(t.ar[0])) firstTrack.set(t.ar[0], t);

const agree = [], disagree = [], unsure = [], failed = [];
for (const [artist, t] of firstTrack) {
  const have = countries[artist];
  if (!have) continue;
  try {
    const r = await findCountry({ artist, title: t.n });
    if (!r.country) unsure.push(`${artist} (${have}): ${r.reason}`);
    else if (r.country === have) agree.push({ artist, via: r.via });
    else disagree.push(`${artist}: list says ${have}, MusicBrainz says ${r.country} (via ${r.via})`);
  } catch (e) { failed.push(`${artist}: ${e.message}`); }
  process.stdout.write('.');
}
console.log('');

const total = agree.length + disagree.length + unsure.length + failed.length;
const byVia = {};
agree.forEach((a) => { byVia[a.via] = (byVia[a.via] ?? 0) + 1; });
const lines = [
  `MusicBrainz country check on ${total} artists with a hand-kept country:`,
  `- Agrees: ${agree.length} (${Object.entries(byVia).map(([k, v]) => `${v} via ${k}`).join(', ') || 'none'})`,
  `- Disagrees: ${disagree.length}`, ...disagree.map((d) => `    ${d}`),
  `- Could not tell: ${unsure.length}`, ...unsure.map((d) => `    ${d}`),
  `- Errors: ${failed.length}`, ...failed.map((d) => `    ${d}`),
  `Agreement where it gave an answer: ${agree.length + disagree.length ? Math.round(100 * agree.length / (agree.length + disagree.length)) : 0}%`,
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
