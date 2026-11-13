import test from 'node:test';
import assert from 'node:assert/strict';
import { batchNameKeys, buildBatchManifest, validateBatchAssignments } from '../src/batch-manifest.js';

test('chapter name normalization matches common prefix and zero-padding variants', () => {
  assert.ok(batchNameKeys('Chapter 001').includes('1'));
  assert.ok(batchNameKeys('Chap-01').includes('1'));
  assert.ok(batchNameKeys('Ch 1').includes('1'));
  assert.ok(batchNameKeys('Chương 1').includes('chuong1'));
});

test('groups nested image files by matching chapter folder and selects TXT over SRT duplicate', () => {
  const images = [
    { name: '02.jpg', path: 'Series/Chap 02/panels/02.jpg' },
    { name: '01.jpg', path: 'Series/Chap 01/panels/01.jpg' },
    { name: '02a.jpg', path: 'Series/Chap 02/panels/02a.jpg' },
  ];
  const subtitles = [
    { id: 'srt1', name: 'Chapter_001.srt', path: 'Subs/Chapter_001.srt' },
    { id: 'txt1', name: 'Chapter_001.txt', path: 'Subs/Chapter_001.txt' },
    { id: 'srt2', name: 'ch02.srt', path: 'Subs/ch02.srt' },
  ];
  const manifest = buildBatchManifest(images, subtitles);
  assert.equal(manifest.chapters.length, 2);
  const ch1 = manifest.chapters.find(ch => ch.subtitleId === 'txt1');
  const ch2 = manifest.chapters.find(ch => ch.subtitleId === 'srt2');
  assert.equal(ch1.images.length, 1);
  assert.equal(ch2.images.length, 2);
  assert.equal(validateBatchAssignments(manifest.chapters, manifest.subtitles).ready, true);
});

test('folder-only fallback auto-assigns the first subtitle in natural order', () => {
  const manifest = buildBatchManifest([
    { name: 'p1.png', path: 'Series/UnlistedChapter/panels/p1.png' },
    { name: 'p2.png', path: 'Series/UnlistedChapter/panels/p2.png' },
  ], [
    { id: 'sub', name: 'Different name.txt', path: 'Subs/Different name.txt' },
    { id: 'sub2', name: 'Other name.srt', path: 'Subs/Other name.srt' },
  ]);
  assert.equal(manifest.chapters.length, 1);
  assert.equal(manifest.chapters[0].images.length, 2);
  assert.equal(manifest.chapters[0].subtitleId, 'sub');
  assert.equal(validateBatchAssignments(manifest.chapters, manifest.subtitles).ready, true);
});

test('a lone chapter and a lone subtitle are auto-matched when names differ', () => {
  const manifest = buildBatchManifest([
    { name: 'p1.png', path: 'Series/StoryTitle/panels/p1.png' },
    { name: 'p2.png', path: 'Series/StoryTitle/panels/p2.png' },
  ], [{ id: 'only-sub', name: 'voice.txt', path: 'Subtitles/voice.txt' }]);
  assert.equal(manifest.chapters.length, 1);
  assert.equal(manifest.chapters[0].subtitleId, 'only-sub');
  assert.equal(validateBatchAssignments(manifest.chapters, manifest.subtitles).ready, true);
});

test('one subtitle cannot be assigned to two chapter videos', () => {
  const chapters = [
    { key: 'a', name: 'A', images: [{}], subtitleId: 'one' },
    { key: 'b', name: 'B', images: [{}], subtitleId: 'one' },
  ];
  const result = validateBatchAssignments(chapters, [{ id: 'one' }]);
  assert.equal(result.ready, false);
  assert.match(result.errors.get('b'), /đang được dùng/);
});

test('sorts subtitle files by natural path/name order by default', () => {
  const manifest = buildBatchManifest([], [
    { id: '10', name: 'Chap 10.txt', path: 'Subs/Chap 10.txt' },
    { id: '2', name: 'Chap 2.srt', path: 'Subs/Chap 2.srt' },
    { id: '1', name: 'Chap 1.txt', path: 'Subs/Chap 1.txt' },
  ]);
  assert.deepEqual(manifest.subtitles.map(item => item.id), ['1', '2', '10']);
});

test('auto-pairs unmatched chapter folders and subtitles by natural order', () => {
  const manifest = buildBatchManifest([
    { name: 'p1.jpg', path: 'Story/Chapter 10/p1.jpg' },
    { name: 'p1.jpg', path: 'Story/Chapter 2/p1.jpg' },
  ], [
    { id: 'sub10', name: 'voice 10.txt', path: 'Subs/voice 10.txt' },
    { id: 'sub2', name: 'voice 2.txt', path: 'Subs/voice 2.txt' },
  ]);
  assert.deepEqual(manifest.chapters.map(chapter => chapter.name), ['Chapter 2', 'Chapter 10']);
  assert.deepEqual(manifest.chapters.map(chapter => chapter.subtitleId), ['sub2', 'sub10']);
  assert.ok(manifest.chapters.every(chapter => chapter.matchKind === 'natural-order'));
});
