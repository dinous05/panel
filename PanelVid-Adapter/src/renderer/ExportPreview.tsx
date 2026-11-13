import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Download, FolderOpen, Images, ShieldAlert } from 'lucide-react';
import type { ExportDestination, ExportProgress, ExportResult, MappingResult } from '../shared/types';
import type { LogicalPageDocument, LogicalPage } from '../shared/logical-pages';
import { validateExport } from '../shared/export-validation';

interface Props {
  mapping: MappingResult;
  document: LogicalPageDocument;
  loadPreview: (file: string) => Promise<string>;
  output: ExportDestination | null;
  result: ExportResult | null;
  progress: ExportProgress | null;
  exporting: boolean;
  onChooseFolder: () => void;
  onValidate: () => void;
  onExport: () => void;
  onOpenResult: () => void;
}
export default function ExportPreview({ mapping, document, loadPreview, output, result, progress, exporting, onChooseFolder, onValidate, onExport, onOpenResult }: Props) {
  const issues = useMemo(() => validateExport(mapping, document), [mapping, document]);
  const chapters = mapping.chapters.map(chapter => ({ chapter, pages: document.pages.filter(page => page.chapterKey === chapter.chapterKey) }));
  const totalPages = document.pages.length;
  const totalPanels = document.pages.reduce((sum, page) => sum + page.scenes.reduce((n, scene) => n + scene.panels.length, 0), 0);
  const totalScenes = document.pages.reduce((sum, page) => sum + page.scenes.length, 0);
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const canExport = errors.length === 0 && Boolean(output) && !exporting;
  const [validationShown, setValidationShown] = useState(false);
  return <>
    <div className="page-heading"><div><div className="eyebrow">PHASE 4 · PANELVID EXPORTER</div><h1>Export Preview</h1><p>Kiểm tra thứ tự Page → Scene → Panel và narration trước khi tạo package cục bộ.</p></div><button className="primary-button" disabled={!canExport} onClick={onExport}><Download size={16}/>{exporting ? 'Đang export…' : 'Export package'}</button></div>
    <section className="export-summary-grid">
      <Summary label="Project" value={mapping.projectName ?? 'Chưa đặt tên'} detail={mapping.projectId ?? 'Không có project ID'} />
      <Summary label="Chapter" value={chapters.length} detail="Giữ nguyên thứ tự Analysis" />
      <Summary label="Logical Page" value={totalPages} detail="Một cue SRT cho mỗi beat" />
      <Summary label="Panel / Scene" value={`${totalPanels} / ${totalScenes}`} detail="Scene được làm phẳng khi export" />
    </section>
    <section className="panel-card export-controls">
      <div className="export-control-row"><div><b>Thư mục đầu ra</b><span>{output ? `${output.folderName} · package con PanelVid_Output` : 'Chưa chọn thư mục đích'}</span></div><button className="outline-button" disabled={exporting} onClick={onChooseFolder}><FolderOpen size={15}/>Choose Output Folder</button></div>
      <div className="export-control-row"><div><b>Validation trước khi export</b><span>{errors.length ? `${errors.length} lỗi chặn export` : warnings.length ? `Hợp lệ · ${warnings.length} cảnh báo` : 'Mapping, Page, panel và narration hợp lệ'}</span></div><span className={`export-validation-pill ${errors.length ? 'bad' : 'good'}`}>{errors.length ? 'CẦN SỬA' : 'VALID'}</span></div>
      <button className="quiet-button" onClick={() => { setValidationShown(true); onValidate(); }}><ShieldAlert size={15}/>Validate</button><button className="quiet-button" onClick={() => setValidationShown(value => !value)}>{validationShown ? 'Ẩn chi tiết validation' : 'Xem chi tiết'}</button>
      {(validationShown || errors.length > 0 || warnings.length > 0) && <div className={`export-issues ${errors.length ? 'has-errors' : 'no-errors'}`}>
        {errors.length === 0 && <p><Check size={14}/> Không có lỗi chặn export.</p>}
        {[...errors, ...warnings].map((issue, index) => <div key={`${issue.code}-${index}`} className={issue.severity}><b>{issue.severity === 'error' ? 'ERROR' : 'WARNING'}</b><span>{issue.message}</span></div>)}
      </div>}
      {exporting && <div className="export-progress"><div><span>{progress?.current ?? 'Đang chuẩn bị package…'}</span><b>{progress ? `${Math.min(99, Math.floor(progress.completed / Math.max(progress.total, 1) * 100))}%` : ''}</b></div><div className="export-progress-track"><i style={{ width: progress ? `${Math.min(99, progress.completed / Math.max(progress.total, 1) * 100)}%` : '4%' }}/></div></div>}
      {result && <div className="export-success"><Check size={16}/><span>Đã tạo package · {result.exportedFileCount} file · {(result.totalBytes / (1024 * 1024)).toFixed(1)} MiB</span><button className="outline-button" onClick={onOpenResult}>Mở thư mục kết quả</button></div>}
    </section>
    {chapters.map(({ chapter, pages }, chapterIndex) => {
      const sceneCount = pages.reduce((n, page) => n + page.scenes.length, 0);
      const panelCount = pages.reduce((n, page) => n + page.scenes.reduce((m, scene) => m + scene.panels.length, 0), 0);
      const chapterIssues = issues.filter(issue => issue.chapterKey === chapter.chapterKey);
      const folderName = `Chapter_${String(chapterIndex + 1).padStart(3, '0')}`;
      const chapterStatus = result ? 'EXPORTED' : exporting && progress?.current.startsWith(folderName) ? 'EXPORTING' : chapterIssues.length ? 'VALIDATION ERROR' : 'READY';
      return <section className="panel-card export-chapter" key={chapter.chapterKey}>
        <div className="card-heading"><div><span className="eyebrow">CHAPTER {String(chapterIndex + 1).padStart(3, '0')} · {chapterStatus}</span><h2>{chapter.series ?? 'Chapter'}{chapter.chapterNumber != null ? ` ${chapter.chapterNumber}` : ''}{chapter.chapterTitle ? ` · ${chapter.chapterTitle}` : ''}</h2></div><span className={`export-validation-pill ${chapterIssues.length ? 'bad' : 'good'}`}>{pages.length} Page · {sceneCount} Scene · {panelCount} Panel · {pages.length} cue</span></div>
        {!pages.length && <div className="mapping-no-beats">Chapter không có Logical Page; export sẽ bị chặn thay vì bỏ qua.</div>}
        {pages.map((page, pageIndex) => <PagePreview key={page.id} page={page} pageIndex={pageIndex} loadPreview={loadPreview}/ >)}
      </section>;
    })}
  </>;
}
function Summary({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div className="export-summary"><span>{label}</span><b>{value}</b><small title={detail}>{detail}</small></div>; }
function PagePreview({ page, pageIndex, loadPreview }: { page: LogicalPage; pageIndex: number; loadPreview: (file: string) => Promise<string> }) {
  return <article className="export-page">
    <div className="export-page-heading"><div><b>Page {String(pageIndex + 1).padStart(3, '0')}</b><code>{page.beat.beatId ?? 'Beat ID không có'} · {page.scenes.length} Scene</code></div><span>{page.scenes.reduce((sum, scene) => sum + scene.panels.length, 0)} panel</span></div>
    <p className="export-page-narration"><b>[TRANG {pageIndex + 1}]</b> {page.beat.narration}</p>
    {page.scenes.map((scene, sceneIndex) => <div className="export-scene" key={scene.id}><div className="export-scene-heading"><b>Scene {sceneIndex + 1}</b><span>{scene.panels.length} panel</span></div><div className="export-image-grid">{scene.panels.map((panel, panelIndex) => <ExportPanel key={panel.key} uuid={panel.reference.referenceUuid} filename={panel.reference.manifestFile ?? ''} status={panel.reference.status} order={panelIndex + 1} loadPreview={loadPreview}/>)}</div></div>)}
  </article>;
}
function ExportPanel({ uuid, filename, status, order, loadPreview }: { uuid: string; filename: string; status: string; order: number; loadPreview: (file: string) => Promise<string> }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !filename || status !== 'mapped') return;
    let alive = true;
    void loadPreview(filename).then(value => { if (alive) setSrc(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [visible, filename, status, loadPreview]);
  return <div className="export-image-card" ref={host}><div className="export-image-thumb">{src ? <img src={src} alt={`Panel ${order} ${uuid}`}/> : <span>{failed ? <CircleAlert size={17}/> : <Images size={17}/>} {failed ? 'Ảnh lỗi' : status === 'mapped' ? 'Nạp ảnh khi xem' : status}</span>}</div><b>Panel {String(order).padStart(3, '0')}</b><code title={uuid}>{uuid}</code><small title={filename}>{filename}</small></div>;
}
