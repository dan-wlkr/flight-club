// Tests for track-name tidying. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle } from './titles.mjs';

test('drops release notes', () => {
  assert.equal(cleanTitle('Play With Fire - Mono'), 'Play With Fire');
  assert.equal(cleanTitle('TVC15 - 2016 Remaster'), 'TVC15');
  assert.equal(cleanTitle('Born Again - Bonus Track'), 'Born Again');
  assert.equal(cleanTitle('Waterloo Sunset - Remastered 2004'), 'Waterloo Sunset');
  assert.equal(cleanTitle('Heroes (2017 Remaster)'), 'Heroes');
  assert.equal(cleanTitle('Paint It Black [Mono Version]'), 'Paint It Black');
  assert.equal(cleanTitle('Song - Mono - Remastered'), 'Song');
  assert.equal(cleanTitle('Song – Digitally Remastered'), 'Song');
});

test('tidies Spotify session names but keeps that it is live', () => {
  assert.equal(cleanTitle('Anemone - (Live) | Spotify RADAR'), 'Anemone (Live)');
  assert.equal(cleanTitle('Song | Spotify Singles'), 'Song');
});

test('keeps what is part of the song or a different recording', () => {
  for (const name of [
    'The Man Who Seeks Pleasure - Live from Ailfionn Studios',
    'Waitress in the Sky - Ed Stasium Mix',
    'Streets of Rage: Public Arguments Edition (feat. Gothic Tropic)',
    'DIFFERENCE [Feat. Yebba]',
    'You Knock Me Down (But in a Good Way)',
    'Mono',                                   // a song actually called that
    'Stereo Love',
    'Remaster Me - Live',
  ]) assert.equal(cleanTitle(name), name);
});
