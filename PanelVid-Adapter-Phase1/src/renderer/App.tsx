import { useMemo, useState } from 'react';
import { Archive, ArrowDownToLine, BookOpen, Check, CircleHelp, FileJson2, FolderOpen, Images, Layers3, RotateCcw, Upload, X } from 'lucide-react';
import type { AnalysisSummary, BatchReportSummary, ManifestSummary } from '../shared/types';

type Page = 'overview' | 'imports' | 'guide';

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [manifest, setManifest] = useState<ManifestSummary | null>(null);
  const [panelFolder, setPanelFolder] = useState<{ path: string; folderName: string; imageCount: number } | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [batchReport, setBatchReport] = useState<BatchReportSummary | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const beats = useMemo(() => analyses.reduce((sum, item) => sum + (item.voiceBeatCount ?? 0), 0), [analyses]);
  const importedCount = Number(Boolean(manifest)) + Number(Boolean(panelFolder)) + Number(analyses.length > 0) + Number(Boolean(batchReport));

  const showError = (text: string) => setNotice({ kind: 'error', text });
  const showSuccess = (text: string) => setNotice({ kind: 'success', text });

  async function importManifest() {
    const result = await window.panelVidAdapter.chooseManifest();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn file.') showError(result.error ?? 'Không đọc được Manifest.'); return; }
    setManifest(result.data!); showSuccess(`Đã đọc ${result.data!.fileName}.`);
  }
  async function importPanelFolder() {
    const result = await window.panelVidAdapter.choosePanelFolder();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn thư mục.') showError(result.error ?? 'Không đọc được thư mục ảnh.'); return; }
    setPanelFolder(result.data!); showSuccess(`Đã quét ${result.data!.imageCount} ảnh trong ${result.data!.folderName}.`);
  }
  async function importAnalyses() {
    const result = await window.panelVidAdapter.chooseAnalysisFiles();
    if (!result.ok) { if (result.error !== 'Chưa chọn file analysis.') showError(result.error ?? 'Không đọc được Analysis JSON.'); return; }
    setAnalyses(result.data!); showSuccess(`Đã đọc ${result.data!.length} file AI Analysis.`);
  }
  async function importReport() {
    const result = await window.panelVidAdapter.chooseBatchReport();
    if (!result.ok) { if (result.error !== 'Đã hủy chọn file.') showError(result.error ?? 'Không đọc được Batch Report.'); return; }
    setBatchReport(result.data!); showSuccess(`Đã đọc ${result.data!.fileName}.`);
  }
  function resetAll() {
    setManifest(null); setPanelFolder(null); setAnalyses([]); setBatchReport(null); setNotice({ kind: 'success', text: 'Đã xóa dữ liệu đã import khỏi phiên làm việc.' });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><div><strong>PanelVid</strong><span>ADAPTER</span></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}><Layers3 size={17} /> Tổng quan</button>
      <button className={`nav-item ${page === 'imports' ? 'active' : ''}`} onClick={() => setPage('imports')}><ArrowDownToLine size={17} /> Import dữ liệu {importedCount > 0 && <i>{importedCount}</i>}</button>
      <div className="side-label side-label-lower">ỨNG DỤNG</div>
      <button className={`nav-item ${page === 'guide' ? 'active' : ''}`} onClick={() => setPage('guide')}><CircleHelp size={17} /> Hướng dẫn</button>
      <div className="sidebar-bottom"><div className="offline-dot" /> Hoạt động offline <span>Phase 1</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">PanelVid Adapter <span>/</span> {page === 'overview' ? 'Tổng quan' : page === 'imports' ? 'Import dữ liệu' : 'Hướng dẫn'}</div><div className="topbar-right"><span className="local-badge"><span /> DỮ LIỆU CHỈ Ở MÁY NÀY</span><button className="reset-button" onClick={resetAll} title="Xóa toàn bộ dữ liệu đã import"><RotateCcw size={15} /> Reset</button></div></header>
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
          <div className="phase-note"><span className="phase-number">01</span><div><b>Phase 1 · Import dữ liệu</b><p>Các bước validate UUID, Beat Mapping và Exporter chưa được triển khai.</p></div><span className="phase-tag">CURRENT PHASE</span></div>
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

        {page === 'guide' && <>
          <div className="page-heading"><div><div className="eyebrow">GETTING STARTED</div><h1>Hướng dẫn</h1><p>Chuẩn bị dữ liệu và sử dụng các chức năng có trong Phase 1.</p></div></div>
          <section className="panel-card guide-card"><GuideStep number="01" title="Import Manifest" text="Chọn manifest.json được PanelCutter xuất. Ứng dụng đọc tên project, schema version và số panel nếu các trường đó có trong file." /><GuideStep number="02" title="Chọn thư mục ảnh" text="Chọn thư mục chứa ảnh panel đã xuất. Ứng dụng đếm ảnh theo đuôi JPG, PNG, WebP, BMP và một số định dạng ảnh phổ biến trong thư mục con." /><GuideStep number="03" title="Import AI Analysis" text="Chọn một hoặc nhiều file analysis_result JSON. Ứng dụng đọc chapter metadata và đếm phần tử trong voice_beats." /><GuideStep number="04" title="Reset khi cần" text="Nút Reset xóa thông tin đã import khỏi bộ nhớ của phiên làm việc. File nguồn không bị thay đổi hoặc xóa." /><div className="guide-boundary"><b>Phạm vi hiện tại</b><p>Phase 1 kiểm tra khả năng phân tích cú pháp JSON và hiển thị thông tin cơ bản. Chưa kiểm tra UUID, không ghép beat với panel, không tạo đầu ra cho PanelVid.</p></div></section>
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
function AnalysisList({ items }: { items: AnalysisSummary[] }) { return <div className="analysis-list">{items.map((item) => <div className="analysis-row" key={item.path}><div className="analysis-file-icon"><FileJson2 size={16} /></div><div className="analysis-name"><b>{item.chapterNumber != null ? `Chapter ${item.chapterNumber}` : item.fileName}</b><span>{item.series ?? item.fileName}{item.chapterTitle ? ` · ${item.chapterTitle}` : ''}</span></div><span className="beat-pill">{item.voiceBeatCount ?? '—'} beat</span></div>)}</div>; }
function GuideStep({ number, title, text }: { number: string; title: string; text: string }) { return <div className="guide-step"><span>{number}</span><div><b>{title}</b><p>{text}</p></div></div>; }
