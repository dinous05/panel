import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePanelScriptTXT, parsePanelScriptDocumentTXT, bindPanelScriptToScenes, panelCueDurationsMap, isPanelScriptBindingValid } from '../src/panel-script.js';

test('TXT without blank separators treats each non-empty line as one panel cue', () => {
  assert.deepEqual(parsePanelScriptTXT('\uFEFFFirst line\r\nSecond line\nThird line'), [
    'First line', 'Second line', 'Third line',
  ]);
});

test('blank-line-separated multi-line paragraphs stay together as one panel cue', () => {
  assert.deepEqual(parsePanelScriptTXT('Wrapped\nparagraph text\n\nNext panel'), [
    'Wrapped\nparagraph text', 'Next panel',
  ]);
});

test('TXT page markers are parsed as metadata and may reveal a missing page', () => {
  const parsed = parsePanelScriptDocumentTXT('[TRANG 1]\nPanel one\nPanel two\n\n[PAGE 3]\nPanel three');
  assert.equal(parsed.pageMarked, true);
  assert.deepEqual(parsed.cues, [
    { text: 'Panel one', page: 1 },
    { text: 'Panel two', page: 1 },
    { text: 'Panel three', page: 3 },
  ]);
  assert.deepEqual(parsePanelScriptTXT('[TRANG 2] Text for panel'), ['Text for panel']);
});

test('panel audio durations follow their panel association after reordering', () => {
  const scenes = [{ id: 'b', panelScriptIndex: 1 }, { id: 'a', panelScriptIndex: 0 }];
  assert.deepEqual([...panelCueDurationsMap(scenes, [2.25, 4.5])], [['b', 4.5], ['a', 2.25]]);
  assert.equal(panelCueDurationsMap(scenes, [2.25]), null);
});

test('page-aware TXT binding maps cues to scenes and leaves a missing page unbound', () => {
  const scenes = [{ pageIndex: 0 }, { pageIndex: 1 }, { pageIndex: 2 }];
  const cues = [{ page: 1 }, { page: 3 }];
  assert.deepEqual(bindPanelScriptToScenes(scenes, cues, 3, true), { bindings: [0, null, 1], error: null });
  assert.match(bindPanelScriptToScenes(scenes, [{ page: 1 }, { page: 3 }, { page: 3 }], 3, true).error, /Trang 3/);
});

test('numbered TXT markers bind directly to scenes for flat chapters represented as one logical group', () => {
  const scenes = Array.from({ length: 103 }, (_, pageIndex) => ({ pageIndex: 0, groupIndex: 0, id: `scene-${pageIndex}` }));
  const cues = Array.from({ length: 103 }, (_, index) => ({ page: index + 1 }));
  const result = bindPanelScriptToScenes(scenes, cues, 1, true);
  assert.equal(result.error, null);
  assert.equal(result.bindings.length, 103);
  assert.deepEqual(result.bindings, cues.map((_, index) => index));
  scenes.forEach((scene,index)=>{scene.panelScriptIndex=result.bindings[index];});
  assert.equal(isPanelScriptBindingValid(scenes,cues,true),true);
});

test('page-marked TXT accepts omitted image pages and rejects stale or reordered bindings', () => {
  const cues=[{page:2},{page:4}],scenes=[{groupIndex:0},{groupIndex:1},{groupIndex:2},{groupIndex:3}];
  const result=bindPanelScriptToScenes(scenes,cues,4,true);
  assert.equal(result.error,null);
  scenes.forEach((scene,index)=>{if(Number.isInteger(result.bindings[index]))scene.panelScriptIndex=result.bindings[index];});
  assert.equal(isPanelScriptBindingValid(scenes,cues,true),true);
  [scenes[1].panelScriptIndex,scenes[3].panelScriptIndex]=[scenes[3].panelScriptIndex,scenes[1].panelScriptIndex];
  assert.equal(isPanelScriptBindingValid(scenes,cues,true),false);
});

test('exact cue map leaves scenes from an unmarked page without a duration', () => {
  const scenes = [
    { id: 'p1', panelScriptIndex: 0 },
    { id: 'p2' },
    { id: 'p3', panelScriptIndex: 1 },
  ];
  const durations = panelCueDurationsMap(scenes, [1.5, 2.75]);
  assert.equal(durations.get('p1'), 1.5);
  assert.equal(durations.has('p2'), false);
  assert.equal(durations.get('p3'), 2.75);
});
