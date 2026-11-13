import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonText, readAnalysisSummary, readBatchReportSummary, readManifestSummary } from '../src/shared/import-data';
import { countImagesInFolder } from '../src/shared/image-files';

const root = process.env.PANELVID_REAL_SAMPLE_ROOT;
const analysisRoot = process.env.PANELVID_ANALYSIS_SAMPLE_ROOT;

describe('user-provided real sample integration', () => {
  it.skipIf(!root || !analysisRoot)('reads manifest, two chapter analyses, batch report, and counts panel images', async () => {
    const manifestPath = path.join(root!, 'manifest.json');
    const manifest = readManifestSummary(parseJsonText(await readFile(manifestPath, 'utf8'), 'manifest.json'), manifestPath);
    expect(manifest).toMatchObject({ projectName: 'The Regressed Mercenary Has a Plan 1-2 - bundle', panelCount: 225 });

    const ch1Path = path.join(analysisRoot!, 'analysis_result_chapter_0001.json');
    const ch2Path = path.join(analysisRoot!, 'analysis_result_chapter_0002.json');
    const ch1 = readAnalysisSummary(parseJsonText(await readFile(ch1Path, 'utf8'), path.basename(ch1Path)), ch1Path);
    const ch2 = readAnalysisSummary(parseJsonText(await readFile(ch2Path, 'utf8'), path.basename(ch2Path)), ch2Path);
    expect(ch1.voiceBeatCount).toBe(29);
    expect(ch2.voiceBeatCount).toBe(25);

    const reportPath = path.join(analysisRoot!, 'batch_report.json');
    const report = readBatchReportSummary(parseJsonText(await readFile(reportPath, 'utf8'), path.basename(reportPath)), reportPath);
    expect(report).toMatchObject({ chapterCount: 2, beatCount: 54, panelReferences: 219 });
    expect(await countImagesInFolder(path.join(root!, 'Chapter 0001'))).toBe(112);
    expect(await countImagesInFolder(path.join(root!, 'Chapter 0002'))).toBe(113);
  });
});
