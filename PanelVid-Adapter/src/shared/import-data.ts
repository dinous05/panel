import type { AnalysisSummary, BatchReportSummary, ManifestSummary } from './types';

export function parseJsonText(text: string, fileName: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Cú pháp JSON không hợp lệ.';
    throw new Error(`${fileName}: ${reason}`);
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function primitiveOrNull(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

export function readManifestSummary(value: unknown, path: string): ManifestSummary {
  const root = objectValue(value);
  if (!root) throw new Error('Manifest phải là một JSON object.');
  const project = objectValue(root.project);
  return {
    path,
    fileName: path.split(/[\\/]/).at(-1) ?? path,
    projectName: textOrNull(project?.project_name),
    projectId: textOrNull(project?.project_id),
    schemaVersion: primitiveOrNull(root.schema_version),
    panelCount: Array.isArray(root.panels) ? root.panels.length : null
  };
}

export function readAnalysisSummary(value: unknown, path: string): AnalysisSummary {
  const root = objectValue(value);
  if (!root) throw new Error('Analysis JSON phải là một JSON object.');
  const chapter = objectValue(root.chapter);
  return {
    path,
    fileName: path.split(/[\\/]/).at(-1) ?? path,
    series: textOrNull(chapter?.series),
    chapterNumber: primitiveOrNull(chapter?.number),
    chapterTitle: textOrNull(chapter?.title),
    voiceBeatCount: Array.isArray(root.voice_beats) ? root.voice_beats.length : null
  };
}

export function readBatchReportSummary(value: unknown, path: string): BatchReportSummary {
  const root = objectValue(value);
  if (!root) throw new Error('Batch Report phải là một JSON object.');
  const totals = objectValue(root.totals);
  return {
    path,
    fileName: path.split(/[\\/]/).at(-1) ?? path,
    chapterCount: typeof totals?.chapters === 'number'
      ? totals.chapters
      : Array.isArray(root.chapters) ? root.chapters.length : null,
    beatCount: typeof totals?.beats === 'number' ? totals.beats : null,
    panelReferences: typeof totals?.panel_references_total === 'number' ? totals.panel_references_total : null
  };
}
