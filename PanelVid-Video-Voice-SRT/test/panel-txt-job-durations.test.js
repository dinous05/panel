import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDurations } from '../src/jobs.js';

test('queued TXT panels keep exact generated cue duration after scene reorder', () => {
  const scenes = [
    { id: 'scene-b', pageIndex: 0, panelScriptIndex: 1 },
    { id: 'scene-a', pageIndex: 0, panelScriptIndex: 0 },
  ];
  const result = jobDurations({
    scenes,
    settings: { durationMode: 'voice' },
    pageCount: 1,
    voiceResult: { duration: 6.75, cueDurations: [2.25, 4.5], pageSegments: {} },
  });
  assert.equal(result.mode, 'panel-txt');
  assert.equal(result.map.get('scene-b'), 4.5);
  assert.equal(result.map.get('scene-a'), 2.25);
});

test('queued TXT missing-page decision omits that page and retains mapped page cues', () => {
  const scenes = [
    { id: 'page-1-panel', pageIndex: 0, panelScriptIndex: 0 },
    { id: 'page-2-panel', pageIndex: 1 },
    { id: 'page-3-panel', pageIndex: 2, panelScriptIndex: 1 },
  ];
  const result = jobDurations({
    scenes,
    settings: { durationMode: 'voice' },
    pageCount: 3,
    voiceResult: {
      duration: 5,
      cueDurations: [2, 3],
      pageSegments: { 0: [0, 2], 2: [2, 5] },
    },
  });
  assert.equal(result.mode, 'panel-txt');
  assert.deepEqual(result.droppedPageIndices, [1]);
  assert.equal(result.map.get('page-1-panel'), 2);
  assert.equal(result.map.has('page-2-panel'), false);
  assert.equal(result.map.get('page-3-panel'), 3);
});
