import test from 'node:test';
import assert from 'node:assert/strict';
import { webtoonScrollPlan, webtoonTileSize } from '../src/webtoon-stack.js';
import { webtoonStackCropFilter } from '../electron/render.js';

test('vertical scroll plan keeps enough following image for the viewport', () => {
  const heights = [420, 1450, 680, 900];
  const first = webtoonScrollPlan(heights, 0, 1080);
  assert.deepEqual(first, {
    startIndex: 0, advancePx: 420, tileCount: 2,
    contentHeight: 1870, requiredHeight: 1500, needsPadding: false,
  });
  const second = webtoonScrollPlan(heights, 1, 1080);
  assert.equal(second.advancePx, heights[1]);
  assert.ok(second.contentHeight >= second.requiredHeight);
  const last = webtoonScrollPlan(heights, 3, 1080);
  assert.equal(last.advancePx, 0);
  assert.equal(last.needsPadding, true);
});

test('natural tile sizing preserves tall source proportions at the shared output width', () => {
  const size = webtoonTileSize(800, 6000, 1920, 100);
  assert.deepEqual(size, { width: 1920, height: 14400 });
  assert.ok(size.height > 1080);
  assert.equal(webtoonTileSize(800, 6000, 1920, 40).height, 5760);
});

test('FFmpeg crops original stack pixels and does not scale the tall strip to fit', () => {
  const filter = webtoonStackCropFilter(4200, 601, 60);
  assert.match(filter, /^crop=1920:1080:0:/);
  assert.match(filter, /4200\*min\(t\/10\.000000,1\)/);
  assert.doesNotMatch(filter, /zoompan|scale=/);
});
