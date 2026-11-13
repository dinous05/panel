import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GitMerge, Scissors, CircleAlert } from 'lucide-react';
import type { MappingResult, PanelReferenceMapping } from '../shared/types';
import { mergeSceneWithPrevious, movePanel, moveScene, splitScene, validateLogicalPages, type LogicalPageDocument } from '../shared/logical-pages';

export default function LogicalPageEditor({ mapping, document, setDocument, loadPreview }: { mapping: MappingResult; document: LogicalPageDocument; setDocument: React.Dispatch<React.SetStateAction<LogicalPageDocument>>; loadPreview: (file: string) => Promise<string> }) {
  const issues = useMemo(() => validateLogicalPages(document, mapping), [document, mapping]);

  return <section className="panel-card logical-editor">
    <div className="card-heading"><div><span className="eyebrow">PHASE 3 · BEAT MAPPER</span><h2>Logical Page & Scene Preview</h2></div><span className="count-chip">{document.pages.length} LOGICAL PAGE</span></div>
    <div className="logical-intro">Mỗi Voice Beat tạo một Logical Page. Đây là cấu trúc biên tập nội bộ, không phải trang truyện gốc; narration và dữ liệu AI Analysis được giữ nguyên.</div>
    <div className={`logical-validation ${issues.length ? 'has-issues' : 'is-valid'}`}>
      {issues.length ? <><CircleAlert size={15}/><div><b>{issues.length} vấn đề cần xử lý</b><ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></div></> : <><span className="validation-check">✓</span><b>Validation cấu trúc hợp lệ · không thiếu/trùng panel</b></>}
    </div>
    {document.pages.map(page => {
      const orderedPanels = page.scenes.flatMap(scene => scene.panels);
      return <article className="logical-page" key={page.id}>
      <div className="logical-page-header"><div><span>{page.chapterLabel} · Chapter {page.chapterOrder + 1}</span><h3>Logical Page {page.beatIndex + 1} <code>{page.beat.beatId ?? 'Beat ID không có'}</code></h3></div><span className="logical-panel-count">{page.scenes.reduce((n, scene) => n + scene.panels.length, 0)} panel</span></div>
      <p className="logical-narration">{page.beat.narration || 'Không có narration trong beat.'}</p>
      <div className="logical-metadata"><span>Emotion: <b>{printValue(page.beat.metadata.emotion)}</b></span><span>Transition: <b>{printValue(page.beat.metadata.transition)}</b></span><span>Order gốc: <b>{printValue(page.beat.order)}</b></span></div>
      {page.scenes.map((scene, sceneIndex) => <section className="logical-scene" key={scene.id}>
        <div className="logical-scene-title"><b>Scene {sceneIndex + 1}</b><span>{scene.panels.length} panel</span><div className="scene-action-group"><button className="scene-action" disabled={sceneIndex === 0} onClick={() => setDocument(current => moveScene(current, page.id, scene.id, -1))}><ArrowUp size={13}/> Lên</button><button className="scene-action" disabled={sceneIndex === page.scenes.length - 1} onClick={() => setDocument(current => moveScene(current, page.id, scene.id, 1))}><ArrowDown size={13}/> Xuống</button>{sceneIndex > 0 && <button className="scene-action" onClick={() => setDocument(current => mergeSceneWithPrevious(current, page.id, scene.id))}><GitMerge size={13}/> Gộp với Scene trước</button>}</div></div>
        {!scene.panels.length && <div className="logical-error">Scene rỗng — cần gộp Scene hoặc khôi phục panel.</div>}
        <div className="logical-panels">{scene.panels.map(panel => <LogicalPanelCard key={panel.key} panel={panel} loadPreview={loadPreview} first={orderedPanels[0]?.key === panel.key} last={orderedPanels.at(-1)?.key === panel.key} canSplit={scene.panels.at(-1)?.key !== panel.key} onUp={() => setDocument(current => movePanel(current, page.id, scene.id, panel.key, -1))} onDown={() => setDocument(current => movePanel(current, page.id, scene.id, panel.key, 1))} onSplit={() => setDocument(current => splitScene(current, page.id, scene.id, panel.key))}/>)}</div>
      </section>)}
    </article>;
    })}
  </section>;
}
function printValue(value: unknown): string { return value == null || value === '' ? '—' : typeof value === 'string' ? value : JSON.stringify(value); }
function statusLabel(panel: PanelReferenceMapping): string { return panel.status === 'mapped' ? 'Mapped' : panel.status; }
function LogicalPanelCard({ panel, loadPreview, first, last, canSplit, onUp, onDown, onSplit }: { panel: { key: string; reference: PanelReferenceMapping }; loadPreview: (file: string) => Promise<string>; first: boolean; last: boolean; canSplit: boolean; onUp: () => void; onDown: () => void; onSplit: () => void }) {
  const ref = panel.reference;
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
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
    if (!visible || ref.status !== 'mapped' || !ref.manifestFile) return;
    let active = true;
    void loadPreview(ref.manifestFile).then(source => { if (active) setImage(source); }).catch(() => { if (active) setImageError(true); });
    return () => { active = false; };
  }, [visible, ref.status, ref.manifestFile, loadPreview]);
  return <div className={`logical-panel ${ref.status === 'mapped' && !imageError ? '' : 'logical-panel-error'}`}>
    <div className="logical-image" ref={host}>{image ? <img src={image} alt={`Panel ${ref.referenceUuid}`} /> : <span>{imageError ? 'Không tải được ảnh' : ref.status === 'mapped' ? 'Ảnh sẽ nạp khi hiện trong preview' : `Không có ảnh · ${statusLabel(ref)}`}</span>}</div>
    <div className="logical-panel-uuid" title={ref.referenceUuid}>{ref.referenceUuid || 'UUID rỗng'}</div>
    <div className="logical-panel-file" title={ref.manifestFile ?? ''}>{ref.manifestFile ?? 'Không có filename'}</div>
    <div className={`logical-status ${ref.status === 'mapped' && !imageError ? 'ok' : 'bad'}`}>{imageError ? 'Ảnh lỗi' : statusLabel(ref)}</div>
    <div className="logical-actions"><button disabled={first} onClick={onUp} aria-label="Di chuyển panel lên"><ArrowUp size={13}/></button><button disabled={last} onClick={onDown} aria-label="Di chuyển panel xuống"><ArrowDown size={13}/></button><button disabled={!canSplit} onClick={onSplit} title="Tách Scene sau panel này"><Scissors size={13}/> Tách sau</button></div>
  </div>;
}
