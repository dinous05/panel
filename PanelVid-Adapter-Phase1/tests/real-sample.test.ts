import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonText, readAnalysisSummary, readBatchReportSummary, readManifestSummary } from '../src/shared/import-data';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real-sample');
const readJson = async (fileName: string) => parseJsonText(await readFile(path.join(fixtures, fileName), 'utf8'), fileName);

describe('user-provided real JSON sample integration', () => {
  it('reads real manifest, two chapter analyses, and batch report with expected totals', async () => {
    const manifest = readManifestSummary(await readJson('manifest.json'), 'manifest.json');
    expect(manifest).toMatchObject({
      projectName: 'The Regressed Mercenary Has a Plan 1-2 - bundle',
      projectId: 'fc87f07d-165a-47d7-a188-5f76f67dc284',
      panelCount: 225
    });

    const ch1 = readAnalysisSummary(await readJson('analysis_result_chapter_0001.json'), 'analysis_result_chapter_0001.json');
    const ch2 = readAnalysisSummary(await readJson('analysis_result_chapter_0002.json'), 'analysis_result_chapter_0002.json');
    expect(ch1).toMatchObject({ chapterNumber: 1, voiceBeatCount: 29 });
    expect(ch2).toMatchObject({ chapterNumber: 2, voiceBeatCount: 25 });
    expect(ch1.voiceBeatCount! + ch2.voiceBeatCount!).toBe(54);

    const report = readBatchReportSummary(await readJson('batch_report.json'), 'batch_report.json');
    expect(report).toMatchObject({ chapterCount: 2, beatCount: 54, panelReferences: 219 });
  });
});
