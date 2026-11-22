// Tidies Spotify track names for display. Spotify adds notes about which release a track comes from
// ("- Mono", "- 2016 Remaster", "- Bonus Track", "| Spotify RADAR"); they aren't part of the song's name, so they go.
// Notes that describe a different performance or mix ("- Live from ...", "- Ed Stasium Mix") and
// featured artists stay. Only the end of the name is touched, so titles with brackets of their own are left alone.

// A release note on its own: mono/stereo, remasters (with or without a year), bonus tracks.
const NOTE = String.raw`(?:mono|stereo)(?: (?:version|mix))?|(?:\d{4} )?(?:digital(?:ly)? )?remaster(?:ed)?(?: version)?(?: \d{4})?|bonus(?: track)?`;
const TAIL = [
  new RegExp(String.raw`\s+[-–—]\s+(?:${NOTE})\s*$`, 'i'),   // "Play With Fire - Mono", "TVC15 - 2016 Remaster"
  new RegExp(String.raw`\s*[([](?:${NOTE})[)\]]\s*$`, 'i'),            // "Song (Remastered 2011)", "Song [Mono]"
  /\s*\|\s*Spotify\s+[\w ]+$/i,                                            // "Anemone - (Live) | Spotify RADAR"
];

export const cleanTitle = (name) => {
  let s = String(name ?? '').trim(), prev;
  do {                                                                      // notes can stack: "Song - Mono - Remastered"
    prev = s;
    for (const re of TAIL) s = s.replace(re, '');
    s = s.replace(/\s+[-–—]\s+(\((?:live|acoustic|demo)[^)]*\))\s*$/i, ' $1');   // "Anemone - (Live)" -> "Anemone (Live)"
  } while (s !== prev);
  return s || String(name ?? '').trim();
};
