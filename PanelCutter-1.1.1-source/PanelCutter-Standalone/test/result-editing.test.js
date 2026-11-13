import test from 'node:test';
import assert from 'node:assert/strict';
import { moveMangaPanel, reindexPanelPaths, splitPanelItem } from '../src/result-editing.js';

const mangaItems = [
  { pageIndex: 0, relativePath: '0001_page-a/panel_001.jpg', id: 'a' },
  { pageIndex: 0, relativePath: '0001_page-a/panel_002.jpg', id: 'b' },
  { pageIndex: 0, relativePath: '0001_page-a/panel_003.png', id: 'c' },
  { pageIndex: 1, relativePath: '0002_page-b/panel_001.jpg', id: 'd' },
];

test('Manga panels can move up/down only inside their own source page', () => {
  const moved = moveMangaPanel(mangaItems, 1, 1);
  assert.deepEqual(moved.map(item => item.id), ['a', 'c', 'b', 'd']);
  assert.equal(moveMangaPanel(mangaItems, 2, 1), mangaItems);
  assert.equal(moveMangaPanel(mangaItems, 0, -1), mangaItems);
});

test('Manga output paths are renumbered by page after a delete or move', () => {
  const kept = [mangaItems[0], mangaItems[2], mangaItems[3]];
  const result = reindexPanelPaths(kept, 'manga');
  assert.deepEqual(result.map(item => item.relativePath), [
    '0001_page-a/panel_001.jpg', '0001_page-a/panel_002.png', '0002_page-b/panel_001.jpg',
  ]);
});

test('a manual split inserts two adjacent Manga panels and preserves source-page metadata', () => {
  const placeholder = '0001_page-a/__manual_split_tmp.jpg';
  const split = splitPanelItem(mangaItems, 1, placeholder);
  assert.equal(split.length, 5);
  assert.equal(split[1].relativePath, mangaItems[1].relativePath);
  assert.equal(split[2].relativePath, placeholder);
  assert.equal(split[1].pageIndex, 0);
  assert.equal(split[2].pageIndex, 0);
  assert.deepEqual(reindexPanelPaths(split, 'manga').slice(0, 4).map(item => item.relativePath), [
    '0001_page-a/panel_001.jpg', '0001_page-a/panel_002.jpg', '0001_page-a/panel_003.jpg', '0001_page-a/panel_004.png',
  ]);
  assert.equal(splitPanelItem(mangaItems, -1, placeholder), mangaItems);
  assert.equal(splitPanelItem(mangaItems, 1, mangaItems[0].relativePath), mangaItems);
});

test('Manhwa/Manhua output paths are renumbered continuously after an edit', () => {
  const strip = [
    { relativePath: 'panel_0001.jpg', id: 'a' },
    { relativePath: 'panel_0003.png', id: 'c' },
  ];
  assert.deepEqual(reindexPanelPaths(strip, 'manhua').map(item => item.relativePath), ['panel_0001.jpg', 'panel_0002.png']);
});
