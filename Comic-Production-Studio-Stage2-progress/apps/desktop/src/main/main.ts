import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupProject, createProject, inspectProjectAccess, listProjects, openProject, restoreProject } from '../../../../packages/project-manager/src/project-manager.mjs';
import { importAnalysisFiles } from '../../../../packages/modules/ai-import/src/importer.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
let win:BrowserWindow|undefined;
let authorizedAnalysisFiles = new Set<string>();
function registerIpc(){
 ipcMain.handle('project:choose-parent',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']}); return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('project:choose-existing',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']}); return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('project:create',async(_e,{parent,name})=>createProject(parent,name));
 ipcMain.handle('project:open',async(_e,{path:p})=>openProject(p));
 ipcMain.handle('project:access',async(_e,{path:p})=>inspectProjectAccess(p));
 ipcMain.handle('project:list',async(_e,{parent})=>listProjects(parent));
 ipcMain.handle('project:backup',async(_e,{projectPath,backupParent})=>backupProject(projectPath,backupParent));
	 ipcMain.handle('project:restore',async(_e,{backupPath,destinationPath})=>restoreProject(backupPath,destinationPath));
		 ipcMain.handle('analysis:choose-files',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openFile','multiSelections'],filters:[{name:'JSON',extensions:['json']}]}); authorizedAnalysisFiles=new Set(r.canceled?[]:r.filePaths); return [...authorizedAnalysisFiles];});
		 ipcMain.handle('analysis:import',async(_e,{projectPath,files})=>{
		  if(!Array.isArray(files)||files.length<1||files.length>200||files.some(item=>typeof item!=='string')) throw new Error('Danh sách file JSON không hợp lệ.');
		  if(files.some(item=>!authorizedAnalysisFiles.has(item))) throw new Error('Hãy chọn lại file JSON bằng hộp thoại.');
		  files.forEach(item=>authorizedAnalysisFiles.delete(item));
		  const project=await openProject(projectPath);
	  return importAnalysisFiles(project.path,files);
	 });
}
function createWindow(){
 win=new BrowserWindow({width:1320,height:860,minWidth:980,minHeight:680,webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const dev=process.env.VITE_DEV_SERVER_URL;
 if(dev) void win.loadURL(dev); else void win.loadFile(path.join(here,'../dist/index.html'));
 win.webContents.on('did-finish-load',()=>console.log(`[shell] renderer loaded: ${win?.webContents.getURL()}`));
 win.webContents.on('did-fail-load',(_event,code,description,url)=>console.error(`[shell] renderer load failed (${code}): ${description} — ${url}`));
 win.webContents.on('render-process-gone',(_event,details)=>console.error(`[shell] renderer process exited: ${details.reason} (${details.exitCode})`));
 win.on('closed',()=>{win=undefined;});
}
app.whenReady().then(()=>{registerIpc();createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
