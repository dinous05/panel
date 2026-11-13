export interface ManifestSummary {
  path: string;
  fileName: string;
  projectName: string | null;
  projectId: string | null;
  schemaVersion: string | number | null;
  panelCount: number | null;
}

export interface AnalysisSummary {
  path: string;
  fileName: string;
  series: string | null;
  chapterNumber: string | number | null;
  chapterTitle: string | null;
  voiceBeatCount: number | null;
}

export interface BatchReportSummary {
  path: string;
  fileName: string;
  chapterCount: number | null;
  beatCount: number | null;
  panelReferences: number | null;
}

export interface ManifestDocument extends Record<string, unknown> {
  panels?: unknown[];
  project?: Record<string, unknown>;
}

export interface AnalysisDocument extends Record<string, unknown> {
  chapter?: Record<string, unknown>;
  voice_beats?: unknown[];
}

export interface ImportedManifest extends ManifestSummary {
  data: ManifestDocument;
}

export interface ImportedAnalysis extends AnalysisSummary {
  data: AnalysisDocument;
}

export type PanelImageStatus = 'found' | 'missing' | 'invalid-image' | 'invalid-path' | 'not-file' | 'unavailable';
export type PanelReferenceStatus = 'mapped' | 'invalid-uuid' | 'uuid-not-found' | 'duplicate-manifest-uuid' | 'image-missing' | 'image-invalid' | 'image-path-error';

export interface ManifestPanelMapping {
  entryKey: string;
  panelId: string | null;
  uuid: string | null;
  uuidStatus: 'valid' | 'invalid' | 'duplicate';
  manifestFile: string | null;
  resolvedPath: string | null;
  imageStatus: PanelImageStatus;
  sourceRegionsCount: number;
  sourceFileIsNull: boolean;
  used: boolean;
}

export interface PanelReferenceMapping {
  referenceUuid: string;
  panelId: string | null;
  manifestFile: string | null;
  resolvedPath: string | null;
  imageStatus: PanelImageStatus | 'not-applicable';
  status: PanelReferenceStatus;
  sourceRegionsCount: number;
  sourceFileIsNull: boolean;
}

export interface VoiceBeatMapping {
  beatId: string | null;
  order: string | number | null;
  narration: string;
  metadata: Record<string, unknown>;
  panels: PanelReferenceMapping[];
}

export interface ChapterMapping {
  chapterKey: string;
  fileName: string;
  series: string | null;
  chapterNumber: string | number | null;
  chapterTitle: string | null;
  beats: VoiceBeatMapping[];
}

export interface MappingStatistics {
  totalPanels: number;
  distinctUuidsUsed: number;
  imagesFound: number;
  imagesMissing: number;
  imagesInvalid: number;
  imagePathErrors: number;
  invalidUuidReferences: number;
  unknownUuidReferences: number;
  invalidManifestUuids: number;
  duplicateManifestUuidGroups: number;
  unusedPanels: number;
}

export interface MappingResult {
  projectName: string | null;
  projectId: string | null;
  imageRoot: string;
  chapters: ChapterMapping[];
  manifestPanels: ManifestPanelMapping[];
  statistics: MappingStatistics;
}

export interface PreviewImageData {
  dataUrl: string;
  resolvedPath: string;
}

export interface ExportDestination { path: string; folderName: string }
export interface ExportProgress { completed: number; total: number; current: string }
export interface ExportResult {
  outputPath: string;
  report: import('./export-report').ExportReport;
  exportedFileCount: number;
  totalBytes: number;
}

export interface ImportResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PanelVidAdapterApi {
  chooseManifest(): Promise<ImportResult<ImportedManifest>>;
  choosePanelFolder(): Promise<ImportResult<{ path: string; folderName: string; imageCount: number }>>;
  chooseAnalysisFiles(): Promise<ImportResult<ImportedAnalysis[]>>;
  chooseBatchReport(): Promise<ImportResult<BatchReportSummary>>;
  buildMapping(manifest: ManifestDocument, analyses: ImportedAnalysis[]): Promise<ImportResult<MappingResult>>;
  loadPanelPreview(manifestFile: string): Promise<ImportResult<PreviewImageData>>;
  chooseExportFolder(): Promise<ImportResult<ExportDestination>>;
  exportPackage(mapping: MappingResult, document: import('./logical-pages').LogicalPageDocument, outputParent: string): Promise<ImportResult<ExportResult>>;
  openExportFolder(folderPath: string): Promise<ImportResult<null>>;
  onExportProgress(listener: (progress: ExportProgress) => void): () => void;
}

declare global {
  interface Window {
    panelVidAdapter: PanelVidAdapterApi;
  }
}
