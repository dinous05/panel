import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutSequentialRows, partitionPanelsByChapter } from '../src/contact-sheet-layout.js';

const panel = (chapterId, order, width = 900, height = 1200) => ({
  chapterId, order, id: `P${String(order).padStart(6, '0')}`, uuid: `uuid-${order}`, width, height,
});

test('chapter partitioning never mixes chapter IDs and respects capacity without reordering', () => {
  const input = [panel('Chapter A', 1), panel('Chapter A', 2), panel('Chapter A', 3), panel('Chapter B', 4), panel('Chapter B', 5)];
  const sheets = partitionPanelsByChapter(input, 2);
  assert.deepEqual(sheets.map(sheet => [sheet.chapterId, sheet.panels.map(item => item.order)]), [
    ['Chapter A', [1, 2]], ['Chapter A', [3]], ['Chapter B', [4, 5]],
  ]);
  assert.ok(sheets.every(sheet => sheet.panels.every(item => item.chapterId === sheet.chapterId)));
});

test('adaptive rows preserve aspect ratio, panel count, and sequential order', () => {
  const input = [panel('A', 1, 900, 1300), panel('A', 2, 1500, 900), panel('A', 3, 1000, 1000), panel('A', 4, 1800, 900)];
  const rows = layoutSequentialRows(input);
  assert.deepEqual(rows.flatMap(row => row.items.map(item => item.uuid)), input.map(item => item.uuid));
  assert.equal(rows.flatMap(row => row.items).length, input.length);
  assert.ok(rows.every(row => row.items.length > 0 && row.items.length <= 4));
});

test('extremely tall narrow panel is flagged for original-image detail rather than claimed readable', () => {
  const rows = layoutSequentialRows([panel('A', 1, 80, 2400)]);
  assert.equal(rows[0].items[0].detail_required, true);
  assert.ok(rows[0].items[0].display_width < 260);
});

test('duplicate UUIDs and non-sequential reading order fail validation', () => {
  assert.throws(() => partitionPanelsByChapter([panel('A', 1), { ...panel('B', 2), uuid: 'uuid-1' }]), /UUID panel bị trùng/);
  assert.throws(() => partitionPanelsByChapter([panel('A', 2), panel('A', 1)]), /Thứ tự đọc/);
});
