import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutVerticalSequential, partitionPanelsByChapter } from '../src/contact-sheet-layout.js';

const panel = (chapterId, order, width = 100, height = 400) => ({
  chapterId, order, id: `P${String(order).padStart(6, '0')}`, uuid: `uuid-${order}`, width, height,
});
const compact = { maxHeight: 1200, maxWidth: 1000, maxColumns: 2, panelGap: 10, columnGap: 10, margin: 20, headerHeight: 100, labelHeight: 20 };

test('chapter partitioning never mixes chapter IDs and respects capacity without reordering', () => {
  const input = [panel('Chapter A', 1), panel('Chapter A', 2), panel('Chapter A', 3), panel('Chapter B', 4), panel('Chapter B', 5)];
  const batches = partitionPanelsByChapter(input, 2);
  assert.deepEqual(batches.map(batch => [batch.chapterId, batch.panels.map(item => item.order)]), [
    ['Chapter A', [1, 2]], ['Chapter A', [3]], ['Chapter B', [4, 5]],
  ]);
});

test('equal-height panels stack vertically then continue in the next column, without scaling dimensions', () => {
  const input = [panel('A', 1), panel('A', 2), panel('A', 3)];
  const sheets = layoutVerticalSequential(input, compact);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].panels.map(item => [item.uuid, item.column, item.x, item.y, item.width, item.height]), [
    ['uuid-1', 1, 20, 120, 100, 400],
    ['uuid-2', 1, 20, 550, 100, 400],
    ['uuid-3', 2, 130, 120, 100, 400],
  ]);
  assert.deepEqual(sheets.flatMap(sheet => sheet.panels.map(item => item.uuid)), input.map(item => item.uuid));
});

test('panels with highly different heights move intact to the next column when there is not enough vertical room', () => {
  const input = [panel('A', 1, 140, 180), panel('A', 2, 140, 700), panel('A', 3, 140, 250)];
  const sheets = layoutVerticalSequential(input, compact);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].panels.map(item => [item.reading_order, item.column, item.width, item.height]), [
    [1, 1, 140, 180], [2, 1, 140, 700], [3, 2, 140, 250],
  ]);
});

test('a panel taller than the canvas is placed alone at native dimensions and marked overflow', () => {
  const sheets = layoutVerticalSequential([panel('A', 1, 180, 2000)], { ...compact, maxHeight: 800 });
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].panels[0].height, 2000);
  assert.equal(sheets[0].panels[0].overflow_height, true);
  assert.equal(sheets[0].overflow.height, true);
  assert.ok(sheets[0].height > 800);
});

test('a new Contact Sheet starts when another column would exceed max width', () => {
  const input = [panel('A', 1, 100, 350), panel('A', 2, 100, 350), panel('A', 3, 100, 350)];
  const sheets = layoutVerticalSequential(input, { ...compact, maxHeight: 500, maxWidth: 250, maxColumns: 8, margin: 10, headerHeight: 60, labelHeight: 10, panelGap: 10, columnGap: 10 });
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map(sheet => sheet.panels.map(item => item.reading_order)), [[1, 2], [3]]);
  assert.ok(sheets.every(sheet => sheet.width <= 250));
});

test('a new Contact Sheet starts at MAX_COLUMNS even when canvas width remains', () => {
  const input = [panel('A', 1, 100, 350), panel('A', 2, 100, 350), panel('A', 3, 100, 350)];
  const sheets = layoutVerticalSequential(input, { ...compact, maxHeight: 500, maxWidth: 1000, maxColumns: 2, margin: 10, headerHeight: 60, labelHeight: 10, panelGap: 10, columnGap: 10 });
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map(sheet => sheet.panels.map(item => item.reading_order)), [[1, 2], [3]]);
});

test('duplicate UUIDs and invalid dimensions fail validation', () => {
  assert.throws(() => layoutVerticalSequential([panel('A', 1), { ...panel('A', 2), uuid: 'uuid-1' }]), /UUID panel bị trùng/);
  assert.throws(() => layoutVerticalSequential([panel('A', 1, 0, 100)]), /Kích thước ảnh không hợp lệ/);
});
