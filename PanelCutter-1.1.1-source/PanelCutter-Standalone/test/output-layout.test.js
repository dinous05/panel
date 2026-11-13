import test from 'node:test';
import assert from 'node:assert/strict';
import { mangaPanelPath, sanitizeSegment, stripPanelPath } from '../src/output-layout.js';

test('Manga tạo folder riêng cho từng trang, bên trong là panel theo thứ tự', () => {
  assert.equal(mangaPanelPath(0, 'chap/page 01.jpg', 0, 'jpg'), '0001_page 01/panel_001.jpg');
  assert.equal(mangaPanelPath(8, 'chap/002.png', 11, 'png'), '0009_002/panel_012.png');
});

test('Manhwa/Manhua dùng một folder panel tuần tự và tên an toàn trên Windows', () => {
  assert.equal(stripPanelPath(0, 'jpg'), 'panel_0001.jpg');
  assert.equal(stripPanelPath(39, 'png'), 'panel_0040.png');
  assert.equal(sanitizeSegment('CON'), 'page');
  assert.equal(sanitizeSegment('ch/01:*'), 'ch_01__');
});
