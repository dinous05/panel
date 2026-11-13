import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPanelItemsByPage, logicalPageCount } from '../src/panel-folders.js';
import { scenesFromPanelImages } from '../src/panel-video-scenes.js';
import { bindPanelScriptToScenes } from '../src/panel-script.js';
import { jobDurations } from '../src/jobs.js';

const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'vi', { numeric: true, sensitivity: 'base' });

test('groups cut panels by page subfolder in natural order and retains natural panel ordering', () => {
  const items = [
    { name: 'Panel 2.jpg', path: 'Chapter 1/Page 10/Panel 2.jpg' },
    { name: 'Panel 1.jpg', path: 'Chapter 1/Page 2/Panel 1.jpg' },
    { name: 'Panel 10.jpg', path: 'Chapter 1/Page 2/Panel 10.jpg' },
    { name: 'Panel 1.jpg', path: 'Chapter 1/Page 10/Panel 1.jpg' },
  ];
  const result = groupPanelItemsByPage(items, { compare: naturalCompare });
  assert.deepEqual(result.groups.map(group => group.name), ['Page 2', 'Page 10']);
  assert.deepEqual(result.groups[0].items.map(item => item.name), ['Panel 1.jpg', 'Panel 10.jpg']);
  assert.deepEqual(items.map(item => result.groupIndexByPath.get(item.path)), [1, 0, 0, 1]);
});

test('batch chapter grouping strips the chapter prefix and generic Pages directory', () => {
  const items = [
    { name: 'p1.jpg', path: 'Series/Chapter 02/Pages/10/p1.jpg' },
    { name: 'p1.jpg', path: 'Series/Chapter 02/Pages/2/p1.jpg' },
    { name: 'p2.jpg', path: 'Series/Chapter 02/Pages/2/p2.jpg' },
  ];
  const result = groupPanelItemsByPage(items, { baseFolder: 'Series/Chapter 02', compare: naturalCompare });
  assert.deepEqual(result.groups.map(group => group.name), ['2', '10']);
  assert.deepEqual(result.groups.map(group => group.items.length), [2, 1]);
});

test('flat files and generic panels directory preserve one-image-per-page behavior', () => {
  const items = [
    { name: 'panel10.jpg', path: 'Chapter/panels/panel10.jpg' },
    { name: 'panel2.jpg', path: 'Chapter/panels/panel2.jpg' },
  ];
  const result = groupPanelItemsByPage(items, { compare: naturalCompare });
  assert.equal(result.pageCount, 2);
  assert.equal(new Set(result.groupIndexByPath.values()).size, 2);
});

test('scenes use source pageIndex for image access and logical groupIndex for page semantics', () => {
  const scenes = scenesFromPanelImages([
    { index: 0, pageGroupIndex: 0 },
    { index: 1, pageGroupIndex: 0 },
    { index: 2, pageGroupIndex: 1 },
  ], () => 'id');
  assert.deepEqual(scenes.map(scene => [scene.pageIndex, scene.groupIndex]), [[0, 0], [1, 0], [2, 1]]);
  assert.equal(logicalPageCount(scenes), 2);
});

test('TXT [TRANG n] binding and job page durations use page folder groups', () => {
  const scenes = [
    { id: 'a', pageIndex: 0, groupIndex: 0 },
    { id: 'b', pageIndex: 1, groupIndex: 0 },
    { id: 'c', pageIndex: 2, groupIndex: 1 },
  ];
  const binding = bindPanelScriptToScenes(scenes, [{ text: 'a', page: 1 }, { text: 'b', page: 1 }, { text: 'c', page: 2 }], 2, true);
  assert.equal(binding.error, null);
  assert.deepEqual(binding.bindings, [0, 1, 2]);
  const durations = jobDurations({ scenes, settings: { durationMode: 'page', pageSeconds: 10, fps: 30 }, pageCount: 2 });
  assert.equal(durations.map.get('a') + durations.map.get('b'), 10);
  assert.equal(durations.map.get('c'), 10);
});
