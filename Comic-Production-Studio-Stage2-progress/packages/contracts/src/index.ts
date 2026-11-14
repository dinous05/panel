export type ModuleId = 'dashboard' | 'panel-cutter' | 'ai-import' | 'adapter' | 'video-studio' | 'export-history' | 'settings';
export type OwnerModule = 'project-manager' | 'panel-cutter' | 'ai-import' | 'adapter' | 'video-studio' | 'system';
export interface ModuleDescriptor { id: ModuleId; title: string; description: string; owner: OwnerModule; status: 'available' | 'integration-pending'; }
export interface ProjectMetadata {
  schemaVersion: 1;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  paths: { originals: string; panels: string; analysis: string; adapter: string; audio: string; subtitles: string; video: string; logs: string; backups: string };
}
export interface ProjectSummary { path: string; metadata: ProjectMetadata; }
export interface CommandRequest<T = unknown> { requestId: string; module: OwnerModule; command: string; payload: T; }
export type CommandResult<T = unknown> = { ok: true; requestId: string; data: T } | { ok: false; requestId: string; error: { code: string; message: string; module: OwnerModule } };
export const PROJECT_LAYOUT = ['source/originals', 'panels/images', 'analysis/incoming', 'adapter', 'audio/tts', 'audio/voice-clones', 'subtitles', 'video/renders', 'logs', 'backups'] as const;
export const DEFAULT_MODULES: ModuleDescriptor[] = [
 { id:'dashboard', title:'Dashboard', description:'Project overview and recent activity', owner:'project-manager', status:'available' },
 { id:'panel-cutter', title:'PanelCutter', description:'Split comic pages into panels', owner:'panel-cutter', status:'integration-pending' },
 { id:'ai-import', title:'AI Analysis Import', description:'Import external analysis JSON; no AI API is used', owner:'ai-import', status:'available' },
 { id:'adapter', title:'PanelVid Adapter', description:'Map panel UUIDs, organize logical pages and export', owner:'adapter', status:'integration-pending' },
 { id:'video-studio', title:'Video Studio', description:'TTS, subtitles, timeline and MP4 rendering', owner:'video-studio', status:'integration-pending' },
 { id:'export-history', title:'Export & History', description:'Project export and job history', owner:'project-manager', status:'integration-pending' },
 { id:'settings', title:'Settings', description:'Application and project settings', owner:'project-manager', status:'available' }
];
