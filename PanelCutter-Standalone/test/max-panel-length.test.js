import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAtMaxPanelLength } from '../src/max-panel-length.js';

test('zero disables the cap and short panel remains intact', () => {
  assert.deepEqual(splitAtMaxPanelLength(900, 0), [[0, 900]]);
  assert.deepEqual(splitAtMaxPanelLength(900, 1000), [[0, 900]]);
});

test('long panel is divided into contiguous pieces no taller than the cap', () => {
  assert.deepEqual(splitAtMaxPanelLength(2501, 1000), [[0, 1000], [1000, 2000], [2000, 2501]]);
  assert.deepEqual(splitAtMaxPanelLength(15000, 3200, 'even'), [[0, 3000], [3000, 6000], [6000, 9000], [9000, 12000], [12000, 15000]]);
  assert.deepEqual(splitAtMaxPanelLength(2501, 1000, 'even'), [[0, 834], [834, 1668], [1668, 2501]]);
});

test('rejects invalid height and cap values', () => {
  assert.throws(() => splitAtMaxPanelLength(0, 100));
  assert.throws(() => splitAtMaxPanelLength(100, -1));
  assert.throws(() => splitAtMaxPanelLength(100, 16001));
});
