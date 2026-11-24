// Keeps the link-preview description (og:description in index.html) showing the playlist's current week,
// e.g. "Week 17 · A shared playlist". The week is counted the same way as on the site: from the first song added
// to the latest one, so it moves on when a song is added. Without a week it falls back to "A shared playlist".

export const weekOf = (tracks) => {
  const at = (tracks ?? []).map((t) => Date.parse(t.at)).filter(Number.isFinite);
  if (!at.length) return null;
  return Math.floor((Math.max(...at) - Math.min(...at)) / 864e5 / 7) + 1;
};

export const shareDescription = (week) => (week ? `Week ${week} · A shared playlist` : 'A shared playlist');

// Returns index.html with the og:description replaced; unchanged if the tag isn't there.
export const withShareDescription = (html, tracks) =>
  html.replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${shareDescription(weekOf(tracks))}$2`);
