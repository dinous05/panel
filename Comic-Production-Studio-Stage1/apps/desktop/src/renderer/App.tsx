import React, { useState } from 'react';
import { DEFAULT_MODULES, type ModuleId, type ProjectSummary } from '../../../../packages/contracts/src/index';
import './style.css';
import './modal.css';

declare global {
  interface Window {
    cps: {
      chooseProjectParent: () => Promise<string | null>;
      chooseExistingProject: () => Promise<string | null>;
      createProject: (parent: string, name: string) => Promise<ProjectSummary>;
      openProject: (path: string) => Promise<ProjectSummary>;
      inspectProjectAccess: (path: string) => Promise<{ projectId: string; writable: Record<string, boolean>; readOnlyModules: string[] }>;
      listProjects: (path: string) => Promise<ProjectSummary[]>;
      backupProject: (path: string, backupParent: string) => Promise<string>;
      restoreProject: (backupPath: string, destinationPath: string) => Promise<ProjectSummary>;
    };
  }
}

function messageFor(error: unknown) {
  const text = String(error);
  if (text.includes('project.json') || text.includes('ENOENT')) {
    return 'Thư mục bạn chọn chưa phải Project của Comic Production Studio (thiếu project.json). Hãy dùng “Tạo Project” trước, hoặc chọn đúng thư mục Project đã tạo.';
  }
  return text.replace(/^Error: /, '');
}

export default function App() {
  const [active, setActive] = useState<ModuleId>('dashboard');
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const selected = DEFAULT_MODULES.find(item => item.id === active)!;

  async function setCurrentProject(value: ProjectSummary) {
    setProject(value);
    try {
      const access = await window.cps.inspectProjectAccess(value.path);
      if (access.readOnlyModules.length) setNotice(`Project đã mở nhưng các thư mục sau không có quyền ghi: ${access.readOnlyModules.join(', ')}. Hãy kiểm tra quyền thư mục trước khi chạy module.`);
      else setNotice(`Project sẵn sàng: ${value.metadata.name}`);
    } catch (error) { setNotice(messageFor(error)); }
  }

  async function beginCreate() {
    const parent = await window.cps.chooseProjectParent();
    if (parent) { setCreateParent(parent); setProjectName(''); }
  }
  async function finishCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!createParent || !projectName.trim()) return;
    setBusy(true);
    try {
      const created = await window.cps.createProject(createParent, projectName.trim());
      setCreateParent(null);
      await setCurrentProject(created);
    } catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(false); }
  }
  async function open() {
    const selectedPath = await window.cps.chooseExistingProject();
    if (!selectedPath) return;
    setBusy(true);
    try {
      const opened = await window.cps.openProject(selectedPath);
      await setCurrentProject(opened);
    } catch (error) {
      setNotice(messageFor(error));
    } finally { setBusy(false); }
  }
  async function backup() {
    if (!project) return;
    const parent = await window.cps.chooseProjectParent();
    if (!parent) return;
    setBusy(true);
    try { setNotice(`Đã sao lưu an toàn: ${await window.cps.backupProject(project.path, parent)}`); }
    catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(false); }
  }
  async function restore() {
    const backupPath = await window.cps.chooseExistingProject();
    if (!backupPath) return;
    const parent = await window.cps.chooseProjectParent();
    if (!parent) return;
    const name = window.prompt('Tên thư mục mới để khôi phục (không ghi đè):');
    if (!name) return;
    setBusy(true);
    try {
      const restored = await window.cps.restoreProject(backupPath, `${parent}/${name}`);
      await setCurrentProject(restored);
    } catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(false); }
  }
  async function showProjects() {
    const parent = await window.cps.chooseProjectParent();
    if (!parent) return;
    try { setRecent(await window.cps.listProjects(parent)); }
    catch (error) { setNotice(messageFor(error)); }
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">C</div><div><b>Comic Production</b><small>STUDIO · FOUNDATION</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{DEFAULT_MODULES.map(item => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActive(item.id)}>
        <span className="nav-icon">{item.id === 'dashboard' ? '⌂' : item.id === 'panel-cutter' ? '▧' : item.id === 'ai-import' ? '⇩' : item.id === 'adapter' ? '⧉' : item.id === 'video-studio' ? '▶' : item.id === 'export-history' ? '◷' : '⚙'}</span>
        {item.title}{item.status === 'integration-pending' && <i>SOON</i>}
      </button>)}</nav>
      <div className="side-footer"><span className="online-dot"/> Local workspace <small>AI API not connected</small></div>
    </aside>
    <main className="main">
      <header><div className="crumb">Comic Production Studio <span>/</span> {selected.title}</div><div className="header-right"><span className="privacy"><span className="online-dot"/> Local-first</span><span className="avatar">CP</span></div></header>
      <section className="content">
        <div className="eyebrow">{active === 'dashboard' ? 'YOUR WORKSPACE' : 'MODULE'}</div>
        <h1>{active === 'dashboard' ? 'Production dashboard' : selected.title}</h1>
        <p className="intro">{active === 'dashboard' ? 'Quản lý Project và theo dõi quy trình sản xuất truyện trong một không gian thống nhất.' : selected.description}</p>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        {active === 'dashboard' ? <>
          <div className="project-card"><div className="project-icon">▣</div><div className="project-info"><span className="eyebrow">CURRENT PROJECT</span>{project ? <><h2>{project.metadata.name}</h2><p>{project.path}</p></> : <><h2>Chưa mở Project</h2><p>Tạo Project mới trước khi bắt đầu sử dụng các module.</p></>}</div>
            <div className="actions"><button className="btn-secondary" disabled={busy} onClick={open}>Mở Project</button><button className="btn-primary" disabled={busy} onClick={beginCreate}>＋ Tạo Project</button><button className="btn-secondary" disabled={busy} onClick={restore}>Khôi phục backup</button>{project && <button className="btn-secondary" disabled={busy} onClick={backup}>Backup</button>}</div>
          </div>
          <div className="section-head"><div><h2>Các module</h2><p>Mỗi module có ranh giới mã nguồn, dữ liệu và kiểm thử riêng.</p></div><button className="text-button" onClick={showProjects}>Chọn thư mục để xem Project</button></div>
          {recent.length > 0 && <div className="recent">{recent.map(item => <button key={item.path} onClick={async () => { try { await setCurrentProject(await window.cps.openProject(item.path)); } catch (error) { setNotice(messageFor(error)); } }}><b>{item.metadata.name}</b><small>{item.path}</small></button>)}</div>}
          <div className="module-grid">{DEFAULT_MODULES.filter(item => !['dashboard', 'settings'].includes(item.id)).map(item => <button key={item.id} className="module-card" onClick={() => setActive(item.id)}>
            <span className="module-symbol">{item.id === 'panel-cutter' ? '▧' : item.id === 'ai-import' ? '⇩' : item.id === 'adapter' ? '⧉' : item.id === 'video-studio' ? '▶' : '◷'}</span><span className="status-pill">{item.status === 'available' ? 'Sẵn sàng' : 'Đang chờ tích hợp'}</span><h3>{item.title}</h3><p>{item.description}</p><span className="module-link">Mở module <b>→</b></span>
          </button>)}</div>
          <div className="pipeline"><div><span className="eyebrow">PIPELINE</span><h2>Từ trang truyện đến video</h2></div><div className="steps"><span>PanelCutter</span><b>→</b><span>AI Import / Adapter</span><b>→</b><span>Video Studio</span></div></div>
        </> : <div className="placeholder"><div className="placeholder-icon">{active === 'settings' ? '⚙' : '◈'}</div><span className="status-pill">{selected.status === 'available' ? 'Nền tảng sẵn sàng' : 'Giai đoạn tích hợp tiếp theo'}</span><h2>{active === 'settings' ? 'Cài đặt nền tảng' : 'Module đã có ranh giới kiến trúc'}</h2><p>{active === 'settings' ? 'Cài đặt Project và hành vi nền tảng sẽ được bổ sung theo từng giai đoạn.' : `Module ${selected.title} hiện là placeholder của Unified Shell. Mã nguồn gốc được giữ riêng trong original-source; chưa bật chức năng nghiệp vụ ở Giai đoạn 1.`}</p>{active !== 'settings' && <button className="btn-secondary" onClick={() => setActive('dashboard')}>← Về Dashboard</button>}</div>}
        <footer>COMIC PRODUCTION STUDIO <span>•</span> Stage 1 — Unified Foundation</footer>
      </section>
    </main>
    {createParent && <div className="modal-backdrop" role="presentation"><form className="create-modal" onSubmit={finishCreate}>
      <button type="button" className="modal-close" onClick={() => setCreateParent(null)} aria-label="Đóng">×</button>
      <span className="eyebrow">PROJECT MANAGER</span><h2>Tạo Project mới</h2><p>Chọn thư mục cha xong, hãy đặt tên cho thư mục Project mới. Dữ liệu hiện có sẽ không bị ghi đè.</p>
      <label>Thư mục cha<input value={createParent} readOnly /></label>
      <label>Tên Project<input autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Ví dụ: Truyen_001" maxLength={100} /></label>
      <div className="target-path">Vị trí tạo: <b>{createParent}/{projectName.trim() || 'Tên_Project'}</b></div>
      <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setCreateParent(null)}>Hủy</button><button type="submit" className="btn-primary" disabled={busy || !projectName.trim()}>{busy ? 'Đang tạo…' : 'Tạo Project'}</button></div>
    </form></div>}
  </div>;
}
