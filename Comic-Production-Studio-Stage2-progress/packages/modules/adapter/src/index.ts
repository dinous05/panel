import type { ModuleDescriptor } from '../../../contracts/src/index.js';
export const descriptor: ModuleDescriptor = { id:'adapter', title:'PanelVid Adapter', description:'Manifest/UUID mapping, Logical Pages and export; legacy behavior is preserved for integration.', owner:'adapter', status:'integration-pending' };
export interface AdapterPort { validate(input: { projectPath: string }): Promise<{ valid: boolean; issues: string[] }>; export(input: { projectPath: string; destination: string }): Promise<{ outputPath: string }>; }
