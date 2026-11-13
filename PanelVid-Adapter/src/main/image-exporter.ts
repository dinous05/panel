import { copyFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { MappingResult, PanelReferenceMapping } from '../shared/types';
import { resolveVerifiedPanelImage } from '../shared/panel-mapping';

function sameResolvedPath(a: string, b: string): boolean {
  const left = path.resolve(a), right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function copyMappedPanelOccurrence(mapping: MappingResult, reference: PanelReferenceMapping, destinationDirectory: string, panelOrder: number): Promise<{ bytes: number; filename: string; sourceFilename: string; sourcePath: string }> {
  const matches = mapping.manifestPanels.filter(entry => entry.uuid?.toLowerCase() === reference.referenceUuid.toLowerCase());
  if (matches.length !== 1 || matches[0].uuidStatus !== 'valid' || matches[0].manifestFile !== reference.manifestFile) {
    throw new Error(`UUID ${reference.referenceUuid} không trỏ duy nhất tới ảnh đã map trong Manifest.`);
  }
  if (reference.status !== 'mapped' || !reference.manifestFile) throw new Error(`Panel ${reference.referenceUuid} không có mapping ảnh hợp lệ.`);
  const verified = await resolveVerifiedPanelImage(mapping.imageRoot, reference.manifestFile);
  if (reference.resolvedPath && !sameResolvedPath(verified.resolvedPath, reference.resolvedPath)) {
    throw new Error(`Ảnh UUID ${reference.referenceUuid} đổi đường dẫn kể từ lúc mapping; hãy chạy lại UUID Mapping.`);
  }
  const sourceStat = await stat(verified.resolvedPath);
  const extension = path.extname(verified.resolvedPath);
  if (!extension || !/^\.[a-z0-9]{1,8}$/i.test(extension)) throw new Error(`Phần mở rộng ảnh không hợp lệ cho UUID ${reference.referenceUuid}.`);
  const filename = `Panel ${String(panelOrder).padStart(3, '0')}${extension.toLowerCase()}`;
  const destination = path.join(destinationDirectory, filename);
  await copyFile(verified.resolvedPath, destination, fsConstants.COPYFILE_EXCL);
  const copiedStat = await stat(destination);
  if (copiedStat.size !== sourceStat.size) throw new Error(`Kích thước ảnh sau copy không khớp: ${filename}.`);
  return {
    bytes: copiedStat.size,
    filename,
    sourceFilename: path.posix.basename(reference.manifestFile.replace(/\\/g, '/')),
    sourcePath: reference.manifestFile.replace(/\\/g, '/')
  };
}
