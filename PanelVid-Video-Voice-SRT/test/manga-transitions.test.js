import test from 'node:test';
import assert from 'node:assert/strict';
import { MANGA_TRANSITIONS, normalizeMangaTransition } from '../src/manga-transitions.js';
import { COMIC_STYLES, normalizeComicStyle, isStripStyle } from '../src/strip-slicer.js';

test('manga transitions expose common fade and four directional slide effects', () => {
  assert.deepEqual(MANGA_TRANSITIONS.map(item => item.value), [
    'none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down',
    'zoom-in', 'zoom-out', 'flash-white',
  ]);
});

test('unknown transition values normalize to the requested safe default', () => {
  assert.equal(normalizeMangaTransition('fade'), 'fade');
  assert.equal(normalizeMangaTransition('broken', 'slide-right'), 'slide-right');
  assert.equal(normalizeMangaTransition(null), 'none');
});

test('comic styles omit Manhua and migrate old Manhua preference to Manga', () => {
  assert.deepEqual(COMIC_STYLES, ['manga', 'manhwa', 'hybrid']);
  assert.equal(normalizeComicStyle('manhua'), 'manga');
  assert.equal(normalizeComicStyle('hybrid'), 'hybrid');
  assert.equal(isStripStyle('hybrid'), false);
});
