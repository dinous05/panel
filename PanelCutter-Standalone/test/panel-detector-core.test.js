import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPanelBoxes } from '../src/panel-detector-core.js';

test('a mostly nested Manga detection is removed even when its borders drift outside the parent', () => {
  const boxes = [
    { x: 10, y: 10, w: 50, h: 60 },
    // Covers about 74% of this smaller candidate; the previous 85% rule let it through.
    { x: 27, y: 25, w: 40, h: 50 },
  ];

  const result = filterPanelBoxes(boxes, 4, 'rtl');

  assert.equal(result.length, 1);
  assert.ok(result[0].x <= 10 && result[0].y <= 10);
});

test('a nearby panel whose center and most of its area are outside the parent is preserved', () => {
  const boxes = [
    { x: 10, y: 10, w: 50, h: 60 },
    { x: 45, y: 35, w: 40, h: 40 },
  ];

  const result = filterPanelBoxes(boxes, 4, 'rtl');

  assert.equal(result.length, 2);
});
