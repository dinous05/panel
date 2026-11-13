import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readSubtitleZip } from '../src/batch-subtitles.js';
import { buildBatchManifest } from '../src/batch-manifest.js';

test('subtitle ZIP extracts only TXT/SRT and preserves paths for name-based chapter matching', async () => {
  const archive = new JSZip();
  archive.file('Subtitles/Chap 01.txt', 'line one\nline two');
  archive.file('Subtitles/Chap 02.SRT', '1\n00:00:00,000 --> 00:00:01,000\nhello');
  archive.file('Subtitles/notes.md', 'ignore');
  archive.file('__MACOSX/._Chap 01.txt', 'ignore');
  const bytes = await archive.generateAsync({ type: 'nodebuffer' });
  const subtitles = await readSubtitleZip({ name: 'subtitles.zip', arrayBuffer: async () => bytes });
  assert.equal(subtitles.length, 2);
  assert.equal(subtitles[0].type, 'txt');
  assert.equal(subtitles[0].rawText, 'line one\nline two');
  const manifest = buildBatchManifest([
    { name: 'panel-01.jpg', path: 'images/Chap 01/panel-01.jpg' },
    { name: 'panel-02.jpg', path: 'images/Chap 02/panel-02.jpg' },
  ], subtitles);
  assert.equal(manifest.chapters.find(chapter => chapter.name === 'Chap 01').subtitleId, subtitles[0].id);
  assert.equal(manifest.chapters.find(chapter => chapter.name === 'Chap 02').subtitleId, subtitles[1].id);
});
