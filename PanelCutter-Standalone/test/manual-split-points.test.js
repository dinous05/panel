import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSplitPoints, splitIntervals, splitPointsAtInterval } from '../src/manual-split-points.js';
import { splitSourceRegions } from '../src/manifest-core.js';

test('custom markers are sorted and divide the full image into adjacent ordered ranges', () => {
  const cuts = normalizeSplitPoints([75, 20], 100);
  const ranges = splitIntervals(cuts, 100);
  assert.deepEqual(cuts, [20, 75]);
  assert.deepEqual(ranges, [[0, 20], [20, 75], [75, 100]]);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], 100);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i - 1][1], ranges[i][0]);
  assert.equal(ranges.reduce((sum, [start, end]) => sum + end - start, 0), 100);
});

test('markers must be unique integer pixels strictly inside the panel', () => {
  assert.throws(() => normalizeSplitPoints([], 100), /ít nhất một mốc/);
  assert.throws(() => normalizeSplitPoints([20, 20], 100), /không được trùng/);
  assert.throws(() => normalizeSplitPoints([0], 100), /nằm bên trong/);
  assert.throws(() => normalizeSplitPoints([100], 100), /nằm bên trong/);
  assert.throws(() => normalizeSplitPoints([20.5], 100), /pixel nguyên/);
});

test('a chosen pixel interval suggests interior cut markers without producing an empty last part', () => {
  assert.deepEqual(splitPointsAtInterval(3500, 1200), [1167, 2333]);
  assert.deepEqual(splitPointsAtInterval(2400, 1200), [1200]);
  assert.deepEqual(splitPointsAtInterval(1801, 1800), [901]);
  assert.deepEqual(splitPointsAtInterval(1100, 1200), []);
  assert.ok(splitIntervals(splitPointsAtInterval(3500, 1200), 3500).every(([start, end]) => end - start <= 1200));
  assert.throws(() => splitPointsAtInterval(1000, 0), /không hợp lệ/);
});

test('multiple markers partition source-region pixels continuously without overlap', () => {
  const original = [{ source_page: 1, source_file: 'page.jpg', source_fingerprint: 'fp', source_width: 80, source_height: 140, crop: { x: 0, y: 10, width: 80, height: 100 }, output_y: 0, output_height: 1 }];
  const cuts = normalizeSplitPoints([61, 23], 100);
  let remainder = original, previousY = 0;
  const pieces = [];
  for (const cut of cuts) {
    const ratio = (cut - previousY) / (100 - previousY);
    const [before, after] = splitSourceRegions(remainder, ratio);
    pieces.push(before[0].crop); remainder = after; previousY = cut;
  }
  pieces.push(remainder[0].crop);
  assert.deepEqual(pieces.map(crop => [crop.y, crop.height]), [[10, 23], [33, 38], [71, 39]]);
  assert.equal(pieces.reduce((sum, crop) => sum + crop.height, 0), original[0].crop.height);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i - 1].y + pieces[i - 1].height, pieces[i].y);
});
