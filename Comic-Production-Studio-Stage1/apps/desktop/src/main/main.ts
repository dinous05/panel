import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupProject, createProject, listProjects, openProject, restoreProject } from '../../../../packages/project-manager/src/project-manager.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
let win:BrowserWindow|undefined;
function registerIpc(){
 ipcMain.handle('project:choose-parent',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']}); return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('project:choose-existing',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']}); return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('project:create',async(_e,{parent,name})=>createProject(parent,name));
 ipcMain.handle('project:open',async(_e,{path:p})=>openProject(p));
 ipcMain.handle('project:list',async(_e,{parent})=>listProjects(parent));
 ipcMain.handle('project:backup',async(_e,{projectPath,backupParent})=>backupProject(projectPath,backupParent));
 ipcMain.handle('project:restore',async(_e,{backupPath,destinationPath})=>restoreProject(backupPath,destinationPath));
}
function createWindow(){
 win=new BrowserWindow({width:1320,height:860,minWidth:980,minHeight:680,webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const dev=process.env.VITE_DEV_SERVER_URL;
 if(dev) void win.loadURL(dev); else void win.loadFile(path.join(here,'../dist/index.html'));
 win.on('closed',()=>{win=undefined;});
}
app.whenReady().then(()=>{registerIpc();createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
