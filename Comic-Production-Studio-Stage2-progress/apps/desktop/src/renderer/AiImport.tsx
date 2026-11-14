import React, { useState } from 'react';
import type { ProjectSummary } from '../../../../packages/contracts/src/index';

type ImportedFile = { sourceName: string; fileName: string; path: string; bytes: number; chapter: string | null; voiceBeatCount: number | null };
type Bridge = {
  chooseAnalysisFiles: () => Promise<string[]>;
  importAnalysisFiles: (projectPath: string, files: string[]) => Promise<ImportedFile[]>;
};

export default function AiImport({ project, bridge, onNotice }: { project: ProjectSummary | null; bridge: Bridge; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ImportedFile[]>([]);
  async function chooseAndImport() {
    if (!project) { onNotice('Hãy mở hoặc tạo Project trước khi nhập AI JSON.'); return; }
    setBusy(true);
    try {
      const files = await bridge.chooseAnalysisFiles();
      if (!files.length) return;
      const result = await bridge.importAnalysisFiles(project.path, files);
      setItems(current => [...result, ...current]);
      onNotice(`Đã nhập ${result.length} file JSON vào analysis/incoming. File nguồn được giữ nguyên.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="module-workspace">
    <section className="project-card import-card">
      <div className="project-icon">⇩</div>
      <div className="project-info"><span className="eyebrow">AI ANALYSIS · LOCAL IMPORT</span><h2>{project ? project.metadata.name : 'Chưa mở Project'}</h2>
        <p>{project ? `${project.path}/analysis/incoming` : 'Mở Project trên Dashboard trước khi nhập file.'}</p>
        <p>Chọn JSON do AI bên ngoài tạo. Nội dung được kiểm tra cú pháp rồi sao chép nguyên trạng; ứng dụng không gọi AI API và không sửa file nguồn.</p>
      </div>
      <div className="actions"><button className="btn-primary" disabled={busy || !project} onClick={chooseAndImport}>{busy ? 'Đang nhập…' : 'Chọn file JSON'}</button></div>
    </section>
    {items.length > 0 && <section className="section-head import-results"><div><h2>Đã nhập trong phiên này</h2><p>Các bản gốc nằm trong thư mục analysis/incoming của Project.</p></div></section>}
    {items.length > 0 && <div className="recent">{items.map((item, index) => <div className="import-row" key={`${item.path}-${index}`}><b>{item.fileName}</b><small>{item.chapter || 'Chapter metadata chưa có'}{item.voiceBeatCount === null ? '' : ` · ${item.voiceBeatCount} voice beats`} · {(item.bytes / 1024).toFixed(1)} KB</small><small>{item.path}</small></div>)}</div>}
    <div className="pipeline import-guidance"><div><span className="eyebrow">BẢO TOÀN DỮ LIỆU</span><h2>Nhập không phá hủy</h2></div><div className="steps"><span>Kiểm tra JSON</span><b>→</b><span>Sao chép nguyên byte</span><b>→</b><span>Không ghi đè bản cũ</span></div></div>
  </div>;
}
