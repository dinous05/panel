import { validateLogicalPages, type LogicalPageDocument, type LogicalPageIssue } from './logical-pages';
import type { MappingResult } from './types';

export interface ExportValidationIssue { severity: 'error' | 'warning'; code: string; message: string; chapterKey?: string; pageId?: string }

export function validateExport(mapping: MappingResult, document: LogicalPageDocument): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = validateLogicalPages(document, mapping).map((issue: LogicalPageIssue) => ({
    severity: issue.severity, code: issue.code, message: issue.message, pageId: issue.pageId
  }));
  for (const page of document.pages) {
    if (!page.beat.narration.trim()) issues.push({ severity: 'error', code: 'empty-narration', message: `Voice Beat “${page.beat.beatId ?? page.beatIndex + 1}” không có narration; không thể tạo SRT.`, chapterKey: page.chapterKey, pageId: page.id });
    for (const scene of page.scenes) for (const panel of scene.panels) {
      if (panel.reference.status !== 'mapped') issues.push({ severity: 'error', code: 'panel-not-mapped', message: `Panel UUID ${panel.reference.referenceUuid} có trạng thái ${panel.reference.status}.`, chapterKey: page.chapterKey, pageId: page.id });
      if (!panel.reference.manifestFile || !panel.reference.resolvedPath) {
        issues.push({ severity: 'error', code: 'missing-image-path', message: `Không có đường dẫn ảnh đã mapping cho UUID ${panel.reference.referenceUuid}.`, chapterKey: page.chapterKey, pageId: page.id });
      }
      if (panel.reference.imageStatus !== 'found') {
        issues.push({ severity: 'error', code: 'image-not-verified', message: `Ảnh UUID ${panel.reference.referenceUuid} chưa được xác minh đọc được (${panel.reference.imageStatus}).`, chapterKey: page.chapterKey, pageId: page.id });
      }
    }
  }
  const errors = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.code}|${issue.pageId ?? ''}|${issue.message}`;
    if (errors.has(key)) return false;
    errors.add(key);
    return true;
  });
}
