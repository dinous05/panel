import type { ProjectSummary } from '../../contracts/src/index.js';
export function createProject(parentPath:string,name:string,appVersion?:string):Promise<ProjectSummary>;
export function openProject(projectPath:string):Promise<ProjectSummary>;
export function listProjects(parentPath:string):Promise<ProjectSummary[]>;
export function backupProject(projectPath:string,backupParent:string):Promise<string>;
export function restoreProject(backupPath:string,destinationPath:string):Promise<ProjectSummary>;
export function inspectProject(projectPath:string):Promise<ProjectSummary & {modifiedAt:string}>;
