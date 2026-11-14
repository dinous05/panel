import type { ModuleDescriptor } from '../../../contracts/src/index.js';
export const descriptor: ModuleDescriptor = { id:'video-studio', title:'Video Studio', description:'TTS, SRT, timeline and FFmpeg rendering; legacy implementation is preserved for integration.', owner:'video-studio', status:'integration-pending' };
export interface VideoStudioPort { createVoice(input: { projectPath: string; cuesPath: string }): Promise<{ audioFiles: string[] }>; render(input: { projectPath: string }): Promise<{ videoPath: string }>; }
