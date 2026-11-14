import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePanelPredictions,
  filterPanelBoxes,
  resolveMinPanelAreaPct,
  sortPanelBoxes,
} from '../src/panel-detector-core.js';

test('keeps a small panel instead of applying the old 4 percent cutoff', () => {
  const result = filterPanelBoxes([
    { x: 5, y: 5, w: 70, h: 80 },
    { x: 80, y: 8, w: 1.2, h: 1.2 },
  ], 0.5, 'rtl');
  assert.equal(result.length, 2);
  assert.ok(result.some(box => box.w < 2 && box.h < 2));
});

test('keeps a meaningful inset panel inside a larger panel', () => {
  const result = filterPanelBoxes([
    { x: 5, y: 5, w: 82, h: 82 },
    { x: 42, y: 38, w: 12, h: 14 },
  ], 0.5, 'rtl');
  assert.equal(result.length, 2);
});

test('removes near-identical duplicate detections but not nested detections', () => {
  const result = filterPanelBoxes([
    { x: 10, y: 10, w: 40, h: 40 },
    { x: 10.2, y: 10.1, w: 40, h: 40 },
    { x: 20, y: 20, w: 10, h: 10 },
  ], 0.5, 'rtl');
  assert.equal(result.length, 2);
});

test('groups staggered boxes into the same reading row', () => {
  const boxes = [
    { id: 'left', x: 0, y: 6, w: 40, h: 25 },
    { id: 'right', x: 50, y: 0, w: 40, h: 25 },
    { id: 'next-row', x: 25, y: 34, w: 50, h: 18 },
  ];
  const rtl = sortPanelBoxes(boxes, 'rtl');
  assert.deepEqual(rtl.map(box => box.id), ['right', 'left', 'next-row']);
  const ltr = sortPanelBoxes(boxes, 'ltr');
  assert.deepEqual(ltr.map(box => box.id), ['left', 'right', 'next-row']);
});

test('resolves a fractional Manga area threshold', () => {
  assert.equal(resolveMinPanelAreaPct(0.5), 0.5);
  assert.equal(resolveMinPanelAreaPct(undefined), 0.5);
  assert.equal(resolveMinPanelAreaPct(25), 4);
});

test('decoder accepts smaller model detections', () => {
  // 20x20 pixels on a 1000x1000 source page, represented in 640px model space.
  const predictions = new Float32Array([100, 100, 12.8, 12.8, 0.9, 0.9]);
  const boxes = decodePanelPredictions(predictions, 1000, 1000, 'rtl');
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].w >= 1.9 && boxes[0].h >= 1.9);
});
