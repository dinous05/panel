declare module '*.mjs' {
  import type { ProjectSummary } from '../../../../packages/contracts/src/index';
  export function createProject(parentPath:string,name:string,appVersion?:string):Promise<ProjectSummary>;
  export function openProject(projectPath:string):Promise<ProjectSummary>;
  export function listProjects(parentPath:string):Promise<ProjectSummary[]>;
  export function backupProject(projectPath:string,backupParent:string):Promise<string>;
  export function restoreProject(backupPath:string,destinationPath:string):Promise<ProjectSummary>;
  export function inspectProjectAccess(projectPath:string):Promise<{projectId:string;writable:Record<string,boolean>;readOnlyModules:string[]}>;
}
