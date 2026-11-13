import type { MappingResult } from './types';
import type { ExportValidationIssue } from './export-validation';

export interface ExportedPanelRecord {
  uuid: string;
  source_filename: string;
  export_filename: string;
  logical_page_index: number;
  scene_index: number;
  panel_order: number;
  source_path: string;
}
export interface ExportChapterRecord {
  chapter_id: string | number;
  chapter_name: string;
  page_count: number;
  scene_count: number;
  panel_count: number;
  srt_cue_count: number;
  export_status: 'success';
  panels: ExportedPanelRecord[];
}
export interface ExportReport {
  schema_version: '1.0';
  project_id: string | null;
  project_name: string | null;
  export_timestamp: string;
  total_chapters: number;
  total_pages: number;
  total_panels: number;
  total_srt_cues: number;
  chapter_results: ExportChapterRecord[];
  validation_errors: Array<{ code: string; message: string }>;
  validation_warnings: Array<{ code: string; message: string }>;
  exported_files: string[];
  export_status: 'success';
}

export function createExportReport(input: {
  mapping: MappingResult;
  chapters: ExportChapterRecord[];
  validationIssues: ExportValidationIssue[];
  exportedFiles: string[];
  exportTimestamp?: string;
}): ExportReport {
  const validationErrors = input.validationIssues.filter(issue => issue.severity === 'error').map(({ code, message }) => ({ code, message }));
  if (validationErrors.length) throw new Error('Không thể tạo report thành công khi còn lỗi validation.');
  const validationWarnings = input.validationIssues.filter(issue => issue.severity === 'warning').map(({ code, message }) => ({ code, message }));
  return {
    schema_version: '1.0',
    project_id: input.mapping.projectId,
    project_name: input.mapping.projectName,
    export_timestamp: input.exportTimestamp ?? new Date().toISOString(),
    total_chapters: input.chapters.length,
    total_pages: input.chapters.reduce((sum, chapter) => sum + chapter.page_count, 0),
    total_panels: input.chapters.reduce((sum, chapter) => sum + chapter.panel_count, 0),
    total_srt_cues: input.chapters.reduce((sum, chapter) => sum + chapter.srt_cue_count, 0),
    chapter_results: input.chapters,
    validation_errors: validationErrors,
    validation_warnings: validationWarnings,
    exported_files: [...input.exportedFiles, 'export_report.json'],
    export_status: 'success'
  };
}
