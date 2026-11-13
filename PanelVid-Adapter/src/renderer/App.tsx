import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, BookOpen, Check, CircleAlert, CircleHelp, Download, FileJson2, FolderOpen, GitMerge, Images, Layers3, RotateCcw, Upload, X } from 'lucide-react';
import type { BatchReportSummary, ExportDestination, ExportProgress, ExportResult, ImportedAnalysis, ImportedManifest, MappingResult, PanelReferenceMapping } from '../shared/types';
import { createLogicalPages, type LogicalPageDocument } from '../shared/logical-pages';
import { validateExport } from '../shared/export-validation';
import LogicalPageEditor from './LogicalPageEditor';
import ExportPreview from './ExportPreview';

type Page = 'overview' | 'imports' | 'mapping' | 'export' | 'guide';
const imageFileKey = (value: string) => value.replace(/\\/g, '/');

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [manifest, setManifest] = useState<ImportedManifest | null>(null);
  const [panelFolder, setPanelFolder] = useState<{ path: string; folderName: string; imageCount: number } | null>(null);
  const [analyses, setAnalyses] = useState<ImportedAnalysis[]>([]);
  const [batchReport, setBatchReport] = useState<BatchReportSummary | null>(null);
  const [mapping, setMapping] = useState<MappingResult | null>(null);
  const [logicalDocument, setLogicalDocument] = useState<LogicalPageDocument>({ pages: [] });
  const [outputDestination, setOutputDestination] = useState<ExportDestination | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [previewInvalidFiles, setPreviewInvalidFiles] = useState<Set<string>>(new Set());
  const previewCache = useRef(new Map<string, Promise<string>>());
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => window.panelVidAdapter.onExportProgress(progress => setExportProgress(progress)), []);
  const beats = useMemo(() => analyses.reduce((sum, item) => sum + (item.voiceBeatCount ?? 0), 0), [analyses]);
  const importedCount = Number(Boolean(manifest)) + Number(Boolean(panelFolder)) + Number(analyses.length > 0) + Number(Boolean(batchReport));
  const canBuildMapping = Boolean(manifest && panelFolder && analyses.length > 0);
  const decodedInvalidCount = mapping
    ? mapping.manifestPanels.filter(panel => panel.manifestFile && panel.imageStatus === 'found' && previewInvalidFiles.has(imageFileKey(panel.manifestFile))).length
    : 0;

  const showError = (text: string) => setNotice({ kind: 'error', text });
  const showSuccess = (text: string) => setNotice({ kind: 'success', text });
  const invalidateMapping = () => {
    setMapping(null);
    setLogicalDocument({ pages: [] });
    setExportResult(null);
    setPreviewInvalidFiles(new Set());
    previewCache.current.clear();
  };
  const loadPreview = useCallback(async (manifestFile: string) => {
    let pending = previewCache.current.get(manifestFile);
    if (!pending) {
      pending = window.panelVidAdapter.loadPanelPreview(manifestFile).then(result => {
        if (!result.ok || !result.data) throw new Error(result.error ?? 'Không nạp được ảnh preview.');
        return result.data.dataUrl;
      });
      previewCache.current.set(manifestFile, pending);
    }
    return pending;
  }, []);
  const markPreviewInvalid = useCallback((manifestFile: string) => {
    setPreviewInvalidFiles(current => {
      const key = imageFileKey(manifestFile);
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  async function importManifest() {
    const result = await window.panelVidAdapter.chooseManifest();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn file.') showError(result.error ?? 'Không đọc được Manifest.'); return; }
    invalidateMapping(); setManifest(result.data!); showSuccess(`Đã đọc ${result.data!.fileName}.`);
  }
  async function importPanelFolder() {
    const result = await window.panelVidAdapter.choosePanelFolder();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn thư mục.') showError(result.error ?? 'Không đọc được thư mục ảnh.'); return; }
    invalidateMapping(); setPanelFolder(result.data!); showSuccess(`Đã quét ${result.data!.imageCount} ảnh trong ${result.data!.folderName}.`);
  }
  async function importAnalyses() {
    const result = await window.panelVidAdapter.chooseAnalysisFiles();
    if (!result.ok) { if (result.error !== 'Chưa chọn file analysis.') showError(result.error ?? 'Không đọc được Analysis JSON.'); return; }
    invalidateMapping(); setAnalyses(result.data!); showSuccess(`Đã đọc ${result.data!.length} file AI Analysis.`);
  }
  async function importReport() {
    const result = await window.panelVidAdapter.chooseBatchReport();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn file.') showError(result.error ?? 'Không đọc được Batch Report.'); return; }
    setBatchReport(result.data!); showSuccess(`Đã đọc ${result.data!.fileName}.`);
  }
  async function runMapping() {
    if (!manifest || !panelFolder || analyses.length === 0) {
      showError('Cần import Manifest, thư mục ảnh và ít nhất một AI Analysis trước khi mapping.');
      return;
    }
    setMappingBusy(true);
    invalidateMapping();
    try {
      const result = await window.panelVidAdapter.buildMapping(manifest.data, analyses);
      if (!result.ok || !result.data) { showError(result.error ?? 'Không chạy được UUID Mapping.'); return; }
      const files = [...new Set(result.data.manifestPanels
        .filter(panel => panel.imageStatus === 'found' && panel.manifestFile)
        .map(panel => panel.manifestFile!))];
      const invalidFiles = new Set<string>();
      for (let offset = 0; offset < files.length; offset += 4) {
        if (offset % 24 === 0) setNotice({ kind: 'success', text: `Đang kiểm tra giải mã ảnh ${Math.min(offset + 1, files.length)}–${Math.min(offset + 4, files.length)} / ${files.length}…` });
        const batch = files.slice(offset, offset + 4);
        const decoded = await Promise.all(batch.map(async file => {
          try {
            const preview = await window.panelVidAdapter.loadPanelPreview(file);
            if (!preview.ok || !preview.data) throw new Error(preview.error ?? 'Không đọc được ảnh.');
            const image = new Image();
            image.src = preview.data.dataUrl;
            await image.decode();
            return null;
          } catch {
            return file;
          }
        }));
        decoded.forEach(file => { if (file) invalidFiles.add(imageFileKey(file)); });
      }
      setPreviewInvalidFiles(invalidFiles);
      const invalidManifestCount = result.data.manifestPanels.filter(panel => panel.manifestFile && panel.imageStatus === 'found' && invalidFiles.has(imageFileKey(panel.manifestFile))).length;
      const decodedMapping: MappingResult = {
        ...result.data,
        manifestPanels: result.data.manifestPanels.map(panel => panel.manifestFile && invalidFiles.has(imageFileKey(panel.manifestFile))
          ? { ...panel, imageStatus: 'invalid-image' as const }
          : panel),
        chapters: result.data.chapters.map(chapter => ({
          ...chapter,
          beats: chapter.beats.map(beat => ({ ...beat, panels: beat.panels.map(panel => panel.manifestFile && invalidFiles.has(imageFileKey(panel.manifestFile))
            ? { ...panel, imageStatus: 'invalid-image' as const, status: 'image-invalid' as const }
            : panel) }))
        })),
        statistics: {
          ...result.data.statistics,
          imagesFound: result.data.statistics.imagesFound - invalidManifestCount,
          imagesInvalid: result.data.statistics.imagesInvalid + invalidManifestCount
        }
      };
      setMapping(decodedMapping);
      setLogicalDocument(createLogicalPages(decodedMapping));
      setPage('mapping');
      showSuccess(`Mapping xong ${decodedMapping.chapters.length} chapter · đã giải mã ${files.length - invalidFiles.size}/${files.length} ảnh${invalidFiles.size ? ` · ${invalidFiles.size} ảnh lỗi` : ''}.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setMappingBusy(false);
    }
  }
  function resetAll() {
    invalidateMapping(); setManifest(null); setPanelFolder(null); setAnalyses([]); setBatchReport(null); setOutputDestination(null); setExportProgress(null); setNotice({ kind: 'success', text: 'Đã xóa dữ liệu đã import khỏi phiên làm việc.' });
  }
  async function chooseOutputFolder() {
    const result = await window.panelVidAdapter.chooseExportFolder();
    if (!result.ok || !result.data) { if (result.error !== 'Đã hủy chọn thư mục export.') showError(result.error ?? 'Không chọn được thư mục đầu ra.'); return; }
    setOutputDestination(result.data); setExportResult(null); setExportProgress(null); showSuccess(`Đã chọn thư mục đầu ra: ${result.data.folderName}.`);
  }
  function validateForExport() {
    if (!mapping || !logicalDocument) { showError('Cần chạy UUID Mapping trước khi Preview Export.'); return; }
    const issues = validateExport(mapping, logicalDocument);
    const errors = issues.filter(issue => issue.severity === 'error');
    if (errors.length) showError(`Validation phát hiện ${errors.length} lỗi cần xử lý trước khi export.`);
    else showSuccess(issues.length ? `Validation đạt, có ${issues.length} cảnh báo cần xem.` : 'Validation đạt; không có lỗi hoặc cảnh báo.');
  }
  async function runExport() {
    if (!mapping || !logicalDocument || !outputDestination) { showError('Chọn thư mục đầu ra và hoàn tất mapping trước khi export.'); return; }
    const warningCount = validateExport(mapping, logicalDocument).filter(issue => issue.severity === 'warning').length;
    if (warningCount && !window.confirm(`Có ${warningCount} cảnh báo. Tiếp tục tạo package?`)) return;
    setExportBusy(true); setExportProgress({ completed: 0, total: 1, current: 'Đang chuẩn bị package…' }); setExportResult(null);
    try {
      const result = await window.panelVidAdapter.exportPackage(mapping, logicalDocument, outputDestination.path);
      if (!result.ok || !result.data) { showError(result.error ?? 'Export package thất bại.'); return; }
      setExportResult(result.data); setExportProgress(null); showSuccess(`Export hoàn tất: ${result.data.exportedFileCount} file.`);
    } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
    finally { setExportBusy(false); }
  }
  async function openExportResult() {
    if (!exportResult) return;
    const result = await window.panelVidAdapter.openExportFolder(exportResult.outputPath);
    if (!result.ok) showError(result.error ?? 'Không mở được thư mục kết quả.');
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><div><strong>PanelVid</strong><span>ADAPTER</span></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}><Layers3 size={17} /> Tổng quan</button>
      <button className={`nav-item ${page === 'imports' ? 'active' : ''}`} onClick={() => setPage('imports')}><ArrowDownToLine size={17} /> Import dữ liệu {importedCount > 0 && <i>{importedCount}</i>}</button>
      <button className={`nav-item ${page === 'mapping' ? 'active' : ''}`} onClick={() => setPage('mapping')}><GitMerge size={17} /> UUID Mapping {mapping && <i>✓</i>}</button>
      <button className={`nav-item ${page === 'export' ? 'active' : ''}`} disabled={!mapping} onClick={() => { setPage('export'); setExportResult(null); }}><Download size={17} /> Export Preview {mapping && <i>4</i>}</button>
      <div className="side-label side-label-lower">ỨNG DỤNG</div>
      <button className={`nav-item ${page === 'guide' ? 'active' : ''}`} onClick={() => setPage('guide')}><CircleHelp size={17} /> Hướng dẫn</button>
      <div className="sidebar-bottom"><div className="offline-dot" /> Hoạt động offline <span>Phase 4</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">PanelVid Adapter <span>/</span> {page === 'overview' ? 'Tổng quan' : page === 'imports' ? 'Import dữ liệu' : page === 'mapping' ? 'UUID Mapping' : page === 'export' ? 'Export Preview' : 'Hướng dẫn'}</div><div className="topbar-right"><span className="local-badge"><span /> DỮ LIỆU CHỈ Ở MÁY NÀY</span><button className="reset-button" onClick={resetAll} title="Xóa toàn bộ dữ liệu đã import"><RotateCcw size={15} /> Reset</button></div></header>
      <div className="page-content">
        {notice && <div className={`notice ${notice.kind}`}><span>{notice.kind === 'success' ? <Check size={16} /> : <X size={16} />}{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Đóng thông báo"><X size={15} /></button></div>}

        {page === 'overview' && <>
          <div className="page-heading"><div><div className="eyebrow">WORKSPACE OVERVIEW</div><h1>Tổng quan</h1><p>Import dữ liệu truyện và theo dõi trạng thái đầu vào của dự án.</p></div><button className="primary-button" onClick={() => setPage('imports')}><Upload size={16} /> Import dữ liệu</button></div>
          <section className="metric-grid">
            <Metric icon={<FileJson2 size={18} />} label="Manifest" value={manifest ? 'Đã nạp' : '—'} detail={manifest?.fileName ?? 'Chưa có file'} tone="mint" />
            <Metric icon={<Images size={18} />} label="Ảnh panel" value={panelFolder ? String(panelFolder.imageCount) : '—'} detail={panelFolder?.folderName ?? 'Chưa chọn thư mục'} tone="blue" />
            <Metric icon={<BookOpen size={18} />} label="Voice Beat" value={analyses.length ? String(beats) : '—'} detail={analyses.length ? `${analyses.length} file Analysis` : 'Chưa có Analysis'} tone="amber" />
            <Metric icon={<Archive size={18} />} label="Batch Report" value={batchReport ? 'Đã nạp' : '—'} detail={batchReport?.fileName ?? 'Không bắt buộc'} tone="violet" />
          </section>
          <section className="content-grid">
            <div className="panel-card project-card"><div className="card-heading"><div><span className="eyebrow">PROJECT SNAPSHOT</span><h2>Thông tin project</h2></div><span className={`status-pill ${manifest ? 'ready' : ''}`}><i />{manifest ? 'Manifest đã đọc' : 'Đang chờ dữ liệu'}</span></div>
              {manifest ? <div className="project-details"><Info label="Tên project" value={manifest.projectName ?? 'Không có trong file'} /><Info label="Project ID" value={manifest.projectId ?? 'Không có trong file'} mono /><Info label="Schema version" value={manifest.schemaVersion == null ? 'Không có trong file' : String(manifest.schemaVersion)} /><Info label="Số panel trong Manifest" value={manifest.panelCount == null ? 'Không có mảng panels' : String(manifest.panelCount)} /></div> : <EmptyState icon={<FileJson2 size={22} />} title="Chưa có Manifest" description="Import manifest.json để đọc thông tin project và tổng số panel." action="Chọn Manifest" onClick={importManifest} />}
            </div>
            <div className="panel-card quick-card"><div className="card-heading"><div><span className="eyebrow">QUICK IMPORT</span><h2>Thêm dữ liệu</h2></div></div><div className="quick-list">
              <QuickItem icon={<FileJson2 size={17} />} title="Manifest JSON" detail={manifest?.fileName ?? 'Chọn manifest.json'} action="Chọn file" done={Boolean(manifest)} onClick={importManifest} />
              <QuickItem icon={<FolderOpen size={17} />} title="Thư mục ảnh panel" detail={panelFolder ? `${panelFolder.imageCount} ảnh · ${panelFolder.folderName}` : 'Quét ảnh trong thư mục'} action="Chọn folder" done={Boolean(panelFolder)} onClick={importPanelFolder} />
              <QuickItem icon={<BookOpen size={17} />} title="AI Analysis JSON" detail={analyses.length ? `${analyses.length} file · ${beats} voice beat` : 'Chọn một hoặc nhiều file'} action="Chọn file" done={analyses.length > 0} onClick={importAnalyses} />
            </div></div>
          </section>
          {analyses.length > 0 && <section className="panel-card analysis-card"><div className="card-heading"><div><span className="eyebrow">IMPORTED ANALYSIS</span><h2>AI Analysis đã nạp</h2></div><span className="count-chip">{analyses.length} FILE</span></div><AnalysisList items={analyses} />{batchReport && <div className="batch-summary"><Archive size={16} /><span><b>{batchReport.fileName}</b> · {batchReport.chapterCount ?? '—'} chapter · {batchReport.beatCount ?? '—'} beat · {batchReport.panelReferences ?? '—'} panel reference</span></div>}</section>}
          <div className="phase-note"><span className="phase-number">04</span><div><b>Phase 4 · PanelVid Exporter</b><p>Preview và validate Page/Scene/Panel; xuất ảnh gốc, SRT theo beat và report cục bộ. Không tạo TTS/video.</p></div><button className="outline-button" onClick={() => setPage(mapping ? 'export' : 'mapping')}>{mapping ? 'Mở Export Preview' : 'Mở Mapping'}</button></div>
        </>}

        {page === 'imports' && <>
          <div className="page-heading"><div><div className="eyebrow">INPUT DATA</div><h1>Import dữ liệu</h1><p>Chọn file hoặc thư mục từ máy tính. Dữ liệu nguồn chỉ được đọc, không chỉnh sửa.</p></div><button className="quiet-button" onClick={resetAll}><RotateCcw size={15} /> Reset tất cả</button></div>
          <div className="import-grid">
            <ImportCard icon={<FileJson2 size={20} />} step="01" title="Manifest PanelCutter" description="Đọc thông tin project, phiên bản schema và số panel từ manifest.json." status={manifest ? `${manifest.fileName} · ${manifest.panelCount ?? '—'} panel` : 'Chưa import'} done={Boolean(manifest)} action="Chọn manifest.json" onClick={importManifest} />
            <ImportCard icon={<Images size={20} />} step="02" title="Thư mục ảnh panel" description="Chọn folder chapter hoặc folder bundle. Đếm file ảnh theo đuôi phổ biến, kể cả thư mục con." status={panelFolder ? `${panelFolder.imageCount} ảnh · ${panelFolder.folderName}` : 'Chưa chọn thư mục'} done={Boolean(panelFolder)} action="Chọn thư mục ảnh" onClick={importPanelFolder} />
            <ImportCard icon={<BookOpen size={20} />} step="03" title="AI Analysis JSON" description="Có thể chọn nhiều analysis_result*.json cùng lúc. Hiển thị số chapter và voice beat đọc được." status={analyses.length ? `${analyses.length} file · ${beats} voice beat` : 'Chưa import'} done={analyses.length > 0} action="Chọn nhiều file JSON" onClick={importAnalyses} />
            <ImportCard icon={<Archive size={20} />} step="04" title="Batch Report (tùy chọn)" description="Đọc các tổng số cơ bản trong batch_report.json nếu file có sẵn." status={batchReport ? batchReport.fileName : 'Không bắt buộc'} done={Boolean(batchReport)} action="Chọn Batch Report" onClick={importReport} />
          </div>
          {analyses.length > 0 && <section className="panel-card analysis-card"><div className="card-heading"><div><span className="eyebrow">FILE LIST</span><h2>Analysis được import</h2></div><span className="count-chip">{analyses.length} FILE · {beats} BEAT</span></div><AnalysisList items={analyses} />{batchReport && <div className="batch-summary"><Archive size={16} /><span><b>{batchReport.fileName}</b> · {batchReport.chapterCount ?? '—'} chapter · {batchReport.beatCount ?? '—'} beat · {batchReport.panelReferences ?? '—'} reference</span></div>}</section>}
          {manifest && <section className="panel-card manifest-strip"><FileJson2 size={18} /><div><b>{manifest.projectName ?? manifest.fileName}</b><span>{manifest.panelCount ?? '—'} panel · schema {manifest.schemaVersion ?? '—'}</span></div><span className="status-pill ready"><i />Đã đọc</span></section>}
        </>}

        {page === 'mapping' && <>
          <div className="page-heading"><div><div className="eyebrow">PHASE 2 · UUID RESOLUTION</div><h1>UUID Mapping & Preview</h1><p>Nối từng UUID trong AI Analysis với đúng panel.file trong Manifest; giữ nguyên thứ tự dữ liệu đầu vào.</p></div><button className="primary-button" disabled={!canBuildMapping || mappingBusy} onClick={runMapping}><GitMerge size={16} />{mappingBusy ? 'Đang mapping…' : mapping ? 'Chạy lại Mapping' : 'Chạy UUID Mapping'}</button></div>
          {!canBuildMapping && <section className="panel-card mapping-empty"><EmptyState icon={<GitMerge size={22} />} title="Cần đủ dữ liệu đầu vào" description="Import Manifest, thư mục gốc ảnh panel và một hoặc nhiều AI Analysis để bắt đầu đối chiếu UUID." action="Mở Import dữ liệu" onClick={() => setPage('imports')} /></section>}
          {canBuildMapping && !mapping && <section className="panel-card mapping-empty"><EmptyState icon={<GitMerge size={22} />} title="Sẵn sàng ánh xạ" description={`${manifest?.panelCount ?? '—'} panel trong Manifest · ${analyses.length} file Analysis · ${panelFolder?.folderName ?? ''}. Đường dẫn ảnh sẽ được resolve từ panel.file, không dựa vào index hoặc tên file để ghép beat.`} action={mappingBusy ? 'Đang mapping…' : 'Chạy UUID Mapping'} onClick={runMapping} /></section>}
          {mapping && <>
            <section className="mapping-stats">
              <MappingMetric label="Tổng panel" value={mapping.statistics.totalPanels} detail="Manifest records" />
              <MappingMetric label="UUID được dùng" value={mapping.statistics.distinctUuidsUsed} detail="UUID phân biệt, tính một lần" />
              <MappingMetric label="Ảnh tìm thấy" value={mapping.statistics.imagesFound - decodedInvalidCount} detail="Đã resolve + Chromium decode" tone={decodedInvalidCount ? 'warn' : 'good'} />
              <MappingMetric label="Ảnh thiếu" value={mapping.statistics.imagesMissing} detail="panel.file không tồn tại" tone={mapping.statistics.imagesMissing ? 'warn' : 'good'} />
              <MappingMetric label="UUID lỗi" value={mapping.statistics.invalidUuidReferences + mapping.statistics.unknownUuidReferences + mapping.statistics.invalidManifestUuids + mapping.statistics.duplicateManifestUuidGroups} detail={`Sai format ${mapping.statistics.invalidUuidReferences} · không có ${mapping.statistics.unknownUuidReferences} · Manifest lỗi/trùng ${mapping.statistics.invalidManifestUuids + mapping.statistics.duplicateManifestUuidGroups}`} tone={mapping.statistics.invalidUuidReferences + mapping.statistics.unknownUuidReferences + mapping.statistics.invalidManifestUuids + mapping.statistics.duplicateManifestUuidGroups ? 'warn' : 'good'} />
              <MappingMetric label="Panel chưa dùng" value={mapping.statistics.unusedPanels} detail="UUID hợp lệ, không được beat tham chiếu" />
            </section>
            <div className="mapping-status-line"><span><Check size={14} /> Đã giữ nguyên thứ tự chapter, Voice Beat và `panel_uuids` trong từng beat.</span><span>Ảnh lỗi: {mapping.statistics.imagesInvalid + decodedInvalidCount} · Path lỗi/quyền: {mapping.statistics.imagePathErrors}</span></div>
            <section className="panel-card mapping-chapters"><div className="card-heading"><div><span className="eyebrow">PREVIEW TREE</span><h2>{mapping.projectName ?? 'Project mapping'} · {mapping.chapters.length} chapter</h2></div><span className="count-chip">{mapping.chapters.reduce((sum, chapter) => sum + chapter.beats.length, 0)} BEATS</span></div>
              {mapping.chapters.length === 0 ? <div className="mapping-no-beats">Không có `voice_beats` trong các Analysis đã import.</div> : mapping.chapters.map(chapter => <details className="chapter-tree" open key={chapter.chapterKey}>
                <summary><b>{chapter.series ?? 'Chapter'}{chapter.chapterNumber != null ? ` ${chapter.chapterNumber}` : ''}{chapter.chapterTitle ? ` · ${chapter.chapterTitle}` : ''}</b><span>{chapter.beats.length} Voice Beat</span><small>{chapter.fileName}</small></summary>
                <div className="beat-tree">{chapter.beats.map((beat, beatIndex) => <details className="beat-tree-item" key={`${chapter.chapterKey}:${beat.beatId ?? beatIndex}`}>
                  <summary><b>Voice Beat {beat.order ?? beatIndex + 1}</b><code>{beat.beatId ?? 'ID không có'}</code><span>{beat.panels.length} panel ref</span><MappingBeatBadge panels={beat.panels} invalidFiles={previewInvalidFiles} /></summary>
                  <div className="beat-body"><p className="beat-narration">{beat.narration || 'Không có narration trong beat.'}</p>
                    {beat.panels.length === 0 ? <div className="mapping-no-beats">Beat này không tham chiếu panel UUID nào.</div> : <div className="mapped-panel-grid">{beat.panels.map((panel, panelIndex) => <MappedPanelCard key={`${panel.referenceUuid}:${panelIndex}`} panel={panel} previewInvalid={Boolean(panel.manifestFile && previewInvalidFiles.has(imageFileKey(panel.manifestFile)))} loadPreview={loadPreview} onPreviewInvalid={markPreviewInvalid} />)}</div>}
                  </div>
                </details>)}</div>
              </details>)}
            </section>
            <section className="panel-card unused-panels"><details><summary><b>UUID Manifest thiếu, sai format hoặc trùng</b><span>{mapping.manifestPanels.filter(panel => panel.uuidStatus !== 'valid').length} record</span></summary><div className="unused-list">{mapping.manifestPanels.filter(panel => panel.uuidStatus !== 'valid').map(panel => <div className="unused-row" key={panel.entryKey}><code>{panel.uuid ?? '(không có UUID)'}</code><span>{panel.panelId ?? 'Không có panel ID'} · {panel.manifestFile ?? 'Không có panel.file'}</span><small>{panel.uuidStatus === 'duplicate' ? 'UUID trùng' : 'UUID không hợp lệ'}</small></div>)}</div></details></section>
            <section className="panel-card unused-panels"><details><summary><b>Panel chưa được sử dụng</b><span>{mapping.statistics.unusedPanels} panel</span></summary><div className="unused-list">{mapping.manifestPanels.filter(panel => panel.uuidStatus === 'valid' && !panel.used).map(panel => <div className="unused-row" key={panel.entryKey}><code>{panel.uuid}</code><span>{panel.manifestFile ?? 'Không có panel.file'}</span><small>{panel.manifestFile && previewInvalidFiles.has(imageFileKey(panel.manifestFile)) ? 'Không giải mã được ảnh' : imageStatusLabel(panel.imageStatus)}</small></div>)}</div></details></section>
            <LogicalPageEditor mapping={mapping} document={logicalDocument} setDocument={setLogicalDocument} loadPreview={loadPreview} />
          </>}
        </>}

        {page === 'export' && mapping && <ExportPreview mapping={mapping} document={logicalDocument} loadPreview={loadPreview} output={outputDestination} result={exportResult} progress={exportProgress} exporting={exportBusy} onChooseFolder={chooseOutputFolder} onValidate={validateForExport} onExport={runExport} onOpenResult={openExportResult} />}

        {page === 'guide' && <>
          <div className="page-heading"><div><div className="eyebrow">GETTING STARTED</div><h1>Hướng dẫn</h1><p>Chuẩn bị dữ liệu và sử dụng UUID Mapping cùng Logical Page/Scene Preview.</p></div></div>
          <section className="panel-card guide-card"><GuideStep number="01" title="Import Manifest" text="Chọn manifest.json được PanelCutter xuất. Ứng dụng giữ nguyên dữ liệu để tra panel.uuid và resolve panel.file." /><GuideStep number="02" title="Chọn thư mục ảnh" text="Chọn thư mục gốc tương ứng với đường dẫn tương đối panel.file trong Manifest. Thư mục con và Unicode được hỗ trợ." /><GuideStep number="03" title="Import AI Analysis" text="Chọn một hoặc nhiều analysis_result JSON. Các voice_beats[].panel_uuids[] được tìm theo UUID, không theo vị trí hoặc tên file." /><GuideStep number="04" title="Mapping → Preview → Export" text="Sau UUID Mapping, chỉnh thứ tự panel/Scene, kiểm tra Export Preview, chọn thư mục đầu ra, Validate rồi export package ảnh/SRT/report." /><div className="guide-boundary"><b>Phạm vi Phase 4</b><p>Exporter tạo ảnh gốc, SRT cue theo Voice Beat và export_report.json. TTS, voice cloning, video rendering và điều khiển PanelVid nằm ngoài phạm vi.</p></div></section>
        </>}
      </div>
    </main>
  </div>;
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail" title={detail}>{detail}</div></div>;
}
function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="info-row"><span>{label}</span><b className={mono ? 'mono' : ''} title={value}>{value}</b></div>; }
function EmptyState({ icon, title, description, action, onClick }: { icon: React.ReactNode; title: string; description: string; action: string; onClick: () => void }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><p>{description}</p><button className="outline-button" onClick={onClick}>{action}</button></div>; }
function QuickItem({ icon, title, detail, action, done, onClick }: { icon: React.ReactNode; title: string; detail: string; action: string; done: boolean; onClick: () => void }) { return <div className="quick-item"><div className={`quick-icon ${done ? 'done' : ''}`}>{done ? <Check size={16} /> : icon}</div><div className="quick-copy"><b>{title}</b><span title={detail}>{detail}</span></div><button onClick={onClick}>{action}</button></div>; }
function ImportCard({ icon, step, title, description, status, done, action, onClick }: { icon: React.ReactNode; step: string; title: string; description: string; status: string; done: boolean; action: string; onClick: () => void }) { return <article className="import-card"><div className="import-top"><div className="import-icon">{icon}</div><span className="step-tag">{step}</span></div><h2>{title}</h2><p>{description}</p><div className={`import-status ${done ? 'done' : ''}`}><span>{done && <Check size={13} />}{status}</span></div><button className="outline-button" onClick={onClick}><FolderOpen size={15} />{action}</button></article>; }
function AnalysisList({ items }: { items: ImportedAnalysis[] }) { return <div className="analysis-list">{items.map((item) => <div className="analysis-row" key={item.path}><div className="analysis-file-icon"><FileJson2 size={16} /></div><div className="analysis-name"><b>{item.chapterNumber != null ? `Chapter ${item.chapterNumber}` : item.fileName}</b><span>{item.series ?? item.fileName}{item.chapterTitle ? ` · ${item.chapterTitle}` : ''}</span></div><span className="beat-pill">{item.voiceBeatCount ?? '—'} beat</span></div>)}</div>; }
function GuideStep({ number, title, text }: { number: string; title: string; text: string }) { return <div className="guide-step"><span>{number}</span><div><b>{title}</b><p>{text}</p></div></div>; }

function MappingMetric({ label, value, detail, tone = '' }: { label: string; value: number; detail: string; tone?: string }) {
  return <div className={`mapping-metric ${tone}`}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></div>;
}

function imageStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    found: 'Ảnh hợp lệ', missing: 'Thiếu file ảnh', 'invalid-image': 'File không phải ảnh hợp lệ',
    'not-file': 'Đường dẫn không phải file', 'invalid-path': 'Đường dẫn Manifest không hợp lệ', unavailable: 'Không đọc được file/quyền truy cập'
  };
  return labels[status] ?? status;
}

function panelReferenceStatusLabel(status: PanelReferenceMapping['status']): string {
  const labels: Record<PanelReferenceMapping['status'], string> = {
    mapped: 'UUID khớp · ảnh hợp lệ', 'invalid-uuid': 'UUID sai định dạng', 'uuid-not-found': 'UUID không có trong Manifest',
    'duplicate-manifest-uuid': 'UUID trùng trong Manifest', 'image-missing': 'Đã khớp UUID · thiếu ảnh',
    'image-invalid': 'Đã khớp UUID · file ảnh lỗi', 'image-path-error': 'Đã khớp UUID · đường dẫn/quyền lỗi'
  };
  return labels[status];
}

function MappingBeatBadge({ panels, invalidFiles }: { panels: PanelReferenceMapping[]; invalidFiles: Set<string> }) {
  const errors = panels.filter(panel => panel.status !== 'mapped' || (panel.manifestFile && invalidFiles.has(imageFileKey(panel.manifestFile)))).length;
  return <span className={`mapping-beat-badge ${errors ? 'has-errors' : 'all-good'}`}>{errors ? `${errors} cảnh báo` : 'UUID khớp'}</span>;
}

function MappedPanelCard({ panel, previewInvalid, loadPreview, onPreviewInvalid }: {
  panel: PanelReferenceMapping;
  previewInvalid: boolean;
  loadPreview: (manifestFile: string) => Promise<string>;
  onPreviewInvalid: (uuid: string) => void;
}) {
  const statusText = previewInvalid ? 'Ảnh không giải mã được' : panelReferenceStatusLabel(panel.status);
  return <article className={`mapped-panel-card ${panel.status === 'mapped' && !previewInvalid ? 'mapped-ok' : 'mapped-error'}`}>
    <div className="mapped-panel-heading"><b>{panel.panelId ?? 'Panel chưa xác định'}</b><span className={`mapping-status-pill ${panel.status === 'mapped' && !previewInvalid ? 'ok' : 'error'}`}>{statusText}</span></div>
    {panel.status === 'mapped' && panel.manifestFile
      ? <PanelImagePreview panel={panel} loadPreview={loadPreview} onPreviewInvalid={onPreviewInvalid} />
      : <div className="panel-image-placeholder"><CircleAlert size={20} /><span>{panelReferenceStatusLabel(panel.status)}</span></div>}
    <div className="mapped-panel-meta"><span>UUID</span><code title={panel.referenceUuid}>{panel.referenceUuid || '(rỗng)'}</code></div>
    <div className="mapped-panel-meta"><span>Tên file / Manifest</span><code title={panel.manifestFile ?? ''}>{panel.manifestFile ?? 'Không có panel.file'}</code></div>
    <div className="mapped-panel-meta"><span>Đường dẫn resolve</span><code title={panel.resolvedPath ?? ''}>{panel.resolvedPath ?? 'Chưa resolve'}</code></div>
    {panel.sourceFileIsNull && panel.sourceRegionsCount > 0 && <div className="source-regions-note">source_file=null hợp lệ · {panel.sourceRegionsCount} source regions</div>}
  </article>;
}

function PanelImagePreview({ panel, loadPreview, onPreviewInvalid }: {
  panel: PanelReferenceMapping;
  loadPreview: (manifestFile: string) => Promise<string>;
  onPreviewInvalid: (uuid: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '180px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !panel.manifestFile || failed) return;
    let active = true;
    void loadPreview(panel.manifestFile).then(dataUrl => { if (active) setSource(dataUrl); }).catch(() => {
      if (active) { setFailed(true); onPreviewInvalid(panel.manifestFile!); }
    });
    return () => { active = false; };
  }, [visible, panel.manifestFile, panel.referenceUuid, failed, loadPreview, onPreviewInvalid]);

  return <div className="panel-image-preview" ref={host}>
    {source && !failed ? <img src={source} alt={`Panel ${panel.panelId ?? panel.referenceUuid}`} onError={() => {
      setFailed(true);
      onPreviewInvalid(panel.manifestFile!);
    }} /> : failed ? <div className="panel-image-placeholder invalid"><CircleAlert size={20} /><span>Không giải mã được ảnh</span></div> : <div className="panel-image-placeholder"><Images size={20} /><span>Ảnh sẽ nạp khi hiện trong preview</span></div>}
  </div>;
}
