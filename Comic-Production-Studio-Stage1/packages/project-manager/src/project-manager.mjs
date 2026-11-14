import { randomUUID } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LAYOUT = ['source/originals','panels/images','analysis/incoming','adapter','audio/tts','audio/voice-clones','subtitles','video/renders','logs','backups'];
const MARKER = 'project.json';
const isDirectory = async p => (await lstat(p)).isDirectory();
async function isEmptyDirectory(dir) { return (await readdir(dir)).length === 0; }
function safeName(s) {
  const value = String(s ?? '').trim();
  if (!value || value.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || value === '.' || value === '..') throw new Error('Tên Project không hợp lệ.');
  return value;
}
function relativeInside(root, rel) {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Đường dẫn nằm ngoài Project.');
  return abs;
}
export async function createProject(parentPath, name, appVersion='0.1.0') {
  const cleanName = safeName(name), parent = path.resolve(parentPath), projectPath = path.join(parent, cleanName);
  await mkdir(parent, { recursive: true });
  try { await mkdir(projectPath); } catch (e) { if (e.code === 'EEXIST') throw new Error('Thư mục đích đã tồn tại; không ghi đè dữ liệu.'); throw e; }
  try {
    const paths = { originals:'source/originals', panels:'panels', analysis:'analysis', adapter:'adapter', audio:'audio', subtitles:'subtitles', video:'video', logs:'logs', backups:'backups' };
    for (const rel of LAYOUT) await mkdir(relativeInside(projectPath, rel), { recursive:true });
    const now = new Date().toISOString();
    const metadata = { schemaVersion:1, projectId:randomUUID(), name:cleanName, createdAt:now, updatedAt:now, appVersion, paths };
    await writeFile(path.join(projectPath, MARKER), JSON.stringify(metadata,null,2)+'\n', { encoding:'utf8', flag:'wx' });
    return { path:projectPath, metadata };
  } catch (e) { await rm(projectPath, { recursive:true, force:true }); throw e; }
}
export async function openProject(projectPath) {
  const root = path.resolve(projectPath), marker = path.join(root, MARKER);
  const metadata = JSON.parse(await readFile(marker,'utf8'));
  if (metadata.schemaVersion !== 1 || !metadata.projectId || !metadata.name) throw new Error('Project metadata không hợp lệ hoặc chưa hỗ trợ.');
  for (const rel of LAYOUT) { const target=relativeInside(root,rel); try { if (!(await isDirectory(target))) throw new Error(`Đường dẫn Project không phải thư mục: ${rel}`); } catch(e) { if(e.code==='ENOENT') throw new Error(`Project thiếu thư mục bắt buộc: ${rel}`); throw e; } }
  return { path:root, metadata };
}
export async function listProjects(parentPath) {
  const parent=path.resolve(parentPath); let entries;
  try { entries=await readdir(parent,{withFileTypes:true}); } catch(e) { if(e.code==='ENOENT') return []; throw e; }
  const found=[];
  for(const ent of entries) if(ent.isDirectory()) { try { found.push(await openProject(path.join(parent,ent.name))); } catch {} }
  return found;
}
export async function backupProject(projectPath, backupParent) {
  const project=await openProject(projectPath), parent=path.resolve(backupParent);
  await mkdir(parent,{recursive:true});
  const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
  const stage=path.join(parent,`.${project.metadata.name}-${timestamp}-${randomUUID()}.staging`);
  const dest=path.join(parent,`${project.metadata.name}-${timestamp}.backup`);
  await mkdir(stage);
  try {
    for(const item of await readdir(project.path,{withFileTypes:true})) {
      if(item.name==='backups') continue;
      const from=path.join(project.path,item.name), to=path.join(stage,item.name);
      if(item.isDirectory()) await cp(from,to,{recursive:true,errorOnExist:true,force:false});
      else await copyFile(from,to);
    }
    await writeFile(path.join(stage,'backup-info.json'),JSON.stringify({projectId:project.metadata.projectId,createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
    await rename(stage,dest);
    return dest;
  } catch(e) { await rm(stage,{recursive:true,force:true}); throw e; }
}
export async function restoreProject(backupPath, destinationPath) {
  const backup=path.resolve(backupPath), dest=path.resolve(destinationPath);
  const info=JSON.parse(await readFile(path.join(backup,'backup-info.json'),'utf8'));
  const metadata=JSON.parse(await readFile(path.join(backup,MARKER),'utf8'));
  if(info.projectId!==metadata.projectId) throw new Error('Backup identity does not match project metadata.');
  await mkdir(path.dirname(dest),{recursive:true});
  try { await mkdir(dest); } catch(e) { if(e.code==='EEXIST') throw new Error('Restore destination already exists; no data was overwritten.'); throw e; }
  try { for(const item of await readdir(backup,{withFileTypes:true})) if(item.name!=='backup-info.json') { const from=path.join(backup,item.name),to=path.join(dest,item.name); if(item.isDirectory()) await cp(from,to,{recursive:true,errorOnExist:true,force:false}); else await copyFile(from,to); } }
  catch(e) { await rm(dest,{recursive:true,force:true}); throw e; }
  await mkdir(path.join(dest, 'backups'), { recursive:true });
  return openProject(dest);
}
export async function inspectProject(projectPath) { const p=await openProject(projectPath); const files=await stat(p.path); return { ...p, modifiedAt:files.mtime.toISOString() }; }
