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

export interface ImportResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PanelVidAdapterApi {
  chooseManifest(): Promise<ImportResult<ManifestSummary>>;
  choosePanelFolder(): Promise<ImportResult<{ path: string; folderName: string; imageCount: number }>>;
  chooseAnalysisFiles(): Promise<ImportResult<AnalysisSummary[]>>;
  chooseBatchReport(): Promise<ImportResult<BatchReportSummary>>;
}

declare global {
  interface Window {
    panelVidAdapter: PanelVidAdapterApi;
  }
}
