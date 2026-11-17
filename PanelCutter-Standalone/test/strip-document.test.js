import test from 'node:test';
import assert from 'node:assert/strict';
import { joinStripProfiles, mapStripCropToSources, stripPageIndexAt } from '../src/strip-document.js';

const profile = (values) => { const v=Float64Array.from(values); return { r:v, g:v, b:v, lum:v, variance:new Float64Array(v.length) }; };

test('profiles from pages join top-to-bottom at a shared width', () => {
  const doc=joinStripProfiles([
    {pageIndex:0,width:2,height:3,profile:profile([10,20,30])},
    {pageIndex:1,width:4,height:4,profile:profile([40,50,60,70])},
  ]);
  assert.equal(doc.width,4); assert.equal(doc.height,10);
  assert.deepEqual([...doc.profile.lum],[10,10,20,20,30,30,40,50,60,70]);
  assert.equal(stripPageIndexAt(doc,5.99),0); assert.equal(stripPageIndexAt(doc,6),1);
});

test('a panel crop crossing the file boundary maps to source fragments', () => {
  const doc=joinStripProfiles([
    {pageIndex:0,width:2,height:3,profile:profile([10,20,30])},
    {pageIndex:1,width:4,height:4,profile:profile([40,50,60,70])},
  ]);
  const parts=mapStripCropToSources(doc,{x:0,y:25,w:100,h:50});
  assert.deepEqual(parts.map(p=>p.pageIndex),[0,1]);
  assert.ok(Math.abs(parts[0].destH-.7)<1e-12);
  assert.ok(Math.abs(parts[1].destH-.3)<1e-12);
  assert.ok(Math.abs(parts[0].sy-1.25)<1e-12);
  assert.ok(Math.abs(parts[0].sh-1.75)<1e-12);
});
