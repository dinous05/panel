import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAnalysisSummary, readManifestSummary } from '../src/shared/import-data';
import { buildPanelMapping } from '../src/shared/panel-mapping';
import { countImagesInFolder } from '../src/shared/image-files';
import type { AnalysisDocument, ImportedAnalysis, ManifestDocument } from '../src/shared/types';

const root = process.env.PANELVID_REAL_PANEL_ROOT;
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real-sample');

async function readRealAnalysis(fileName: string): Promise<ImportedAnalysis> {
  const filePath = path.join(fixtures, fileName);
  const data = JSON.parse(await readFile(filePath, 'utf8')) as AnalysisDocument;
  return { ...readAnalysisSummary(data, fileName), data };
}

describe('user-provided full panel folders', () => {
  it('resolves all real Manifest panels and maps the two real chapters by UUID', async () => {
    if (!root) {
      throw new Error('Thiếu PANELVID_REAL_PANEL_ROOT. Đặt biến này tới thư mục chứa Chapter 0001 và Chapter 0002; xem README.md mục Kiểm thử dữ liệu ảnh thật.');
    }
    expect(await countImagesInFolder(path.join(root, 'Chapter 0001'))).toBe(112);
    expect(await countImagesInFolder(path.join(root, 'Chapter 0002'))).toBe(113);

    const manifestFile = path.join(fixtures, 'manifest.json');
    const manifestData = JSON.parse(await readFile(manifestFile, 'utf8')) as ManifestDocument;
    const manifestSummary = readManifestSummary(manifestData, manifestFile);
    expect(manifestSummary.panelCount).toBe(225);
    const analyses = await Promise.all([
      readRealAnalysis('analysis_result_chapter_0001.json'),
      readRealAnalysis('analysis_result_chapter_0002.json')
    ]);
    const mapping = await buildPanelMapping(manifestData, analyses, root);

    expect(mapping.statistics).toMatchObject({
      totalPanels: 225,
      distinctUuidsUsed: 219,
      imagesFound: 225,
      imagesMissing: 0,
      imagesInvalid: 0,
      imagePathErrors: 0,
      invalidUuidReferences: 0,
      unknownUuidReferences: 0,
      invalidManifestUuids: 0,
      duplicateManifestUuidGroups: 0,
      unusedPanels: 6
    });
    expect(mapping.chapters.map(chapter => chapter.beats.length)).toEqual([29, 25]);
    expect(mapping.chapters[0].beats[0].panels.map(panel => panel.referenceUuid)).toEqual(
      (analyses[0].data.voice_beats?.[0] as { panel_uuids: string[] }).panel_uuids
    );
    const joinedSourcePanel = (manifestData.panels ?? []).map(panel => panel as Record<string, unknown>)
      .find(panel => panel.source_file === null && Array.isArray(panel.source_regions) && panel.source_regions.length > 1);
    expect(joinedSourcePanel).toBeDefined();
    const joinedSourceUuid = joinedSourcePanel?.uuid;
    const joinedSourceReference = mapping.chapters.flatMap(chapter => chapter.beats)
      .flatMap(beat => beat.panels).find(panel => panel.referenceUuid === joinedSourceUuid);
    expect(joinedSourceReference).toMatchObject({ status: 'mapped', imageStatus: 'found', sourceFileIsNull: true });
  });
});
