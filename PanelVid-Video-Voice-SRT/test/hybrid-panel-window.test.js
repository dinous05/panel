import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHybridPanelCard } from '../src/hybrid-panel-window.js';

test('rolling hybrid panel window retains recent cards across page boundaries', () => {
  let cards=[];
  cards=appendHybridPanelCard(cards,{id:'page-1-panel-1'},3);
  cards=appendHybridPanelCard(cards,{id:'page-2-panel-1'},3);
  cards=appendHybridPanelCard(cards,{id:'page-3-panel-1'},3);
  cards=appendHybridPanelCard(cards,{id:'page-4-panel-1'},3);
  assert.deepEqual(cards.map(card=>card.id),['page-2-panel-1','page-3-panel-1','page-4-panel-1']);
});

test('hybrid card window clamps limits to the supported range', () => {
  assert.equal(appendHybridPanelCard([],{},0).length,1);
  assert.equal(appendHybridPanelCard(Array.from({length:15},()=>({})),{},50).length,10);
});
