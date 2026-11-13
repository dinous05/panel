import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportStagedOutput } from '../electron/export-core.js';
import { validateManifest } from '../src/manifest-core.js';

const source=(file,page,y=0,height=100)=>({source_page:page,source_file:file,source_fingerprint:createHash('sha256').update(file).digest('hex'),source_width:800,source_height:1000,crop:{x:0,y,width:800,height},output_y:0,output_height:1});
function editedFlowManifest(){
  const base={schema_version:'1.0',project:{project_id:'project-uuid',project_name:'Sample',created_at:'2026-11-13T00:00:00Z',exported_at:'2026-11-13T00:05:00Z'},source:{source_type:'FOLDER',source_name:'Sample',reading_direction:'rtl',comic_type:'manga'},coordinate_system:{units:'pixel',origin:'top_left',crop:'half-open'},export_layout:'preserve'};
  // Equivalent final review state after reorder, split, and merge:
  // P000002 moved first; P000001 second; split children P000003/4 were merged as P000005.
  const panels=[
    {id:'P000002',uuid:'uuid-2',file:'ch1/page-02/panel_001.jpg',order:1,source_page:2,source_file:'page-02.jpg',width:800,height:100,source_regions:[source('page-02.jpg',2)],decision:'SHOW',review_required:false,edit_history:[{action:'reorder'}],parent_ids:[]},
    {id:'P000001',uuid:'uuid-1',file:'ch1/page-01/panel_001.jpg',order:2,source_page:1,source_file:'page-01.jpg',width:800,height:100,source_regions:[source('page-01.jpg',1)],decision:'SHOW',review_required:false,edit_history:[{action:'reorder'}],parent_ids:[]},
    {id:'P000005',uuid:'uuid-5',file:'ch1/page-02/panel_002.jpg',order:3,source_page:null,source_file:null,width:800,height:200,source_regions:[source('page-02.jpg',2,200,50,0.5),source('page-02.jpg',2,300,50,0.5)],decision:'SHOW',review_required:false,edit_history:[{action:'split',parent_id:'P000003'},{action:'split',parent_id:'P000004'},{action:'merge',source_ids:['P000003','P000004']}],parent_ids:['P000003','P000004']},
  ];
  return {...base,panels};
}
async function createFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'panelcutter-export-integration-'));
  const stagingDir=path.join(root,'staging'); await fs.mkdir(path.join(stagingDir,'ch1','page-01'),{recursive:true}); await fs.mkdir(path.join(stagingDir,'ch1','page-02'),{recursive:true});
  const manifest=editedFlowManifest();
  for(let i=0;i<manifest.panels.length;i++){
    const panel=manifest.panels[i], dest=path.join(stagingDir,...panel.file.split('/'));
    await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.writeFile(dest,Buffer.from(`test-image-${i}`));
  }
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,stagingDir,manifest};
}

for(const layout of ['preserve','flat']) test(`${layout} export integration writes matching manifest and all panel files`,async t=>{
  const {root,stagingDir,manifest}=await createFixture(t);
  const outputDir=path.join(root,`output-${layout}`); await fs.mkdir(outputDir);
  const written=await exportStagedOutput({stagingDir,outputDir,layout,manifest});
  const diskManifest=JSON.parse(await fs.readFile(path.join(outputDir,'manifest.json'),'utf8'));
  assert.deepEqual(diskManifest,written);
  assert.deepEqual(validateManifest(diskManifest),{valid:true,errors:[]});
  assert.deepEqual(diskManifest.panels.map(p=>p.order),[1,2,3]);
  assert.deepEqual(diskManifest.panels.map(p=>p.source_regions),manifest.panels.map(p=>p.source_regions));
  assert.ok(diskManifest.panels.every(panel=>panel.source_regions.every(region=>/^[a-f0-9]{64}$/.test(region.source_fingerprint) && region.source_file)));
  assert.equal(new Set(diskManifest.panels.map(p=>p.id)).size,3);
  assert.equal(new Set(diskManifest.panels.map(p=>p.uuid)).size,3);
  for(const panel of diskManifest.panels){
    const imagePath=path.resolve(outputDir,...panel.file.split('/'));
    assert.ok(imagePath.startsWith(outputDir+path.sep));
    assert.ok((await fs.stat(imagePath)).size>0);
  }
  const files=[];
  async function scan(dir,rel=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isDirectory())await scan(path.join(dir,entry.name),rel?`${rel}/${entry.name}`:entry.name);else if(/\.(jpg|jpeg|png|webp|bmp)$/i.test(entry.name))files.push(rel?`${rel}/${entry.name}`:entry.name);}}
  await scan(outputDir);
  assert.equal(files.length,diskManifest.panels.length);
  assert.deepEqual(new Set(files),new Set(diskManifest.panels.map(p=>p.file)));
  if(layout==='preserve') assert.ok(diskManifest.panels[0].file.includes('ch1/page-02'));
  else assert.ok(diskManifest.panels[0].file.startsWith('000001__'));
  assert.deepEqual(diskManifest.panels[2].parent_ids,['P000003','P000004']);
  assert.equal(diskManifest.panels[2].edit_history.at(-1).action,'merge');
  assert.ok(await fs.stat(stagingDir));
});

test('failed export removes partial output and retains staging for retry',async t=>{
  const {root,stagingDir,manifest}=await createFixture(t);
  const outputDir=path.join(root,'output-failure'); await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir,'manifest.json'),'existing');
  await assert.rejects(exportStagedOutput({stagingDir,outputDir,layout:'preserve',manifest}),/EEXIST|already exists/i);
  await assert.rejects(fs.stat(outputDir),{code:'ENOENT'});
  assert.ok(await fs.stat(stagingDir));
});

test('invalid UUID duplicates are rejected before exporting and leave staging intact',async t=>{
  const {root,stagingDir,manifest}=await createFixture(t);
  const outputDir=path.join(root,'output-invalid'); await fs.mkdir(outputDir);
  const invalid=structuredClone(manifest); invalid.panels[1].uuid=invalid.panels[0].uuid;
  await assert.rejects(exportStagedOutput({stagingDir,outputDir,layout:'flat',manifest:invalid}),/UUID panel bị trùng/);
  await assert.rejects(fs.stat(outputDir),{code:'ENOENT'});
  assert.ok(await fs.stat(stagingDir));
});
