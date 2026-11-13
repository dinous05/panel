import { describe, expect, it } from 'vitest';
import { parseJsonText, readAnalysisSummary, readBatchReportSummary, readManifestSummary } from '../src/shared/import-data';

describe('Phase 1 JSON import summaries', () => {
  it('parses UTF-8 BOM JSON and reports a useful syntax error', () => {
    expect(parseJsonText('\uFEFF{"ok":true}', 'sample.json')).toEqual({ ok: true });
    expect(() => parseJsonText('{ broken', 'bad.json')).toThrow(/bad\.json/);
  });

  it('reads project name and panel count without enforcing Phase 2 validation', () => {
    expect(readManifestSummary({ schema_version: 1, project: { project_name: 'Demo' }, panels: [{}, {}] }, '/tmp/manifest.json'))
      .toMatchObject({ projectName: 'Demo', panelCount: 2, schemaVersion: 1 });
    expect(readManifestSummary({ project: {} }, '/tmp/manifest.json').panelCount).toBeNull();
  });

  it('counts voice beats in the supplied AI analysis shape', () => {
    const summary = readAnalysisSummary({ chapter: { series: 'Series', number: 2 }, voice_beats: [{}, {}, {}] }, '/tmp/analysis.json');
    expect(summary).toMatchObject({ series: 'Series', chapterNumber: 2, voiceBeatCount: 3 });
  });

  it('reads optional batch totals', () => {
    expect(readBatchReportSummary({ totals: { chapters: 2, beats: 54, panel_references_total: 219 } }, '/tmp/batch_report.json'))
      .toMatchObject({ chapterCount: 2, beatCount: 54, panelReferences: 219 });
  });
});
