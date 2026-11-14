import type { ModuleDescriptor } from '../../../contracts/src/index.js';
export const descriptor: ModuleDescriptor = { id:'panel-cutter', title:'PanelCutter', description:'Panel detection and editing module; legacy implementation is preserved in original-source.', owner:'panel-cutter', status:'integration-pending' };
export interface PanelCutterPort { run(input: { projectPath: string; sourcePath: string }): Promise<{ manifestPath: string; panelCount: number }>; }
