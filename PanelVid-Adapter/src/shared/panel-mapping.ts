import { open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalysisDocument, ChapterMapping, ImportedAnalysis, ManifestDocument, ManifestPanelMapping,
  MappingResult, MappingStatistics, PanelImageStatus, PanelReferenceMapping, PreviewImageData, VoiceBeatMapping
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function primitiveOrNull(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

interface SafePath {
  rootRealPath: string;
  candidatePath: string;
}

async function resolveSafePath(root: string, manifestFile: unknown): Promise<SafePath> {
  if (typeof manifestFile !== 'string' || !manifestFile.trim()) throw new Error('Manifest panel.file is missing.');
  const normalized = manifestFile.trim().replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) throw new Error('Absolute panel.file paths are not allowed.');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) throw new Error('Unsafe relative panel.file path.');
  const rootRealPath = await realpath(root);
  const candidatePath = path.resolve(rootRealPath, ...segments);
  if (!isInside(rootRealPath, candidatePath)) throw new Error('Resolved image path is outside the selected panel folder.');
  return { rootRealPath, candidatePath };
}

export function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) return 'image/tiff';
  return null;
}

async function inspectImage(root: string, manifestFile: unknown): Promise<{ status: PanelImageStatus; resolvedPath: string | null }> {
  let safe: SafePath;
  try {
    safe = await resolveSafePath(root, manifestFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Absolute panel.file paths are not allowed.' || message === 'Unsafe relative panel.file path.' || message === 'Resolved image path is outside the selected panel folder.') {
      return { status: 'invalid-path', resolvedPath: null };
    }
    if (message === 'Manifest panel.file is missing.') return { status: 'invalid-path', resolvedPath: null };
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'unavailable', resolvedPath: null };
    return { status: 'unavailable', resolvedPath: null };
  }

  let actualPath = safe.candidatePath;
  try {
    actualPath = await realpath(safe.candidatePath);
    if (!isInside(safe.rootRealPath, actualPath)) return { status: 'invalid-path', resolvedPath: safe.candidatePath };
    const details = await stat(actualPath);
    if (!details.isFile()) return { status: 'not-file', resolvedPath: actualPath };
    const file = await open(actualPath, 'r');
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      if (!detectImageMimeType(header.subarray(0, bytesRead))) return { status: 'invalid-image', resolvedPath: actualPath };
    } finally {
      await file.close();
    }
    return { status: 'found', resolvedPath: actualPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing', resolvedPath: safe.candidatePath };
    if (code === 'EACCES' || code === 'EPERM') return { status: 'unavailable', resolvedPath: safe.candidatePath };
    return { status: 'unavailable', resolvedPath: safe.candidatePath };
  }
}

export async function loadPanelImageData(root: string, manifestFile: string): Promise<PreviewImageData> {
  const safe = await resolveSafePath(root, manifestFile);
  const actualPath = await realpath(safe.candidatePath);
  if (!isInside(safe.rootRealPath, actualPath)) throw new Error('Image path is outside the selected panel folder.');
  const details = await stat(actualPath);
  if (!details.isFile()) throw new Error('Panel path is not a file.');
  const content = await readFile(actualPath);
  const mime = detectImageMimeType(content.subarray(0, 16));
  if (!mime) throw new Error('Image file has an invalid or unsupported signature.');
  return { dataUrl: `data:${mime};base64,${content.toString('base64')}`, resolvedPath: actualPath };
}

export async function resolveVerifiedPanelImage(root: string, manifestFile: string): Promise<{ resolvedPath: string; mimeType: string }> {
  const safe = await resolveSafePath(root, manifestFile);
  const actualPath = await realpath(safe.candidatePath);
  if (!isInside(safe.rootRealPath, actualPath)) throw new Error('Image path is outside the selected panel folder.');
  const details = await stat(actualPath);
  if (!details.isFile()) throw new Error('Panel path is not a file.');
  const file = await open(actualPath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const mimeType = detectImageMimeType(header.subarray(0, bytesRead));
    if (!mimeType) throw new Error('Image file has an invalid or unsupported signature.');
    return { resolvedPath: actualPath, mimeType };
  } finally { await file.close(); }
}

function imageReferenceStatus(status: PanelImageStatus): PanelReferenceMapping['status'] {
  if (status === 'missing') return 'image-missing';
  if (status === 'invalid-image' || status === 'not-file') return 'image-invalid';
  if (status === 'invalid-path' || status === 'unavailable') return 'image-path-error';
  return 'mapped';
}

export async function buildPanelMapping(
  manifest: ManifestDocument,
  analyses: ImportedAnalysis[],
  imageRoot: string
): Promise<MappingResult> {
  const manifestPanelsRaw = Array.isArray(manifest.panels) ? manifest.panels : [];
  const manifestPanels: ManifestPanelMapping[] = await Promise.all(manifestPanelsRaw.map(async (rawPanel, panelIndex) => {
    const panel = asObject(rawPanel);
    const uuid = textOrNull(panel.uuid);
    const manifestFile = textOrNull(panel.file);
    const image = await inspectImage(imageRoot, manifestFile);
    const uniquePart = uuid?.toLowerCase() ?? textOrNull(panel.id) ?? manifestFile ?? 'unknown';
    return {
      entryKey: `${uniquePart}#${panelIndex + 1}`,
      panelId: textOrNull(panel.id),
      uuid,
      uuidStatus: uuid && isUuid(uuid) ? 'valid' : 'invalid',
      manifestFile,
      resolvedPath: image.resolvedPath,
      imageStatus: image.status,
      sourceRegionsCount: Array.isArray(panel.source_regions) ? panel.source_regions.length : 0,
      sourceFileIsNull: panel.source_file === null,
      used: false
    };
  }));

  const uuidGroups = new Map<string, ManifestPanelMapping[]>();
  let invalidManifestUuids = 0;
  for (const panel of manifestPanels) {
    if (!panel.uuid || !isUuid(panel.uuid)) {
      invalidManifestUuids++;
      continue;
    }
    const key = panel.uuid.toLowerCase();
    const group = uuidGroups.get(key) ?? [];
    group.push(panel);
    uuidGroups.set(key, group);
  }
  const duplicateManifestUuidGroups = [...uuidGroups.values()].filter(group => group.length > 1).length;
  for (const group of uuidGroups.values()) {
    if (group.length > 1) group.forEach(panel => { panel.uuidStatus = 'duplicate'; });
  }
  const usedUuids = new Set<string>();
  let invalidUuidReferences = 0;
  let unknownUuidReferences = 0;

  const chapters: ChapterMapping[] = analyses.map((analysis) => {
    const document = analysis.data as AnalysisDocument;
    const chapter = asObject(document.chapter);
    const voiceBeatsRaw = Array.isArray(document.voice_beats) ? document.voice_beats : [];
    const beats: VoiceBeatMapping[] = voiceBeatsRaw.map(rawBeat => {
      const beat = asObject(rawBeat);
      const refs = Array.isArray(beat.panel_uuids) ? beat.panel_uuids : [];
      const panels = refs.map(rawUuid => {
        const referenceUuid = typeof rawUuid === 'string' ? rawUuid.trim() : '';
        if (!isUuid(referenceUuid)) {
          invalidUuidReferences++;
          return {
            referenceUuid: referenceUuid || String(rawUuid ?? ''), panelId: null, manifestFile: null, resolvedPath: null,
            imageStatus: 'not-applicable', status: 'invalid-uuid', sourceRegionsCount: 0, sourceFileIsNull: false
          } satisfies PanelReferenceMapping;
        }
        const group = uuidGroups.get(referenceUuid.toLowerCase());
        if (!group?.length) {
          unknownUuidReferences++;
          return {
            referenceUuid, panelId: null, manifestFile: null, resolvedPath: null,
            imageStatus: 'not-applicable', status: 'uuid-not-found', sourceRegionsCount: 0, sourceFileIsNull: false
          } satisfies PanelReferenceMapping;
        }
        if (group.length > 1) {
          return {
            referenceUuid, panelId: null, manifestFile: null, resolvedPath: null,
            imageStatus: 'not-applicable', status: 'duplicate-manifest-uuid', sourceRegionsCount: 0, sourceFileIsNull: false
          } satisfies PanelReferenceMapping;
        }
        const panel = group[0];
        panel.used = true;
        usedUuids.add(panel.uuid!.toLowerCase());
        return {
          referenceUuid,
          panelId: panel.panelId,
          manifestFile: panel.manifestFile,
          resolvedPath: panel.resolvedPath,
          imageStatus: panel.imageStatus,
          status: imageReferenceStatus(panel.imageStatus),
          sourceRegionsCount: panel.sourceRegionsCount,
          sourceFileIsNull: panel.sourceFileIsNull
        } satisfies PanelReferenceMapping;
      });
      return {
        beatId: textOrNull(beat.beat_id),
        order: primitiveOrNull(beat.order),
        narration: typeof beat.narration === 'string' ? beat.narration : '',
        metadata: { ...beat },
        panels
      };
    });
    return {
      chapterKey: analysis.path || analysis.fileName,
      fileName: analysis.fileName,
      series: textOrNull(chapter.series),
      chapterNumber: primitiveOrNull(chapter.number),
      chapterTitle: textOrNull(chapter.title),
      beats
    };
  });

  const statistics: MappingStatistics = {
    totalPanels: manifestPanels.length,
    distinctUuidsUsed: usedUuids.size,
    imagesFound: manifestPanels.filter(panel => panel.imageStatus === 'found').length,
    imagesMissing: manifestPanels.filter(panel => panel.imageStatus === 'missing').length,
    imagesInvalid: manifestPanels.filter(panel => panel.imageStatus === 'invalid-image' || panel.imageStatus === 'not-file').length,
    imagePathErrors: manifestPanels.filter(panel => panel.imageStatus === 'invalid-path' || panel.imageStatus === 'unavailable').length,
    invalidUuidReferences,
    unknownUuidReferences,
    invalidManifestUuids,
    duplicateManifestUuidGroups,
    unusedPanels: manifestPanels.filter(panel => panel.uuidStatus === 'valid' && !panel.used).length
  };

  const project = asObject(manifest.project);
  return {
    projectName: textOrNull(project.project_name),
    projectId: textOrNull(project.project_id),
    imageRoot,
    chapters,
    manifestPanels,
    statistics
  };
}
