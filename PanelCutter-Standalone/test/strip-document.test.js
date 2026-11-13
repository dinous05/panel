import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { joinStripProfiles, mapStripCropToSources, mapStripCropToSourceRegions, stripPageIndexAt } from '../src/strip-document.js';

const profile = values => { const v=Float64Array.from(values); return { r:v, g:v, b:v, lum:v, variance:new Float64Array(v.length) }; };
const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(specs) {
  const parts=specs.map((item,index)=>({pageIndex:index,profile:profile(Array.from({length:item.height},(_,y)=>10+index*20+y)),...item}));
  const doc=joinStripProfiles(parts);
  const sources=parts.map(item=>({pageIndex:item.pageIndex,sourceIndex:item.sourceIndex,sourceFile:item.sourceFile,sourceFingerprint:item.sourceFingerprint,sourceWidth:item.sourceWidth,height:item.height}));
  return {doc,sources};
}
const source=(pageIndex,sourceIndex,sourceFile,sourceWidth,height,width=4,cropX=0,sourceFingerprint=fingerprint(Buffer.from(sourceFile)))=>({pageIndex,sourceIndex,sourceFile,sourceFingerprint,sourceWidth,width,cropX,height});

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

test('single-source panel keeps original file, page, SHA-256 and exact bounded crop', () => {
  const hash=fingerprint(Buffer.from('original image bytes'));
  const {doc,sources}=fixture([source(0,7,'chapter/page-08.png',12,8,4,3,hash)]);
  const regions=mapStripCropToSourceRegions(doc,{x:0,y:25,w:50,h:50},sources);
  assert.equal(regions.length,1);
  assert.equal(regions[0].source_page,8);
  assert.equal(regions[0].source_file,'chapter/page-08.png');
  assert.equal(regions[0].source_fingerprint,hash);
  assert.equal(regions[0].source_width,12);
  assert.equal(regions[0].source_height,8);
  assert.deepEqual(regions[0].crop,{x:3,y:2,width:2,height:4});
  assert.ok(regions[0].crop.x+regions[0].crop.width<=12);
  assert.ok(regions[0].crop.y+regions[0].crop.height<=8);
});

test('panel spanning two source images maps both original crops, including variable dimensions', () => {
  const {doc,sources}=fixture([
    source(0,0,'a.jpg',8,3,2,2),
    source(1,1,'b.jpg',10,4,4,1),
  ]);
  const regions=mapStripCropToSourceRegions(doc,{x:0,y:25,w:100,h:50},sources);
  assert.deepEqual(regions.map(r=>r.source_file),['a.jpg','b.jpg']);
  assert.deepEqual(regions.map(r=>r.crop),[
    {x:2,y:1,width:2,height:2},
    {x:1,y:0,width:4,height:2},
  ]);
  assert.ok(regions.every(r=>r.crop.x+r.crop.width<=r.source_width && r.crop.y+r.crop.height<=r.source_height));
  assert.equal(regions[0].output_height,0.7);
  assert.equal(regions[1].output_height,0.3);
});

test('panel spanning three sources preserves each fingerprint and maps variable source heights', () => {
  const specs=[
    source(0,4,'set/01.png',8,3,2,2),
    source(1,9,'set/02.png',10,4,4,1),
    source(2,15,'set/03.png',12,5,4,3),
  ];
  const {doc,sources}=fixture(specs);
  const regions=mapStripCropToSourceRegions(doc,{x:0,y:0,w:100,h:100},sources);
  assert.deepEqual(regions.map(r=>r.source_page),[5,10,16]);
  assert.deepEqual(regions.map(r=>r.source_file),specs.map(s=>s.sourceFile));
  assert.deepEqual(regions.map(r=>r.source_fingerprint),specs.map(s=>s.sourceFingerprint));
  assert.deepEqual(regions.map(r=>r.crop),[
    {x:2,y:0,width:2,height:3},
    {x:1,y:0,width:4,height:4},
    {x:3,y:0,width:4,height:5},
  ]);
  assert.ok(regions.every(r=>r.crop.x+r.crop.width<=r.source_width && r.crop.y+r.crop.height<=r.source_height));
  assert.ok(Math.abs(regions.reduce((sum,r)=>sum+r.output_height,0)-1)<1e-12);
});

test('crop beginning or ending exactly at a source boundary excludes the adjacent image', () => {
  const {doc,sources}=fixture([
    source(0,0,'first.jpg',4,3),
    source(1,1,'second.jpg',4,4),
    source(2,2,'third.jpg',4,5),
  ]);
  const beginsAtBoundary=mapStripCropToSourceRegions(doc,{x:0,y:25,w:100,h:50},sources);
  assert.deepEqual(beginsAtBoundary.map(r=>r.source_file),['second.jpg','third.jpg']);
  const endsAtBoundary=mapStripCropToSourceRegions(doc,{x:0,y:0,w:100,h:25},sources);
  assert.deepEqual(endsAtBoundary.map(r=>r.source_file),['first.jpg']);
  assert.equal(endsAtBoundary[0].crop.y+endsAtBoundary[0].crop.height,3);
});

test('panel crossing exactly two boundaries returns three nonempty source regions without gaps', () => {
  const {doc,sources}=fixture([
    source(0,0,'first.jpg',4,3),
    source(1,1,'second.jpg',4,4),
    source(2,2,'third.jpg',4,5),
  ]);
  const regions=mapStripCropToSourceRegions(doc,{x:0,y:2/12*100,w:100,h:8/12*100},sources);
  assert.deepEqual(regions.map(r=>r.source_file),['first.jpg','second.jpg','third.jpg']);
  assert.deepEqual(regions.map(r=>r.crop),[
    {x:0,y:2,width:4,height:1},
    {x:0,y:0,width:4,height:4},
    {x:0,y:0,width:4,height:3},
  ]);
  assert.ok(Math.abs(regions.reduce((sum,r)=>sum+r.output_height,0)-1)<1e-12);
});

test('source mapping refuses missing source metadata rather than writing null attribution', () => {
  const doc=joinStripProfiles([{pageIndex:0,width:4,height:2,profile:profile([10,20])}]);
  assert.throws(()=>mapStripCropToSourceRegions(doc,{x:0,y:0,w:100,h:100},[{pageIndex:0,sourceIndex:0,sourceFile:'a.jpg',sourceFingerprint:null,sourceWidth:4,height:2}]),/Metadata nguồn không đầy đủ/);
});
