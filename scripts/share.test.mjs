// Tests for the link-preview description. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, shareDescription, withShareDescription } from './share.mjs';

const t = (at) => ({ at });

test('counts weeks like the site', () => {
  assert.equal(weekOf([t('2026-07-29T09:00:00Z')]), 1);
  assert.equal(weekOf([t('2026-07-29T09:00:00Z'), t('2026-08-04T09:00:00Z')]), 1);     // 6 days in
  assert.equal(weekOf([t('2026-07-29T09:00:00Z'), t('2026-08-05T09:00:00Z')]), 2);     // 7 days in
  assert.equal(weekOf([]), null);
  assert.equal(weekOf([{ at: 'not a date' }]), null);
});

test('falls back to the plain line without a week', () => {
  assert.equal(shareDescription(17), 'Week 17 · A shared playlist');
  assert.equal(shareDescription(null), 'A shared playlist');
});

test('rewrites only the og:description tag', () => {
  const html = '<meta name="description" content="Keep me">\n<meta property="og:description" content="Old text">\n';
  const out = withShareDescription(html, [t('2026-07-29T09:00:00Z'), t('2026-11-19T09:00:00Z')]);
  assert.equal(out, '<meta name="description" content="Keep me">\n<meta property="og:description" content="Week 17 · A shared playlist">\n');
  assert.equal(withShareDescription('<p>no tag</p>', []), '<p>no tag</p>');
});
