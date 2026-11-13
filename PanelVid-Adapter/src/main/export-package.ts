import { mkdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExportProgress, ExportResult, MappingResult } from '../shared/types';
import { validateExport } from '../shared/export-validation';
import { createExportReport, type ExportChapterRecord, type ExportedPanelRecord } from '../shared/export-report';
import { buildChapterSrt } from '../shared/srt-generator';
import type { LogicalPage, LogicalPageDocument } from '../shared/logical-pages';
import { copyMappedPanelOccurrence } from './image-exporter';

function requireWritableParent(parentPath: string): string {
  const resolved = path.resolve(parentPath);
  if (!resolved || resolved === path.parse(resolved).root) throw new Error('Không dùng thư mục gốc ổ đĩa làm thư mục đích export.');
  return resolved;
}
function pageLabel(index: number): string { return `Page ${String(index + 1).padStart(3, '0')}`; }
function srtFileName(index: number): string { return `Chapter ${String(index + 1).padStart(3, '0')}.srt`; }
function chapterName(page: LogicalPage): string { return page.chapterLabel || 'Chapter'; }

export async function exportPackageToDirectory(
  mapping: MappingResult,
  document: LogicalPageDocument,
  outputParent: string,
  onProgress: (progress: ExportProgress) => void = () => undefined
): Promise<ExportResult> {
  const validation = validateExport(mapping, document);
  const errors = validation.filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(`Không thể export: ${errors.length} lỗi validation. ${errors.slice(0, 5).map(issue => issue.message).join(' ')}`);
  const parent = requireWritableParent(outputParent);
  const parentStat = await stat(parent);
  if (!parentStat.isDirectory()) throw new Error('Thư mục output đã chọn không tồn tại hoặc không phải thư mục.');
  const target = path.join(parent, 'PanelVid_Output');
  try { await stat(target); throw new Error('Thư mục PanelVid_Output đã tồn tại. Chọn thư mục cha khác để tránh ghi đè.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  const chapters = mapping.chapters.map((chapter, chapterOrder) => ({ chapter, pages: document.pages.filter(page => page.chapterKey === chapter.chapterKey), chapterOrder }));
  const flattenedPanels = chapters.flatMap(group => group.pages.flatMap(page => page.scenes.flatMap(scene => scene.panels)));
  const totalPanels = flattenedPanels.length;
  const totalSteps = totalPanels + chapters.length + 1;
  let completed = 0;
  const stage = path.join(parent, `.panelvid-export-${randomUUID()}`);
  let committed = false;
  const exportedFiles: string[] = [];
  const chapterResults: ExportChapterRecord[] = [];
  let totalBytes = 0;
  try {
    await mkdir(stage, { recursive: false });
    try {
      const space = await statfs(parent);
      const available = Number(space.bavail) * Number(space.bsize);
      const expected = await flattenedPanels.reduce(async (previous, panel) => {
        const subtotal = await previous;
        return subtotal + (panel.reference.resolvedPath ? (await stat(panel.reference.resolvedPath)).size : 0);
      }, Promise.resolve(0));
      const reserve = Math.max(16 * 1024 * 1024, Math.ceil(expected * 0.05));
      if (available < expected + reserve) throw new Error(`Không đủ dung lượng trống: cần khoảng ${Math.ceil((expected + reserve) / (1024 * 1024))} MiB kể cả dự phòng.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Không đủ dung lượng')) throw error;
      // statfs may not be implemented on a particular filesystem; copy errors remain fatal.
    }

    for (const { chapter, pages, chapterOrder } of chapters) {
      const folder = `Chapter_${String(chapterOrder + 1).padStart(3, '0')}`;
      const chapterDir = path.join(stage, folder);
      await mkdir(chapterDir, { recursive: true });
      const panelRecords: ExportedPanelRecord[] = [];
      let sceneCount = 0;
      let chapterPanelCount = 0;
      for (const [pageIndex, page] of pages.entries()) {
        if (page.id !== `${chapter.chapterKey}::beat-${page.beatIndex}` || page.beatIndex !== pageIndex) {
          throw new Error(`Thứ tự hoặc ID Logical Page không hợp lệ ở ${folder}, Page ${pageIndex + 1}.`);
        }
        const pageDirName = pageLabel(pageIndex);
        const pageDir = path.join(chapterDir, pageDirName);
        await mkdir(pageDir, { recursive: false });
        let panelOrder = 0;
        for (const [sceneIndex, scene] of page.scenes.entries()) {
          sceneCount++;
          for (const panel of scene.panels) {
            const copied = await copyMappedPanelOccurrence(mapping, panel.reference, pageDir, panelOrder + 1);
            const relativeExportPath = path.join(folder, pageDirName, copied.filename).split(path.sep).join('/');
            totalBytes += copied.bytes;
            exportedFiles.push(relativeExportPath);
            panelRecords.push({
              uuid: panel.reference.referenceUuid,
              source_filename: copied.sourceFilename,
              export_filename: relativeExportPath,
              logical_page_index: pageIndex + 1,
              scene_index: sceneIndex + 1,
              panel_order: panelOrder + 1,
              source_path: copied.sourcePath
            });
            panelOrder++;
            chapterPanelCount++;
            completed++;
            onProgress({ completed, total: totalSteps, current: `${folder} / ${pageDirName} / ${copied.filename}` });
          }
        }
      }
      const srt = buildChapterSrt(chapter, pages);
      const cueCount = pages.length;
      const srtName = srtFileName(chapterOrder);
      const srtPath = path.join(chapterDir, srtName);
      await writeFile(srtPath, `\uFEFF${srt}`, { encoding: 'utf8', flag: 'wx' });
      const relativeSrt = `${folder}/${srtName}`;
      exportedFiles.push(relativeSrt);
      totalBytes += Buffer.byteLength(`\uFEFF${srt}`, 'utf8');
      completed++;
      onProgress({ completed, total: totalSteps, current: `${folder} / ${srtName}` });
      chapterResults.push({
        chapter_id: chapter.chapterNumber ?? chapterOrder + 1,
        chapter_name: chapterName(pages[0] ?? { chapterLabel: chapter.fileName } as LogicalPage),
        page_count: pages.length,
        scene_count: sceneCount,
        panel_count: chapterPanelCount,
        srt_cue_count: cueCount,
        export_status: 'success',
        panels: panelRecords
      });
    }

    const report = createExportReport({ mapping, chapters: chapterResults, validationIssues: validation, exportedFiles });
    const reportText = `${JSON.stringify(report, null, 2)}\n`;
    const reportPath = path.join(stage, 'export_report.json');
    await writeFile(reportPath, reportText, { encoding: 'utf8', flag: 'wx' });
    totalBytes += Buffer.byteLength(reportText, 'utf8');
    exportedFiles.push('export_report.json');
    completed++;
    onProgress({ completed, total: totalSteps, current: 'Hoàn tất report' });
    try { await stat(target); throw new Error('Thư mục PanelVid_Output vừa được tạo bởi tiến trình khác; không ghi đè.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(stage, target);
    committed = true;
    return { outputPath: target, report, exportedFileCount: exportedFiles.length, totalBytes };
  } finally {
    if (!committed) await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}
