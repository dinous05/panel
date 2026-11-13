import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { remapManifestPaths, validateManifest } from '../src/manifest-core.js';

const naturalCompare = (a,b) => String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
const toPosix = value => String(value).replace(/\\/g,'/');

function resolveInside(root, relative) {
  const normalized = toPosix(relative);
  const parts = normalized.split('/');
  if (!normalized || path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Đường dẫn panel không an toàn: ${relative}`);
  const absolute = path.resolve(root,...parts);
  if (!absolute.startsWith(path.resolve(root)+path.sep)) throw new Error(`Đường dẫn panel vượt ngoài thư mục: ${relative}`);
  return absolute;
}

async function walkImages(root, relative = '') {
  const entries = await fs.readdir(root,{withFileTypes:true});
  entries.sort((a,b)=>naturalCompare(a.name,b.name));
  const result=[];
  for(const entry of entries){
    if(entry.isSymbolicLink()) continue;
    const rel=relative?`${relative}/${entry.name}`:entry.name;
    const abs=path.join(root,entry.name);
    if(entry.isDirectory()) result.push(...await walkImages(abs,rel));
    else if(entry.isFile() && /\.(jpe?g|png|webp|bmp)$/i.test(entry.name)) result.push({abs,relativePath:rel});
  }
  return result;
}

function safeFlatPart(value){
  const cleaned=String(value||'panel').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim();
  return cleaned ? cleaned.slice(0,100) : 'panel';
}

export async function exportStagedOutput({ stagingDir, outputDir, layout, manifest }) {
  try {
    if(!['preserve','flat'].includes(layout)) throw new Error('Kiểu sắp xếp folder không hợp lệ.');
    const initialValidation=validateManifest(manifest);
    if(!initialValidation.valid) throw new Error(`Manifest không hợp lệ: ${initialValidation.errors.join(' ')}`);
    const files=await walkImages(stagingDir);
    const stagedPaths=new Set(files.map(file=>toPosix(file.relativePath)));
    const panelPaths=manifest.panels.map(panel=>toPosix(panel.file));
    if(new Set(panelPaths).size!==panelPaths.length) throw new Error('Một file ảnh được tham chiếu bởi nhiều panel trong manifest.');
    if(stagedPaths.size!==panelPaths.length || panelPaths.some(file=>!stagedPaths.has(file))) throw new Error('Manifest không khớp đầy đủ với ảnh trong vùng tạm; chưa hoàn tất xuất.');

    const exportedPaths=new Map();
    if(layout==='preserve'){
      for(const file of files){
        const destination=resolveInside(outputDir,file.relativePath);
        await fs.mkdir(path.dirname(destination),{recursive:true});
        await fs.copyFile(file.abs,destination,constants.COPYFILE_EXCL);
        exportedPaths.set(toPosix(file.relativePath),toPosix(file.relativePath));
      }
    } else {
      const filesByPath=new Map(files.map(file=>[toPosix(file.relativePath),file]));
      for(let index=0;index<manifest.panels.length;index++){
        const source=filesByPath.get(toPosix(manifest.panels[index].file));
        const relative=source.relativePath.split(/[\\/]/).map(safeFlatPart).join('__');
        const outputName=`${String(index+1).padStart(6,'0')}__${relative}`;
        await fs.copyFile(source.abs,resolveInside(outputDir,outputName),constants.COPYFILE_EXCL);
        exportedPaths.set(toPosix(source.relativePath),outputName);
      }
    }
    const exportedManifest=remapManifestPaths(manifest,exportedPaths);
    const validation=validateManifest(exportedManifest);
    if(!validation.valid) throw new Error(`Manifest không hợp lệ sau remap: ${validation.errors.join(' ')}`);
    for(const panel of exportedManifest.panels){
      const diskPath=resolveInside(outputDir,panel.file);
      const stat=await fs.stat(diskPath);
      if(!stat.isFile() || stat.size===0) throw new Error(`Ảnh panel thiếu hoặc rỗng: ${panel.file}`);
    }
    const manifestText=`${JSON.stringify(exportedManifest,null,2)}\n`;
    JSON.parse(manifestText);
    await fs.writeFile(path.join(outputDir,'manifest.json'),manifestText,{encoding:'utf8',flag:'wx'});
    return exportedManifest;
  } catch(error) {
    await fs.rm(outputDir,{recursive:true,force:true});
    throw error;
  }
}
