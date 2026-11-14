import type { ModuleDescriptor } from '../../../contracts/src/index.js';
export const descriptor: ModuleDescriptor = { id:'ai-import', title:'AI Analysis Import', description:'Local import and validation of externally generated analysis JSON.', owner:'ai-import', status:'integration-pending' };
export interface AnalysisImportPort { validateAndImport(input: { projectPath: string; files: string[] }): Promise<{ imported: number; warnings: string[] }>; }
