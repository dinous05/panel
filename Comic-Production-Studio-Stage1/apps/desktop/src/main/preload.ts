import { contextBridge, ipcRenderer } from 'electron';
const api={
 chooseProjectParent:()=>ipcRenderer.invoke('project:choose-parent'), chooseExistingProject:()=>ipcRenderer.invoke('project:choose-existing'),
 createProject:(parent:string,name:string)=>ipcRenderer.invoke('project:create',{parent,name}), openProject:(projectPath:string)=>ipcRenderer.invoke('project:open',{path:projectPath}), inspectProjectAccess:(projectPath:string)=>ipcRenderer.invoke('project:access',{path:projectPath}),
 listProjects:(parent:string)=>ipcRenderer.invoke('project:list',{parent}), backupProject:(projectPath:string,backupParent:string)=>ipcRenderer.invoke('project:backup',{projectPath,backupParent}), restoreProject:(backupPath:string,destinationPath:string)=>ipcRenderer.invoke('project:restore',{backupPath,destinationPath})
};
contextBridge.exposeInMainWorld('cps',api);
