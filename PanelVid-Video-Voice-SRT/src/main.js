import JSZip from 'jszip';
import './style.css';
import { scenesFromPanelImages } from './panel-video-scenes.js';
import { resolveMinPanelAreaPct } from './panel-detector-core.js';
import { computeRowProfile, sliceStripProfile, stripSegmentCrop, stripPanWeight, normalizeComicStyle, isStripStyle } from './strip-slicer.js';
import { joinStripProfiles, mapStripCropToSources, stripPageIndexAt, stripZoomRange } from './strip-document.js';
import { parseSRT, computeVoiceDurations, shareFramesWeighted, analyzeMarkers, markerSegmentsFromCues, resolveVoiceId, cloneRefError } from './voice.js';
import { buildSubtitleItems } from './subtitles.js';
import { webtoonScrollPlan, webtoonTileSize } from './webtoon-stack.js';
import { appendHybridPanelCard } from './hybrid-panel-window.js';
import { parsePanelScriptDocumentTXT, bindPanelScriptToScenes, panelCueDurationsMap, isPanelScriptBindingValid } from './panel-script.js';
import { readSubtitleZip } from './batch-subtitles.js';
import { makeJobSnapshot, sanitizeJobFileName, validateJobVoice, jobDurations, runJobQueue, JOB_STATUS_TEXT, canRetryJob, jobSnapshotVoiceId, resolveJobComicStyle } from './jobs.js';
import { nextParkName, createParkedChapter, serializePages, serializeScenes, summarizeParked, findParked, removeParked, renameParked } from './pending.js';
import { extractFolderImages } from './folderscan.js';
import { hashSrt, suggestTestName, suggestFullName, TYPE_LABELS, formatLibDate, formatLibSeconds, canUseFullEntry } from './voicelib.js';
import { autoExportDecision, AUTO_EXPORT_SKIP_MESSAGES } from './autoexport.js';
import { loadUserPreferences, saveUserPreferences } from './user-prefs.js';
import { buildBatchManifest, validateBatchAssignments } from './batch-manifest.js';
import { MANGA_TRANSITIONS, normalizeMangaTransition } from './manga-transitions.js';
import { adjustVoiceTimeline, normalizeVoiceTiming } from './voice-timing.js';
import { groupPanelItemsByPage, logicalPageCount, logicalPageIndex } from './panel-folders.js';

const app = document.querySelector('#app');
// v6v: thẻ panel dải dọc mặc định thu còn 85% khung hình, kiểu Manhwa Origin
// (Hưng chốt 23/10/2026) thay cho phóng tối đa chạm mép ở v6s-v6u.
export const STRIP_CARD_SCALE = 0.85;
const MIN_PANEL_AREA_KEY = 'panelvid.minPanelAreaPct';
const PANEL_DISPLAY_SCALE_KEY = 'panelvid.panelDisplayScalePct';
const WEBTOON_WIDTH_KEY = 'panelvid.webtoonWidthPct';
const HYBRID_THRESHOLD_KEY = 'panelvid.hybridScrollThresholdPx';
const HYBRID_VISIBLE_PANELS_KEY = 'panelvid.hybridVisiblePanels';
function loadHybridVisiblePanels(){try{const n=Number(localStorage.getItem(HYBRID_VISIBLE_PANELS_KEY));return Number.isFinite(n)&&n>=1&&n<=10?Math.round(n):5;}catch{return 5;}}
function loadHybridScrollThreshold(){try{const n=Number(localStorage.getItem(HYBRID_THRESHOLD_KEY));return Number.isFinite(n)&&n>=600&&n<=20000?Math.round(n):1600;}catch{return 1600;}}
function loadWebtoonWidthPct() {
  try { const n=Number(localStorage.getItem(WEBTOON_WIDTH_KEY)); return Number.isFinite(n)&&n>=40&&n<=100?Math.round(n):100; }
  catch { return 100; }
}
function loadMinPanelAreaPct() {
  // v6j: mặc định 4%; giá trị lưu 25 (mặc định cũ) được migrate về 4.
  try { return resolveMinPanelAreaPct(localStorage.getItem(MIN_PANEL_AREA_KEY)); }
  catch { return 4; }
}
function loadPanelDisplayScalePct() {
  try {
    const value = Number(localStorage.getItem(PANEL_DISPLAY_SCALE_KEY));
    return Number.isFinite(value) && value >= 60 && value <= 200 ? Math.round(value) : 140;
  } catch { return 140; }
}
const PANEL_DISPLAY_MODE_KEY = 'panelvid.panelDisplayMode';
function loadPanelDisplayMode() {
  // Mặc định v6: thẻ panel (Hưng phản hồi full màn hình crop xấu). Chỉ dùng full/mosaic khi đã lưu rõ.
  try {
    const v = localStorage.getItem(PANEL_DISPLAY_MODE_KEY);
    return v === 'full' || v === 'mosaic' ? v : 'card';
  } catch { return 'card'; }
}
// Mã hóa video (v6k): 'auto' = ưu tiên GPU NVENC nếu máy có, 'cpu' = ép libx264.
// Lưu localStorage như các cài đặt hiển thị khác.
const ENCODER_KEY = 'panelvid.encoder';
function loadEncoderSetting() {
  try { return localStorage.getItem(ENCODER_KEY) === 'cpu' ? 'cpu' : 'auto'; }
  catch { return 'auto'; }
}
// Luồng render song song theo trang (v6l): render nhiều trang cùng lúc trong 1
// video để rút ngắn thời gian dựng. 1..4, mặc định 2, lưu localStorage.
const WORKERS_KEY = 'panelvid.workers';
function loadWorkersSetting() {
  try {
    const v = Number(localStorage.getItem(WORKERS_KEY));
    return [1, 2, 3, 4].includes(v) ? v : 2;
  } catch { return 2; }
}
// Phụ đề ghi lên video (v6i): bật/tắt + màu chữ + màu viền + cỡ chữ, lưu localStorage.
const SUB_SETTING_KEYS = { on: 'panelvid.subBurn', color: 'panelvid.subColor', outline: 'panelvid.subOutline', size: 'panelvid.subSize' };
function loadSubtitleSettings() {
  const s = { enabled: false, fontColor: '#FFD400', outlineColor: '#000000', fontSize: 48 };
  try {
    s.enabled = localStorage.getItem(SUB_SETTING_KEYS.on) === '1';
    const c = localStorage.getItem(SUB_SETTING_KEYS.color);
    if (/^#[0-9a-f]{6}$/i.test(c || '')) s.fontColor = c;
    const o = localStorage.getItem(SUB_SETTING_KEYS.outline);
    if (/^#[0-9a-f]{6}$/i.test(o || '')) s.outlineColor = o;
    const z = Number(localStorage.getItem(SUB_SETTING_KEYS.size));
    if (Number.isFinite(z) && z >= 24 && z <= 96) s.fontSize = Math.round(z);
  } catch {}
  return s;
}
// Kiểu truyện: Manga theo folder trang, Manhwa cuộn dọc, hoặc Manga lai. Lưu
// localStorage như các cài đặt hiển thị khác; mặc định 'manga'.
const COMIC_STYLE_KEY = 'panelvid.comicStyle';
function loadComicStyle() {
  try { return normalizeComicStyle(localStorage.getItem(COMIC_STYLE_KEY)); }
  catch { return 'manga'; }
}
const MANGA_TRANSITION_IN_KEY='panelvid.mangaTransitionIn';
const MANGA_TRANSITION_OUT_KEY='panelvid.mangaTransitionOut';
function loadMangaTransition(key,fallback){try{return normalizeMangaTransition(localStorage.getItem(key),fallback);}catch{return fallback;}}
const VOICE_TIMING_ANCHOR_KEY='panelvid.voiceTimingAnchor';
const VOICE_TIMING_OFFSET_KEY='panelvid.voiceTimingOffsetSeconds';
function loadVoiceTiming(){try{return normalizeVoiceTiming(localStorage.getItem(VOICE_TIMING_ANCHOR_KEY),localStorage.getItem(VOICE_TIMING_OFFSET_KEY));}catch{return{anchor:'start',offsetSeconds:0};}}
// Độ biểu cảm giọng clone (v6i): 0..1, mặc định 0.4 (êm, ít chói hơn 0.5 cũ).
const CLONE_EXAGG_KEY = 'panelvid.cloneExaggeration';
function loadCloneExaggeration() {
  try {
    const stored = localStorage.getItem(CLONE_EXAGG_KEY);
    if (stored === null) return persistedUserPreferences?.cloneExaggeration ?? 0.4;
    const v = Number(stored);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.4;
  } catch { return 0.4; }
}
const persistedUserPreferences = loadUserPreferences();
const state = {
  pages: [], scenes: [], stripDoc: null, selected: 0, status: 'empty', busy: false,
  reading: persistedUserPreferences.reading, seconds: persistedUserPreferences.seconds, totalSeconds: persistedUserPreferences.totalSeconds, pageSeconds: persistedUserPreferences.pageSeconds, durationMode: 'scene', quality: persistedUserPreferences.quality, fps: persistedUserPreferences.fps, encoder: loadEncoderSetting(), workers: loadWorkersSetting(), cropMode: false, voice: null,
  minPanelAreaPct: loadMinPanelAreaPct(), panelDisplayScalePct: loadPanelDisplayScalePct(),
  panelDisplayMode: loadPanelDisplayMode(), comicStyle: loadComicStyle(), webtoonWidthPct: loadWebtoonWidthPct(), hybridScrollThresholdPx: loadHybridScrollThreshold(), hybridVisiblePanels: loadHybridVisiblePanels(),
  mangaTransitionIn:loadMangaTransition(MANGA_TRANSITION_IN_KEY,'none'),mangaTransitionOut:loadMangaTransition(MANGA_TRANSITION_OUT_KEY,'slide-right'),
  voiceTimingAnchor:loadVoiceTiming().anchor,voiceTimingOffsetSeconds:loadVoiceTiming().offsetSeconds,
  subtitle: loadSubtitleSettings(),
};
function persistCurrentPreferences(){
  const voiceKind=document.querySelector('input[name="voice-kind"]:checked')?.value==='clone'?'clone':'edge';
  saveUserPreferences({durationMode:state.durationMode,seconds:state.seconds,totalSeconds:state.totalSeconds,pageSeconds:state.pageSeconds,quality:state.quality,fps:state.fps,reading:state.reading,voiceKind,edgeVoiceId:$('#voice-select')?.value||persistedUserPreferences.edgeVoiceId,customVoiceId:$('#voice-custom-id')?.value||'',cloneLanguage:$('#clone-lang')?.value||persistedUserPreferences.cloneLanguage,cloneExaggeration:currentExaggeration()});
}
let manualSplit = null;
// Trạng thái bộ xử lý HÀNG ĐỢI RENDER (v6f): jobs chạy nền, không chạm state workspace.
let jobsRunning = false, jobsStop = false, jobsVoiceActiveId = null, jobsRenderActiveId = null;
const isDesktop = Boolean(window.panelVid);

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark"><span></span><span></span><span></span><span></span></div><div><div class="brand-name">PANEL<span>VID</span></div><div class="brand-note">OFFLINE STUDIO</div></div></div>
      <div class="project-title"><span class="live-dot"></span><span id="project-name">Dự án mới</span><span class="local-chip"><i></i> Hình ảnh/video xử lý tại chỗ</span><span class="ver-chip">V6x</span></div>
      <div class="top-actions"><button class="new-chapter-btn hidden" id="new-chapter-btn" title="Quay lại để tạo chap mới">＋ Chap mới</button><button class="icon-button" id="settings-btn" title="Cài đặt">⚙</button><button class="icon-button" id="help-btn" title="Hướng dẫn">?</button><button class="avatar">PV</button></div>
    </header>
    <div class="workspace">
      <aside class="rail">
        <div class="rail-label">QUY TRÌNH</div>
        <div class="rail-step active"><b>01</b><span>Nhập panel</span></div>
        <div class="rail-step"><b>02</b><span>Cảnh video</span></div>
        <div class="rail-step"><b>03</b><span>Chuyển động</span></div>
        <div class="rail-step"><b>04</b><span>Xuất video</span></div>
        <div class="rail-spacer"></div>
        <div class="offline-card"><div class="offline-icon">⌁</div><strong>Ảnh/video xử lý tại chỗ</strong><span>Giọng Edge cần Internet; giọng clone chạy local sau khi cài.</span></div>
        <div class="version">PANELVID 0.1 · WINDOWS</div>
      </aside>
      <main class="main-area">
        <div class="page-head"><div><div class="eyebrow">DỰNG VIDEO TRUYỆN</div><h1>Ảnh truyện, thành video.</h1><p>Dùng ảnh panel đã cắt để tạo video, voice và phụ đề.</p></div><div class="head-badges"><span class="badge"><b></b> 16:9 YOUTUBE</span><span class="badge">1920 × 1080</span></div></div>
        <section class="import-card" id="import-card">
          <div class="import-orbit"><div class="orbit-ring"></div><div class="stack-art"><i></i><i></i><i></i></div><div class="spark spark-a">✦</div><div class="spark spark-b">✧</div></div>
          <div class="import-copy"><div class="import-kicker">BẮT ĐẦU TỪ BỘ ẢNH</div><h2>Thả bộ ảnh panel vào đây</h2><p>Chọn folder chapter với folder trang chứa panel, nhiều ảnh hoặc ZIP.<br/>Manga nhóm ảnh theo folder trang; app không tách panel ở đây.</p>
            <div class="import-actions"><button class="primary-btn" id="choose-btn"><span>＋</span> Chọn ảnh panel / ZIP</button><button class="secondary-btn" id="folder-btn"><span>📁</span> Chọn thư mục panel</button><button class="text-btn" id="sample-btn">Cách app xử lý <span>↗</span></button></div>
            <div class="import-foot"><span>JPG · PNG · WEBP · ZIP</span><span class="foot-sep">/</span><span>Tối đa theo bộ nhớ máy</span><span class="foot-lock">● NGOẠI TUYẾN</span></div>
          </div>
          <input id="file-input" type="file" accept=".zip,image/jpeg,image/png,image/webp,image/bmp" multiple hidden />
          <input id="folder-input" type="file" webkitdirectory hidden />
        </section>
        <section class="pending-section" id="pending-section">
          <div class="queue-head"><div><div class="eyebrow">CHAP CHỜ</div><h2 id="pending-title">Chưa có chap nào chờ</h2><p class="queue-hint">Bấm <b>＋ Chap mới</b> để lưu chap hiện tại vào đây rồi làm chap khác. Mở lại bất cứ lúc nào, không mất dữ liệu.</p></div></div>
          <div class="queue-list" id="pending-list"><div class="queue-empty">Chưa có chap nào. Bấm <b>＋ Chap mới</b> ở góc trên để lưu chap hiện tại vào đây.</div></div>
        </section>
        <section class="queue-section" id="queue-section">
          <div class="queue-head"><div><div class="eyebrow">HÀNG ĐỢI RENDER</div><h2 id="queue-title">Chưa có job nào trong hàng đợi</h2><p class="queue-hint">Chuẩn bị chap trong workspace (mỗi ảnh panel là một cảnh, chọn SRT + voice), bấm <b>➕ Đưa vào hàng đợi render</b> ở mục ĐẦU RA. Hàng đợi tự chạy nền: tạo voice rồi xuất MP4 từng chap — bạn vẫn làm chap khác được trong lúc chờ.</p></div>
            <div class="queue-controls"><span class="queue-elapsed" id="queue-elapsed">Đã chạy (voice + render): 00:00:00</span><button class="secondary-btn" id="jobs-dir-btn"><span>📁</span> Thư mục xuất</button><button class="primary-btn" id="jobs-run-btn">▶ Chạy hàng đợi</button><button class="subtle-btn" id="jobs-stop-btn" disabled>Dừng</button><button class="subtle-btn queue-clear-btn" id="jobs-clear-btn" disabled>🗑 Xóa toàn bộ</button></div></div>
          <div class="batch-render-panel">
            <div class="batch-render-title"><div><b>RENDER NHIỀU CHAP TỰ ĐỘNG</b><span>Chọn bộ ảnh và folder/ZIP TXT-SRT; ghép tự động theo tên tự nhiên, nếu không trùng tên thì ghép theo thứ tự folder/file.</span></div><button class="primary-btn" id="batch-run-btn" disabled>▶ Tạo &amp; render batch</button></div>
            <div class="batch-render-controls">
              <button class="secondary-btn" id="batch-zip-btn">＋ Chọn ZIP chapter</button>
              <button class="secondary-btn" id="batch-folder-btn">📁 Chọn folder chapter</button>
              <button class="secondary-btn" id="batch-subs-btn">📝 Chọn folder TXT/SRT</button><button class="secondary-btn" id="batch-subs-zip-btn">🗜 Chọn ZIP TXT/SRT</button>
              <button class="secondary-btn" id="batch-outdir-btn">📂 Folder xuất</button>
              <label class="batch-voice-control"><span>Giọng AI chung</span><select id="batch-voice-select"><option value="ja-JP-NanamiNeural">Nhật · Nanami (nữ)</option><option value="ja-JP-KeitaNeural">Nhật · Keita (nam)</option><option value="en-US-JennyNeural">Anh · Jenny (nữ)</option><option value="en-US-GuyNeural">Anh · Guy (nam)</option><option value="en-US-AriaNeural">Anh · Aria (nữ)</option><option value="vi-VN-HoaiMyNeural">Việt · Hoài My (nữ)</option><option value="vi-VN-NamMinhNeural">Việt · Nam Minh (nam)</option><option value="__custom__">Voice ID tùy ý…</option></select><input id="batch-voice-custom" class="hidden" placeholder="Nhập Voice ID" type="text"></label><button class="subtle-btn" id="batch-scan-btn" disabled>Ghép TXT/SRT tự động</button><label class="auto-export-check"><input type="checkbox" id="batch-auto-concat"> Tự nối MP4 sau khi render xong</label><input id="batch-concat-name" type="text" value="batch-noi.mp4" placeholder="Tên video nối">
            </div>
            <div class="batch-source-status" id="batch-source-status">Chọn folder ảnh và TXT/SRT; danh sách sẽ tự ghép theo tên tự nhiên, rồi ghép theo thứ tự nếu tên khác nhau.</div>
            <div class="batch-preview hidden" id="batch-preview"><div class="batch-preview-summary" id="batch-preview-summary"></div><div class="batch-table-wrap"><table class="batch-table"><thead><tr><th>Chapter</th><th>Panel / cue</th><th>File TXT/SRT</th><th>Trạng thái</th></tr></thead><tbody id="batch-table-body"></tbody></table></div><p class="batch-footnote">Folder chapter và TXT/SRT được sắp xếp tự nhiên (2 trước 10), ghép tên trùng trước rồi ghép phần còn lại theo thứ tự từ trên xuống. Voice vẫn tạo riêng cho từng chap; MP4 được render riêng, tùy chọn mới nối các file sau khi toàn bộ job hoàn tất.</p></div>
            <input type="file" id="batch-zip-input" accept=".zip,application/zip" class="hidden">
            <input type="file" id="batch-folder-input" webkitdirectory directory multiple class="hidden">
            <input type="file" id="batch-subs-input" webkitdirectory directory multiple class="hidden"><input type="file" id="batch-subs-zip-input" accept=".zip,application/zip" class="hidden">
          </div>
          <div class="queue-list" id="queue-list"><div class="queue-empty">Chưa có job nào. Chuẩn bị chap trong workspace rồi bấm <b>➕ Đưa vào hàng đợi render</b> ở mục ĐẦU RA.</div></div>
        </section>
        <section class="concat-section" id="concat-section">
          <div class="queue-head"><div><div class="eyebrow">NỐI VIDEO</div><h2 id="concat-title">Nối nhiều video thành 1 video dài</h2><p class="queue-hint">Chọn các file MP4 đã render (ví dụ chap 1–5), sắp xếp thứ tự rồi nối lại thành 1 video. File cùng chuẩn 1920×1080 60fps sẽ nối nhanh trong vài giây, không giảm chất lượng.</p></div>
            <div class="queue-controls"><label class="queue-field">Tên file xuất<input id="concat-name" value="video-noi.mp4"></label><button class="secondary-btn" id="concat-pick-btn"><span>＋</span> Thêm video</button><button class="secondary-btn" id="concat-add-jobs-btn"><span>＋</span> Thêm video đã render</button><button class="subtle-btn" id="concat-dir-btn">Thư mục lưu</button><button class="primary-btn" id="concat-run-btn">🔗 Nối video</button></div></div>
          <div class="queue-list" id="concat-list"><div class="queue-empty">Chưa có video nào. Bấm <b>＋ Thêm video</b> để chọn nhiều file MP4 một lúc.</div></div>
          <div class="concat-foot"><div class="progress-track hidden" id="concat-progress-track"><i id="concat-progress-fill"></i></div><div class="concat-total" id="concat-total"></div><div class="concat-result hidden" id="concat-result"></div></div>
        </section>
        <section class="editor hidden" id="editor">
          <div class="stage-column">
            <div class="stage-toolbar"><div><span class="live-dot"></span><span class="toolbar-title">XEM TRƯỚC</span><span class="stage-subtitle" id="selected-label">Chọn cảnh để xem</span></div><div class="toolbar-tools"><button class="small-tool" id="prev-scene">‹</button><span class="scene-counter" id="scene-counter">0 / 0</span><button class="small-tool" id="next-scene">›</button></div></div>
            <div class="stage-wrap"><div class="stage-preview"><canvas id="preview-canvas" width="1920" height="1080"></canvas><div class="preview-overlays"><span>16:9</span><span id="motion-label">SLIDE IN</span></div><div class="empty-stage hidden" id="empty-stage">Chọn một cảnh để xem trước</div></div></div>
            <div class="preview-footer"><span><i class="motion-dot"></i> Chuyển động nhẹ · ảnh nguồn được giữ nguyên</span><span>Âm thanh chưa thêm</span></div>
            <div class="timeline-head"><div><b>TIMELINE CẢNH</b><span id="timeline-count">0 cảnh</span></div><button class="subtle-btn" id="reorder-btn">↕ Sắp theo thứ tự ảnh</button></div>
            <div class="timeline" id="timeline"></div>
          </div>
          <aside class="inspector">
            <div class="inspector-head"><div><div class="eyebrow">BỘ CẢNH</div><h3 id="scene-heading">Chưa có cảnh</h3></div><div class="inspector-head-actions"><button class="small-tool hidden" disabled id="manual-split-btn" title="Chọn vùng khung thủ công">▧</button><button class="small-tool" id="add-page-btn" title="Thêm ảnh panel làm cảnh">＋</button></div></div>
            <div class="inspector-meta"><span id="page-count">0 ảnh panel</span><span class="dot-sep">·</span><span id="panel-count">0 panel</span></div>
            <div class="scene-list" id="scene-list"></div>
            <div class="panel-editor" id="panel-editor"><div class="panel-editor-head"><div><b>KHUNG HÌNH VIDEO</b><span>tọa độ theo % ảnh panel</span></div><button class="link-button" id="reset-crop">Đặt lại</button></div><div class="crop-grid"><label>X<input type="number" id="crop-x" min="0" max="99" step="1"></label><label>Y<input type="number" id="crop-y" min="0" max="99" step="1"></label><label>RỘNG<input type="number" id="crop-w" min="1" max="100" step="1"></label><label>CAO<input type="number" id="crop-h" min="1" max="100" step="1"></label></div><button class="apply-crop" id="apply-crop">Cập nhật vùng cắt</button><label class="panel-duration-row"><span>Thời lượng riêng của khung</span><span class="panel-duration-control"><input id="scene-duration" type="number" min="0.5" max="120" step="0.5" placeholder="Mặc định"><i>giây</i></span></label><div class="panel-duration-note" id="scene-duration-note">Để trống sẽ dùng thời lượng mặc định.</div></div>
            <div class="export-box"><div class="export-box-title"><div><b>XUẤT VIDEO</b><span>MP4 · cài đặt trong ⚙</span></div><span class="export-tag">MP4</span></div><label class="setting-row hidden"><span>Chia thời lượng theo</span><select id="duration-mode"><option value="scene" selected>Mặc định mỗi cảnh</option><option value="total">Tổng video</option><option value="page">Mỗi ảnh panel</option><option value="voice">Theo voice SRT</option></select></label><label class="setting-row hidden"><span id="duration-target-label">Mặc định mỗi cảnh</span><span class="duration-target-wrap"><input id="duration-target" type="number" min="0.5" max="120" step="any" value="4"><i>giây</i></span></label><div id="duration-summary" class="duration-summary hidden">Tổng ước tính: 0 giây</div><label class="setting-row"><span>Khung hình / giây</span><select id="fps-select"><option value="30">30 FPS</option><option value="45">45 FPS</option><option value="60" selected>60 FPS</option></select></label><label class="setting-row"><span>Chất lượng</span><select id="quality-select"><option value="balanced" selected>Cân bằng</option><option value="high">Cao</option></select></label><label class="setting-row"><span>Mã hóa video</span><select id="encoder-select"><option value="auto">Tự động (GPU nếu có)</option><option value="cpu">CPU</option></select></label><label class="setting-row"><span>Luồng render</span><select id="workers-select"><option value="1">1</option><option value="2" selected>2 (nhanh hơn)</option><option value="3">3</option><option value="4">4 (nhanh hơn, tốn tài nguyên)</option></select></label><label class="setting-row"><span>Thứ tự đọc</span><select id="reading-select"><option value="rtl" selected>Phải sang trái</option><option value="ltr">Trái sang phải</option></select></label><div class="setting-row"><span>Cách trình bày</span><div class="segmented segmented-small" role="group" aria-label="Cách trình bày video"><button type="button" class="seg-btn" data-comic-style="manga">Manga (Nhật)</button><button type="button" class="seg-btn" data-comic-style="manhwa">Manhwa (Hàn)</button><button type="button" class="seg-btn" data-comic-style="hybrid">Manga lai</button></div></div><label class="setting-row"><span>Hiện phụ đề trên video</span><input type="checkbox" id="sub-burn"></label><div class="sub-style hidden" id="sub-style"><label class="setting-row"><span>Màu chữ</span><input type="color" id="sub-color" value="#FFD400"></label><label class="setting-row"><span>Màu viền</span><input type="color" id="sub-outline" value="#000000"></label><label class="setting-row"><span>Cỡ chữ</span><span class="duration-target-wrap"><input type="range" id="sub-size" min="24" max="96" step="2" value="48"><i id="sub-size-val">48</i></span></label></div><button class="export-btn" id="export-btn"><span class="export-icon">↗</span> Tạo video MP4 <span class="arrow">→</span></button><button class="secondary-btn enqueue-btn" id="enqueue-btn"><span class="export-icon">➕</span> Đưa vào hàng đợi render</button><div class="export-note" id="export-note"><span class="lock-small">▣</span> Không voice · không nhạc · ${state.fps} fps</div></div><div class="export-box"><div class="export-box-title"><div><b>GIỌNG ĐỌC</b><span>Edge AI hoặc giọng clone · theo SRT hoặc TXT từng panel</span></div><span class="export-tag" id="voice-tag">CHƯA CÓ</span></div><label class="setting-row"><span>File SRT</span><button class="subtle-btn" id="srt-pick-btn">Chọn file .srt</button></label><div class="voice-file-note" id="srt-file-note">Chưa chọn file SRT.</div><label class="setting-row"><span>TXT theo panel</span><button class="subtle-btn" id="txt-pick-btn">Chọn file .txt</button></label><div class="voice-file-note" id="txt-file-note">Mỗi dòng hoặc đoạn cách dòng là lời của một panel, theo đúng thứ tự cảnh.</div><div class="settings-hint">TXT không cần timestamp. Mỗi dòng/đoạn là lời một panel. Đặt [TRANG n] trước lời của trang đó; mỗi trang có mốc phải có đúng số đoạn bằng số panel. Nếu thiếu mốc trang, app sẽ hỏi trước khi bỏ các panel thuộc trang đó.</div><div class="voice-cards"><label class="voice-card" id="voice-card-edge"><input type="radio" name="voice-kind" value="edge" checked><div class="voice-card-body"><b>Giọng AI Edge</b><span>Giọng có sẵn của Microsoft — nhanh, miễn phí</span><select id="voice-select"><option value="ja-JP-NanamiNeural" selected>Nhật — Nanami (nữ)</option><option value="ja-JP-KeitaNeural">Nhật — Keita (nam)</option><option value="en-US-JennyNeural">Anh — Jenny (nữ)</option><option value="en-US-GuyNeural">Anh — Guy (nam)</option><option value="en-US-AriaNeural">Anh — Aria (nữ)</option><option value="vi-VN-HoaiMyNeural">Việt — Hoài My (nữ)</option><option value="vi-VN-NamMinhNeural">Việt — Nam Minh (nam)</option><option value="__custom__">Voice ID tùy ý…</option></select><input id="voice-custom-id" class="voice-custom-input hidden" placeholder="Voice ID tùy ý, vd: ja-JP-AoiNeural"></div></label><label class="voice-card" id="voice-card-clone"><input type="radio" name="voice-kind" value="clone"><div class="voice-card-body"><b>🎙️ Giọng của tôi (clone)</b><span>Clone giọng mẫu của bạn — chạy local trên máy. Text Anh/Nhật/TBN/BĐN đọc bằng Chatterbox, text tiếng Việt đọc bằng VieNeu.</span><div class="clone-drop" id="clone-drop">Thả file <b>.wav</b> giọng mẫu vào đây<br><small>hoặc bấm để chọn file</small></div><div class="voice-file-note hidden" id="clone-ref-note"></div><div class="clone-row"><button class="subtle-btn" id="clone-change-btn" type="button">Đổi file</button><span class="clone-lang-wrap">Ngôn ngữ <select id="clone-lang"><option value="ja" selected>Nhật</option><option value="en">Anh</option><option value="es">Tây Ban Nha</option><option value="pt">Bồ Đào Nha</option><option value="vi">Việt — VieNeu (local)</option></select></span><button class="subtle-btn" id="clone-test-btn" type="button">▶ Nghe thử giọng clone</button><button class="subtle-btn hidden" id="clone-save-btn" type="button">💾 Lưu giọng thử</button><button class="subtle-btn hidden" id="clone-lib-add-btn" type="button">＋ Thư viện</button></div><div class="clone-exagg-row"><span>Độ biểu cảm</span><input type="range" id="clone-exagg" min="0" max="1" step="0.05" value="0.4"><b id="clone-exagg-val">0.40</b></div><div class="clone-exagg-hint">Thấp = êm, ít chói · cao = giàu cảm xúc</div></div></label></div><input type="file" id="clone-file-input" accept=".wav,.mp3,.m4a,.flac,audio/*" class="hidden"><label class="auto-export-check"><input type="checkbox" id="auto-export-mp4" checked> Tự động tạo video MP4 ngay sau khi có voice</label><button class="export-btn" id="voice-gen-btn"><span class="export-icon">♪</span> Tạo voice đọc <span class="arrow">→</span></button><button class="export-btn hidden" id="voice-resume-btn"><span class="export-icon">▶</span> <span id="voice-resume-label">Tiếp tục</span> <span class="arrow">→</span></button><div class="voice-progress hidden" id="voice-progress"><div class="progress-track"><i id="voice-progress-fill"></i></div><div class="voice-progress-meta"><span id="voice-progress-text">0/0 cue</span><button type="button" class="cancel-operation-btn" id="voice-cancel-btn">Dừng tạo voice</button></div></div><div class="export-note" id="voice-note">BAT tự cài mọi thứ lần đầu.</div><div class="voice-lib" id="voice-lib"><button class="voice-lib-toggle" id="voice-lib-toggle" type="button">📚 Thư viện giọng <span class="voice-lib-count" id="voice-lib-count">0</span><span class="voice-lib-arrow" id="voice-lib-arrow">▸</span></button><div class="voice-lib-body hidden" id="voice-lib-body"><div class="voice-lib-list" id="voice-lib-list"><div class="voice-lib-empty">Chưa lưu giọng nào.</div></div></div></div><button class="subtle-btn hidden" id="voice-lib-save-chap-btn" type="button">💾 Lưu voice chap này</button></div><input type="file" id="srt-file-input" accept=".srt" class="hidden"><input type="file" id="txt-file-input" accept=".txt,text/plain" class="hidden">
          </aside>
        </section>
      </main>
    </div>
    <div class="toast hidden" id="toast"></div>
    <div class="progress-modal hidden" id="progress-modal"><div class="progress-card"><div class="progress-spinner"></div><div class="progress-title" id="progress-title">Đang dựng video</div><div class="progress-sub" id="progress-sub">Kết xuất các cảnh trực tiếp trên máy này…</div><div class="progress-track"><i id="progress-fill"></i></div><div class="progress-meta"><span>PANELVID · OFFLINE</span><b id="progress-percent">0%</b></div><div class="progress-actions"><button type="button" class="cancel-operation-btn" id="cancel-export-btn">Dừng render</button></div></div></div>
    <div class="progress-modal hidden" id="prompt-modal"><div class="progress-card"><div class="progress-title" id="prompt-title">Nhập tên</div><input id="prompt-input" class="prompt-input" type="text"><div class="prompt-actions"><button class="subtle-btn" id="prompt-cancel" type="button">Hủy</button><button class="primary-btn" id="prompt-ok" type="button">OK</button></div></div></div>
    <div class="progress-modal hidden" id="confirm-modal"><div class="progress-card"><div class="progress-title" id="confirm-title">Xác nhận</div><div class="progress-sub" id="confirm-message"></div><div class="prompt-actions"><button class="subtle-btn" id="confirm-cancel" type="button">Hủy</button><button class="primary-btn" id="confirm-ok" type="button">Tiếp tục</button></div></div></div>
    <div class="settings-modal hidden" id="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="settings-card"><button class="settings-close" id="close-settings" aria-label="Đóng">×</button><div class="eyebrow">CÀI ĐẶT CHUNG</div><h2 id="settings-title">Cài đặt chung</h2><p>Thiết lập video đầu ra và cách hiển thị panel. Các lựa chọn sẽ được ghi nhớ cho những lần sử dụng sau.</p><div class="settings-output-block" id="general-output-settings"><h3>Thiết lập đầu ra video</h3></div><section class="voice-timing-settings"><h3>Đồng bộ Voice với video</h3><label class="settings-field">Độ lệch cần sửa (giây; dương = voice trễ, âm = voice sớm)<input id="voice-timing-offset" type="number" min="-30" max="30" step="0.01" value="0"></label><label class="settings-field">Điểm căn chỉnh<select id="voice-timing-anchor"><option value="start">Đầu video — dịch voice</option><option value="end">Cuối video — đổi nhanh/chậm toàn voice</option></select></label><div class="settings-hint">Nhập độ lệch đo được tại đầu/cuối (có thể lấy mốc ở đoạn hình đứng yên). Ví dụ +0,50 giây nghĩa voice đang trễ 0,5 giây; để 0 nếu không cần chỉnh. Ở mốc đầu: số âm giữ nguyên voice từ giây 0 và giữ hình đứng yên trong khoảng đó rồi mới bắt đầu cuộn; số dương bỏ phần im lặng đầu voice. Ở mốc cuối: giữ nguyên mốc đầu rồi tăng/giảm tốc độ đều của voice để khớp mốc cuối.</div></section><label class="settings-field">Kiểu hiển thị panel<select id="panel-display-mode-input"><option value="card">Thẻ panel trên nền mờ (khuyên dùng)</option><option value="full">Full màn hình</option><option value="mosaic">Lấp khung (kiểu Genz)</option></select></label><section class="hybrid-mode-settings hidden" id="hybrid-mode-settings"><label class="settings-field">Ngưỡng chiều cao panel để cuộn (px)<input id="hybrid-scroll-threshold" type="number" min="600" max="20000" step="100"></label><label class="settings-field">Số panel hiển thị đồng thời<input id="hybrid-visible-panels" type="number" min="1" max="10" step="1"></label><div class="settings-hint">Trong Manga lai: panel cao hơn ngưỡng và còn phần dọc vượt khung 1080p sau khi fit rộng sẽ cuộn riêng; panel ngắn hiện dạng thẻ; chỉ giữ số panel gần nhất đã chọn.</div></section><label class="settings-field">Crop khung tối thiểu (%)<input id="min-panel-area-input" type="number" min="1" max="100" step="1"></label><label class="settings-field">Kích thước thẻ panel (%)<input id="panel-display-scale-input" type="number" min="60" max="200" step="5"></label><label class="settings-field">Độ rộng ảnh Manhwa (%)<input id="webtoon-width-input" type="number" min="40" max="100" step="5"></label><div class="settings-hint">Manhwa: ảnh được giữ đúng tỷ lệ theo chiều rộng đã chọn, xếp nối dọc rồi cuộn xuống liên tục; mặc định 100% để giữ độ dài tự nhiên.</div><section class="manga-transition-settings hidden" id="manga-transition-settings"><h3>Chuyển trang Manga</h3><label class="settings-field">Hiệu ứng In<select id="manga-transition-in"></select></label><label class="settings-field">Hiệu ứng Out<select id="manga-transition-out"></select></label><div class="settings-hint">Áp dụng ở ranh giới folder trang Manga/Manga lai; thời lượng tự căn theo FPS. Manhwa cuộn dọc không dùng các hiệu ứng này.</div></section><div class="settings-hint">Chế độ thẻ (mặc định): panel trượt xen kẽ trái/phải trên nền mờ, kích thước mặc định 140%, chọn 60–200%. Chế độ full: panel lấp kín khung 16:9, camera lia nhẹ theo panel. Chế độ lấp khung (kiểu Genz): ảnh panel phủ kín khung hình sắc nét, camera lia tới panel đang đọc và panel đó nổi lên tại chỗ. Áp dụng ngay cho xem trước và video mới. Giới hạn crop chỉ áp dụng cho khung hình video.</div><div class="settings-actions"><button class="subtle-btn" id="cancel-settings">Hủy</button><button class="primary-btn" id="save-settings">Lưu cài đặt</button></div></div></div>
    <div class="help-modal hidden" id="help-modal"><div class="help-card"><button id="close-help">×</button><div class="eyebrow">HƯỚNG DẪN NHANH</div><h2>Từ ảnh panel đến MP4</h2><ol><li>Với Manga, chọn folder chapter có các folder trang (ví dụ Trang 01, Trang 02), mỗi folder trang chứa các ảnh panel đã cắt. Panel trong cùng folder được phát lần lượt rồi mới chuyển sang trang tiếp theo. Folder phẳng hoặc nhiều ảnh rời vẫn dùng được như trước.</li><li>Nếu đang dùng trang truyện gốc, hãy tách panel trước bằng app Panel Cutter rồi nhập folder kết quả vào đây.</li><li>Chọn cảnh để xem trước, chỉnh vùng khung cho bố cục video nếu cần, sắp thứ tự cảnh và đặt thời lượng.</li><li>File TXT không cần timestamp: mỗi dòng hoặc đoạn cách dòng là một panel; số đoạn phải khớp số panel. Sau khi tạo voice, thời lượng audio AI của từng đoạn sẽ căn đúng panel tương ứng.</li><li>Chọn <b>Manhwa</b> để cuộn ảnh dọc liên tục. Chọn <b>Manga lai</b> để panel cao hơn ngưỡng cấu hình cuộn riêng, còn panel thấp hơn hiện dạng thẻ và phóng nhẹ; hiệu ứng chuyển trang chạy ở ranh giới folder trang.</li><li>Trong <b>Cài đặt</b>: <b>Thẻ panel</b> trên nền mờ với kích thước 60–200% (mặc định 140%), hoặc <b>Full màn hình</b> cho panel lấp kín khung 16:9; mỗi ảnh panel là một cảnh video.</li><li>Chế độ thẻ: video trượt panel trái/phải xen kẽ và chồng lớp, panel trước làm nền mờ cho panel sau. Chế độ full: panel lấp kín màn hình, camera lia nhẹ theo từng panel. Trong <b>Đầu ra</b>, chỉnh thời lượng cảnh, ảnh panel hoặc toàn video.</li><li>Nhấn <b>Tạo video MP4</b> để xuất. Bấm <b>＋ Chap mới</b> để tự lưu chap hiện tại vào <b>CHAP CHỜ</b> rồi nhập chap khác — mở lại bất cứ lúc nào, không mất dữ liệu (muốn xóa hẳn thì dùng nút 🗑 trong danh sách chờ). Ảnh/video xử lý trên máy; Edge TTS cần Internet, giọng clone chạy local.</li></ol><p class="help-note">PanelVid chỉ dựng video từ ảnh panel đầu vào; việc nhận diện và xuất ảnh panel nằm ở app Panel Cutter riêng.</p></div></div>
    <div class="split-modal hidden" id="split-modal" role="dialog" aria-modal="true" aria-labelledby="split-title"><div class="split-card"><div class="split-modal-header"><div><div class="eyebrow">CHỌN KHUNG THỦ CÔNG</div><h2 id="split-title">Kéo để chọn các khung</h2><p id="split-page-name">Chọn một vùng rồi bấm Thêm khung; lặp lại đến khi xong trang.</p></div><button class="split-close" id="close-split" aria-label="Đóng">×</button></div><div class="split-canvas-wrap"><canvas id="split-canvas"></canvas></div><div class="split-modal-actions"><button class="subtle-btn" id="cancel-split">Đóng</button><button class="export-btn" id="apply-split" disabled>＋ Thêm khung</button><button class="subtle-btn" id="finish-split">Xong</button></div><div class="split-modal-note" id="split-modal-note">Kéo chuột trên ảnh để khoanh một panel. Thêm từng vùng, rồi bấm Xong để kết thúc.</div></div></div>
  </div>`;

const $ = (selector) => document.querySelector(selector);
for(const id of ['#manga-transition-in','#manga-transition-out']){
  const select=$(id);if(select)select.innerHTML=MANGA_TRANSITIONS.map(item=>`<option value="${item.value}">${item.label}</option>`).join('');
}
function syncMangaTransitionSettings(){ const hasPageTransitions=state.comicStyle==='manga'||state.comicStyle==='hybrid'; $('#manga-transition-settings')?.classList.toggle('hidden',!hasPageTransitions); $('#hybrid-mode-settings')?.classList.toggle('hidden',state.comicStyle!=='hybrid'); }
// Chuyển các tùy chọn đầu ra khỏi khung thao tác xuất sang Cài đặt chung.
const generalOutputSettings=$('#general-output-settings');
if(generalOutputSettings){
  const exportBox=$('.export-box');
  const outputNodes=[
    $('#fps-select')?.closest('.setting-row'),$('#quality-select')?.closest('.setting-row'),
    $('#encoder-select')?.closest('.setting-row'),$('#workers-select')?.closest('.setting-row'),
    $('#reading-select')?.closest('.setting-row'),$('.segmented-small')?.closest('.setting-row'),
    $('#sub-burn')?.closest('.setting-row'),$('#sub-style'),
  ].filter(Boolean);
  outputNodes.forEach(node=>generalOutputSettings.appendChild(node));
  exportBox?.classList.add('export-actions-only');
}
const fileInput = $('#file-input');
const toast = (text) => {
  const el = $('#toast'); el.textContent = text; el.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 3600);
};
// Electron KHÔNG hỗ trợ window.prompt (trả null ngay) → dùng hộp nhập tên trong app.
function promptModal(title, defaultValue='') {
  return new Promise((resolve) => {
    const modal = $('#prompt-modal'), input = $('#prompt-input');
    $('#prompt-title').textContent = title || 'Nhập tên';
    input.value = defaultValue || '';
    modal.classList.remove('hidden');
    input.focus(); input.select();
    const done = (v) => {
      modal.classList.add('hidden');
      $('#prompt-ok').onclick = null; $('#prompt-cancel').onclick = null; input.onkeydown = null;
      resolve(v);
    };
    $('#prompt-ok').onclick = () => done(input.value);
    $('#prompt-cancel').onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value); else if (e.key === 'Escape') done(null); };
  });
}
// Hộp xác nhận trong app (cùng lý do như promptModal: Electron không có confirm dùng tốt).
// Trả về Promise<boolean>: true khi bấm nút OK.
function confirmModal({ title = 'Xác nhận', message = '', okLabel = 'Tiếp tục', cancelLabel = 'Hủy' } = {}) {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    const okBtn = $('#confirm-ok'), cancelBtn = $('#confirm-cancel');
    okBtn.textContent = okLabel; cancelBtn.textContent = cancelLabel;
    modal.classList.remove('hidden');
    okBtn.focus();
    const done = (v) => {
      modal.classList.add('hidden');
      okBtn.onclick = null; cancelBtn.onclick = null; document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    document.addEventListener('keydown', onKey);
  });
}
function naturalCompare(a,b) { return a.localeCompare(b, 'vi', { numeric:true, sensitivity:'base' }); }
function pageImage(page) { return page.image; }
function pageForLogicalGroup(groupIndex,pages=state.pages){return pages.find(page=>(Number.isInteger(page.pageGroupIndex)?page.pageGroupIndex:page.index)===groupIndex)||pages[0]||null;}
function previousGroupPage(groupIndex,pages=state.pages){return groupIndex>0?(pages.find(page=>(Number.isInteger(page.pageGroupIndex)?page.pageGroupIndex:page.index)===groupIndex-1)||pageForLogicalGroup(groupIndex,pages)):pageForLogicalGroup(groupIndex,pages);}

$('#choose-btn').addEventListener('click', () => fileInput.click());
$('#import-card').addEventListener('dragover', e => { e.preventDefault(); $('#import-card').classList.add('dragging'); });
$('#import-card').addEventListener('dragleave', () => $('#import-card').classList.remove('dragging'));
$('#import-card').addEventListener('drop', e => { e.preventDefault(); $('#import-card').classList.remove('dragging'); loadFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change', () => { loadFiles([...fileInput.files]); fileInput.value = ''; });
const folderInput = $('#folder-input');
$('#folder-btn').addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', async () => {
  const files = [...folderInput.files]; folderInput.value = '';
  const items = extractFolderImages(files, naturalCompare);
  if (!items.length) { toast('Thư mục không có ảnh JPG, PNG, WebP hoặc BMP.'); return; }
  toast(`Tìm thấy ${items.length} ảnh trong thư mục.`);
  await importImageItems(items);
});
$('#help-btn').addEventListener('click', () => $('#help-modal').classList.remove('hidden'));
$('#sample-btn').addEventListener('click', () => $('#help-modal').classList.remove('hidden'));
$('#close-help').addEventListener('click', () => $('#help-modal').classList.add('hidden'));
$('#settings-btn').addEventListener('click', () => {
  $('#min-panel-area-input').value = String(state.minPanelAreaPct);
  $('#panel-display-scale-input').value = String(state.panelDisplayScalePct);
  $('#webtoon-width-input').value = String(state.webtoonWidthPct);
  $('#panel-display-mode-input').value = state.panelDisplayMode;
  $('#hybrid-scroll-threshold').value=String(state.hybridScrollThresholdPx);
  $('#hybrid-visible-panels').value=String(state.hybridVisiblePanels);
  $('#voice-timing-offset').value=String(state.voiceTimingOffsetSeconds);
  $('#voice-timing-anchor').value=state.voiceTimingAnchor;
  $('#manga-transition-in').value=state.mangaTransitionIn;
  $('#manga-transition-out').value=state.mangaTransitionOut;
  syncMangaTransitionSettings();
  $('#settings-modal').classList.remove('hidden');
});
function closeSettings() { $('#settings-modal').classList.add('hidden'); }
$('#close-settings').addEventListener('click', closeSettings);
$('#cancel-settings').addEventListener('click', closeSettings);
$('#save-settings').addEventListener('click', () => {
  const areaInput = $('#min-panel-area-input'), scaleInput = $('#panel-display-scale-input');
  const area = Number(areaInput.value), scale = Number(scaleInput.value);
  if (!Number.isFinite(area) || area < 1 || area > 100) {
    areaInput.focus(); toast('Ngưỡng diện tích phải nằm trong khoảng 1–100%.'); return;
  }
  if (!Number.isFinite(scale) || scale < 60 || scale > 200) {
    scaleInput.focus(); toast('Kích thước thẻ panel phải nằm trong khoảng 60–200%.'); return;
  }
  const webtoonWidthInput=$('#webtoon-width-input'), webtoonWidth=Number(webtoonWidthInput.value);
  if(!Number.isFinite(webtoonWidth)||webtoonWidth<40||webtoonWidth>100){webtoonWidthInput.focus();toast('Độ rộng ảnh Manhwa phải nằm trong khoảng 40–100%.');return;}
  const voiceOffsetInput=$('#voice-timing-offset'),voiceOffset=Number(voiceOffsetInput.value);
  if(!Number.isFinite(voiceOffset)||voiceOffset < -30||voiceOffset > 30){voiceOffsetInput.focus();toast('Độ lệch voice phải nằm trong khoảng -30 đến +30 giây.');return;}
  const hybridThresholdInput=$('#hybrid-scroll-threshold'),hybridThreshold=Number(hybridThresholdInput.value);
  if(!Number.isFinite(hybridThreshold)||hybridThreshold<600||hybridThreshold>20000){hybridThresholdInput.focus();toast('Ngưỡng chiều cao panel phải từ 600 đến 20.000 px.');return;}
  state.hybridScrollThresholdPx=Math.round(hybridThreshold);
  const hybridVisibleInput=$('#hybrid-visible-panels'),hybridVisible=Number(hybridVisibleInput.value);
  if(!Number.isFinite(hybridVisible)||hybridVisible<1||hybridVisible>10){hybridVisibleInput.focus();toast('Số panel Manga Lai phải từ 1 đến 10.');return;}
  state.hybridVisiblePanels=Math.round(hybridVisible);
  state.minPanelAreaPct = Math.round(area); state.panelDisplayScalePct = Math.round(scale); state.webtoonWidthPct=Math.round(webtoonWidth);
  const modeValue = $('#panel-display-mode-input').value;
  state.panelDisplayMode = modeValue === 'full' || modeValue === 'mosaic' ? modeValue : 'card';
  const voiceTiming=normalizeVoiceTiming($('#voice-timing-anchor').value,voiceOffset);
  state.voiceTimingAnchor=voiceTiming.anchor;state.voiceTimingOffsetSeconds=voiceTiming.offsetSeconds;
  state.mangaTransitionIn=normalizeMangaTransition($('#manga-transition-in').value,'none');
  state.mangaTransitionOut=normalizeMangaTransition($('#manga-transition-out').value,'slide-right');
  try {
    localStorage.setItem(MIN_PANEL_AREA_KEY, String(state.minPanelAreaPct));
    localStorage.setItem(PANEL_DISPLAY_SCALE_KEY, String(state.panelDisplayScalePct));
    localStorage.setItem(WEBTOON_WIDTH_KEY, String(state.webtoonWidthPct));
    localStorage.setItem(HYBRID_THRESHOLD_KEY,String(state.hybridScrollThresholdPx));
    localStorage.setItem(HYBRID_VISIBLE_PANELS_KEY,String(state.hybridVisiblePanels));
    localStorage.setItem(PANEL_DISPLAY_MODE_KEY, state.panelDisplayMode);
    localStorage.setItem(MANGA_TRANSITION_IN_KEY,state.mangaTransitionIn);
    localStorage.setItem(MANGA_TRANSITION_OUT_KEY,state.mangaTransitionOut);
    localStorage.setItem(VOICE_TIMING_ANCHOR_KEY,state.voiceTimingAnchor);
    localStorage.setItem(VOICE_TIMING_OFFSET_KEY,String(state.voiceTimingOffsetSeconds));
  } catch {}
  closeSettings(); renderAll();
  const modeLabel = state.panelDisplayMode === 'full' ? 'full màn hình' : state.panelDisplayMode === 'mosaic' ? 'lấp khung (kiểu Genz)' : 'thẻ panel';
  toast(`Đã lưu: ${modeLabel} · ngưỡng ${state.minPanelAreaPct}% · thẻ ${state.panelDisplayScalePct}%.`);
});
// ===== CHAP CHỜ (v6): lưu chap hiện tại, mở chap mới không mất dữ liệu =====
const parked = [];
let parkSeq = 0;
function renderPending(){
  const list = $('#pending-list');
  $('#pending-title').textContent = parked.length ? `${parked.length} chap đang chờ` : 'Chưa có chap nào chờ';
  if (!parked.length) {
    list.innerHTML = '<div class="queue-empty">Chưa có chap nào. Bấm <b>＋ Chap mới</b> ở góc trên để lưu chap hiện tại vào đây.</div>';
    return;
  }
  list.innerHTML = parked.map(item => {
    const s = summarizeParked(item);
    const voiceHtml = s.hasVoice ? `<span class="srt-ok">▣ Đã có voice</span>` : `<span class="queue-meta">chưa có voice</span>`;
    return `<div class="queue-item" data-id="${escapeHtml(item.id)}">
      <div class="queue-item-main"><b>${escapeHtml(s.name)}</b><span class="queue-meta">${s.pageCount} trang · ${s.panelCount} panel</span>${voiceHtml}</div>
      <div class="queue-item-srt"></div>
      <div class="queue-item-actions"><button class="subtle-btn" data-action="open" data-id="${escapeHtml(item.id)}">Mở</button><button class="small-tool" data-action="rename" data-id="${escapeHtml(item.id)}" title="Đổi tên">✎</button><button class="small-tool queue-del" data-action="remove" data-id="${escapeHtml(item.id)}" title="Xóa">🗑</button></div>
    </div>`;
  }).join('');
}
async function parkCurrentChapter(){
  if (!state.pages.length) return null;
  parkSeq++;
  const item = createParkedChapter({
    name: nextParkName(parkSeq),
    pages: serializePages(state.pages),
    scenes: serializeScenes(state.scenes),
    voice: state.voice ? { ...state.voice, cues:(state.voice.cues||[]).map(c=>({...c})) } : null,
    settings: { durationMode: state.durationMode, seconds: state.seconds, totalSeconds: state.totalSeconds, pageSeconds: state.pageSeconds, quality: state.quality, reading: state.reading, comicStyle: state.comicStyle, webtoonWidthPct: state.webtoonWidthPct,hybridScrollThresholdPx:state.hybridScrollThresholdPx,mangaTransitionIn:state.mangaTransitionIn,mangaTransitionOut:state.mangaTransitionOut,voiceTimingAnchor:state.voiceTimingAnchor,voiceTimingOffsetSeconds:state.voiceTimingOffsetSeconds },
  });
  if (item.voice && item.voice.path && window.panelVid?.stashVoice) {
    try {
      const r = await window.panelVid.stashVoice({ srcPath: item.voice.path, id: item.id });
      if (r && r.path) item.voice.path = r.path;
    } catch (e) { console.error(e); }
  }
  parked.push(item);
  renderPending();
  return item;
}
function resetWorkspace(){
  state.pages.forEach(page => { try { URL.revokeObjectURL(page.url); } catch {} });
  state.pages = []; state.scenes = []; state.stripDoc = null; state.selected = 0; state.status = 'empty';
  const defaults=loadUserPreferences();
  state.durationMode='scene';state.seconds=defaults.seconds;state.totalSeconds=defaults.totalSeconds;state.pageSeconds=defaults.pageSeconds;state.quality=defaults.quality;state.fps=defaults.fps;state.reading=defaults.reading;state.voice=null;
  $('#duration-mode').value=state.durationMode;$('#quality-select').value=state.quality;$('#fps-select').value=String(state.fps);$('#reading-select').value=state.reading;resetVoiceUI();updateDurationControls();
  fileInput.value = ''; $('#project-name').textContent = 'Dự án mới';
  renderAll();
}
$('#new-chapter-btn').addEventListener('click', async () => {
  if (state.pages.length) {
    await parkCurrentChapter();
    toast('Đã lưu chap hiện tại vào danh sách chờ.');
  }
  resetWorkspace();
  toast('Đã mở workspace trống. Chọn ảnh hoặc ZIP của chap mới.');
});
// v6k: ghi chú số trang bị bỏ vì không có mốc [TRANG n] (chỉ khi đã nạp trang
// và SRT có ít nhất 1 mốc trong phạm vi trang).
function droppedMarkerNote(cues){
  const pc = logicalPageCount(state.scenes);
  if (!pc) return '';
  const marked = new Set();
  for (const c of cues || []) if (c.page != null && c.page >= 1 && c.page <= pc) marked.add(c.page);
  const dropped = pc - marked.size;
  return marked.size && dropped > 0 ? ` · bỏ ${dropped} trang không mốc` : '';
}
function syncVoiceUIFromState(){
  resetVoiceUI();
  const v = state.voice;
  if (!v) return;
  $('#voice-gen-btn').innerHTML=v.source==='txt'?'<span class="export-icon">♪</span> Tạo voice theo panel TXT <span class="arrow">→</span>':'<span class="export-icon">♪</span> Tạo voice từ SRT <span class="arrow">→</span>';
  const markers = new Set((v.cues || []).map(c => c.page).filter(p => p != null));
  $('#srt-file-note').textContent = v.source==='txt' ? 'Đang dùng TXT theo panel.' : `${v.srtName || 'SRT'} · ${(v.cues || []).length} cue · ${markers.size} mốc trang${droppedMarkerNote(v.cues)}.`;
  if($('#txt-file-note'))$('#txt-file-note').textContent=v.source==='txt'?`${v.srtName||'TXT'} · ${(v.cues||[]).length} panel · ${v.path?'voice đã tạo':'chưa tạo voice'}.`:'TXT: mỗi dòng/đoạn là một panel; thêm [TRANG n] trước lời của từng trang.';
  if (v.voiceId) selectVoiceCardForId(v.voiceId);
  if (v.path && v.duration) {
    $('#voice-tag').textContent = 'ĐÃ CÓ';
    $('#voice-note').textContent = `Voice: ${(v.cues || []).length} cue · ${formatPreciseSeconds(v.duration)}.`;
  } else {
    $('#voice-tag').textContent = 'CHƯA TẠO';
    $('#voice-note').textContent = v.source==='txt'?'Đã nạp TXT theo panel. Tạo voice để đo thời lượng từng đoạn.':'Đã nạp SRT. Bấm "Tạo voice từ SRT".';
  }
}
async function openParkedChapter(id){
  const item = findParked(parked, id);
  if (!item) return;
  if (state.pages.length) {
    await parkCurrentChapter();
    toast('Đã lưu chap hiện tại vào danh sách chờ.');
  }
  removeParked(parked, id);
  resetWorkspace();
  state.status = 'loading'; renderAll();
  try {
    for (let i = 0; i < item.pages.length; i++) {
      const p = item.pages[i];
      const url = URL.createObjectURL(p.blob), image = new Image();
      image.src = url; await image.decode();
      const sceneMeta=item.scenes?.find(scene=>scene.pageIndex===i);
      state.pages.push({ name: p.name, path: p.path, blob: p.blob, url, image, index: i, pageGroupIndex:Number.isInteger(p.pageGroupIndex)?p.pageGroupIndex:(sceneMeta?.groupIndex??i), pageGroupName:p.pageGroupName||sceneMeta?.groupName||p.name });
    }
  } catch (err) {
    console.error(err); toast('Không mở được ảnh của chap: ' + (err.message || err));
    resetWorkspace(); renderPending(); return;
  }
  state.scenes = serializeScenes(item.scenes);
  state.selected = 0;
  state.scenes.forEach((scene,index)=>{if(Number.isInteger(scene.panelScriptIndex))scene.panelScriptIndex=index;});
  const st = item.settings || {};
  state.durationMode = item.voice?.duration ? 'voice' : 'scene';
  state.seconds = st.seconds ?? 4; state.totalSeconds = st.totalSeconds ?? 60; state.pageSeconds = st.pageSeconds ?? 12;
  state.quality = st.quality || 'balanced'; state.fps=[30,45,60].includes(Number(st.fps))?Number(st.fps):60; state.reading = st.reading || 'rtl';
  state.comicStyle = normalizeComicStyle(st.comicStyle); syncComicStyleControls();
  const parkedVoiceTiming=normalizeVoiceTiming(st.voiceTimingAnchor??state.voiceTimingAnchor,st.voiceTimingOffsetSeconds??state.voiceTimingOffsetSeconds);state.voiceTimingAnchor=parkedVoiceTiming.anchor;state.voiceTimingOffsetSeconds=parkedVoiceTiming.offsetSeconds;
  state.mangaTransitionIn=normalizeMangaTransition(st.mangaTransitionIn,state.mangaTransitionIn);
  state.mangaTransitionOut=normalizeMangaTransition(st.mangaTransitionOut,state.mangaTransitionOut);
  state.hybridScrollThresholdPx=Number.isFinite(Number(st.hybridScrollThresholdPx))&&Number(st.hybridScrollThresholdPx)>=600&&Number(st.hybridScrollThresholdPx)<=20000?Math.round(Number(st.hybridScrollThresholdPx)):loadHybridScrollThreshold();
  state.hybridVisiblePanels=Number.isFinite(Number(st.hybridVisiblePanels))&&Number(st.hybridVisiblePanels)>=1&&Number(st.hybridVisiblePanels)<=10?Math.round(Number(st.hybridVisiblePanels)):loadHybridVisiblePanels();
  const parkedWidth=Number(st.webtoonWidthPct); state.webtoonWidthPct=Number.isFinite(parkedWidth)&&parkedWidth>=40&&parkedWidth<=100?Math.round(parkedWidth):loadWebtoonWidthPct();
  state.stripDoc = isStripStyle(state.comicStyle) && state.scenes.some(scene => scene.stripDocument)
    ? buildStripDocument(state.pages) : null;
  $('#duration-mode').value = state.durationMode; $('#quality-select').value = state.quality; $('#fps-select').value=String(state.fps); $('#reading-select').value = state.reading;
  state.voice = item.voice ? { ...item.voice } : null;
  if (state.voice && state.voice.path && window.panelVid?.fileExists) {
    try {
      const ok = await window.panelVid.fileExists({ filePath: state.voice.path });
      if (!ok) state.voice = { ...state.voice, path: null, duration: 0, pageSegments: {} };
    } catch {}
  }
  syncVoiceUIFromState();
  $('#project-name').textContent = `${item.name} (${logicalPageCount(state.scenes)} trang)`;
  state.status = 'ready';
  renderAll(); renderPending();
  toast(`Đã mở "${item.name}".`);
}
$('#pending-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id, action = b.dataset.action;
  const item = findParked(parked, id); if (!item) return;
  if (action === 'open') { await openParkedChapter(id); }
  else if (action === 'remove') {
    if (!window.confirm(`Xóa vĩnh viễn "${item.name}" khỏi danh sách chờ?`)) return;
    removeParked(parked, id);
    try { await window.panelVid?.unstashVoice?.({ id }); } catch {}
    renderPending(); toast('Đã xóa chap khỏi danh sách chờ.');
  }
  else if (action === 'rename') {
    const name = await promptModal('Đổi tên chap:', item.name);
    if (renameParked(parked, id, name)) renderPending();
  }
});
$('#duration-mode').addEventListener('change', e => {
  const next=e.target.value,currentTotal=estimatedTotalDuration(),groups=groupScenesByPage();
  if(next==='voice'&&!(state.voice&&state.voice.duration)){toast('Hãy tạo voice từ SRT ở mục GIỌNG ĐỌC trước, rồi chọn lại chế độ này.');e.target.value=state.durationMode;return;}
  if(next==='voice'){const ev=evaluateVoiceSplit();if(ev.fallback)toast(ev.reason);}
  if(state.scenes.length&&currentTotal>0){
    if(next==='total')state.totalSeconds=currentTotal;
    else if(next==='page')state.pageSeconds=currentTotal/Math.max(1,groups.size);
    else state.seconds=clamp(currentTotal/state.scenes.length,0.5,120);
  }
  state.durationMode=next;updateDurationControls();persistCurrentPreferences();renderAll();
});
$('#duration-target').addEventListener('change', e => {
  const bounds=durationBounds(state.durationMode),value=Number(e.target.value);
  const target=clamp(Number.isFinite(value)?value:bounds.min,bounds.min,bounds.max);
  if(state.durationMode==='total')state.totalSeconds=target;
  else if(state.durationMode==='page')state.pageSeconds=target;
  else state.seconds=target;
  updateDurationControls();persistCurrentPreferences();renderAll();
});
$('#quality-select').addEventListener('change', e => {state.quality=e.target.value;persistCurrentPreferences();});
$('#fps-select').value=String(state.fps);
$('#fps-select').addEventListener('change',e=>{const fps=Number(e.target.value);state.fps=[30,45,60].includes(fps)?fps:60;persistCurrentPreferences();updateExportNote();});
$('#encoder-select').value = state.encoder;
$('#encoder-select').addEventListener('change', e => {
  state.encoder = e.target.value === 'cpu' ? 'cpu' : 'auto';
  try { localStorage.setItem(ENCODER_KEY, state.encoder); } catch {}
  persistCurrentPreferences();
});
$('#workers-select').value = String(state.workers);
$('#workers-select').addEventListener('change', e => {
  const v = Number(e.target.value);
  state.workers = [1, 2, 3, 4].includes(v) ? v : 2;
  try { localStorage.setItem(WORKERS_KEY, String(state.workers)); } catch {}
  persistCurrentPreferences();
});
$('#reading-select').addEventListener('change', e => { state.reading = e.target.value;persistCurrentPreferences();sortScenesByPage(); renderAll(); });
// Panel cut/detection is handled by the separate Panel Cutter app.
// ===== KIỂU TRUYỆN (v6p) =====
// Hai control (thẻ nhập + mục ĐẦU RA) dùng chung nút [data-comic-style];
// syncComicStyleControls đánh dấu nút đang chọn ở cả hai nơi.
function syncComicStyleControls(){
  document.querySelectorAll('[data-comic-style]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.comicStyle === state.comicStyle);
  });
  syncMangaTransitionSettings();
}
function setComicStyle(value){
  const next = normalizeComicStyle(value);
  if (next === state.comicStyle) { syncComicStyleControls(); return; }
  state.comicStyle = next;
  try { localStorage.setItem(COMIC_STYLE_KEY, next); } catch {}
  syncComicStyleControls();
  if (state.pages.length && state.status === 'ready') {
    renderAll();
    toast('Đã đổi cách trình bày video.');
  } else toast('Đã lưu cách trình bày video.');
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-comic-style]');
  if (btn) setComicStyle(btn.dataset.comicStyle);
});
syncComicStyleControls();
$('#manual-split-btn').addEventListener('click', () => {
  const scene=state.scenes[state.selected];
  if(scene)openManualSplit(scene.pageIndex);
  else toast('Chọn ảnh panel hoặc cảnh trước.');
});
$('#close-split').addEventListener('click', () => finishManualSplit());
$('#cancel-split').addEventListener('click', () => finishManualSplit());
$('#finish-split').addEventListener('click', () => finishManualSplit());
$('#apply-split').addEventListener('click', () => addManualSplitSelection());
$('#split-canvas').addEventListener('pointerdown',e=>{
  if(!manualSplit)return;e.preventDefault();
  const point=manualSplitPoint(e);manualSplit.start=point;manualSplit.rect={x:point.x,y:point.y,w:0,h:0};manualSplit.dragging=true;
  e.currentTarget.setPointerCapture(e.pointerId);drawManualSplit();
});
$('#split-canvas').addEventListener('pointermove',e=>{
  if(!manualSplit?.dragging)return;
  const point=manualSplitPoint(e);manualSplit.rect=normalizedRect(manualSplit.start,point);drawManualSplit();
});
$('#split-canvas').addEventListener('pointerup',e=>{
  if(!manualSplit?.dragging)return;
  const point=manualSplitPoint(e);manualSplit.rect=normalizedRect(manualSplit.start,point);manualSplit.dragging=false;
  const r=manualSplit.rect,canvas=e.currentTarget;
  const areaPct=r.w/canvas.width*r.h/canvas.height*100,tooSmall=r.w<canvas.width*.025||r.h<canvas.height*.025||areaPct<state.minPanelAreaPct;
  $('#apply-split').disabled=tooSmall;
  $('#split-modal-note').textContent=tooSmall?`Vùng chọn chiếm ${areaPct.toFixed(1)}%; cần ít nhất ${state.minPanelAreaPct}%. Có thể giảm ngưỡng trong Cài đặt.`:'Đã chọn vùng hợp lệ. Bấm ＋ Thêm khung, tiếp tục chọn panel khác hoặc bấm Xong.';
  drawManualSplit();
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&manualSplit)finishManualSplit();});
$('#scene-duration').addEventListener('change', e => {
  if(state.durationMode!=='scene')return;
  const scene=state.scenes[state.selected];if(!scene)return;
  const value=e.target.value.trim();
  scene.duration=value===''?null:clamp(Number(value)||0.5,0.5,120);
  renderAll();
  toast(scene.duration===null?'Dùng thời lượng mặc định cho khung này.':`Đã đặt ${formatSeconds(scene.duration)} cho khung này.`);
});
$('#prev-scene').addEventListener('click', () => selectScene(Math.max(0,state.selected-1)));
$('#next-scene').addEventListener('click', () => selectScene(Math.min(state.scenes.length-1,state.selected+1)));
$('#reorder-btn').addEventListener('click', () => { sortScenesByPage(); renderAll(); toast('Đã sắp xếp cảnh theo thứ tự trang.'); });
$('#add-page-btn').addEventListener('click', () => {
  if (!state.pages.length) return;
  const pageIndex=state.scenes[state.selected]?.pageIndex ?? 0;
  const scene = { id: crypto.randomUUID(), pageIndex, groupIndex:logicalPageIndex(state.scenes[state.selected]||{groupIndex:state.pages[pageIndex]?.pageGroupIndex??pageIndex}), crop:{x:0,y:0,w:100,h:100}, autoCrop:{x:0,y:0,w:100,h:100}, label:'Toàn trang', manual:true, duration:null, fullFrame:true };
  state.scenes.push(scene); state.selected=state.scenes.length-1; renderAll(); toast('Đã thêm toàn trang làm một cảnh.');
});
$('#apply-crop').addEventListener('click', () => {
  const scene=state.scenes[state.selected]; if (!scene) return;
  const x=clamp(Number($('#crop-x').value)||0,0,99), y=clamp(Number($('#crop-y').value)||0,0,99);
  const w=clamp(Number($('#crop-w').value)||1,1,100-x), h=clamp(Number($('#crop-h').value)||1,1,100-y);
  const stripReferenceHeight=scene.stripDocument&&state.stripDoc?.entries.length?state.stripDoc.entries[0].y1-state.stripDoc.entries[0].y0:state.stripDoc?.height;
  const cropAreaScore=scene.stripDocument&&stripReferenceHeight?w*h*state.stripDoc.height/stripReferenceHeight:w*h;
  if (cropAreaScore < state.minPanelAreaPct*100) { toast(`Vùng cắt phải chiếm ít nhất ${state.minPanelAreaPct}% diện tích trang. Có thể đổi ngưỡng trong Cài đặt.`); return; }
  scene.crop={x,y,w,h}; scene.manual=true; renderAll(); toast('Đã cập nhật vùng cắt.');
});
$('#reset-crop').addEventListener('click', () => {
  const scene=state.scenes[state.selected]; if (!scene) return;
  scene.crop={...scene.autoCrop}; scene.manual=false; sortScenesByPage(); renderAll(); toast('Đã khôi phục khung hình gốc của panel.');
});

async function loadFiles(files) {
  if (!files.length) return;
  try {
    const items=[];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        const zip=await JSZip.loadAsync(file);
        const paths=Object.keys(zip.files).filter(n=>!zip.files[n].dir && /\.(jpe?g|png|webp|bmp)$/i.test(n)).sort(naturalCompare);
        for (const name of paths) {
          const blob=await zip.files[name].async('blob');
          items.push({name:name.split('/').pop(),path:name,blob});
        }
      } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(file.name)) {
        items.push({name:file.name,path:file.name,blob:file});
      }
    }
    if (!items.length) { toast('Không tìm thấy ảnh JPG, PNG, WebP hoặc BMP.'); return; }
    items.sort((a,b)=>naturalCompare(a.path,b.path));
    await importImageItems(items);
  } catch (error) {
    console.error(error); toast(`Không đọc được bộ ảnh: ${error.message || error}`);
  }
}

// Nạp danh sách ảnh [{name,path,blob}] vào workspace. Dùng chung: chọn file/ZIP, thư mục, kéo-thả.
async function importImageItems(items, { baseFolder = '' } = {}) {
  try {
    const pageGrouping=groupPanelItemsByPage(items,{baseFolder,compare:naturalCompare});
    state.pages.forEach(p=>URL.revokeObjectURL(p.url));
    state.pages=[]; state.scenes=[]; state.stripDoc=null; state.selected=0; state.status='loading'; renderAll();
    $('#project-name').textContent=items.length===1?'Chap video (1 ảnh panel)':`Chap video (${items.length} ảnh panel)`;
    for (let i=0;i<items.length;i++) {
      const item=items[i], url=URL.createObjectURL(item.blob), image=new Image();
      image.src=url; await image.decode();
      const itemKey=String(item.path||item.name),pageGroupIndex=pageGrouping.groupIndexByPath.get(itemKey)??i;
      const page={...item,url,image,index:i,pageGroupIndex,pageGroupName:pageGrouping.groups[pageGroupIndex]?.name||item.name};
      state.pages.push(page);
      state.status='ready'; renderAll();
    }
    state.pages.sort((a,b)=>naturalCompare(a.path,b.path));
    state.pages.forEach((p,i)=>p.index=i);
    state.stripDoc=null;
    state.scenes=scenesFromPanelImages(state.pages,()=>crypto.randomUUID());
    state.selected=0;
    sortScenesByPage(); renderAll();
    toast(`Đã nạp ${state.pages.length} panel trong ${logicalPageCount(state.scenes)} trang, tạo ${state.scenes.length} cảnh video.`);
  } catch (error) {
    console.error(error); toast(`Không đọc được bộ ảnh: ${error.message || error}`);
  }
}

function setPageToFullImage(pageIndex){
  const pageScenes=state.scenes.filter(scene=>scene.pageIndex===pageIndex),old=pageScenes[0];
  const scene={id:crypto.randomUUID(),pageIndex,groupIndex:logicalPageIndex(old||{groupIndex:state.pages[pageIndex]?.pageGroupIndex??pageIndex}),crop:{x:0,y:0,w:100,h:100},autoCrop:{x:0,y:0,w:100,h:100},label:'Toàn trang',manual:false,duration:old?.duration??null,fullFrame:true};
  state.scenes=state.scenes.filter(item=>item.pageIndex!==pageIndex);
  let insertAt=state.scenes.findIndex(item=>item.pageIndex>pageIndex);if(insertAt<0)insertAt=state.scenes.length;
  state.scenes.splice(insertAt,0,scene);sortScenesByPage();state.selected=state.scenes.findIndex(item=>item.id===scene.id);renderAll();
}
function normalizedRect(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
function manualSplitPoint(event){
  const canvas=$('#split-canvas'),bounds=canvas.getBoundingClientRect();
  return {x:clamp((event.clientX-bounds.left)*canvas.width/bounds.width,0,canvas.width),y:clamp((event.clientY-bounds.top)*canvas.height/bounds.height,0,canvas.height)};
}
function drawManualSplit(){
  if(!manualSplit)return;
  const canvas=$('#split-canvas'),ctx=canvas.getContext('2d'),{page}=manualSplit;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(page.image,0,0,canvas.width,canvas.height);
  const r=manualSplit.rect;if(!r)return;
  ctx.fillStyle='rgba(8,8,12,.58)';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.drawImage(page.image,0,0,canvas.width,canvas.height);ctx.restore();
  ctx.strokeStyle='#ff8b75';ctx.lineWidth=Math.max(2,canvas.width/700);ctx.setLineDash([10,6]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.setLineDash([]);
}
function openManualSplit(pageIndex,replaceSceneId=null,replacePageScenesOnFirstAdd=false){
  const page=state.pages[pageIndex];if(!page)return Promise.resolve(false);
  if(!replaceSceneId){const pageScenes=state.scenes.filter(scene=>scene.pageIndex===pageIndex);if(pageScenes.length===1&&pageScenes[0].fullFrame)replaceSceneId=pageScenes[0].id;}
  return new Promise(resolve=>{
    const canvas=$('#split-canvas'),scale=Math.min(1,1200/page.image.width,700/page.image.height);
    canvas.width=Math.max(1,Math.round(page.image.width*scale));canvas.height=Math.max(1,Math.round(page.image.height*scale));
    manualSplit={pageIndex,page,replaceSceneId,replacePageScenesOnFirstAdd,start:null,rect:null,dragging:false,addedCount:0,resolve};
    $('#split-page-name').textContent=`${page.name} · kéo vùng cần tách`;
    $('#split-modal-note').textContent=replacePageScenesOnFirstAdd?'Vùng khoanh đầu tiên sẽ thay các panel hiện tại của trang. Có thể chọn nhiều vùng liên tiếp.':'Kéo khoanh panel, bấm ＋ Thêm khung để thêm tiếp rồi bấm Xong.';
    $('#apply-split').disabled=true;drawManualSplit();$('#split-modal').classList.remove('hidden');
  });
}
function addManualSplitSelection(){
  const current=manualSplit;if(!current?.rect)return;
  const canvas=$('#split-canvas'),r=current.rect;
  const crop={x:r.x/canvas.width*100,y:r.y/canvas.height*100,w:r.w/canvas.width*100,h:r.h/canvas.height*100};
  if(crop.w*crop.h<state.minPanelAreaPct*100){$('#split-modal-note').textContent=`Vùng chọn phải chiếm ít nhất ${state.minPanelAreaPct}% diện tích trang.`;return;}
  const pageScenes=state.scenes.filter(scene=>scene.pageIndex===current.pageIndex),oldIndex=state.scenes.findIndex(scene=>scene.id===current.replaceSceneId),old=oldIndex>=0?state.scenes[oldIndex]:null;
  const replacingPage=current.replacePageScenesOnFirstAdd&&current.addedCount===0,replacingPlaceholder=!replacingPage&&old?.fullFrame&&pageScenes.length===1;
  const labelIndex=replacingPage||replacingPlaceholder?1:pageScenes.length+1;
  const scene={id:crypto.randomUUID(),pageIndex:current.pageIndex,groupIndex:logicalPageIndex(pageScenes[0]||{groupIndex:current.page?.pageGroupIndex??current.pageIndex}),crop,autoCrop:{...crop},label:`Khung thủ công ${labelIndex}`,manual:true,duration:(replacingPage?pageScenes[0]?.duration:old?.duration)??null,fullFrame:false};
  if(replacingPage){
    state.scenes=state.scenes.filter(item=>item.pageIndex!==current.pageIndex);
    let insertAt=state.scenes.findIndex(item=>item.pageIndex>current.pageIndex);if(insertAt<0)insertAt=state.scenes.length;
    state.scenes.splice(insertAt,0,scene);
  }else if(old?.fullFrame&&pageScenes.length===1){state.scenes[oldIndex]=scene;}
  else{
    let insertAt=state.scenes.length;
    for(let i=0;i<state.scenes.length;i++){if(state.scenes[i].pageIndex>current.pageIndex){insertAt=i;break;}if(state.scenes[i].pageIndex===current.pageIndex)insertAt=i+1;}
    state.scenes.splice(insertAt,0,scene);
  }
  current.replaceSceneId=null;current.replacePageScenesOnFirstAdd=false;current.addedCount=(current.addedCount||0)+1;current.rect=null;current.start=null;current.dragging=false;
  sortScenesByPage();state.selected=state.scenes.findIndex(item=>item.id===scene.id);renderAll();
  $('#apply-split').disabled=true;$('#split-modal-note').textContent=`Đã thêm ${current.addedCount} khung. Kéo chọn tiếp hoặc bấm Xong khi đã đủ.`;drawManualSplit();
}
function finishManualSplit(){
  const current=manualSplit;if(!current)return;
  const resolve=current.resolve,added=(current.addedCount||0)>0;manualSplit=null;$('#split-modal').classList.add('hidden');resolve?.(added);
}


// Hồ sơ hàng của 1 ảnh trang (cho bộ cắt dải dọc) — vẽ qua canvas như đường
// detector, rồi tính thuần bằng computeRowProfile.
function imageRowProfile(image) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  return computeRowProfile(rgba, width, height);
}

// Ghép hồ sơ hàng của mọi ảnh theo thứ tự file. Ảnh gốc không bị sửa/ghép lại;
// doc chỉ giữ profile + offset để khe và panel có thể đi qua mép hai file.
function buildStripDocument(pages){
  return joinStripProfiles(pages.map(page=>({
    pageIndex:page.index,
    width:page.image.naturalWidth||page.image.width,
    height:page.image.naturalHeight||page.image.height,
    profile:imageRowProfile(page.image),
  })));
}
async function buildJoinedStripScenes(pages){
  if(!pages.length)return null;
  const parts=[];
  for(let i=0;i<pages.length;i++){
    const page=pages[i],width=page.image.naturalWidth||page.image.width,height=page.image.naturalHeight||page.image.height;
    if($('#progress-sub'))$('#progress-sub').textContent=`Đang ghép và phân tích dải ${i+1}/${pages.length}…`;
    if($('#progress-fill'))$('#progress-fill').style.width=`${Math.round((i/pages.length)*100)}%`;
    if($('#progress-percent'))$('#progress-percent').textContent=`${Math.round((i/pages.length)*100)}%`;
    parts.push({pageIndex:page.index,width,height,profile:imageRowProfile(page.image)});
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  const doc=joinStripProfiles(parts);
  if(doc.height/Math.max(1,doc.width)<1.3)return null;
  state.stripDoc=doc;
  const {segments}=sliceStripProfile(doc.profile,doc.width,doc.height,state.comicStyle);
  if(!segments.length)return null;
  return segments.map((seg,index)=>{
    const crop=stripSegmentCrop(seg,doc.height);
    const pageWeightMap=new Map();
    for(const fragment of mapStripCropToSources(doc,crop))pageWeightMap.set(fragment.pageIndex,(pageWeightMap.get(fragment.pageIndex)||0)+fragment.destH);
    const sourcePageWeights=[...pageWeightMap].map(([pageIndex,weight])=>({pageIndex,weight}));
    return {
      id:crypto.randomUUID(),pageIndex:stripPageIndexAt(doc,seg.y0),crop,autoCrop:{...crop},
      label:`Panel ${index+1}`,manual:false,duration:null,fullFrame:false,stripDocument:true,
      sourcePageWeights,
      panWeight:stripPanWeight(crop,doc.width,doc.height)??undefined,
    };
  });
}

// Cắt dải dọc cho Manhwa. Trả mảng crop % hoặc null khi cần lùi về đường detector manga.
function detectStripCrops(image) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const style = state.comicStyle;
  const tall = height / Math.max(1, width) >= 1.3;
  if (!tall) {
    // Trang không đủ cao để cuộn: giữ nguyên thành một cảnh.
    return [{ x: 0, y: 0, w: 100, h: 100 }];
  }
  const profile = imageRowProfile(image);
  const { segments } = sliceStripProfile(profile, width, height, style);
  if (!segments.length) return [{ x: 0, y: 0, w: 100, h: 100 }];
  return segments.map(seg => stripSegmentCrop(seg, height));
}

function sortScenesByPage(){
  state.scenes.sort((a,b)=>logicalPageIndex(a)-logicalPageIndex(b) || a.pageIndex-b.pageIndex || (Math.abs(a.crop.y-b.crop.y)>10?a.crop.y-b.crop.y:(state.reading==='rtl'?b.crop.x-a.crop.x:a.crop.x-b.crop.x)));
  let panelCount=0,stripCount=0;
  for(const scene of state.scenes){
    if(scene.stripDocument){if(!scene.manual)scene.label=`Panel ${++stripCount}`;continue;}
    const next=++panelCount;
    if(!scene.manual)scene.label=`Panel ${next}`;
  }
  state.selected=Math.min(state.selected,Math.max(0,state.scenes.length-1));
}
function clamp(x,min,max){return Math.min(max,Math.max(min,x));}
function groupScenesByPage(includeStripSpans=false){
  const groups=new Map();
  for(const scene of state.scenes){
    const sourcePages=includeStripSpans&&scene.stripDocument&&scene.sourcePageWeights?.length
      ?scene.sourcePageWeights.map(item=>item.pageIndex):[logicalPageIndex(scene)];
    for(const pageIndex of new Set(sourcePages)){if(!groups.has(pageIndex))groups.set(pageIndex,[]);groups.get(pageIndex).push(scene);}
  }
  return groups;
}
function shareFrames(totalFrames,count){
  if(!count)return[];
  const base=Math.floor(totalFrames/count),remainder=totalFrames%count;
  return Array.from({length:count},(_,index)=>base+(index<remainder?1:0));
}
// v6r: chia frame trong 1 trang theo panWeight khi MỌI cảnh đều có trọng số
// (cảnh dải dọc) -> cảnh lia dài nhận nhiều thời gian hơn, tốc độ lia đều;
// thiếu 1 cảnh là lùi về chia đều như cũ.
function shareSceneFrames(totalFrames,items){
  const ws=items.map(sc=>sc.panWeight);
  const parts=(ws.length&&ws.every(w=>Number(w)>0))?shareFramesWeighted(totalFrames,ws):null;
  return parts||shareFrames(totalFrames,items.length);
}
function durationBounds(mode=state.durationMode,groups=groupScenesByPage()){
  if(mode==='scene')return{min:0.5,max:120};
  const counts=[...groups.values()].map(items=>items.length);
  if(!counts.length)return{min:0.5,max:3600};
  const pageCount=counts.length,maxPanels=Math.max(...counts),minPanels=Math.min(...counts);
  if(mode==='total')return{min:pageCount*maxPanels*0.5,max:Math.max(pageCount*maxPanels*0.5,pageCount*minPanels*3600)};
  return{min:maxPanels*0.5,max:Math.max(maxPanels*0.5,minPanels*3600)};
}
function getDurationTarget(mode=state.durationMode){
  return mode==='total'?state.totalSeconds:mode==='page'?state.pageSeconds:state.seconds;
}
function setDurationTarget(mode,value){
  if(mode==='total')state.totalSeconds=value;else if(mode==='page')state.pageSeconds=value;
}
function validPanelScriptBinding(){
  const v=state.voice;if(v?.source!=='txt')return true;
  return isPanelScriptBindingValid(state.scenes,v.cues,v.pageMarked);
}
function getEffectiveDurations(){
  const groups=groupScenesByPage(state.durationMode==='voice'),durations=new Map();
  if(state.durationMode==='voice'){
    const v=state.voice;
    if(v&&v.source==='txt'&&v.duration){const exact=panelCueDurationsMap(state.scenes,v.cueDurations);if(exact)return exact;}
    if(v&&v.duration&&v.cues&&v.cues.length&&state.scenes.length){
      const pageCount=logicalPageCount(state.scenes),counts=Array.from({length:pageCount},()=>0),ordered=[];
      const weightsByPage=[],flatWeights=[];let allWeighted=true;
      for(let p=0;p<pageCount;p++){const items=groups.get(p)||[];counts[p]=items.length;for(const sc of items)ordered.push({scene:sc,pageIndex:p});
        const ws=items.map(sc=>{
          const pageWeight=sc.stripDocument?(sc.sourcePageWeights||[]).find(item=>item.pageIndex===p)?.weight??0:1;
          return Number(sc.panWeight)*pageWeight;
        }),ok=ws.length>0&&ws.every(w=>Number(w)>0);
        weightsByPage.push(ok?ws:null);if(ok)flatWeights.push(...ws);else allWeighted=false;}
      const vd=computeVoiceDurations({pageCount,scenesPerPage:counts,pageSegments:v.pageSegments,D:v.duration,fps:state.fps,sceneWeightsPerPage:weightsByPage,sceneWeights:allWeighted?flatWeights:null});
      // v6k: mode partial -> perScene chỉ có các trang có mốc; map theo thứ tự
      // scene của CÁC TRANG CÒN LẠI (trang bị bỏ ở đầu/giữa/cuối đều bị bỏ qua),
      // scene của trang bị bỏ không nhận duration (và bị loại khỏi payload xuất).
      const droppedVd=new Set(vd.droppedPageIndices||[]);
      const keptOrdered=droppedVd.size?ordered.filter(item=>!droppedVd.has(item.pageIndex)):ordered;
      keptOrdered.forEach((item,i)=>{if(i<vd.perScene.length){const sc=item.scene;durations.set(sc.id,(durations.get(sc.id)||0)+(vd.perScene[i]??0));}});
    }
    return durations;
  }
  if(state.durationMode==='scene'){
    for(const scene of state.scenes)durations.set(scene.id,scene.duration??state.seconds);
    return durations;
  }
  const entries=[...groups.entries()];if(!entries.length)return durations;
  if(state.durationMode==='total'){
    const bounds=durationBounds('total',groups),target=clamp(Number(state.totalSeconds)||bounds.min,bounds.min,bounds.max),totalFrames=Math.max(1,Math.round(target*state.fps));
    const pageFrames=shareFrames(totalFrames,entries.length);
    entries.forEach(([,items],pageIndex)=>{
      const sceneFrames=shareSceneFrames(pageFrames[pageIndex],items);
      items.forEach((scene,index)=>durations.set(scene.id,sceneFrames[index]/state.fps));
    });
  }else{
    const bounds=durationBounds('page',groups),pageSeconds=clamp(Number(state.pageSeconds)||bounds.min,bounds.min,bounds.max),pageFrameCount=Math.max(1,Math.round(pageSeconds*state.fps));
    for(const [,items] of entries){
      const sceneFrames=shareSceneFrames(pageFrameCount,items);
      items.forEach((scene,index)=>durations.set(scene.id,sceneFrames[index]/state.fps));
    }
  }
  return durations;
}
function estimatedTotalDuration(){
  const durations=getEffectiveDurations();let total=0;
  for(const value of durations.values())total+=value;
  return total;
}
function formatPreciseSeconds(value){return `${Number(value.toFixed(2)).toLocaleString('vi-VN')} giây`;}
function updateDurationControls(){
  const groups=groupScenesByPage(),bounds=durationBounds(state.durationMode,groups),target=clamp(Number(getDurationTarget())||bounds.min,bounds.min,bounds.max);
  setDurationTarget(state.durationMode,target);
  $('#duration-mode').value=state.durationMode;
  $('#duration-target-label').textContent=state.durationMode==='total'?'Tổng thời lượng video':state.durationMode==='page'?'Thời lượng mỗi trang':state.durationMode==='voice'?'Theo voice SRT':'Mặc định mỗi cảnh';
  const input=$('#duration-target');input.min=String(bounds.min);input.max=String(bounds.max);input.value=String(Math.round(target*100)/100);input.disabled=state.durationMode==='voice';
  const sceneInput=$('#scene-duration'),note=$('#scene-duration-note');
  sceneInput.disabled=!state.scenes.length||state.durationMode!=='scene';
  note.textContent=state.durationMode==='scene'?'Để trống sẽ dùng thời lượng mặc định.':'Đang tự chia đều; thời lượng riêng tạm không áp dụng.';
  const total=estimatedTotalDuration(),pageCount=groups.size;
  if(!state.scenes.length)$('#duration-summary').textContent='Nhập ảnh để xem thời lượng ước tính.';
  else if(state.durationMode==='total')$('#duration-summary').textContent=`Ước tính ${formatPreciseSeconds(total)} · chia đều ${pageCount} trang, rồi chia theo số khung.`;
  else if(state.durationMode==='page')$('#duration-summary').textContent=`${formatPreciseSeconds(target)} mỗi trang · tổng khoảng ${formatPreciseSeconds(total)} (${pageCount} trang).`;
  else if(state.durationMode==='voice'){const vv=state.voice;$('#duration-summary').textContent=vv&&vv.duration?(vv.source==='txt'?`Theo voice AI từng panel · tổng ${formatPreciseSeconds(vv.duration)} · ${vv.cues.length} panel.`:`Theo voice SRT · tổng ${formatPreciseSeconds(vv.duration)} · ${vv.cues.length} cue, ${Object.keys(vv.pageSegments||{}).length} mốc trang.`):'Chưa có voice — hãy nạp SRT hoặc TXT theo panel rồi tạo voice ở mục GIỌNG ĐỌC.';}
  else $('#duration-summary').textContent=`Tổng khoảng ${formatPreciseSeconds(total)} · ${pageCount} trang, ${state.scenes.length} khung.`;
}
function formatSeconds(value){const n=Number(value);return `${Number.isInteger(n)?n:n.toFixed(1)}s`;}
function formatSceneDuration(value){return state.durationMode==='scene'?formatSeconds(value):`${Number(value.toFixed(2)).toLocaleString('vi-VN')}s`;}
function selectScene(index){if(index<0||index>=state.scenes.length)return;state.selected=index;renderAll();}
function moveScene(index,delta){const target=index+delta;if(target<0||target>=state.scenes.length)return;const [item]=state.scenes.splice(index,1);state.scenes.splice(target,0,item);state.selected=target;renderAll();}

// Crop thường theo % một page; strip scene dùng % toàn dải ghép logic.
function cropRectOf(page,scene,stripDoc=state.stripDoc){
  const c=scene.crop;
  if(scene.stripDocument&&stripDoc)return {sx:c.x/100*stripDoc.width,sy:c.y/100*stripDoc.height,sw:c.w/100*stripDoc.width,sh:c.h/100*stripDoc.height};
  return {sx:Math.round(c.x/100*page.image.width),sy:Math.round(c.y/100*page.image.height),sw:Math.max(1,Math.round(c.w/100*page.image.width)),sh:Math.max(1,Math.round(c.h/100*page.image.height))};
}
function cropRect(scene){
  return cropRectOf(state.pages[scene.pageIndex],scene,state.stripDoc);
}
function drawStripCrop(ctx,scene,doc,pages,dx,dy,dw,dh){
  if(!doc)return;
  for(const fragment of mapStripCropToSources(doc,scene.crop)){
    const page=pages[fragment.pageIndex];if(!page?.image)continue;
    ctx.drawImage(page.image,fragment.sx,fragment.sy,fragment.sw,fragment.sh,dx,dy+fragment.destY*dh,dw,fragment.destH*dh);
  }
}
function drawWebtoonSource(ctx,scene,pages,stripDoc,x,y,w,h){
  const page=pages[scene.pageIndex],crop=cropRectOf(page,scene,stripDoc);
  if(scene.stripDocument&&stripDoc)drawStripCrop(ctx,scene,stripDoc,pages,x,y,w,h);
  else ctx.drawImage(page.image,crop.sx,crop.sy,crop.sw,crop.sh,x,y,w,h);
}
function makeWebtoonScrollTile(scene,pages,stripDoc,widthPct=100){
  const page=pages[scene.pageIndex],crop=cropRectOf(page,scene,stripDoc);
  const {width,height}=webtoonTileSize(crop.sw,crop.sh,1920,widthPct);
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#101014';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.filter='blur(30px) brightness(.34) saturate(.72)';
  drawWebtoonSource(ctx,scene,pages,stripDoc,0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='rgba(12,12,17,.22)';ctx.fillRect(0,0,canvas.width,canvas.height);
  const dx=(canvas.width-width)/2;
  drawWebtoonSource(ctx,scene,pages,stripDoc,dx,0,width,height);
  return canvas;
}
function renderWebtoonStackPlate(index){
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#101014';ctx.fillRect(0,0,canvas.width,canvas.height);
  const ordered=state.scenes;
  const scene=state.scenes[index],globalIndex=ordered.findIndex(item=>item.id===scene?.id);
  if(globalIndex<0)return canvas;
  const heights=ordered.map(target=>{const page=state.pages[target.pageIndex],crop=cropRectOf(page,target,state.stripDoc);return webtoonTileSize(crop.sw,crop.sh,1920,state.webtoonWidthPct).height;});
  const plan=webtoonScrollPlan(heights,globalIndex,1080);
  let y=-plan.advancePx*.38;
  for(let i=globalIndex;y<1080&&i<ordered.length;i++){
    const tile=makeWebtoonScrollTile(ordered[i],state.pages,state.stripDoc,state.webtoonWidthPct);
    ctx.drawImage(tile,0,y);y+=tile.height;tile.width=0;tile.height=0;
  }
  return canvas;
}
function stripThumbnail(scene){
  const canvas=document.createElement('canvas');canvas.width=120;canvas.height=68;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#17171d';ctx.fillRect(0,0,canvas.width,canvas.height);
  const rect=cropRect(scene),fit=Math.min(canvas.width/Math.max(1,rect.sw),canvas.height/Math.max(1,rect.sh));
  const w=rect.sw*fit,h=rect.sh*fit;
  drawStripCrop(ctx,scene,state.stripDoc,state.pages,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
  return canvas.toDataURL('image/jpeg',.72);
}
// Vẽ panel lấp kín khung 16:9 (cover-fit, không méo) lên canvas 1920×1080. Dùng cho chế độ full màn hình.
function coverCanvasOf(page,crop,zoom=1){
  const cover=document.createElement('canvas');cover.width=1920;cover.height=1080;
  const cctx=cover.getContext('2d'),sc=Math.max(1920/crop.sw,1080/crop.sh)*zoom,dw=crop.sw*sc,dh=crop.sh*sc;
  cctx.fillStyle='#000';cctx.fillRect(0,0,1920,1080);
  cctx.drawImage(page.image,crop.sx,crop.sy,crop.sw,crop.sh,(1920-dw)/2,(1080-dh)/2,dw,dh);
  return cover;
}
// ===== Chế độ LẤP KHUNG / MOSAIC (v6j, kiểu Genz) =====
// Trang phủ KÍN khung 1920×1080 ở độ sắc nét đầy đủ (không nền mờ). Camera là một
// khung nhìn nhỏ hơn MOSAIC_ZOOM lần trên "thế giới" (trang vẽ cover-fit), lia tới
// tâm panel đang đọc; panel đó nổi lên tại đúng vị trí của nó, to MOSAIC_POP_SCALE lần.
// Thế giới dùng canvas 3840×2160 (2× khung hình) để render.js lia bằng zoompan.
const MOSAIC_ZOOM = 1.5;
const MOSAIC_POP_SCALE = 1.25;
const MOSAIC_WORLD_W = 3840, MOSAIC_WORLD_H = 2160;
function mosaicWorldTransform(page){
  const scale=Math.max(MOSAIC_WORLD_W/page.image.width,MOSAIC_WORLD_H/page.image.height);
  return {scale,offX:(MOSAIC_WORLD_W-page.image.width*scale)/2,offY:(MOSAIC_WORLD_H-page.image.height*scale)/2};
}
// Tâm panel + tâm camera đã kẹp trong thế giới (tọa độ thế giới 3840×2160).
function mosaicCameraFor(page,scene){
  const t=mosaicWorldTransform(page),crop=cropRectOf(page,scene);
  const cx=t.offX+(crop.sx+crop.sw/2)*t.scale, cy=t.offY+(crop.sy+crop.sh/2)*t.scale;
  const winW=MOSAIC_WORLD_W/MOSAIC_ZOOM, winH=MOSAIC_WORLD_H/MOSAIC_ZOOM;
  return {panelCenterX:cx,panelCenterY:cy,camX:clamp(cx,winW/2,MOSAIC_WORLD_W-winW/2),camY:clamp(cy,winH/2,MOSAIC_WORLD_H-winH/2),winW,winH};
}
// display: {mode:'card'|'full'|'mosaic', scalePct} — mặc định lấy từ state (workspace).
// Job trong hàng đợi truyền display từ snapshot nên không chạm state toàn cục.
function panelPlacement(page,scene,sequenceIndex,pageSceneCount=1,display=null){
  const crop=cropRectOf(page,scene),fullFrame=Boolean(scene.fullFrame);
  const sizeScale=(Number(display&&display.scalePct)||state.panelDisplayScalePct)/100;
  const maxW=1920*Math.min((fullFrame?0.84:0.46)*sizeScale,0.90),maxH=1080*Math.min((fullFrame?0.90:0.68)*sizeScale,0.90),fit=Math.min(maxW/crop.sw,maxH/crop.sh);
  const contentW=Math.max(1,Math.round(crop.sw*fit)),contentH=Math.max(1,Math.round(crop.sh*fit));
  const pad=14,shadow=20,w=contentW+pad*2+shadow*2,h=contentH+pad*2+shadow*2;
  const solo=!fullFrame&&pageSceneCount===1,left=fullFrame?false:sequenceIndex%2===0,pair=Math.floor(sequenceIndex/2),centered=fullFrame||solo;
  let centerX=centered?960:1920*(left ? 0.365 : 0.635)+(left?-1:1)*(pair%2)*34;
  const yOffsets=[0,-54,48];
  let centerY=centered?540:1080*.5+yOffsets[pair%3];
  // Giữ panel trong khung hình kể cả khi phóng to 200%.
  centerX=Math.min(Math.max(centerX,w/2),1920-w/2);
  centerY=Math.min(Math.max(centerY,h/2),1080-h/2);
  // Giới hạn zoom lúc trượt vào để không tràn viền.
  const zMax=Math.min(1.24,1920/w,1080/h);
  return {crop,contentW,contentH,pad,shadow,w,h,centerX,centerY,startCenterX:fullFrame?centerX:left?-w*.62:1920+w*.62,side:fullFrame?'center':left?'left':'right',fullFrame,zMax};
}
function drawBackdrop(ctx,page){
  ctx.fillStyle='#111117';ctx.fillRect(0,0,1920,1080);
  const cover=Math.max(1920/page.image.width,1080/page.image.height),coverW=page.image.width*cover,coverH=page.image.height*cover;
  ctx.save();ctx.filter='blur(38px) brightness(.31) saturate(.68)';ctx.drawImage(page.image,(1920-coverW)/2,(1080-coverH)/2,coverW,coverH);ctx.restore();
  ctx.fillStyle='rgba(12,12,17,.27)';ctx.fillRect(0,0,1920,1080);
}
function drawStripBackdrop(ctx,scene,doc,pages){
  const crop=cropRectOf(null,scene,doc),cover=Math.max(1920/Math.max(1,crop.sw),1080/Math.max(1,crop.sh));
  const layer=document.createElement('canvas');layer.width=1920;layer.height=1080;
  const layerCtx=layer.getContext('2d');layerCtx.fillStyle='#111117';layerCtx.fillRect(0,0,1920,1080);
  const dw=crop.sw*cover,dh=crop.sh*cover;
  drawStripCrop(layerCtx,scene,doc,pages,(1920-dw)/2,(1080-dh)/2,dw,dh);
  ctx.fillStyle='#111117';ctx.fillRect(0,0,1920,1080);
  ctx.save();ctx.filter='blur(38px) brightness(.31) saturate(.68)';ctx.drawImage(layer,0,0);ctx.restore();
  ctx.fillStyle='rgba(12,12,17,.27)';ctx.fillRect(0,0,1920,1080);
}
// Nền mờ cho kiểu Ma Vương (v6x, chỉ manhwa): dùng CHÍNH ĐOẠN đang hiện
// phóng cover + làm mờ lấp phần thừa hai bên (pillarbox blur) — kênh mẫu
// Ma Vương Review không dùng nền trang mờ như kiểu thẻ.
function drawSegmentBackdrop(ctx,img,sx,sy,sw,sh){
  ctx.fillStyle='#111117';ctx.fillRect(0,0,1920,1080);
  const cover=Math.max(1920/sw,1080/sh),coverW=sw*cover,coverH=sh*cover;
  ctx.save();ctx.filter='blur(38px) brightness(.31) saturate(.68)';ctx.drawImage(img,sx,sy,sw,sh,(1920-coverW)/2,(1080-coverH)/2,coverW,coverH);ctx.restore();
  ctx.fillStyle='rgba(12,12,17,.27)';ctx.fillRect(0,0,1920,1080);
}
function drawPanelCard(ctx,page,scene,placement,scale=1,offsetX=0){
  const x=placement.centerX-placement.w*scale/2+offsetX,y=placement.centerY-placement.h*scale/2;
  const shadow=placement.shadow*scale,pad=placement.pad*scale,w=placement.contentW*scale,h=placement.contentH*scale;
  const crop=placement.crop;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.58)';ctx.shadowBlur=24*scale;ctx.shadowOffsetY=10*scale;
  ctx.fillStyle='#fffdf8';ctx.fillRect(x+shadow,y+shadow,w+pad*2,h+pad*2);ctx.restore();
  ctx.save();ctx.fillStyle='#fffdf8';ctx.fillRect(x+shadow,y+shadow,w+pad*2,h+pad*2);
  ctx.drawImage(page.image,crop.sx,crop.sy,crop.sw,crop.sh,x+shadow+pad,y+shadow+pad,w,h);ctx.restore();
}
// Xem trước mosaic: cùng hình học với payload xuất (camera kẹp trên tâm panel,
// panel nổi tại chỗ ×1.25, trang sắc nét phủ kín khung).
function renderMosaicPlate(index){
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d');
  const scene=state.scenes[index],page=state.pages[scene.pageIndex];
  const cam=mosaicCameraFor(page,scene);
  const s1=Math.max(1920/page.image.width,1080/page.image.height);
  const offX1=(1920-page.image.width*s1)/2, offY1=(1080-page.image.height*s1)/2;
  const winW1=1920/MOSAIC_ZOOM, winH1=1080/MOSAIC_ZOOM;
  const winX1=cam.camX/2-winW1/2, winY1=cam.camY/2-winH1/2;
  ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);
  ctx.drawImage(page.image,(winX1-offX1)/s1,(winY1-offY1)/s1,winW1/s1,winH1/s1,0,0,1920,1080);
  const crop=cropRectOf(page,scene);
  const pcx1=offX1+(crop.sx+crop.sw/2)*s1, pcy1=offY1+(crop.sy+crop.sh/2)*s1;
  const fx=(pcx1-winX1)*MOSAIC_ZOOM, fy=(pcy1-winY1)*MOSAIC_ZOOM;
  const fw=crop.sw*s1*MOSAIC_ZOOM*MOSAIC_POP_SCALE, fh=crop.sh*s1*MOSAIC_ZOOM*MOSAIC_POP_SCALE;
  const pad=16;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=26;ctx.shadowOffsetY=10;
  ctx.fillStyle='#fffdf8';ctx.fillRect(fx-fw/2-pad,fy-fh/2-pad,fw+pad*2,fh+pad*2);ctx.restore();
  ctx.fillStyle='#fffdf8';ctx.fillRect(fx-fw/2-pad,fy-fh/2-pad,fw+pad*2,fh+pad*2);
  ctx.drawImage(page.image,crop.sx,crop.sy,crop.sw,crop.sh,fx-fw/2,fy-fh/2,fw,fh);
  return canvas;
}
function renderPlate(index,revealProgress=1){
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d');
  const scene=state.scenes[index],page=state.pages[scene.pageIndex],groupIndex=logicalPageIndex(scene);
  if(isStripStyle(state.comicStyle))return renderWebtoonStackPlate(index);
  if(state.comicStyle==='hybrid'){
    const crop=cropRectOf(page,scene),renderHeight=Math.round(1920*crop.sh/Math.max(1,crop.sw));
    if(crop.sh>state.hybridScrollThresholdPx&&renderHeight>1080){ctx.fillStyle='#101014';ctx.fillRect(0,0,1920,1080);ctx.drawImage(page.image,crop.sx,crop.sy,crop.sw,crop.sh,0,0,1920,renderHeight);return canvas;}
  }
  if(state.comicStyle!=='hybrid'&&state.panelDisplayMode==='mosaic'){
    return renderMosaicPlate(index);
  }
  if(state.comicStyle!=='hybrid'&&state.panelDisplayMode==='full'){
    // Full màn hình: panel hiện tại lấp kín khung 16:9, zoom nhẹ theo tiến độ hiện.
    const crop=cropRect(scene),ease=Math.max(0,Math.min(1,revealProgress));
    const cover=coverCanvasOf(page,crop,1+0.06*ease*ease);
    ctx.drawImage(cover,0,0);
    return canvas;
  }
  const backdrop=previousGroupPage(groupIndex)||page;
  drawBackdrop(ctx,backdrop);
  const pageSceneCount=state.scenes.filter(item=>logicalPageIndex(item)===groupIndex).length;
  let sequenceIndex=0;
  for(let i=0;i<=index;i++){
    const item=state.scenes[i];if(logicalPageIndex(item)!==groupIndex)continue;
    const itemPage=state.pages[item.pageIndex],placement=panelPlacement(itemPage,item,sequenceIndex++,pageSceneCount),active=i===index,progress=active?Math.max(0,Math.min(1,revealProgress)):1,ease=progress*progress*(3-2*progress);
    const zMax=placement.zMax||1.24;
    const scale=active?(placement.fullFrame?1:zMax-(zMax-1)*ease):1,offset=active&&!placement.fullFrame?(placement.startCenterX-placement.centerX)*(1-ease):0;
    drawPanelCard(ctx,itemPage,item,placement,scale,offset);
  }
  return canvas;
}
function paintPreview(){
  const canvas=$('#preview-canvas'),ctx=canvas.getContext('2d');
  if(!state.scenes.length){ctx.clearRect(0,0,canvas.width,canvas.height);$('#empty-stage').classList.remove('hidden');return;}
  $('#empty-stage').classList.add('hidden');
  const frame=renderPlate(state.selected);ctx.drawImage(frame,0,0,canvas.width,canvas.height);
}
function renderAll(){
  const has=state.pages.length>0;$('#import-card').classList.toggle('hidden',has);$('#editor').classList.toggle('hidden',!has);$('#new-chapter-btn').classList.toggle('hidden',!has);
  if(!has)return;
  updateExportNote();
  updateDurationControls();const durations=getEffectiveDurations();
  const scene=state.scenes[state.selected], page=scene?state.pages[scene.pageIndex]:null;
  $('#page-count').textContent=`${logicalPageCount(state.scenes)} trang · ${state.pages.length} panel`;
  $('#panel-count').textContent=`${state.scenes.length} cảnh`;
  $('#scene-heading').textContent=state.scenes.length?`${state.scenes.length} cảnh trong chap`:'Chưa có cảnh';
  $('#timeline-count').textContent=`${state.scenes.length} cảnh`;
  $('#scene-counter').textContent=state.scenes.length?`${state.selected+1} / ${state.scenes.length}`:'0 / 0';
  $('#selected-label').textContent=scene?`${page.pageGroupName||page.name} · ${scene.label}`:'Chọn cảnh để xem';
  $('#motion-label').textContent=state.comicStyle==='hybrid'?'MANGA LAI · PANEL DÀI CUỘN, PANEL NGẮN ZOOM':isStripStyle(state.comicStyle)?'MANHWA · CUỘN DẢI LIÊN TỤC':state.panelDisplayMode==='full'?'FULL MÀN HÌNH · LIA CAMERA':state.panelDisplayMode==='mosaic'?'LẤP KHUNG · KIỂU GENZ':'SLIDE IN · THẺ XEN KẼ';
  $('#panel-editor .panel-editor-head span').textContent=scene?.stripDocument?'tọa độ theo % dải ghép':'tọa độ theo % trang';
  $('#crop-x').value=scene?Math.round(scene.crop.x):0;$('#crop-y').value=scene?Math.round(scene.crop.y):0;
  $('#crop-w').value=scene?Math.round(scene.crop.w):100;$('#crop-h').value=scene?Math.round(scene.crop.h):100;
  $('#scene-duration').value=scene&&scene.duration!==null&&scene.duration!==undefined?scene.duration:'';
  $('#scene-duration').placeholder=`Mặc định ${formatSeconds(state.seconds)}`;$('#scene-duration').disabled=!scene||state.durationMode!=='scene';
  $('#scene-list').innerHTML=state.scenes.map((s,i)=>{
    const p=state.pages[s.pageIndex],r=cropRect(s),baseW=s.stripDocument?state.stripDoc.width:p.image.width,baseH=s.stripDocument?state.stripDoc.height:p.image.height;
    const src=s.stripDocument?stripThumbnail(s):p.url,style=s.stripDocument?'object-fit:cover':`object-position:${(r.sx+r.sw/2)/p.image.width*100}% ${(r.sy+r.sh/2)/p.image.height*100}%`;
    return `<div class="scene-row ${i===state.selected?'selected':''}" data-index="${i}"><button class="scene-thumb" data-action="select" data-index="${i}"><img src="${src}" style="${style}" /></button><button class="scene-info" data-action="select" data-index="${i}"><b>${String(i+1).padStart(2,'0')} · ${s.label}</b><span>${s.stripDocument?'Dải ghép · ':(p.pageGroupName?`${p.pageGroupName} · ${p.name} · `:`${p.name} · `)}${Math.round(r.sw/baseW*100)}% × ${Math.round(r.sh/baseH*100)}% · ${formatSceneDuration(durations.get(s.id)??state.seconds)}</span></button><div class="scene-actions"><button title="Lên" data-action="up" data-index="${i}">↑</button><button title="Xuống" data-action="down" data-index="${i}">↓</button><button class="delete-scene" title="Xóa cảnh" data-action="remove" data-index="${i}">×</button></div></div>`;
  }).join('');
  $('#timeline').innerHTML=state.scenes.map((s,i)=>{const p=state.pages[s.pageIndex],r=cropRect(s),src=s.stripDocument?stripThumbnail(s):p.url,style=s.stripDocument?'object-fit:cover':`object-position:${(r.sx+r.sw/2)/p.image.width*100}% ${(r.sy+r.sh/2)/p.image.height*100}%`;return `<button class="timeline-item ${i===state.selected?'active':''}" data-action="select" data-index="${i}"><span class="timeline-no">${String(i+1).padStart(2,'0')}</span><img src="${src}" style="${style}"/><i>${formatSceneDuration(durations.get(s.id)??state.seconds)}</i></button>`;}).join('');
  paintPreview();
}
$('#scene-list').addEventListener('click', e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const i=Number(b.dataset.index),action=b.dataset.action;
  if(action==='select')selectScene(i);if(action==='up')moveScene(i,-1);if(action==='down')moveScene(i,1);if(action==='remove'){state.scenes.splice(i,1);state.selected=Math.max(0,Math.min(i,state.scenes.length-1));renderAll();toast('Đã xóa cảnh khỏi video.');}
});
$('#timeline').addEventListener('click',e=>{const b=e.target.closest('[data-action="select"]');if(b)selectScene(Number(b.dataset.index));});

// Dựng exportPages (states + panels) từ pages/scenes — ĐƯỜNG DUY NHẤT dựng payload video,
// dùng chung cho xuất trực tiếp trong workspace và job trong hàng đợi (v6f).
// durations: Map scene.id -> giây. fallbackSeconds dùng khi durations thiếu.
// display: {mode:'card'|'full', scalePct} — null = lấy từ state (workspace).
async function prepareExportPages(pages, scenes, durations, fallbackSeconds, onPrepare, display=null, shouldCancel=null){
  const exportPages=[];
  let preparedPanels=0;
  const totalScenes=scenes.length;
  const exactVoiceTiming=display?.exactVoiceTiming??!!(state.voice?.source==='txt'&&state.voice?.path);
  const displayMode=(display&&display.mode)||state.panelDisplayMode;
  // Kiểu trình bày video lấy từ job snapshot hoặc workspace. Chọn Manhwa
  // chỉ đổi bố cục cảnh; ảnh panel đầu vào không bị nối hoặc tách lại.
  const comicStyle=normalizeComicStyle((display&&display.comicStyle)||state.comicStyle);
  const stripMode=isStripStyle(comicStyle),hybridMode=comicStyle==='hybrid';
  const hybridThresholdPx=Math.max(600,Math.min(20000,Number(display&&display.hybridScrollThresholdPx)||state.hybridScrollThresholdPx||1600));
  const hybridVisiblePanels=Math.max(1,Math.min(10,Math.round(Number(display&&display.hybridVisiblePanels)||state.hybridVisiblePanels||5)));
  const hybridWidthPct=Math.max(40,Math.min(100,Number(display&&display.webtoonWidthPct)||state.webtoonWidthPct||100));
  const hasLegacyStripScenes=stripMode&&scenes.some(scene=>scene.stripDocument);
  const stripDoc=hasLegacyStripScenes?(pages===state.pages&&state.stripDoc?state.stripDoc:buildStripDocument(pages)):null;
  const webtoonScenes=stripMode?[...scenes]:[];
  const webtoonIndex=new Map(webtoonScenes.map((scene,index)=>[scene.id,index]));
  const webtoonWidthPct=Number(display&&display.webtoonWidthPct)||state.webtoonWidthPct||100;
  const webtoonTileHeights=stripMode?webtoonScenes.map(scene=>{const page=pages[scene.pageIndex],crop=cropRectOf(page,scene,stripDoc);return webtoonTileSize(crop.sw,crop.sh,1920,webtoonWidthPct).height;}):[];
  const logicalPages=[...new Set(scenes.map(logicalPageIndex))].sort((a,b)=>a-b);
  const globalSceneIndex=new Map(scenes.map((scene,index)=>[scene.id,index]));
  // Manga Lai keeps the most recent cards across folder/page boundaries too.
  // Batch chapters commonly have one image per page folder; resetting this list
  // inside the page loop made every exported page show only its current image.
  let hybridCards=[];
  for(const pageIndex of logicalPages){
    if(shouldCancel?.())throw Object.assign(new Error('Đã dừng render theo yêu cầu.'),{code:'CANCELLED'});
    const pageScenes=scenes.filter(s=>logicalPageIndex(s)===pageIndex),page=pages[pageScenes[0]?.pageIndex]||pages[pageIndex];
    if(!pageScenes.length)continue;
    const fullMode=!stripMode&&!hybridMode&&displayMode==='full', mosaicMode=!stripMode&&!hybridMode&&displayMode==='mosaic';
    const states=[],panels=[];
    let compositeCtx=null,composite=null,hybridBase=null;
    // Mosaic dựng thế giới riêng theo ảnh source của từng panel trong folder trang.
    let mosaicPrevCam=null, mosaicPrevPageIndex=null;
    if(!fullMode&&!mosaicMode&&!stripMode){
      const backdrop=previousGroupPage(pageIndex,pages)||page,base=document.createElement('canvas');base.width=1920;base.height=1080;
      drawBackdrop(base.getContext('2d'),backdrop);
      composite=document.createElement('canvas');composite.width=1920;composite.height=1080;
      compositeCtx=composite.getContext('2d');compositeCtx.drawImage(base,0,0);
      if(hybridMode){
        hybridBase=document.createElement('canvas');hybridBase.width=1920;hybridBase.height=1080;hybridBase.getContext('2d').drawImage(base,0,0);
        for(const card of hybridCards)compositeCtx.drawImage(card.image,card.x,card.y);
        const initialState=await new Promise(resolve=>composite.toBlob(resolve,'image/jpeg',.96));
        states.push(await initialState.arrayBuffer());
      }else{
        const baseBlob=await new Promise(resolve=>base.toBlob(resolve,'image/jpeg',.96));
        states.push(await baseBlob.arrayBuffer());
      }
    }
    for(let panelIndex=0;panelIndex<pageScenes.length;panelIndex++){
      if(shouldCancel?.())throw Object.assign(new Error('Đã dừng render theo yêu cầu.'),{code:'CANCELLED'});
      const scene=pageScenes[panelIndex];
      const scenePage=pages[scene.pageIndex]||page;
      if(hybridMode){
        const crop=cropRectOf(scenePage,scene),renderWidth=Math.max(1,Math.round(1920*hybridWidthPct/100)),renderHeight=Math.max(1,Math.round(renderWidth*crop.sh/Math.max(1,crop.sw)));
        if(crop.sh>hybridThresholdPx&&renderHeight>1080){
          const stackCanvas=document.createElement('canvas');stackCanvas.width=1920;stackCanvas.height=renderHeight;
          const stackCtx=stackCanvas.getContext('2d');stackCtx.fillStyle='#101014';stackCtx.fillRect(0,0,stackCanvas.width,stackCanvas.height);
          stackCtx.drawImage(scenePage.image,crop.sx,crop.sy,crop.sw,crop.sh,(1920-renderWidth)/2,0,renderWidth,renderHeight);
          const stackImage=await (await new Promise(resolve=>stackCanvas.toBlob(resolve,'image/jpeg',.92))).arrayBuffer();
          panels.push({displayMode:'webtoon-stack',stackImage,stackAdvancePx:Math.max(0,renderHeight-1080),seconds:durations.get(scene.id)??fallbackSeconds,exactVoiceDuration:exactVoiceTiming,fullFrame:false});
          // The long image scrolls during its own segment, then remains in the
          // Manga Lai composition as a regular miniature panel. Retain it in
          // the same rolling window as short panels so the next scene does not
          // make the completed long panel disappear immediately.
          const placeIndex=globalSceneIndex.get(scene.id)??panelIndex,placeCount=hybridMode?scenes.length:pageScenes.length;
          const placement=panelPlacement(scenePage,scene,placeIndex,placeCount,display),tile=document.createElement('canvas');
          tile.width=placement.w;tile.height=placement.h;
          const tileCtx=tile.getContext('2d'),cardX=placement.shadow,cardY=placement.shadow,cardW=placement.contentW+placement.pad*2,cardH=placement.contentH+placement.pad*2;
          tileCtx.save();tileCtx.shadowColor='rgba(0,0,0,.58)';tileCtx.shadowBlur=24;tileCtx.shadowOffsetY=10;tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(cardX,cardY,cardW,cardH);tileCtx.restore();
          tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(cardX,cardY,cardW,cardH);
          tileCtx.drawImage(scenePage.image,crop.sx,crop.sy,crop.sw,crop.sh,cardX+placement.pad,cardY+placement.pad,placement.contentW,placement.contentH);
          hybridCards=appendHybridPanelCard(hybridCards,{image:tile,x:placement.centerX-placement.w/2,y:placement.centerY-placement.h/2},hybridVisiblePanels);
          compositeCtx.clearRect(0,0,1920,1080);compositeCtx.drawImage(hybridBase,0,0);
          for(const card of hybridCards)compositeCtx.drawImage(card.image,card.x,card.y);
          const retainedState=await new Promise(resolve=>composite.toBlob(resolve,'image/jpeg',.96));
          states.push(await retainedState.arrayBuffer());
          preparedPanels++;if(onPrepare)onPrepare(preparedPanels,totalScenes);
          continue;
        }
      }
      if(stripMode){
        // Dải Webtoon: ảnh giữ chiều cao tự nhiên theo chiều rộng chung; mỗi cảnh
        // cuộn lên đúng chiều cao của chính ảnh đó để cảnh kế tiếp vào từ dưới.
        const seconds=durations.get(scene.id)??fallbackSeconds;
        const globalIndex=webtoonIndex.get(scene.id)??0;
        const plan=webtoonScrollPlan(webtoonTileHeights,globalIndex,1080);
        const stackCanvas=document.createElement('canvas');
        stackCanvas.width=1920;stackCanvas.height=Math.max(1080,plan.contentHeight,plan.requiredHeight);
        const stackCtx=stackCanvas.getContext('2d');stackCtx.fillStyle='#101014';stackCtx.fillRect(0,0,stackCanvas.width,stackCanvas.height);
        let tileY=0;
        for(let slot=0;slot<plan.tileCount;slot++){
          const target=webtoonScenes[plan.startIndex+slot];if(!target)continue;
          const tile=makeWebtoonScrollTile(target,pages,stripDoc,webtoonWidthPct);
          stackCtx.drawImage(tile,0,tileY);tileY+=tile.height;tile.width=0;tile.height=0;
        }
        const stackBlob=await new Promise(resolve=>stackCanvas.toBlob(resolve,'image/jpeg',.92));
        const stackImage=await stackBlob.arrayBuffer();
        panels.push({displayMode:'webtoon-stack',stackImage,stackAdvancePx:plan.advancePx,seconds,exactVoiceDuration:exactVoiceTiming,fullFrame:false});
        states.push(stackImage);
      }else if(mosaicMode){
        // Lấp khung: nền = thế giới trang (render.js lia camera bằng zoompan từ panel
        // trước tới panel này); pop = thẻ panel tại đúng vị trí, ×1.25 so với trên trang.
        const cam=mosaicCameraFor(scenePage,scene),crop=cropRectOf(scenePage,scene);
        const worldTransform=mosaicWorldTransform(scenePage),worldScale=worldTransform.scale;
        const sceneWorld=document.createElement('canvas');sceneWorld.width=MOSAIC_WORLD_W;sceneWorld.height=MOSAIC_WORLD_H;
        sceneWorld.getContext('2d').drawImage(scenePage.image,worldTransform.offX,worldTransform.offY,scenePage.image.width*worldScale,scenePage.image.height*worldScale);
        const sceneMosaicImage=await (await new Promise(resolve=>sceneWorld.toBlob(resolve,'image/jpeg',.92))).arrayBuffer();
        let popFactor=(worldScale/2)*MOSAIC_ZOOM*MOSAIC_POP_SCALE; // px tile / px ảnh gốc
        const maxContentW=2400,maxContentH=2000;
        popFactor=Math.min(popFactor,maxContentW/Math.max(1,crop.sw),maxContentH/Math.max(1,crop.sh));
        const pad=Math.max(6,Math.round(14*popFactor/Math.max(1e-6,worldScale/2)));
        const shadow=Math.round(pad*1.4);
        const contentW=Math.max(1,Math.round(crop.sw*popFactor)),contentH=Math.max(1,Math.round(crop.sh*popFactor));
        const tile=document.createElement('canvas');tile.width=contentW+pad*2+shadow*2;tile.height=contentH+pad*2+shadow*2;
        const tileCtx=tile.getContext('2d');
        tileCtx.save();tileCtx.shadowColor='rgba(0,0,0,.58)';tileCtx.shadowBlur=24;tileCtx.shadowOffsetY=10;tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(shadow,shadow,contentW+pad*2,contentH+pad*2);tileCtx.restore();
        tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(shadow,shadow,contentW+pad*2,contentH+pad*2);
        tileCtx.drawImage(scenePage.image,crop.sx,crop.sy,crop.sw,crop.sh,shadow+pad,shadow+pad,contentW,contentH);
        const popImage=await (await new Promise(resolve=>tile.toBlob(resolve,'image/png'))).arrayBuffer();
        // State nghỉ (đủ số states cho pipeline + xem lại khi cần): thế giới qua khung
        // nhìn của panel này + pop đặt tại chỗ.
        const stateCanvas=document.createElement('canvas');stateCanvas.width=1920;stateCanvas.height=1080;
        const sctx=stateCanvas.getContext('2d');
        sctx.drawImage(sceneWorld,cam.camX-cam.winW/2,cam.camY-cam.winH/2,cam.winW,cam.winH,0,0,1920,1080);
        const outScale=1920/cam.winW;
        sctx.drawImage(tile,(cam.panelCenterX-(cam.camX-cam.winW/2))*outScale-tile.width/2,(cam.panelCenterY-(cam.camY-cam.winH/2))*outScale-tile.height/2);
        states.push(await (await new Promise(resolve=>stateCanvas.toBlob(resolve,'image/jpeg',.92))).arrayBuffer());
        const sameWorld=scenePage.index===mosaicPrevPageIndex;
        panels.push({displayMode:'mosaic',mosaicImage:sceneMosaicImage,popImage,camFromX:sameWorld&&mosaicPrevCam?mosaicPrevCam.camX:cam.camX,camFromY:sameWorld&&mosaicPrevCam?mosaicPrevCam.camY:cam.camY,camToX:cam.camX,camToY:cam.camY,popCenterX:cam.panelCenterX,popCenterY:cam.panelCenterY,seconds:durations.get(scene.id)??fallbackSeconds,exactVoiceDuration:exactVoiceTiming,fullFrame:false,animatedImage:null,animatedWidth:0,animatedHeight:0,centerX:960,centerY:540,startCenterX:960,zoomMax:1});
        mosaicPrevCam=cam;
        mosaicPrevPageIndex=scenePage.index;
      }else if(fullMode){
        // Full màn hình: panel lấp kín 16:9, ffmpeg sẽ lia camera (pan/zoom nhẹ) — không thẻ, không nền mờ.
        const crop=cropRectOf(scenePage,scene);
        const tile=document.createElement('canvas');tile.width=crop.sw;tile.height=crop.sh;
        tile.getContext('2d').drawImage(scenePage.image,crop.sx,crop.sy,crop.sw,crop.sh,0,0,crop.sw,crop.sh);
        const fullImage=await (await new Promise(resolve=>tile.toBlob(resolve,'image/png'))).arrayBuffer();
        const cover=coverCanvasOf(scenePage,crop);
        const coverJpeg=await (await new Promise(resolve=>cover.toBlob(resolve,'image/jpeg',.92))).arrayBuffer();
        states.push(coverJpeg);
        panels.push({displayMode:'full',fullImage,cropAspect:crop.sw/Math.max(1,crop.sh),seconds:durations.get(scene.id)??fallbackSeconds,exactVoiceDuration:exactVoiceTiming,fullFrame:false,animatedImage:null,animatedWidth:0,animatedHeight:0,centerX:960,centerY:540,startCenterX:960,zoomMax:1});
      }else{
        const placeIndex=hybridMode?(globalSceneIndex.get(scene.id)??panelIndex):panelIndex,placeCount=hybridMode?scenes.length:pageScenes.length;
        const placement=panelPlacement(scenePage,scene,placeIndex,placeCount,display),tile=document.createElement('canvas');
        tile.width=placement.w;tile.height=placement.h;
        const tileCtx=tile.getContext('2d'),cardX=placement.shadow,cardY=placement.shadow,cardW=placement.contentW+placement.pad*2,cardH=placement.contentH+placement.pad*2;
        tileCtx.save();tileCtx.shadowColor='rgba(0,0,0,.58)';tileCtx.shadowBlur=24;tileCtx.shadowOffsetY=10;tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(cardX,cardY,cardW,cardH);tileCtx.restore();
        tileCtx.fillStyle='#fffdf8';tileCtx.fillRect(cardX,cardY,cardW,cardH);
        tileCtx.drawImage(scenePage.image,placement.crop.sx,placement.crop.sy,placement.crop.sw,placement.crop.sh,cardX+placement.pad,cardY+placement.pad,placement.contentW,placement.contentH);
        let animatedImage=null,animatedWidth=0,animatedHeight=0;
        if(!placement.fullFrame){
          const zMax=placement.zMax||1.24;
          animatedWidth=Math.ceil(placement.w*zMax/2)*2;animatedHeight=Math.ceil(placement.h*zMax/2)*2;
          const animatedTile=document.createElement('canvas');animatedTile.width=animatedWidth;animatedTile.height=animatedHeight;
          animatedTile.getContext('2d').drawImage(tile,(animatedWidth-placement.w)/2,(animatedHeight-placement.h)/2);
          const animatedBlob=await new Promise(resolve=>animatedTile.toBlob(resolve,'image/png'));
          animatedImage=await animatedBlob.arrayBuffer();
        }
        panels.push({animatedImage,animatedWidth,animatedHeight,centerX:placement.centerX,centerY:placement.centerY,startCenterX:placement.startCenterX,seconds:durations.get(scene.id)??fallbackSeconds,exactVoiceDuration:exactVoiceTiming,fullFrame:placement.fullFrame,zoomMax:placement.zMax||1.24});
        if(hybridMode){
          hybridCards=appendHybridPanelCard(hybridCards,{image:tile,x:placement.centerX-placement.w/2,y:placement.centerY-placement.h/2},hybridVisiblePanels);
          compositeCtx.clearRect(0,0,1920,1080);compositeCtx.drawImage(hybridBase,0,0);
          for(const card of hybridCards)compositeCtx.drawImage(card.image,card.x,card.y);
        }else compositeCtx.drawImage(tile,placement.centerX-placement.w/2,placement.centerY-placement.h/2);
        const stateBlob=await new Promise(resolve=>composite.toBlob(resolve,'image/jpeg',.96));
        states.push(await stateBlob.arrayBuffer());
      }
      preparedPanels++;
      if(onPrepare)onPrepare(preparedPanels,totalScenes);
    }
    if((fullMode||mosaicMode||stripMode)&&states.length)states.push(states[states.length-1]); // đủ states.length = panels.length + 1 cho validation
    exportPages.push({states,panels});
  }
  return exportPages;
}

// Luồng bản đầu (v6g): đã nạp SRT + chọn giọng mà chưa tạo voice thì bấm
// "Tạo video MP4" sẽ tự tạo voice trước rồi xuất luôn trong cùng 1 lần bấm.
async function ensureVoiceForExport(){
  const v=state.voice;
  if(!v||!v.cues||!v.cues.length)return true; // không có SRT -> xuất không voice như cũ
  const voiceId=currentVoiceId();
  if(!voiceId){toast('Hãy chọn hoặc nhập giọng đọc.');return false;}
  if(v.path&&v.voiceId===voiceId)return true; // đã tạo đúng giọng này -> dùng luôn
  if(isCloneVoiceId(voiceId)){const err=cloneRefError(getCloneRef());if(err){toast(err);return false;}}
  toast('Đang tạo voice trước khi xuất video…');
  voiceRunBegin(v);
  try{
    const result=await window.panelVid.generateVoice(voicePayload(v,voiceId));
    await finishVoiceSuccess(v,voiceId,result);
    return true;
  }catch(error){
    if(error?.code==='CANCELLED'||/Đã dừng tạo voice/.test(error?.message||''))toast('Đã dừng tạo voice. Có thể tiếp tục từ cue còn thiếu.');else{console.error(error);toast(error.message||'Không tạo được voice.');}
    await showVoiceResumeIfFailed();
    return false;
  }finally{voiceRunEnd();}
}
// ===== Chốt chặn lệch tiếng (v6j, semantics v6k) =====
// Trước khi xuất MP4 trực tiếp hoặc đưa chap vào hàng đợi: nếu đang ở chế độ
// "Theo voice SRT" mà mốc [TRANG n] không khớp trang, PHẢI hỏi người dùng thay vì
// im lặng chia đều thời lượng (nguyên nhân video lệch tiếng trước đây).
// - none: cảnh báo lệch, [Vẫn xuất / Vẫn cho vào hàng đợi] hoặc [Hủy].
// - invalid: cảnh báo lệch kèm lý do mốc sai (mốc vượt số trang của chap).
// - partial: nêu tên MỌI trang không có mốc (đầu/giữa/cuối) sẽ bị BỎ khỏi video,
//   [Tiếp tục]/[Hủy] — trang có mốc vẫn khớp tiếng bình thường.
// Trả về {proceed, mode, droppedPageIndices, droppedPageNames}.
async function guardMarkerSync({ forQueue = false } = {}) {
  const none = { proceed: true, mode: null, droppedPageIndices: [], droppedPageNames: [] };
  const v = state.voice;
  // TXT voice durations are bound directly to panels. For sparse page-marked
  // TXT, unmatched scenes are omitted; treating cue page numbers as SRT page
  // segments would incorrectly flag flat chapters as out-of-range markers.
  if(v?.source==='txt')return none;
  if (state.durationMode !== 'voice' && v?.source!=='txt') return none;
  if (!v || !v.cues || !v.cues.length) return none;
  // Ưu tiên pageSegments thật (đã tạo voice); chưa có thì suy từ mốc trong cues.
  const segments = (v.pageSegments && Object.keys(v.pageSegments).length) ? v.pageSegments : markerSegmentsFromCues(v.cues);
  const a = analyzeMarkers(segments, logicalPageCount(state.scenes));
  if (a.mode === 'full') return { proceed: true, mode: 'full', droppedPageIndices: [], droppedPageNames: [] };
  if (a.mode === 'partial') {
    const names = a.droppedPageIndices.map(i => pageForLogicalGroup(i)?.pageGroupName || pageForLogicalGroup(i)?.name || `trang ${i + 1}`);
    const ok = await confirmModal({
      title: 'Trang không có lời đọc',
      message: `TXT/SRT không có lời gắn với các trang sau. Toàn bộ panel thuộc các trang này sẽ bị BỎ khỏi video: ${names.join(', ')}. Tiếp tục?`,
      okLabel: 'Tiếp tục', cancelLabel: 'Hủy',
    });
    return { proceed: ok, mode: 'partial', droppedPageIndices: a.droppedPageIndices, droppedPageNames: names };
  }
  const ok = await confirmModal({
    title: 'Cảnh báo: dễ lệch tiếng',
    message: a.mode === 'invalid'
      ? `${a.reason} Video sẽ chia đều thời gian cho mọi panel và dễ bị LỆCH tiếng. Vẫn tiếp tục?`
      : `${v.source==='txt'?'TXT':'SRT'} không có mốc [TRANG n] khớp với các trang. Video sẽ chia đều thời gian cho mọi panel và dễ bị LỆCH tiếng. Vẫn tiếp tục?`,
    okLabel: forQueue ? 'Vẫn cho vào hàng đợi' : 'Vẫn xuất', cancelLabel: 'Hủy',
  });
  return { proceed: ok, mode: a.mode, droppedPageIndices: [], droppedPageNames: [] };
}

let exportCancelRequested=false;
async function runExportMp4(){
  if(state.busy)return toast('App đang bận, thử lại sau.');
  if(jobsRunning)return toast('Hàng đợi đang render, chờ xong hoặc bấm Dừng.');
  if(!state.scenes.length)return toast('Chưa có cảnh để xuất.');
  if(!isDesktop)return toast('Hãy mở PanelVid Offline trên Windows để xuất MP4 hoàn toàn offline.');
  if(!validPanelScriptBinding())return toast('Số panel hoặc thứ tự panel đã thay đổi so với TXT. Hãy nạp lại file TXT để ghép đúng lời và hình.');
  const voiceReady=await ensureVoiceForExport();
  if(!voiceReady)return;
  const markerGuard=await guardMarkerSync();
  if(!markerGuard.proceed)return;
  exportCancelRequested=false;state.busy=true;$('#export-btn').disabled=true;$('#cancel-export-btn').disabled=false;$('#cancel-export-btn').textContent='Dừng render';$('#progress-modal').classList.remove('hidden');$('#progress-percent').textContent='0%';$('#progress-fill').style.width='0%';
  $('#progress-title').textContent='Đang dựng video';
  const unsubscribe=window.panelVid.onExportProgress(value=>{$('#progress-percent').textContent=`${value}%`;$('#progress-fill').style.width=`${value}%`;});
  try {
    const ready=await window.panelVid.ffmpegReady();if(!ready)throw new Error('Không tìm thấy FFmpeg đi kèm ứng dụng. Hãy cài lại PanelVid Offline.');
    $('#progress-sub').textContent=`Chuẩn bị ${state.scenes.length} cảnh · xử lý tại chỗ…`;
    // v6k: loại hẳn scene của các trang bị bỏ (mode partial) khỏi payload xuất.
    const droppedPages=new Set(markerGuard.droppedPageIndices||[]);
    const txtScenes=state.voice?.source==='txt'?state.scenes.filter(scene=>Number.isInteger(scene.panelScriptIndex)):state.scenes;
    const exportScenes=(droppedPages.size?txtScenes.filter(s=>!droppedPages.has(logicalPageIndex(s))):txtScenes);
    const exportPages=await prepareExportPages(state.pages,exportScenes,getEffectiveDurations(),state.seconds,(done,total)=>{
      const progress=Math.round(done/total*12);
      $('#progress-percent').textContent=`${progress}%`;$('#progress-fill').style.width=`${progress}%`;
    },null,()=>exportCancelRequested);
    if(exportCancelRequested)throw Object.assign(new Error('Đã dừng render theo yêu cầu.'),{code:'CANCELLED'});
    const useVoice=state.durationMode==='voice'&&state.voice&&state.voice.path;
    let subtitles=null;
    const subBuilt=buildExportSubtitles(markerGuard.droppedPageIndices||[]);
    if(subBuilt==='no-srt')toast('Hãy nạp file SRT để hiện phụ đề.');
    else subtitles=subBuilt;
    const result=await window.panelVid.exportVideo({pages:exportPages,quality:state.quality,encoder:state.encoder,workers:state.workers,fps:state.fps,seconds:state.seconds,audioPath:useVoice||null,audioDurationSeconds:state.voice?.duration||0,voiceTimingAnchor:state.voiceTimingAnchor,voiceTimingOffsetSeconds:state.voiceTimingOffsetSeconds,subtitles,comicStyle:state.comicStyle,mangaTransitionIn:state.mangaTransitionIn,mangaTransitionOut:state.mangaTransitionOut});
    if(result.cancelled){$('#progress-modal').classList.add('hidden');toast('Đã dừng render theo yêu cầu.');}
    else {$('#progress-title').textContent='Video đã xuất xong';$('#progress-sub').textContent=result.outputPath+(result.encoder?` · ${result.encoder==='nvenc'?'GPU (NVENC)':'CPU'}`:'')+(result.subtitleWarning?` · ${result.subtitleWarning}`:'');$('#progress-percent').textContent='100%';$('#progress-fill').style.width='100%';setTimeout(()=>{$('#progress-modal').classList.add('hidden');$('#progress-title').textContent='Đang dựng video';},2600);toast('MP4 đã lưu vào máy.');}
  } catch(error){if(error?.code==='CANCELLED'||exportCancelRequested)toast('Đã dừng render theo yêu cầu.');else{console.error(error);toast(error.message||'Không xuất được video.');}$('#progress-modal').classList.add('hidden');}
  finally{unsubscribe?.();state.busy=false;$('#export-btn').disabled=false;$('#cancel-export-btn').disabled=false;$('#cancel-export-btn').textContent='Dừng render';}
}
$('#export-btn').addEventListener('click',()=>{runExportMp4();});
$('#cancel-export-btn').addEventListener('click',async()=>{exportCancelRequested=true;$('#cancel-export-btn').disabled=true;$('#cancel-export-btn').textContent='Đang dừng…';try{await window.panelVid?.cancelRender?.();}catch(err){console.error(err);}});

// ===== GIỌNG ĐỌC (Edge TTS theo SRT) =====
function selectedVoiceKind(){
  return document.querySelector('input[name="voice-kind"]:checked')?.value==='clone'?'clone':'edge';
}
// Voice ID của thẻ clone (v6o): ngôn ngữ Việt -> VieNeu local, còn lại Chatterbox.
function isCloneVoiceId(voiceId){return voiceId==='chatterbox-clone'||voiceId==='vieneu-clone';}
function currentVoiceId(){
  if(selectedVoiceKind()==='clone')return $('#clone-lang').value==='vi'?'vieneu-clone':'chatterbox-clone';
  return resolveVoiceId(selectedVoiceKind(),$('#voice-select').value,$('#voice-custom-id').value);
}
function resetVoiceUI(){
  $('#voice-tag').textContent='CHƯA CÓ';
  $('#voice-gen-btn').innerHTML='<span class="export-icon">♪</span> Tạo voice đọc <span class="arrow">→</span>';
  $('#srt-file-note').textContent='Chưa chọn file SRT.';
  if($('#txt-file-note'))$('#txt-file-note').textContent='TXT: mỗi dòng/đoạn là một panel; thêm [TRANG n] trước lời của từng trang.';
  $('#voice-note').textContent='BAT tự cài mọi thứ lần đầu.';
  $('#voice-progress').classList.add('hidden');
  $('#voice-resume-btn').classList.add('hidden');
  $('#voice-lib-save-chap-btn').classList.add('hidden');
  const prefs=loadUserPreferences();
  const kindRadio=document.querySelector(`input[name="voice-kind"][value="${prefs.voiceKind}"]`);if(kindRadio)kindRadio.checked=true;
  $('#voice-select').value=prefs.edgeVoiceId;$('#voice-custom-id').value=prefs.customVoiceId;$('#clone-lang').value=prefs.cloneLanguage;
  syncVoiceCards();renderCloneRef();
}
function evaluateVoiceSplit(){
  const v=state.voice;
  if(!v||!v.duration)return{ok:false,fallback:false,reason:'Chưa có voice.',mode:'none',droppedPageIndices:[]};
  const a=analyzeMarkers(v.pageSegments,logicalPageCount(state.scenes));
  if(a.mode==='full')return{ok:true,fallback:false,reason:'',mode:'full',droppedPageIndices:[]};
  if(a.mode==='partial')return{ok:true,fallback:false,reason:'',mode:'partial',droppedPageIndices:a.droppedPageIndices};
  return{ok:true,fallback:true,reason:a.reason+' Chia đều tổng thời lượng voice cho tất cả panel.',mode:a.mode,droppedPageIndices:[]};
}
function updateExportNote(){
  const hasVoice=state.durationMode==='voice'&&state.voice&&state.voice.duration;
  $('#export-note').innerHTML=`<span class="lock-small">▣</span> ${hasVoice?'Có voice':'Không voice'} · không nhạc · ${state.fps} fps`;
}
// ===== GIỌNG CLONE CHATTERBOX (v5) =====
const CLONE_REF_KEY='panelvid.cloneRef';
function getCloneRef(){try{return localStorage.getItem(CLONE_REF_KEY)||'';}catch{return '';}}
function setCloneRef(p){try{localStorage.setItem(CLONE_REF_KEY,p||'');}catch{}}
const CLONE_TEST_TEXTS={ja:'こんにちは、これは私の声のテストです。今日も物語を始めましょう。',en:'Hello, this is a test of my cloned voice. Let the story begin.',es:'Hola, esta es una prueba de mi voz clonada. Comencemos la historia.',pt:'Olá, este é um teste da minha voz clonada. Vamos começar a história.',vi:'Xin chào, đây là bản thử giọng clone của tôi. Hãy cùng bắt đầu câu chuyện.'};
let pendingCloneFile=null;
function probeFileDuration(file){
  return new Promise(resolve=>{
    try{
      const url=URL.createObjectURL(file),a=new Audio();
      const done=v=>{URL.revokeObjectURL(url);resolve(Number(v)||0);};
      a.preload='metadata';a.onloadedmetadata=()=>done(a.duration);a.onerror=()=>done(0);a.src=url;
    }catch{resolve(0);}
  });
}
async function renderCloneRef(){
  const r=getCloneRef(),note=$('#clone-ref-note');
  if(!note)return;
  if(!r){note.classList.add('hidden');note.textContent='';return;}
  note.classList.remove('hidden');
  const short=String(r).split(/[\\/]/).pop();
  let dur=0;
  if(pendingCloneFile){dur=await probeFileDuration(pendingCloneFile);pendingCloneFile=null;}
  else if(window.panelVid?.audioInfo){try{const info=await window.panelVid.audioInfo({filePath:r});if(info&&info.exists)dur=Number(info.duration)||0;}catch{}}
  note.textContent=`Đã chọn giọng mẫu: ${short}${dur>0?' · '+dur.toFixed(1)+'s':''}`;
}
async function setCloneRefFile(f){
  if(!f)return;
  // 1) Electron mới: lấy đường dẫn qua webUtils (File.path đã bị bỏ).
  let p='';
  try{if(window.panelVid?.getPathForFile)p=String(window.panelVid.getPathForFile(f)||'');}catch{}
  // 2) Electron cũ: File.path.
  if(!p&&f.path)p=String(f.path);
  // 3) Dự phòng: gửi bytes sang main ghi ra file tạm rồi dùng đường dẫn đó.
  if(!p&&window.panelVid?.saveBlobAudio){
    try{
      const buf=new Uint8Array(await f.arrayBuffer());
      const r=await window.panelVid.saveBlobAudio({name:f.name||'giong-mau.wav',data:buf});
      if(r&&r.ok&&r.path)p=String(r.path);
    }catch{}
  }
  if(!p){toast('Không đọc được file giọng mẫu. Hãy thử nút "Đổi file" để chọn lại.');return;}
  pendingCloneFile=f;setCloneRef(p);renderCloneRef();
  toast('Đã chọn file giọng mẫu.');
}
function isCloneVoiceSelected(){return selectedVoiceKind()==='clone';}
function syncVoiceCards(){
  $('#voice-custom-id').classList.toggle('hidden',$('#voice-select').value!=='__custom__');
  syncCloneLang();
  if(isCloneVoiceSelected()){renderCloneRef();checkCloneNote();}
}
// v6o: thanh Độ biểu cảm chỉ dành cho Chatterbox — đường VieNeu (tiếng Việt)
// khóa lại + đổi câu gợi ý để khỏi hiểu nhầm.
function syncCloneLang(){
  const vi=$('#clone-lang')&&$('#clone-lang').value==='vi';
  const ex=$('#clone-exagg');if(ex)ex.disabled=!!vi;
  const hint=document.querySelector('.clone-exagg-hint');
  if(hint)hint.textContent=vi?'VieNeu không dùng độ biểu cảm — thanh này chỉ áp dụng cho Chatterbox.':'Thấp = êm, ít chói · cao = giàu cảm xúc';
}
const EDGE_VOICE_IDS=['ja-JP-NanamiNeural','ja-JP-KeitaNeural','en-US-JennyNeural','en-US-GuyNeural','en-US-AriaNeural','vi-VN-HoaiMyNeural','vi-VN-NamMinhNeural'];
function selectVoiceCardForId(voiceId){
  if(isCloneVoiceId(voiceId)){
    const radio=document.querySelector('input[name="voice-kind"][value="clone"]');if(radio)radio.checked=true;
    if(voiceId==='vieneu-clone')$('#clone-lang').value='vi';
  }else if(voiceId){
    const radio=document.querySelector('input[name="voice-kind"][value="edge"]');if(radio)radio.checked=true;
    if(EDGE_VOICE_IDS.includes(voiceId))$('#voice-select').value=voiceId;
    else{$('#voice-select').value='__custom__';$('#voice-custom-id').value=voiceId;}
  }
  syncVoiceCards();persistCurrentPreferences();
}
async function checkChatterboxNote(){
  $('#voice-note').textContent='Đang kiểm tra Chatterbox...';
  try{
    const st=await window.panelVid.chatterboxReady?.();
    if(st&&st.ok)$('#voice-note').textContent=st.cuda?'Chatterbox sẵn sàng (GPU). Thả file giọng mẫu, chọn file SRT rồi bấm "Tạo voice từ SRT".':'Chatterbox sẵn sàng (CPU — sẽ chậm). Thả file giọng mẫu, chọn file SRT rồi bấm "Tạo voice từ SRT".';
    else $('#voice-note').textContent='Chưa cài Chatterbox — chạy lại CHAY-PANELVID.bat để tự cài (cần Internet 1 lần).';
  }catch(e){console.error(e);$('#voice-note').textContent='Không kiểm tra được Chatterbox.';}
}
// v6o: ghi chú dưới thẻ clone theo ngôn ngữ đang chọn — Việt thì kiểm tra VieNeu.
async function checkCloneNote(){
  if($('#clone-lang')&&$('#clone-lang').value==='vi'){
    $('#voice-note').textContent='Đang kiểm tra VieNeu...';
    try{
      const st=await window.panelVid.vieneuReady?.();
      if(st&&st.ok)$('#voice-note').textContent='VieNeu sẵn sàng (chạy local). Thả file giọng mẫu, chọn file SRT tiếng Việt rồi bấm "Tạo voice từ SRT".';
      else $('#voice-note').textContent='Chưa cài VieNeu — chạy lại CHAY-PANELVID.bat để tự cài (cần Internet 1 lần).';
    }catch(e){console.error(e);$('#voice-note').textContent='Không kiểm tra được VieNeu.';}
    return;
  }
  checkChatterboxNote();
}
document.querySelectorAll('input[name="voice-kind"]').forEach(r=>r.addEventListener('change',()=>{syncVoiceCards();persistCurrentPreferences();}));
$('#voice-select').addEventListener('change',()=>{syncVoiceCards();persistCurrentPreferences();});
$('#voice-custom-id').addEventListener('change',persistCurrentPreferences);
$('#clone-lang').addEventListener('change',()=>{syncCloneLang();persistCurrentPreferences();if(isCloneVoiceSelected())checkCloneNote();});
$('#clone-drop').addEventListener('click',()=>$('#clone-file-input').click());
$('#clone-change-btn').addEventListener('click',e=>{
  e.preventDefault();
  if(window.panelVid?.pickVoiceRef){
    window.panelVid.pickVoiceRef().then(res=>{
      if(res&&!res.cancelled&&res.refPath){pendingCloneFile=null;setCloneRef(res.refPath);renderCloneRef();toast('Đã chọn file giọng mẫu.');}
    }).catch(err=>{console.error(err);toast(err.message||'Không chọn được file.');});
  }else $('#clone-file-input').click();
});
$('#clone-file-input').addEventListener('change',e=>{
  const f=e.target.files[0];e.target.value='';if(f)setCloneRefFile(f);
});
{
  const drop=$('#clone-drop');
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',e=>{
    e.preventDefault();drop.classList.remove('dragging');
    const f=[...(e.dataTransfer.files||[])].find(x=>/\.(wav|mp3|m4a|flac)$/i.test(x.name));
    if(f)setCloneRefFile(f);else toast('Hãy thả file audio .wav / .mp3 / .flac.');
  });
}
$('#clone-test-btn').addEventListener('click',async e=>{
  e.preventDefault();
  const ref=getCloneRef(),err=cloneRefError(ref);
  if(err){toast(err);return;}
  if(!window.panelVid?.cloneTest){toast('Chức năng nghe thử chỉ chạy trong app desktop.');return;}
  const btn=$('#clone-test-btn');btn.disabled=true;const oldLabel=btn.textContent;btn.textContent='⏳ Đang tạo giọng thử...';
  try{
    const lg=$('#clone-lang').value||'ja',tt=CLONE_TEST_TEXTS[lg]||CLONE_TEST_TEXTS.ja;
    const r=await window.panelVid.cloneTest({refPath:ref,lang:lg,text:tt,exaggeration:currentExaggeration()});
    const audio=new Audio(r.dataUri);await audio.play();
    $('#clone-save-btn').classList.remove('hidden');
    $('#clone-lib-add-btn').classList.remove('hidden');
    toast('Đang phát giọng thử. Bấm "Lưu giọng thử" nếu muốn giữ file.');
  }catch(err2){console.error(err2);toast(err2.message||'Không tạo được giọng thử.');}
  finally{btn.disabled=false;btn.textContent=oldLabel;}
});
$('#clone-save-btn').addEventListener('click',async e=>{
  e.preventDefault();
  if(!window.panelVid?.saveCloneTest){toast('Chức năng lưu chỉ chạy trong app desktop.');return;}
  const btn=$('#clone-save-btn');btn.disabled=true;
  try{
    const r=await window.panelVid.saveCloneTest();
    if(r&&r.ok&&r.path)toast('Đã lưu giọng thử: '+r.path);
    else if(r&&!r.cancelled)toast(r.error||'Không lưu được file.');
  }catch(err2){toast(err2.message||'Không lưu được file.');}
  finally{btn.disabled=false;}
});
// ===== Thư viện giọng (v6d) =====
async function refreshVoiceLib(){
  const listEl=$('#voice-lib-list'),countEl=$('#voice-lib-count');
  if(!listEl)return;
  let entries=[];
  try{ entries=(await window.panelVid?.voiceLibList?.())||[]; }catch(e){ console.error(e); }
  if(countEl)countEl.textContent=entries.length;
  if(!entries.length){
    listEl.innerHTML='<div class="voice-lib-empty">Chưa lưu giọng nào. Sau khi nghe thử bấm "＋ Thư viện", hoặc sau khi tạo voice bấm "Lưu voice chap này".</div>';
    return;
  }
  listEl.innerHTML=entries.map(e=>`
    <div class="voice-lib-item">
      <div class="voice-lib-info"><b>${escapeHtml(e.name)}</b>
        <span class="voice-lib-meta"><i class="voice-lib-badge t-${escapeHtml(e.type)}">${escapeHtml(TYPE_LABELS[e.type]||e.type)}</i> · ${escapeHtml(formatLibSeconds(e.duration))} · ${escapeHtml(formatLibDate(e.createdAt))}</span>
      </div>
      <div class="voice-lib-actions">
        <button class="subtle-btn" data-act="use" data-id="${escapeHtml(e.id)}">Dùng</button>
        <button class="subtle-btn" data-act="del" data-id="${escapeHtml(e.id)}" title="Xóa">🗑</button>
      </div>
    </div>`).join('');
}
async function useLibEntry(id){
  let entries=[];
  try{ entries=(await window.panelVid?.voiceLibList?.())||[]; }catch(e){ console.error(e); }
  const e=entries.find(x=>x.id===id);
  if(!e){toast('Không tìm thấy giọng trong thư viện.');return;}
  if(e.type==='full'){
    const v=state.voice;
    if(!v||!(v.cues||[]).length){toast('Hãy nạp file SRT của chap hiện tại trước.');return;}
    if(!canUseFullEntry(e,v.srtHash)){toast('Voice này tạo từ SRT khác, không dùng được cho chap hiện tại.');return;}
    state.voice={...v,path:e.path,duration:e.duration,pageSegments:e.pageSegments||{},cueStarts:e.cueStarts||[]};
    $('#voice-tag').textContent='ĐÃ TẠO (thư viện)';
    $('#voice-note').textContent=`Voice từ thư viện: ${e.name} · ${formatLibSeconds(e.duration)}.`;
    if(state.durationMode==='voice')renderAll();
    toast('Đã dùng voice từ thư viện.');
  }else{
    const radio=document.querySelector('input[name="voice-kind"][value="clone"]');
    if(radio)radio.checked=true;
    setCloneRef(e.path);renderCloneRef();syncVoiceCards();
    toast('Đã đặt giọng mẫu từ thư viện.');
  }
}
$('#voice-lib-toggle')?.addEventListener('click',()=>{
  const body=$('#voice-lib-body');if(!body)return;
  body.classList.toggle('hidden');
  const arrow=$('#voice-lib-arrow');if(arrow)arrow.textContent=body.classList.contains('hidden')?'▸':'▾';
});
$('#voice-lib-list')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-act]');if(!btn)return;
  const id=btn.getAttribute('data-id');if(!id)return;
  if(btn.getAttribute('data-act')==='use'){await useLibEntry(id);return;}
  if(!window.confirm('Xóa giọng này khỏi thư viện?'))return;
  try{
    const r=await window.panelVid?.voiceLibRemove?.({id});
    if(r&&r.removed){toast('Đã xóa khỏi thư viện.');await refreshVoiceLib();}
    else toast('Không xóa được.');
  }catch(err){console.error(err);toast(err.message||'Không xóa được.');}
});
$('#clone-lib-add-btn')?.addEventListener('click',async e=>{
  e.preventDefault();
  if(!window.panelVid?.voiceLibAdd){toast('Chức năng thư viện chỉ chạy trong app desktop.');return;}
  const lang=$('#clone-lang').value||'ja';
  const name=await promptModal('Tên giọng trong thư viện:',suggestTestName(lang));
  if(name==null)return;
  try{
    const entry=await window.panelVid.voiceLibAdd({name:(name||'').trim()||suggestTestName(lang),type:'test',useLastCloneTest:true,meta:{lang}});
    await refreshVoiceLib();toast(`Đã lưu "${entry.name}" vào thư viện.`);
  }catch(err){console.error(err);toast(err.message||'Không lưu được vào thư viện.');}
});
$('#voice-lib-save-chap-btn')?.addEventListener('click',async e=>{
  e.preventDefault();
  const v=state.voice;
  if(!v||!v.path){toast('Chưa có voice để lưu.');return;}
  if(!window.panelVid?.voiceLibAdd){toast('Chức năng thư viện chỉ chạy trong app desktop.');return;}
  const name=await promptModal('Tên voice trong thư viện:',suggestFullName(v.srtName));
  if(name==null)return;
  try{
    const entry=await window.panelVid.voiceLibAdd({name:(name||'').trim()||suggestFullName(v.srtName),type:'full',srcPath:v.path,
      meta:{srtName:v.srtName,srtHash:v.srtHash,cueCount:(v.cues||[]).length,pageSegments:v.pageSegments||{},cueStarts:v.cueStarts||[],voiceId:v.voiceId}});
    await refreshVoiceLib();toast(`Đã lưu "${entry.name}" vào thư viện.`);
  }catch(err){console.error(err);toast(err.message||'Không lưu được vào thư viện.');}
});
refreshVoiceLib();
renderCloneRef();
// ===== v6i: Độ biểu cảm clone + phụ đề ghi lên video =====
function currentExaggeration(){
  const el=$('#clone-exagg');
  const v=el?Number(el.value):loadCloneExaggeration();
  return Number.isFinite(v)?Math.min(1,Math.max(0,v)):0.4;
}
{
  const exEl=$('#clone-exagg'),exVal=$('#clone-exagg-val');
  if(exEl){
    exEl.value=String(loadCloneExaggeration());
    const sync=()=>{if(exVal)exVal.textContent=Number(exEl.value).toFixed(2);};
    sync();
    exEl.addEventListener('input',()=>{sync();try{localStorage.setItem(CLONE_EXAGG_KEY,exEl.value);}catch{}persistCurrentPreferences();});
  }
}
function currentSubtitleSettings(){
  const s=state.subtitle||{};
  return{enabled:!!s.enabled,fontColor:s.fontColor||'#FFD400',outlineColor:s.outlineColor||'#000000',fontSize:s.fontSize||48};
}
function saveSubtitleSettings(){
  try{
    const s=currentSubtitleSettings();
    localStorage.setItem(SUB_SETTING_KEYS.on,s.enabled?'1':'0');
    localStorage.setItem(SUB_SETTING_KEYS.color,s.fontColor);
    localStorage.setItem(SUB_SETTING_KEYS.outline,s.outlineColor);
    localStorage.setItem(SUB_SETTING_KEYS.size,String(s.fontSize));
  }catch{}
}
function syncSubtitleControls(){
  const s=currentSubtitleSettings();
  const burn=$('#sub-burn');if(burn)burn.checked=s.enabled;
  const box=$('#sub-style');if(box)box.classList.toggle('hidden',!s.enabled);
  const c=$('#sub-color');if(c)c.value=s.fontColor;
  const o=$('#sub-outline');if(o)o.value=s.outlineColor;
  const z=$('#sub-size');if(z)z.value=String(s.fontSize);
  const zv=$('#sub-size-val');if(zv)zv.textContent=String(s.fontSize);
}
{
  const burn=$('#sub-burn'),c=$('#sub-color'),o=$('#sub-outline'),z=$('#sub-size');
  if(burn)burn.addEventListener('change',()=>{state.subtitle.enabled=burn.checked;syncSubtitleControls();saveSubtitleSettings();});
  if(c)c.addEventListener('input',()=>{state.subtitle.fontColor=c.value;saveSubtitleSettings();});
  if(o)o.addEventListener('input',()=>{state.subtitle.outlineColor=o.value;saveSubtitleSettings();});
  if(z)z.addEventListener('input',()=>{state.subtitle.fontSize=Number(z.value);const zv=$('#sub-size-val');if(zv)zv.textContent=z.value;saveSubtitleSettings();});
  syncSubtitleControls();
}
// Dựng payload phụ đề cho lần xuất hiện tại: null = không ghi chữ;
// 'no-srt' = đã bật nhưng chưa nạp SRT (để caller toast nhắc, vẫn xuất không chữ).
function buildExportSubtitles(droppedPageIndices=[]){
  const s=currentSubtitleSettings();
  if(!s.enabled)return null;
  const v=state.voice;
  if(!v||!v.cues||!v.cues.length)return 'no-srt';
  if(!v.path||!Array.isArray(v.cueStarts)||v.cueStarts.length!==v.cues.length)return null;
  const dropped=new Set(droppedPageIndices||[]);
  const cues=[],starts=[];
  v.cues.forEach((cue,index)=>{if(cue.page==null||!dropped.has(cue.page-1)){cues.push(cue);starts.push(v.cueStarts[index]);}});
  const aligned=adjustVoiceTimeline({cueStarts:starts,durationSeconds:v.duration,anchor:state.voiceTimingAnchor,offsetSeconds:state.voiceTimingOffsetSeconds});
  const items=buildSubtitleItems(cues,aligned.cueStarts,aligned.durationSeconds);
  if(!items.length)return null;
  return{items,style:{fontColor:s.fontColor,outlineColor:s.outlineColor,fontSize:s.fontSize}};
}
// v6e: Tự động tạo MP4 sau khi có voice (checkbox trong box GIỌNG ĐỌC).
function isAutoExportOn(){return localStorage.getItem('panelvid.autoExportMp4')!=='0';}
$('#auto-export-mp4').checked=isAutoExportOn();
$('#auto-export-mp4').addEventListener('change',e=>{localStorage.setItem('panelvid.autoExportMp4',e.target.checked?'1':'0');persistCurrentPreferences();});
async function maybeAutoExportMp4(){
  const decision=autoExportDecision({autoExportOn:isAutoExportOn(),hasVoice:!!(state.voice&&state.voice.path&&state.voice.duration),busy:state.busy,isDesktopEnv:isDesktop,sceneCount:state.scenes.length});
  if(!decision.ok){const msg=AUTO_EXPORT_SKIP_MESSAGES[decision.reason];if(msg)toast(msg);return;}
  toast('Voice xong — đang tự động tạo video MP4…');
  await runExportMp4();
}
$('#srt-pick-btn').addEventListener('click',()=>$('#srt-file-input').click());
$('#srt-file-input').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const srtRaw=await file.text();
    const cues=parseSRT(srtRaw);
    if(!cues.length)throw new Error('Không đọc được cue nào trong file SRT.');
    state.scenes.forEach(scene=>{delete scene.panelScriptIndex;});
    const markers=new Set(cues.map(c=>c.page).filter(p=>p!=null));
    state.voice={source:'srt',srtName:file.name,cues,voiceId:currentVoiceId(),path:null,duration:0,pageSegments:{},cueStarts:[],cueDurations:[],srtHash:hashSrt(srtRaw)};
    $('#srt-file-note').textContent=`${file.name} · ${cues.length} cue · ${markers.size} mốc trang${droppedMarkerNote(cues)}`;
    $('#voice-gen-btn').innerHTML='<span class="export-icon">♪</span> Tạo voice từ SRT <span class="arrow">→</span>';
    if($('#txt-file-note'))$('#txt-file-note').textContent='SRT đang hoạt động; chọn TXT để căn từng panel theo voice AI.';
    $('#voice-resume-btn').classList.add('hidden');
    $('#voice-lib-save-chap-btn').classList.add('hidden');
    $('#voice-tag').textContent='CHƯA TẠO';
    $('#voice-note').textContent='Đã nạp SRT. Bấm "Tạo voice từ SRT".';
    toast(`Đã nạp ${cues.length} cue từ SRT.`);
    if(state.durationMode==='voice')renderAll();
  }catch(err){console.error(err);toast(err.message||'Không đọc được file SRT.');}
  e.target.value='';
});
$('#txt-pick-btn').addEventListener('click',()=>$('#txt-file-input').click());
$('#txt-file-input').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const raw=await file.text(),documentTXT=parsePanelScriptDocumentTXT(raw),scriptCues=documentTXT.cues;
    if(!scriptCues.length)throw new Error('File TXT không có nội dung.');
    if(!state.scenes.length)throw new Error('Hãy nhập ảnh và tạo danh sách panel trước khi chọn TXT.');
    const binding=bindPanelScriptToScenes(state.scenes,scriptCues,logicalPageCount(state.scenes),documentTXT.pageMarked);
    if(binding.error)throw new Error(binding.error);
    state.scenes.forEach((scene,index)=>{if(Number.isInteger(binding.bindings[index]))scene.panelScriptIndex=binding.bindings[index];else delete scene.panelScriptIndex;});
    const cues=scriptCues.map((cue,panelIndex)=>({start:0,end:0,text:cue.text,page:documentTXT.pageMarked?cue.page:logicalPageIndex(state.scenes[binding.bindings.indexOf(panelIndex)]||{})+1,panelIndex}));
    state.voice={source:'txt',pageMarked:documentTXT.pageMarked,srtName:file.name,cues,voiceId:currentVoiceId(),path:null,duration:0,pageSegments:{},cueStarts:[],cueDurations:[],srtHash:hashSrt(raw)};
    $('#srt-file-note').textContent='TXT theo panel đang hoạt động.';
    $('#voice-gen-btn').innerHTML='<span class="export-icon">♪</span> Tạo voice theo panel TXT <span class="arrow">→</span>';
    const matchedScenes=state.scenes.filter(scene=>Number.isInteger(scene.panelScriptIndex)).length;
    $('#txt-file-note').textContent=documentTXT.pageMarked?`${file.name} · ${cues.length} đoạn, khớp ${matchedScenes} panel · có mốc trang.`:`${file.name} · ${cues.length} đoạn khớp ${matchedScenes} panel.`;
    $('#voice-resume-btn').classList.add('hidden');$('#voice-lib-save-chap-btn').classList.add('hidden');
    $('#voice-tag').textContent='CHƯA TẠO';$('#voice-note').textContent=`Đã nạp TXT cho ${cues.length} panel. Tạo voice để tự căn thời lượng theo audio AI.`;
    toast(`Đã nạp ${cues.length} đoạn TXT${documentTXT.pageMarked?' theo mốc trang':''}.`);
    if(state.durationMode==='voice')renderAll();
  }catch(err){console.error(err);toast(err.message||'Không đọc được file TXT.');}
  e.target.value='';
});
let voiceProgressUnsub=null;
function hideVoiceResume(){$('#voice-resume-btn').classList.add('hidden');}
function voiceProgressHandler(){
  voiceProgressUnsub=window.panelVid.onVoiceProgress(p=>{
    if(p.note){$('#voice-progress-text').textContent=p.note;return;}
    if(p.retrying!=null){
      $('#voice-progress-text').textContent=`Câu ${p.retrying+1} đang thử lại (lần ${p.attempt}/${p.maxAttempts||4})...`;
    }else{
      $('#voice-progress-text').textContent=`${p.done}/${p.total} cue`;
      $('#voice-progress-fill').style.width=`${p.total?Math.round(p.done/p.total*100):0}%`;
    }
  });
}
async function showVoiceResumeIfFailed(){
  try{
    const info=await window.panelVid.getVoiceFailInfo?.();
    if(info&&info.failedAt!=null){
      $('#voice-resume-label').textContent=`Tiếp tục từ câu ${info.failedAt+1}`;
      $('#voice-resume-btn').classList.remove('hidden');
      return true;
    }
  }catch(e){console.error(e);}
  return false;
}
function voicePayload(v,voiceId){
  const p={cues:v.cues.map(c=>({start:c.start,end:c.end,text:c.text,page:c.page,...(Number.isInteger(c.panelIndex)?{panelIndex:c.panelIndex}:{})})),voice:voiceId};
  if(isCloneVoiceId(voiceId)){p.cloneRef=getCloneRef();p.cloneLang=$('#clone-lang').value||'ja';}
  if(voiceId==='chatterbox-clone'){p.cloneExaggeration=currentExaggeration();}
  return p;
}
async function finishVoiceSuccess(v,voiceId,result){
  state.voice={...v,voiceId,path:result.voicePath,duration:result.duration,pageSegments:result.pageSegments,cueStarts:result.cueStarts||[],cueDurations:result.cueDurations||[]};
  if(v.source==='txt'&&$('#txt-file-note'))$('#txt-file-note').textContent=`${v.srtName} · ${v.cues.length} panel · đã căn theo voice AI (${formatPreciseSeconds(result.duration)}).`;
  // v6e: có voice → chuyển chế độ thời lượng sang "Theo voice SRT" để export theo voice.
  if(state.durationMode!=='voice'){state.durationMode='voice';$('#duration-mode').value='voice';updateDurationControls();}
  $('#voice-tag').textContent='ĐÃ CÓ';
  $('#voice-lib-save-chap-btn').classList.remove('hidden');
  $('#voice-note').textContent=v.source==='txt'?`Voice xong: ${v.cues.length} panel đã căn theo thời lượng audio AI · ${formatPreciseSeconds(result.duration)}.`:`Voice xong: ${v.cues.length} cue · ${formatPreciseSeconds(result.duration)} · ${Object.keys(result.pageSegments||{}).length} mốc trang.`;
  hideVoiceResume();
  const ev=evaluateVoiceSplit();if(ev.fallback)toast(ev.reason);else toast('Đã tạo voice xong.');
  renderAll();
}
async function guardVoiceStart(){
  if(!window.panelVid?.generateVoice){toast('Chức năng voice chỉ chạy trong app desktop.');return null;}
  const v=state.voice;
  if(!v||!v.cues.length){toast('Hãy chọn file SRT hoặc TXT theo panel trước.');return null;}
  const voiceId=currentVoiceId();
  if(!voiceId){toast('Hãy chọn hoặc nhập giọng đọc.');return null;}
  if(isCloneVoiceId(voiceId)){const err=cloneRefError(getCloneRef());if(err){toast(err);return null;}}
  if(state.busy){toast('App đang bận, thử lại sau.');return null;}
  if(jobsRunning){toast('Hàng đợi đang render, chờ xong hoặc bấm Dừng.');return null;}
  return{v,voiceId};
}
function voiceRunBegin(v){
  state.busy=true;$('#voice-gen-btn').disabled=true;$('#voice-resume-btn').disabled=true;
  hideVoiceResume();
  $('#voice-progress').classList.remove('hidden');$('#voice-progress-fill').style.width='0%';$('#voice-progress-text').textContent=`0/${v.cues.length} cue`;
  $('#voice-cancel-btn').disabled=false;$('#voice-cancel-btn').textContent='Dừng tạo voice';
  voiceProgressHandler();
}
function voiceRunEnd(){
  voiceProgressUnsub?.();voiceProgressUnsub=null;state.busy=false;
  $('#voice-gen-btn').disabled=false;$('#voice-resume-btn').disabled=false;
  $('#voice-cancel-btn').disabled=false;$('#voice-cancel-btn').textContent='Dừng tạo voice';$('#voice-progress').classList.add('hidden');
}
$('#voice-cancel-btn').addEventListener('click',async()=>{if($('#voice-cancel-btn').disabled)return;$('#voice-cancel-btn').disabled=true;$('#voice-cancel-btn').textContent='Đang dừng…';try{await window.panelVid.cancelVoice();}catch(err){console.error(err);}});
$('#voice-gen-btn').addEventListener('click',async()=>{
  const g=await guardVoiceStart();if(!g)return;
  const{v,voiceId}=g;
  voiceRunBegin(v);
  let voiceOk=false;
  try{
    const result=await window.panelVid.generateVoice(voicePayload(v,voiceId));
    await finishVoiceSuccess(v,voiceId,result);
    voiceOk=true;
  }catch(error){
    if(error?.code==='CANCELLED'||/Đã dừng tạo voice/.test(error?.message||''))toast('Đã dừng tạo voice. Có thể tiếp tục từ cue còn thiếu.');else{console.error(error);toast(error.message||'Không tạo được voice.');}
    await showVoiceResumeIfFailed();
  }
  finally{voiceRunEnd();}
  if(voiceOk)await maybeAutoExportMp4();
});
$('#voice-resume-btn').addEventListener('click',async()=>{
  const g=await guardVoiceStart();if(!g)return;
  if(!window.panelVid?.resumeVoice){toast('Bản app này chưa hỗ trợ tiếp tục voice.');return;}
  const{v,voiceId}=g;
  voiceRunBegin(v);
  let voiceOk=false;
  try{
    const result=await window.panelVid.resumeVoice(voicePayload(v,voiceId));
    await finishVoiceSuccess(v,voiceId,result);
    voiceOk=true;
  }catch(error){
    if(error?.code==='CANCELLED'||/Đã dừng tạo voice/.test(error?.message||''))toast('Đã dừng voice. Có thể tiếp tục từ cue còn thiếu.');else{console.error(error);toast(error.message||'Không tiếp tục được voice.');}
    await showVoiceResumeIfFailed();
  }
  finally{voiceRunEnd();}
  if(voiceOk)await maybeAutoExportMp4();
});


// ===== HÀNG ĐỢI RENDER — JOBS (v6f) =====
// Luồng: chuẩn bị chap trong workspace (ảnh panel + SRT + giọng) → bấm
// "➕ Đưa vào hàng đợi render" → chap được snapshot thành job độc lập trên đĩa
// (<userData>/render-jobs/<id>/), workspace trống lại ngay. Bộ xử lý chạy nền
// tuần tự từng job: tạo voice (cùng IPC app:tts) → dựng payload bằng
// prepareExportPages với dữ liệu job (KHÔNG dùng state) → xuất MP4 qua
// app:export-to-path (cùng renderChapter với xuất trực tiếp).
const jobs = [];
let jobsVoiceUnsub = null, jobsExportUnsub = null;

function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const JOBS_OUTDIR_KEY='panelvid-jobs-outdir';
function loadJobsOutDir(){try{return localStorage.getItem(JOBS_OUTDIR_KEY)||'';}catch{return '';}}
function saveJobsOutDir(d){try{localStorage.setItem(JOBS_OUTDIR_KEY,d||'');}catch{}}
let jobsOutDir=loadJobsOutDir();

function jobVoiceLabel(job){
  const v=job.voice||{kind:'none'};
  if(v.kind==='clone')return v.lang==='vi'?`Giọng của tôi (VieNeu) · ${(v.cues||[]).length} cue`:`Giọng của tôi (clone) · ${(v.cues||[]).length} cue`;
  if(v.kind==='edge')return `${v.voiceId||'Edge'} · ${(v.cues||[]).length} cue`;
  return 'Không voice · theo cài đặt thời lượng';
}
function formatElapsedTime(ms){
  const total=Math.max(0,Math.floor((Number(ms)||0)/1000)),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),seconds=total%60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}
function jobElapsedMs(job,now=Date.now()){
  return Math.max(0,Number(job.elapsedMs)||0)+(Number(job.runStartedAt)>0?Math.max(0,now-Number(job.runStartedAt)):0);
}
function jobElapsedLabel(job){return job.startedAt?`Đã chạy (voice + render): ${formatElapsedTime(jobElapsedMs(job))}`:'Chưa chạy';}
function refreshJobElapsedLabels(){for(const job of jobs){const el=document.getElementById(`job-elapsed-${job.id}`);if(el)el.textContent=jobElapsedLabel(job);}}
let queueRunStartedAt=0,queueRunElapsedMs=0,queueRunTimer=null;
function renderQueueElapsed(){const el=$('#queue-elapsed');if(!el)return;const ms=queueRunStartedAt?Date.now()-queueRunStartedAt:queueRunElapsedMs;el.textContent=`Đã chạy (voice + render): ${formatElapsedTime(ms)}`;}
function renderJobList(){
  const list=$('#queue-list');
  $('#queue-title').textContent=jobs.length?`${jobs.length} job trong hàng đợi`:'Chưa có job nào trong hàng đợi';
  if(!jobs.length){
    list.innerHTML='<div class="queue-empty">Chưa có job nào. Chuẩn bị chap trong workspace rồi bấm <b>➕ Đưa vào hàng đợi render</b> ở mục ĐẦU RA.</div>';
    return;
  }
  list.innerHTML=jobs.map(job=>{
    const st=JOB_STATUS_TEXT[job.status]||job.status;
    const canDel=job.status!=='voice'&&job.status!=='render';
    const noteText=job.status==='loi'?(job.error||job.note||''):job.note||'';
    const droppedCount=((job.settings||{}).droppedPageIndices||[]).length;
    const droppedNote=droppedCount?` · đã bỏ ${droppedCount} trang không có lời đọc`:'';
    return `<div class="queue-item qstatus-${escapeHtml(job.status)}" data-id="${escapeHtml(job.id)}">
      <div class="queue-item-main"><b>${escapeHtml(job.name)}</b><span class="queue-meta">${(job.pages||[]).length} trang · ${(job.scenes||[]).length} cảnh${droppedNote}</span><span class="queue-badge">${escapeHtml(st)}</span></div>
      <div class="queue-item-srt"><span class="queue-meta">${escapeHtml(jobVoiceLabel(job))}</span></div>
      <div class="queue-item-actions">${canRetryJob(job)?`<button class="subtle-btn" data-action="retry" data-id="${escapeHtml(job.id)}">Thử lại</button>`:''}${canDel?`<button class="small-tool queue-del" data-action="remove" data-id="${escapeHtml(job.id)}" title="Xóa job">✖</button>`:''}</div>
      <div class="queue-note" id="job-note-${escapeHtml(job.id)}"><span class="job-elapsed" id="job-elapsed-${escapeHtml(job.id)}">${escapeHtml(jobElapsedLabel(job))}</span>${noteText?`<br>${escapeHtml(noteText)}`:''}${job.outputPath?`<br>Đã lưu: ${escapeHtml(job.outputPath)}`:''}</div>
    </div>`;
  }).join('');
}
function renderJobNote(job){
  const el=document.getElementById(`job-note-${job.id}`);
  if(!el)return;
  const note=job.status==='loi'?(job.error||job.note||''):job.note||'';
  el.innerHTML=`<span class="job-elapsed" id="job-elapsed-${escapeHtml(job.id)}">${escapeHtml(jobElapsedLabel(job))}</span>${note?`<br>${escapeHtml(note)}`:''}${job.outputPath?`<br>Đã lưu: ${escapeHtml(job.outputPath)}`:''}`;
}
function updateJobButtons(){
  const runBtn=$('#jobs-run-btn'),stopBtn=$('#jobs-stop-btn');
  if(runBtn)runBtn.disabled=jobsRunning||!jobs.some(j=>j.status==='cho');
  if(stopBtn)stopBtn.disabled=!jobsRunning;
  const clearBtn=$('#jobs-clear-btn');
  if(clearBtn)clearBtn.disabled=jobsRunning||jobs.length===0;
}
function kickJobs(){
  if(!jobsRunning&&jobs.some(j=>j.status==='cho'))processJobs();
}

// --- Snapshot chap workspace thành job ---
function currentJobVoiceConfig(sourceVoice=state.voice,voiceIdOverride=null){
  const v=sourceVoice;
  if(!v||!v.cues||!v.cues.length)return{kind:'none'};
    const cues=v.cues.map(c=>({start:c.start,end:c.end,text:c.text,page:c.page,...(Number.isInteger(c.panelIndex)?{panelIndex:c.panelIndex}:{})}));
    if(!voiceIdOverride&&selectedVoiceKind()==='clone'){
      const ref=getCloneRef();
      const err=cloneRefError(ref);
      if(err)return{error:err};
      return{kind:'clone',refPath:ref,lang:$('#clone-lang').value||'ja',exaggeration:currentExaggeration(),cues,srtName:v.srtName,srtHash:v.srtHash,source:v.source||'srt',pageMarked:!!v.pageMarked};
  }
  const voiceId=voiceIdOverride||currentVoiceId();
  if(!voiceId)return{error:'Hãy chọn hoặc nhập giọng đọc.'};
  return{kind:'edge',voiceId,cues,srtName:v.srtName,srtHash:v.srtHash,source:v.source||'srt',pageMarked:!!v.pageMarked};
}
async function enqueueCurrentChapter(){
  if(!isDesktop)return toast('Hãy mở PanelVid Offline trên Windows.');
  if(!window.panelVid?.jobsCreate)return toast('Bản app này chưa hỗ trợ hàng đợi render.');
  if(state.busy)return toast('App đang bận, thử lại sau.');
  if(!state.pages.length||!state.scenes.length||state.status!=='ready')return toast('Chưa có chap nào sẵn sàng. Hãy nạp ảnh panel trước.');
  if(!validPanelScriptBinding())return toast('Số panel hoặc thứ tự panel đã thay đổi so với TXT. Hãy nạp lại file TXT để ghép đúng lời và hình.');
  const voice=currentJobVoiceConfig();
  if(voice.error)return toast(voice.error);
  const verr=validateJobVoice(voice);
  if(verr)return toast(verr);
  // v6k: quyết định mốc trang NGAY lúc enqueue — bộ xử lý nền không hỏi lại.
  const markerGuard=await guardMarkerSync({forQueue:true});
  if(!markerGuard.proceed)return;
  if(!jobsOutDir){
    let pick;
    try{pick=await window.panelVid.pickDir();}catch(e){toast(e.message||'Không chọn được thư mục.');return;}
    if(!pick||pick.cancelled||!pick.dirPath)return;
    jobsOutDir=pick.dirPath;saveJobsOutDir(jobsOutDir);
  }
  const defaultName=String($('#project-name').textContent||'').replace(/\s*\(\d+\s*trang\)\s*$/,'').trim()||'Chap';
  const name=await promptModal('Tên chap trong hàng đợi:',defaultName);
  if(name==null)return;
  const cleanName=String(name).trim()||defaultName;
  const scenesSnap=state.scenes.map(s=>({id:s.id,pageIndex:s.pageIndex,groupIndex:logicalPageIndex(s),crop:{...s.crop},label:s.label,manual:!!s.manual,duration:s.duration??null,fullFrame:!!s.fullFrame,...(Number.isInteger(s.panelScriptIndex)?{panelScriptIndex:s.panelScriptIndex}:{})}));
  const settings={durationMode:state.durationMode,seconds:state.seconds,totalSeconds:state.totalSeconds,pageSeconds:state.pageSeconds,quality:state.quality,fps:state.fps,encoder:state.encoder,workers:state.workers,reading:state.reading,panelDisplayMode:state.panelDisplayMode,panelDisplayScalePct:state.panelDisplayScalePct,comicStyle:state.comicStyle,webtoonWidthPct:state.webtoonWidthPct,voiceTimingAnchor:state.voiceTimingAnchor,voiceTimingOffsetSeconds:state.voiceTimingOffsetSeconds,mangaTransitionIn:state.mangaTransitionIn,mangaTransitionOut:state.mangaTransitionOut,hybridScrollThresholdPx:state.hybridScrollThresholdPx,hybridVisiblePanels:state.hybridVisiblePanels,subtitles:currentSubtitleSettings(),markerMode:markerGuard.mode,droppedPageIndices:markerGuard.droppedPageIndices,droppedPageNames:markerGuard.droppedPageNames};
  const job=makeJobSnapshot({
    name:cleanName,
    pages:state.pages.map(p=>({name:p.name,path:p.path,pageGroupIndex:p.pageGroupIndex,pageGroupName:p.pageGroupName})),
    scenes:scenesSnap,settings,voice,
    outDir:jobsOutDir,fileName:cleanName,
  });
  try{
    await window.panelVid.jobsCreate({job});
    for(let i=0;i<state.pages.length;i++){
      const buf=new Uint8Array(await state.pages[i].blob.arrayBuffer());
      await window.panelVid.jobsSaveImage({jobId:job.id,file:job.pages[i].file,data:buf});
    }
    const saved=await window.panelVid.jobsFinalize({jobId:job.id});
    jobs.push(saved);
    renderJobList();updateJobButtons();
    resetWorkspace();
    toast(`Đã đưa "${saved.name}" vào hàng đợi — nạp chap tiếp theo được rồi.`);
    kickJobs();
  }catch(err){console.error(err);toast(err.message||'Không lưu được job vào hàng đợi.');}
}
$('#enqueue-btn').addEventListener('click',enqueueCurrentChapter);

// --- Bộ xử lý hàng đợi nền (chạy tuần tự, không chạm state workspace) ---
function jobVoicePayload(job){
  const v=job.voice;
  const cues=(v.cues||[]).map(c=>({start:c.start,end:c.end,text:c.text,page:c.page,...(Number.isInteger(c.panelIndex)?{panelIndex:c.panelIndex}:{})}));
  const p={cues,voice:jobSnapshotVoiceId(v)};
  if(v.kind==='clone'){p.cloneRef=v.refPath;p.cloneLang=v.lang||'ja';if(p.voice==='chatterbox-clone')p.cloneExaggeration=(v.exaggeration!=null&&Number.isFinite(Number(v.exaggeration)))?Number(v.exaggeration):currentExaggeration();}
  return p;
}
function jobImageMime(name){
  const ext=String(name||'').split('.').pop().toLowerCase();
  if(ext==='png')return 'image/png';
  if(ext==='webp')return 'image/webp';
  if(ext==='bmp')return 'image/bmp';
  return 'image/jpeg';
}
async function loadJobPages(job){
  const pages=[];
  for(let i=0;i<job.pages.length;i++){
    const pf=job.pages[i];
    const data=await window.panelVid.jobsReadImage({jobId:job.id,file:pf.file});
    const blob=new Blob([data],{type:jobImageMime(pf.name||pf.file)});
    const url=URL.createObjectURL(blob),image=new Image();
    image.src=url;await image.decode();
    pages.push({name:pf.name,path:pf.path||pf.name,url,image,index:i,blob,pageGroupIndex:Number.isInteger(pf.pageGroupIndex)?pf.pageGroupIndex:(job.scenes.find(scene=>scene.pageIndex===i)?.groupIndex??i),pageGroupName:pf.pageGroupName||pf.name});
  }
  return pages;
}
function releaseJobPages(pages){
  (pages||[]).forEach(p=>{try{URL.revokeObjectURL(p.url);}catch{}});
}
async function processJobRender(job,voiceResult,onPct){
  // Không đụng state, nhưng tránh 2 lần render chồng nhau: chờ workspace rảnh.
  while(state.busy&&!jobsStop)await new Promise(r=>setTimeout(r,800));
  if(jobsStop)throw new Error('Đã dừng theo yêu cầu.');
  jobsRenderActiveId=job.id;
  const pages=await loadJobPages(job);
  try{
    const st=job.settings||{};
    const pageCount=logicalPageCount(job.scenes);
    const dur=jobDurations({scenes:job.scenes,settings:st,pageCount,voiceResult});
    if(dur.fallback&&dur.reason)job.note=dur.reason;
    // v6k: loại hẳn scene của các trang không có mốc (đã quyết ở lúc enqueue,
    // jobDurations tính lại cùng kết quả từ pageSegments thật của voice).
    const droppedPages=new Set(dur.droppedPageIndices||[]);
    const txtScenes=job.voice?.source==='txt'?job.scenes.filter(scene=>Number.isInteger(scene.panelScriptIndex)):job.scenes;
    const renderScenes=job.voice?.source==='txt'?txtScenes:(droppedPages.size?txtScenes.filter(s=>!droppedPages.has(logicalPageIndex(s))):txtScenes);
    // CÙNG hàm dựng payload với xuất trực tiếp, chỉ khác nguồn dữ liệu + display từ snapshot.
    // Queued jobs created by older app builds may not carry comicStyle or
    // hybrid width settings. In that case inherit the saved/current preference
    // instead of silently falling back to Manga cards on every batch chapter.
    const display={mode:st.panelDisplayMode||state.panelDisplayMode||'card',scalePct:Number(st.panelDisplayScalePct)||state.panelDisplayScalePct||140,comicStyle:resolveJobComicStyle(st,loadComicStyle()||state.comicStyle),webtoonWidthPct:Number(st.webtoonWidthPct)||state.webtoonWidthPct||100,mangaTransitionIn:normalizeMangaTransition(st.mangaTransitionIn,state.mangaTransitionIn||'none'),mangaTransitionOut:normalizeMangaTransition(st.mangaTransitionOut,state.mangaTransitionOut||'slide-right'),hybridScrollThresholdPx:Number(st.hybridScrollThresholdPx)||state.hybridScrollThresholdPx,hybridVisiblePanels:Number(st.hybridVisiblePanels)||state.hybridVisiblePanels,exactVoiceTiming:job.voice?.source==='txt'};
    const exportPages=await prepareExportPages(pages,renderScenes,dur.map,Number(st.seconds)||4,(done,total)=>{
      if(onPct)onPct(Math.round(done/Math.max(1,total)*12));
    },display,()=>jobsStop);
    if(jobsStop)throw Object.assign(new Error('Đã dừng render theo yêu cầu.'),{code:'CANCELLED'});
    const audioPath=voiceResult&&voiceResult.voicePath?voiceResult.voicePath:null;
    // Phụ đề (v6i): chỉ khi snapshot bật + job có voice kèm cueStarts từ bước tạo voice.
    let subtitles=null;
    const subCfg=st.subtitles;
    if(subCfg&&subCfg.enabled&&voiceResult&&Array.isArray(voiceResult.cueStarts)&&((job.voice&&job.voice.cues)||[]).length){
      const selectedCues=job.voice.cues.filter(cue=>cue.page==null||!droppedPages.has(cue.page-1));
      const selectedStarts=voiceResult.cueStarts.filter((_,index)=>{const cue=job.voice.cues[index];return cue.page==null||!droppedPages.has(cue.page-1);});
      const corrected=adjustVoiceTimeline({cueStarts:selectedStarts,durationSeconds:voiceResult.duration,anchor:st.voiceTimingAnchor,offsetSeconds:st.voiceTimingOffsetSeconds});
      const items=buildSubtitleItems(selectedCues,corrected.cueStarts,corrected.durationSeconds);
      if(items.length)subtitles={items,style:{fontColor:subCfg.fontColor||'#FFD400',outlineColor:subCfg.outlineColor||'#000000',fontSize:subCfg.fontSize||48}};
    }
    const res=await window.panelVid.exportToPath({pages:exportPages,quality:st.quality||'balanced',encoder:st.encoder||'auto',workers:st.workers||2,fps:Number(st.fps)||60,seconds:Number(st.seconds)||4,audioPath,audioDurationSeconds:Number(voiceResult?.duration)||0,voiceTimingAnchor:normalizeVoiceTiming(st.voiceTimingAnchor,'start').anchor,voiceTimingOffsetSeconds:normalizeVoiceTiming(st.voiceTimingAnchor,st.voiceTimingOffsetSeconds).offsetSeconds,subtitles,comicStyle:display.comicStyle,mangaTransitionIn:display.mangaTransitionIn,mangaTransitionOut:display.mangaTransitionOut,outDir:job.outDir,fileName:job.fileName});
    if(res?.cancelled)throw Object.assign(new Error('Đã dừng render theo yêu cầu.'),{code:'CANCELLED'});
    if(res&&res.subtitleWarning)toast(`Job "${job.name}": ${res.subtitleWarning}`);
    return res;
  }finally{
    releaseJobPages(pages);
    jobsRenderActiveId=null;
  }
}
async function processJobs(){
  if(jobsRunning)return;
  if(!isDesktop)return toast('Hãy mở PanelVid Offline trên Windows để render.');
  if(!window.panelVid?.generateVoice||!window.panelVid?.exportToPath)return toast('Bản app này chưa hỗ trợ hàng đợi render.');
  let ready=false;
  try{ready=await window.panelVid.ffmpegReady();}catch{}
  if(!ready)return toast('Không tìm thấy FFmpeg đi kèm ứng dụng.');
  jobsRunning=true;jobsStop=false;queueRunElapsedMs=0;queueRunStartedAt=Date.now();renderQueueElapsed();refreshJobElapsedLabels();
  if(queueRunTimer)clearInterval(queueRunTimer);
  queueRunTimer=setInterval(()=>{renderQueueElapsed();refreshJobElapsedLabels();},1000);
  updateJobButtons();
  jobsVoiceUnsub=window.panelVid.onVoiceProgress(p=>{
    const job=jobs.find(j=>j.id===jobsVoiceActiveId);
    if(!job||job.status!=='voice')return;
    if(p.note)job.note=p.note;
    else if(p.retrying!=null)job.note=`Câu ${p.retrying+1} đang thử lại (lần ${p.attempt}/${p.maxAttempts||4})...`;
    else if(p.done!=null)job.note=`Đang tạo voice: ${p.done}/${p.total||(job.voice.cues||[]).length} cue`;
    renderJobNote(job);
  });
  jobsExportUnsub=window.panelVid.onExportProgress(p=>{
    const job=jobs.find(j=>j.id===jobsRenderActiveId);
    if(!job||job.status!=='render')return;
    job.note=`Đang render: ${p}%`;
    renderJobNote(job);
  });
  let completedStats=null;
  try{
    const stats=await runJobQueue(jobs,{
      generateVoice:async(job)=>{
        jobsVoiceActiveId=job.id;
        try{return await window.panelVid.generateVoice(jobVoicePayload(job));}
        finally{if(jobsVoiceActiveId===job.id)jobsVoiceActiveId=null;}
      },
      renderJob:(job,voiceResult,onPct)=>processJobRender(job,voiceResult,onPct),
      persist:(job)=>window.panelVid.jobsUpdate({job}),
      onJob:()=>{renderJobList();updateJobButtons();},
      onNote:(job)=>renderJobNote(job),
      shouldStop:()=>jobsStop,
    });
    completedStats=stats;
    if(stats.total)toast(`Hàng đợi xong: ${stats.done} job thành công, ${stats.error} lỗi${stats.stopped?' · đã dừng':''}.`);
  }catch(err){console.error(err);toast(err.message||'Lỗi khi chạy hàng đợi.');}
  finally{
    jobsVoiceUnsub&&jobsVoiceUnsub();jobsExportUnsub&&jobsExportUnsub();
    jobsVoiceUnsub=jobsExportUnsub=null;jobsVoiceActiveId=jobsRenderActiveId=null;
    queueRunElapsedMs=queueRunStartedAt?Date.now()-queueRunStartedAt:queueRunElapsedMs;queueRunStartedAt=0;
    if(queueRunTimer)clearInterval(queueRunTimer);queueRunTimer=null;renderQueueElapsed();refreshJobElapsedLabels();
    jobsRunning=false;jobsStop=false;
    updateJobButtons();renderJobList();
  }
  return completedStats;
}
$('#jobs-clear-btn').addEventListener('click',async()=>{
  if(jobsRunning)return toast('Hãy dừng hàng đợi trước khi xóa toàn bộ.');
  if(!jobs.length)return toast('Hàng đợi đang trống.');
  const ok=window.confirm(`Xóa toàn bộ ${jobs.length} job khỏi hàng đợi? File MP4 đã render sẽ được giữ nguyên.`);
  if(!ok)return;
  const snapshot=[...jobs];let removed=0;const failures=[];
  for(const job of snapshot){
    if(job.status==='voice'||job.status==='render'){failures.push(job.name);continue;}
    try{await window.panelVid.jobsRemove({jobId:job.id});const index=jobs.findIndex(item=>item.id===job.id);if(index>=0)jobs.splice(index,1);removed++;}
    catch(err){console.error(err);failures.push(job.name);}
  }
  renderJobList();updateJobButtons();
  if(failures.length)toast(`Đã xóa ${removed} job; chưa xóa được ${failures.length} job${failures.length===1?` (${failures[0]})`:''}.`);
  else toast(`Đã xóa ${removed} job khỏi hàng đợi. File MP4 đã render vẫn được giữ nguyên.`);
});
$('#jobs-run-btn').addEventListener('click',()=>{
  if(jobsRunning)return;
  if(!jobs.some(j=>j.status==='cho'))return toast('Không có job nào đang chờ.');
  processJobs();
});
$('#jobs-stop-btn').addEventListener('click',async()=>{jobsStop=true;toast('Đang dừng tác vụ hiện tại…');try{await Promise.all([window.panelVid?.cancelVoice?.(),window.panelVid?.cancelRender?.()]);}catch(err){console.error(err);}});
$('#jobs-dir-btn').addEventListener('click',async()=>{
  if(!window.panelVid?.pickDir)return toast('Bản app này chưa hỗ trợ chọn thư mục.');
  let pick;
  try{pick=await window.panelVid.pickDir();}catch(e){toast(e.message||'Không chọn được thư mục.');return;}
  if(!pick||pick.cancelled||!pick.dirPath)return;
  jobsOutDir=pick.dirPath;saveJobsOutDir(jobsOutDir);
  toast(`Thư mục xuất mặc định cho job mới: ${jobsOutDir}`);
});
let batchImageItems = [];
let batchSubtitleItems = [];
let batchManifest = null;
let batchProcessing = false;
const batchImageExtensions = /\.(?:jpe?g|png|webp|bmp)$/i;

function batchRefreshSourceStatus(message=''){
  const parts=[];
  if(batchImageItems.length)parts.push(`${batchImageItems.length} ảnh panel (${batchImageItems[0].sourceLabel||'đã chọn'})`);
  if(batchSubtitleItems.length)parts.push(`${batchSubtitleItems.length} TXT/SRT (${batchSubtitleItems[0].rootLabel||'đã chọn'})`);
  parts.push(`Thư mục xuất: ${jobsOutDir||'chưa chọn'}`);
  $('#batch-source-status').textContent=message||parts.join(' · ')||'Chọn ZIP hoặc folder gồm các folder chapter ảnh, rồi chọn folder phụ đề tương ứng.';
  $('#batch-scan-btn').disabled=!batchImageItems.length||!batchSubtitleItems.length||batchProcessing;
}
function batchSubtitleLabel(sub){return `${sub.name}${sub.path&&sub.path!==sub.name?` · ${sub.path}`:''}`;}
function batchTryAutoScan(){if(!batchImageItems.length||!batchSubtitleItems.length)return;batchManifest=buildBatchManifest(batchImageItems,batchSubtitleItems,naturalCompare);renderBatchPreview();batchRefreshSourceStatus(`Đã tự ghép ${batchManifest.chapters.length} chapter với ${batchManifest.subtitles.length} TXT/SRT theo tên tự nhiên và thứ tự.`);}
function batchParseChapter(chapter,subtitle){
  if(!subtitle)return{error:'Chưa ghép file TXT/SRT.'};
  const pageGrouping=groupPanelItemsByPage(chapter.images,{baseFolder:chapter.folderPath||'',compare:naturalCompare});
  const pages=chapter.images.map((item,index)=>{const pageGroupIndex=pageGrouping.groupIndexByPath.get(String(item.path||item.name))??index;return{name:item.name,path:item.path,index,blob:item.blob,pageGroupIndex,pageGroupName:pageGrouping.groups[pageGroupIndex]?.name||item.name};});
  const scenes=scenesFromPanelImages(pages,()=>`batch-${crypto.randomUUID()}`);
  const raw=String(subtitle.rawText||'');
  if(subtitle.type==='txt'){
    const doc=parsePanelScriptDocumentTXT(raw);
    if(!doc.cues.length)return{error:'TXT không có nội dung.'};
    const binding=bindPanelScriptToScenes(scenes,doc.cues,logicalPageCount(scenes),doc.pageMarked);
    if(binding.error)return{error:binding.error};
    scenes.forEach((scene,index)=>{if(Number.isInteger(binding.bindings[index]))scene.panelScriptIndex=binding.bindings[index];});
    const cues=doc.cues.map((cue,panelIndex)=>({start:0,end:0,text:cue.text,page:doc.pageMarked?cue.page:logicalPageIndex(scenes[binding.bindings.indexOf(panelIndex)]||{})+1,panelIndex}));
    return{pages,scenes,sourceVoice:{source:'txt',pageMarked:doc.pageMarked,srtName:subtitle.name,cues,voiceId:currentVoiceId(),path:null,duration:0,pageSegments:{},cueStarts:[],cueDurations:[],srtHash:hashSrt(raw)}};
  }
  const cues=parseSRT(raw);
  if(!cues.length)return{error:'Không đọc được cue nào trong SRT.'};
  const markers=new Set(cues.map(cue=>cue.page).filter(page=>page!=null));
  return{pages,scenes,sourceVoice:{source:'srt',srtName:subtitle.name,cues,voiceId:currentVoiceId(),path:null,duration:0,pageSegments:{},cueStarts:[],cueDurations:[],srtHash:hashSrt(raw),markerCount:markers.size}};
}
function batchCueCount(sub){if(!sub)return 0;return sub.type==='txt'?parsePanelScriptDocumentTXT(sub.rawText||'').cues.length:parseSRT(sub.rawText||'').length;}
function renderBatchPreview(){
  const preview=$('#batch-preview'),body=$('#batch-table-body'),summary=$('#batch-preview-summary'),runBtn=$('#batch-run-btn');
  if(!batchManifest){preview.classList.add('hidden');runBtn.disabled=true;return;}
  preview.classList.remove('hidden');
  const {chapters,subtitles}=batchManifest;
  const assignments=validateBatchAssignments(chapters,subtitles),rowResults=[];
  body.innerHTML=chapters.map(chapter=>{
    const assignmentError=assignments.errors.get(chapter.key);
    const sub=subtitles.find(item=>item.id===chapter.subtitleId);
    const parsed=assignmentError?{error:assignmentError}:batchParseChapter(chapter,sub);
    rowResults.push({chapter,error:parsed.error||''});
    const options=[`<option value="">— Chọn subtitle —</option>`,...subtitles.map(item=>`<option value="${escapeHtml(item.id)}" ${item.id===chapter.subtitleId?'selected':''}>${escapeHtml(batchSubtitleLabel(item))}</option>`)].join('');
    const cueCount=batchCueCount(sub),countText=sub?`${chapter.images.length} panel · ${cueCount} cue/dòng`:`${chapter.images.length} panel · chưa có file`;
    const status=parsed.error?`<span class="batch-status-error">${escapeHtml(parsed.error)}</span>`:`<span class="batch-status-ok">Sẵn sàng · ${countText}</span>`;
    return `<tr><td><b>${escapeHtml(chapter.name)}</b><small>${escapeHtml(chapter.folderPath||'Ảnh ở thư mục gốc')}</small></td><td>${escapeHtml(countText)}</td><td><select data-batch-chapter="${escapeHtml(chapter.key)}">${options}</select></td><td>${status}</td></tr>`;
  }).join('');
  const ready=rowResults.filter(item=>!item.error).length;
  summary.textContent=`${chapters.length} chapter · ${ready} sẵn sàng · ${chapters.length-ready} cần sửa/ghép · ${subtitles.length} TXT/SRT. Ghép theo tên và thứ tự tự nhiên.`;
  runBtn.disabled=!assignments.ready||rowResults.some(item=>item.error)||!jobsOutDir||batchProcessing||jobsRunning||!isDesktop;
  runBtn.textContent=!jobsOutDir?'Chọn folder xuất trước':(batchProcessing?'Đang tạo job…':`▶ Tạo & render ${chapters.length} video`);
}
function batchSelectSubtitle(chapterKey,subtitleId){
  const chapter=batchManifest?.chapters.find(item=>item.key===chapterKey);if(!chapter)return;
  chapter.subtitleId=subtitleId||null;renderBatchPreview();
}
$('#batch-zip-btn').addEventListener('click',()=>$('#batch-zip-input').click());
$('#batch-folder-btn').addEventListener('click',()=>$('#batch-folder-input').click());
$('#batch-subs-btn').addEventListener('click',()=>$('#batch-subs-input').click());
$('#batch-subs-zip-btn').addEventListener('click',()=>$('#batch-subs-zip-input').click());
function currentBatchVoiceId(){const select=$('#batch-voice-select');return select.value==='__custom__'?$('#batch-voice-custom').value.trim():select.value;}
$('#batch-voice-select').addEventListener('change',e=>$('#batch-voice-custom').classList.toggle('hidden',e.target.value!=='__custom__'));
$('#batch-zip-input').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
    batchRefreshSourceStatus('Đang đọc ZIP chapter…');batchImageItems=[];
    const zip=await JSZip.loadAsync(file),paths=Object.keys(zip.files).filter(name=>!zip.files[name].dir&&batchImageExtensions.test(name)).sort(naturalCompare);
    for(const entryPath of paths){
      const blob=await zip.files[entryPath].async('blob');
      batchImageItems.push({name:entryPath.split('/').at(-1),path:entryPath,blob,sourceLabel:file.name});
    }
    batchManifest=null;$('#batch-preview').classList.add('hidden');
    if(!batchImageItems.length)throw new Error('ZIP không có ảnh JPG, PNG, WebP hoặc BMP.');
    batchRefreshSourceStatus(`Đã đọc ${file.name}: ${batchImageItems.length} ảnh.`);batchTryAutoScan();
  }catch(err){console.error(err);batchImageItems=[];batchRefreshSourceStatus(`Lỗi đọc ZIP: ${err.message||err}`);}
});
$('#batch-folder-input').addEventListener('change',e=>{
  const files=[...e.target.files||[]];e.target.value='';
  batchImageItems=files.filter(file=>batchImageExtensions.test(file.webkitRelativePath||file.name)).map(file=>({name:file.name,path:file.webkitRelativePath||file.name,blob:file,sourceLabel:'folder chapter'}));
  batchManifest=null;$('#batch-preview').classList.add('hidden');
  batchRefreshSourceStatus(batchImageItems.length?`Đã chọn ${batchImageItems.length} ảnh từ folder.`:'Folder không có ảnh JPG, PNG, WebP hoặc BMP.');batchTryAutoScan();
});
$('#batch-subs-zip-input').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  batchSubtitleItems=[];batchManifest=null;$('#batch-preview').classList.add('hidden');
  try{
    batchRefreshSourceStatus(`Đang đọc ZIP TXT/SRT ${file.name}…`);
    batchSubtitleItems=await readSubtitleZip(file);
    batchRefreshSourceStatus(`Đã đọc ${batchSubtitleItems.length} file TXT/SRT từ ${file.name}.`);batchTryAutoScan();
  }catch(err){console.error(err);batchSubtitleItems=[];batchManifest=null;batchRefreshSourceStatus(`Lỗi đọc ZIP TXT/SRT: ${err.message||err}`);}
});
$('#batch-subs-input').addEventListener('change',async e=>{
  const files=[...e.target.files||[]].filter(file=>/\.(?:txt|srt)$/i.test(file.name));e.target.value='';
  batchSubtitleItems=[];
  for(let i=0;i<files.length;i++){
    const file=files[i],path=file.webkitRelativePath||file.name;
    batchSubtitleItems.push({id:`sub-${i}-${path}`,name:file.name,path,type:/\.txt$/i.test(file.name)?'txt':'srt',rawText:await file.text(),file,rootLabel:'folder subtitle'});
  }
  batchManifest=null;$('#batch-preview').classList.add('hidden');
  batchRefreshSourceStatus(batchSubtitleItems.length?`Đã đọc ${batchSubtitleItems.length} file TXT/SRT.`:'Folder không có file .txt hoặc .srt.');batchTryAutoScan();
});
$('#batch-scan-btn').addEventListener('click',()=>{
  if(!batchImageItems.length||!batchSubtitleItems.length)return;
  batchManifest=buildBatchManifest(batchImageItems,batchSubtitleItems,naturalCompare);
  renderBatchPreview();
  if(!batchManifest.chapters.length)batchRefreshSourceStatus('Không tìm thấy folder chapter có ảnh panel.');
});
$('#batch-table-body').addEventListener('change',e=>{
  const select=e.target.closest('[data-batch-chapter]');if(select)batchSelectSubtitle(select.dataset.batchChapter,select.value);
});
$('#batch-outdir-btn').addEventListener('click',async()=>{
  if(!window.panelVid?.pickDir)return toast('Chọn folder xuất chỉ chạy trong app desktop.');
  try{const pick=await window.panelVid.pickDir();if(!pick||pick.cancelled||!pick.dirPath)return;jobsOutDir=pick.dirPath;saveJobsOutDir(jobsOutDir);batchRefreshSourceStatus();renderBatchPreview();}
  catch(err){toast(err.message||'Không chọn được folder xuất.');}
});
async function createBatchChapterJob(chapter,parsed,fileName){
  const batchVoiceId=currentBatchVoiceId();if(!batchVoiceId)throw new Error('Hãy chọn hoặc nhập Voice ID cho batch.');
  const voice=currentJobVoiceConfig(parsed.sourceVoice,batchVoiceId);
  if(voice.error)throw new Error(voice.error);
  const voiceError=validateJobVoice(voice);if(voiceError)throw new Error(voiceError);
  const scenesSnap=parsed.scenes.map(scene=>({id:scene.id,pageIndex:scene.pageIndex,groupIndex:logicalPageIndex(scene),crop:{...scene.crop},label:scene.label,manual:!!scene.manual,duration:scene.duration??null,fullFrame:!!scene.fullFrame,...(Number.isInteger(scene.panelScriptIndex)?{panelScriptIndex:scene.panelScriptIndex}:{})}));
  const settings={durationMode:state.durationMode,seconds:state.seconds,totalSeconds:state.totalSeconds,pageSeconds:state.pageSeconds,quality:state.quality,fps:state.fps,encoder:state.encoder,workers:state.workers,reading:state.reading,panelDisplayMode:state.panelDisplayMode,panelDisplayScalePct:state.panelDisplayScalePct,comicStyle:state.comicStyle,webtoonWidthPct:state.webtoonWidthPct,voiceTimingAnchor:state.voiceTimingAnchor,voiceTimingOffsetSeconds:state.voiceTimingOffsetSeconds,mangaTransitionIn:state.mangaTransitionIn,mangaTransitionOut:state.mangaTransitionOut,hybridScrollThresholdPx:state.hybridScrollThresholdPx,hybridVisiblePanels:state.hybridVisiblePanels,subtitles:currentSubtitleSettings(),markerMode:'batch-auto',droppedPageIndices:[],droppedPageNames:[]};
  const job=makeJobSnapshot({name:chapter.name,pages:parsed.pages.map(page=>({name:page.name,path:page.path,pageGroupIndex:page.pageGroupIndex,pageGroupName:page.pageGroupName})),scenes:scenesSnap,settings,voice,outDir:jobsOutDir,fileName});
  await window.panelVid.jobsCreate({job});
  try{
    for(let i=0;i<parsed.pages.length;i++){
      const buf=new Uint8Array(await parsed.pages[i].blob.arrayBuffer());
      await window.panelVid.jobsSaveImage({jobId:job.id,file:job.pages[i].file,data:buf});
    }
    const saved=await window.panelVid.jobsFinalize({jobId:job.id});jobs.push(saved);return saved;
  }catch(err){try{await window.panelVid.jobsRemove({jobId:job.id});}catch{}throw err;}
}
async function uniqueBatchFileName(baseName){
  const base=sanitizeJobFileName(baseName)||'Chap';let candidate=base,index=2;
  while(true){
    const file=`${candidate.toLowerCase().endsWith('.mp4')?candidate:candidate+'.mp4'}`.toLowerCase();
    const queued=jobs.some(job=>String(job.outDir||'').toLowerCase()===String(jobsOutDir).toLowerCase()&&String(job.fileName||'').toLowerCase()===file);
    const separator=/\\/.test(jobsOutDir)?'\\':'/';
    const exists=!queued&&window.panelVid?.fileExists?await window.panelVid.fileExists({filePath:`${jobsOutDir.replace(/[\\/]+$/,'')}${separator}${file}`}):false;
    if(!queued&&!exists)return candidate;
    candidate=`${base} (${index++})`;
  }
}
async function autoConcatBatchJobs(jobIds,baseName){
  const files=(jobIds||[]).map(id=>jobs.find(job=>job.id===id)).filter(job=>job?.status==='xong'&&job.outputPath).map(job=>job.outputPath);
  if(files.length<2){toast(files.length===1?'Chỉ có 1 chap render thành công; giữ nguyên MP4 riêng, không cần nối.':'Không có đủ MP4 render thành công để tự nối.');return;}
  if(!window.panelVid?.concatVideos){toast('Bản app này chưa hỗ trợ tự nối video; các MP4 riêng vẫn được giữ nguyên.');return;}
  const base=String(baseName||'batch-noi.mp4').replace(/\.mp4$/i,'')||'batch-noi';
  const fileName=await uniqueBatchFileName(base);
  let unsubscribe=null;
  try{
    unsubscribe=window.panelVid.onConcatProgress?.(pct=>{const status=$('#batch-source-status');if(status)status.textContent=`Đang nối ${files.length} MP4 sau batch: ${Math.round(Number(pct)||0)}%…`;});
    batchRefreshSourceStatus(`Đang nối ${files.length} video sau khi render batch xong…`);
    const result=await window.panelVid.concatVideos({files,outDir:jobsOutDir,fileName});
    toast(`Đã nối ${files.length} video (${result.mode==='fast'?'ghép stream, không encode lại':'chuẩn hóa/encode CPU'}): ${result.outputPath}`);
    $('#batch-source-status').textContent=`Đã nối ${files.length} MP4: ${result.outputPath}`;
  }catch(err){console.error(err);toast(`Không nối được video batch: ${err.message||err}. Các MP4 chapter riêng vẫn được giữ.`);}
  finally{unsubscribe?.();}
}
$('#batch-run-btn').addEventListener('click',async()=>{
  if(!isDesktop)return toast('Render batch cần chạy trong PanelVid Offline trên Windows.');
  if(batchProcessing||jobsRunning)return;
  const assignments=validateBatchAssignments(batchManifest?.chapters,batchManifest?.subtitles);
  if(!assignments.ready)return toast('Hãy ghép một file TXT/SRT duy nhất cho mỗi chapter.');
  if(!currentBatchVoiceId())return toast('Hãy nhập Voice ID tùy ý hoặc chọn một giọng Edge AI.');
  if(!jobsOutDir){$('#batch-outdir-btn').click();return;}
  const autoConcat=$('#batch-auto-concat').checked;
  const concatName=$('#batch-concat-name').value.trim()||'batch-noi.mp4';
  batchProcessing=true;renderBatchPreview();
  let added=0;const errors=[],batchJobIds=[],totalChapters=batchManifest.chapters.length;
  const nameCounts=new Map();
  for(const chapter of batchManifest.chapters){const key=chapter.name.toLowerCase();nameCounts.set(key,(nameCounts.get(key)||0)+1);}
  try{
    for(let i=0;i<batchManifest.chapters.length;i++){
      const chapter=batchManifest.chapters[i],sub=batchManifest.subtitles.find(item=>item.id===chapter.subtitleId);
      batchRefreshSourceStatus(`Đang chuẩn bị job ${i+1}/${batchManifest.chapters.length}: ${chapter.name}…`);
      try{
        const parsed=batchParseChapter(chapter,sub);if(parsed.error)throw new Error(parsed.error);
        const parent=chapter.folderPath.split('/').at(-2)||'';
        const proposedName=nameCounts.get(chapter.name.toLowerCase())>1&&parent?`${parent} - ${chapter.name}`:chapter.name;
        const fileName=await uniqueBatchFileName(proposedName);
        const created=await createBatchChapterJob(chapter,parsed,fileName);batchJobIds.push(created.id);added++;
      }catch(err){console.error(err);errors.push(`${chapter.name}: ${err.message||err}`);}
    }
  }finally{batchProcessing=false;renderJobList();updateJobButtons();}
  const summary=`Đã thêm ${added}/${totalChapters} job vào hàng đợi${errors.length?` · ${errors.length} lỗi chuẩn bị`:''}.`;
  const statusMessage=errors.length?`${summary} ${errors.slice(0,3).join(' | ')}`:summary;
  batchImageItems=[];batchSubtitleItems=[];batchManifest=null;$('#batch-preview').classList.add('hidden');batchRefreshSourceStatus(summary);
  $('#batch-source-status').textContent=statusMessage;
  if(added){toast(errors.length?`${summary} ${errors[0]}`:summary);const stats=await processJobs();if(autoConcat&&stats&&!stats.stopped)await autoConcatBatchJobs(batchJobIds,concatName);}
  else toast(errors[0]||'Không tạo được job nào.');
});

$('#queue-list').addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const id=b.dataset.id;
  const job=jobs.find(j=>j.id===id);if(!job)return;
  if(b.dataset.action==='remove'){
    if(job.status==='voice'||job.status==='render')return toast('Job đang chạy, bấm Dừng trước.');
    if(!window.confirm(`Xóa job "${job.name}" khỏi hàng đợi? (file MP4 đã render vẫn giữ nguyên)`))return;
    try{await window.panelVid.jobsRemove({jobId:id});}catch(err){console.error(err);toast(err.message||'Không xóa được job.');return;}
    const i=jobs.findIndex(j=>j.id===id);if(i>=0)jobs.splice(i,1);
    renderJobList();updateJobButtons();
    toast('Đã xóa job khỏi hàng đợi.');
  }else if(b.dataset.action==='retry'){
    job.status='cho';job.note='';job.error=null;job.outputPath=null;
    try{await window.panelVid.jobsUpdate({job});}catch(err){console.error(err);}
    renderJobList();updateJobButtons();
    kickJobs();
  }
});

// Nạp lại jobs từ đĩa khi khởi động. Job dở dang đã được main đánh dấu lỗi gián
// đoạn; job 'cho' của phiên trước giữ nguyên, bấm "Chạy hàng đợi" để chạy tiếp.
async function loadJobs(){
  if(!isDesktop||!window.panelVid?.jobsList){renderJobList();updateJobButtons();return;}
  try{
    const list=await window.panelVid.jobsList();
    jobs.length=0;
    for(const j of (list||[]))jobs.push(j);
  }catch(e){console.error(e);}
  renderJobList();updateJobButtons();
}
loadJobs();

// ===== NỐI VIDEO (v4) =====
const concatFiles=[]; // {path, name, ok, duration, width, height, fps, vcodec, acodec, hasAudio, error}
let concatOutDir='',concatRunning=false;

function fmtDur(s){
  s=Math.max(0,Math.round(Number(s)||0));
  const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;
  return (h?h+':':'')+String(m).padStart(h?2:1,'0')+':'+String(sec).padStart(2,'0');
}
function renderConcat(){
  const list=$('#concat-list');
  if(!concatFiles.length){
    list.innerHTML='<div class="queue-empty">Chưa có video nào. Bấm <b>＋ Thêm video</b> để chọn nhiều file MP4 một lúc.</div>';
    $('#concat-total').textContent='';
    return;
  }
  list.innerHTML=concatFiles.map(f=>{
    const res=(f.width&&f.height)?`${f.width}×${f.height}`:'?';
    const resCls=(f.width===1920&&f.height===1080)?'':' res-warn';
    const aud=f.hasAudio?'🔊':'🔇';
    return `<div class="queue-item" data-id="${escapeHtml(f.path)}">
      <div class="queue-item-main"><b>${escapeHtml(f.name)}</b><span class="queue-meta">${fmtDur(f.duration)} · <span class="${resCls.trim()}">${res}</span> · ${Math.round(f.fps||0)}fps ${aud}</span></div>
      <div class="queue-item-srt"></div>
      <div class="queue-item-actions"><button class="small-tool" data-action="up" title="Lên">▲</button><button class="small-tool" data-action="down" title="Xuống">▼</button><button class="small-tool queue-del" data-action="remove" title="Xóa">✖</button></div>
    </div>`;
  }).join('');
  const total=concatFiles.reduce((s,f)=>s+(f.duration||0),0);
  $('#concat-total').textContent=`${concatFiles.length} video · tổng ${fmtDur(total)}`;
}
function updateConcatButtons(){
  $('#concat-run-btn').disabled=concatRunning||concatFiles.length<2;
  $('#concat-pick-btn').disabled=concatRunning;
}
function addProbedVideos(infos){
  let added=0,skipped=0;
  for(const info of infos||[]){
    if(!info.ok){toast(`Bỏ qua ${info.name}: ${info.error||'không đọc được'}`);continue;}
    if(concatFiles.some(f=>f.path===info.path)){skipped++;continue;}
    concatFiles.push(info);added++;
  }
  renderConcat();updateConcatButtons();
  toast(`Đã thêm ${added} video.${skipped?` ${skipped} video đã có trong danh sách.`:''}`);
}
$('#concat-pick-btn').addEventListener('click',async()=>{
  if(concatRunning)return;
  if(!isDesktop){toast('Hãy mở PanelVid Offline trên Windows để nối video.');return;}
  if(!window.panelVid?.pickVideoFiles){toast('Bản app này chưa hỗ trợ nối video.');return;}
  let pick;
  try{pick=await window.panelVid.pickVideoFiles();}catch(err){toast(err.message||'Không chọn được file.');return;}
  if(!pick||pick.cancelled||!pick.files||!pick.files.length)return;
  let probe;
  try{probe=await window.panelVid.probeFiles({files:pick.files});}catch(err){toast(err.message||'Không đọc được thông tin video.');return;}
  addProbedVideos(probe.infos);
});
// Thêm tất cả MP4 của job đã render xong (v6f): theo đúng thứ tự hàng đợi.
$('#concat-add-jobs-btn').addEventListener('click',async()=>{
  if(concatRunning)return;
  if(!isDesktop){toast('Hãy mở PanelVid Offline trên Windows để nối video.');return;}
  if(!window.panelVid?.probeFiles){toast('Bản app này chưa hỗ trợ nối video.');return;}
  const paths=jobs.filter(j=>j.status==='xong'&&j.outputPath).map(j=>j.outputPath).filter(p=>!concatFiles.some(f=>f.path===p));
  if(!paths.length)return toast('Không có video nào mới từ hàng đợi (cần job render xong).');
  let probe;
  try{probe=await window.panelVid.probeFiles({files:paths});}catch(err){toast(err.message||'Không đọc được thông tin video.');return;}
  addProbedVideos(probe.infos);
});
$('#concat-list').addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  if(concatRunning){toast('Đang nối video, không sửa được.');return;}
  const row=e.target.closest('.queue-item');if(!row)return;
  const id=row.dataset.id;
  const i=concatFiles.findIndex(f=>f.path===id);if(i<0)return;
  const action=b.dataset.action;
  if(action==='remove'){concatFiles.splice(i,1);}
  else if(action==='up'&&i>0){const[t]=concatFiles.splice(i,1);concatFiles.splice(i-1,0,t);}
  else if(action==='down'&&i<concatFiles.length-1){const[t]=concatFiles.splice(i,1);concatFiles.splice(i+1,0,t);}
  else return;
  renderConcat();updateConcatButtons();
});
$('#concat-dir-btn').addEventListener('click',async()=>{
  if(!window.panelVid?.pickDir){toast('Bản app này chưa hỗ trợ chọn thư mục.');return;}
  let pick;
  try{pick=await window.panelVid.pickDir();}catch(err){toast(err.message||'Không chọn được thư mục.');return;}
  if(!pick||pick.cancelled||!pick.dirPath)return;
  concatOutDir=pick.dirPath;
  try{localStorage.setItem('panelvid-concat-dir',concatOutDir);}catch{}
  toast(`Thư mục lưu: ${concatOutDir}`);
});
$('#concat-run-btn').addEventListener('click',async()=>{
  if(concatRunning||concatFiles.length<2){toast('Cần ít nhất 2 video để nối.');return;}
  if(!isDesktop){toast('Hãy mở PanelVid Offline trên Windows để nối video.');return;}
  if(!window.panelVid?.concatVideos){toast('Bản app này chưa hỗ trợ nối video.');return;}
  if(!concatOutDir){
    try{concatOutDir=localStorage.getItem('panelvid-concat-dir')||'';}catch{}
  }
  if(!concatOutDir){
    let pick;
    try{pick=await window.panelVid.pickDir();}catch(err){toast(err.message||'Không chọn được thư mục.');return;}
    if(!pick||pick.cancelled||!pick.dirPath)return;
    concatOutDir=pick.dirPath;
    try{localStorage.setItem('panelvid-concat-dir',concatOutDir);}catch{}
  }
  let fileName=$('#concat-name').value.trim()||'video-noi.mp4';
  concatRunning=true;updateConcatButtons();
  $('#concat-result').classList.add('hidden');
  $('#concat-progress-track').classList.remove('hidden');
  $('#concat-progress-fill').style.width='0%';
  const unsub=window.panelVid.onConcatProgress(p=>{
    $('#concat-progress-fill').style.width=`${Math.min(99,p)}%`;
  });
  try{
    const res=await window.panelVid.concatVideos({files:concatFiles.map(f=>f.path),outDir:concatOutDir,fileName});
    $('#concat-progress-fill').style.width='100%';
    const mode=res.mode==='fast'?'nối nhanh (không giảm chất lượng)':'chuẩn hóa về 1920×1080';
    $('#concat-result').classList.remove('hidden');
    $('#concat-result').innerHTML=`✅ Đã lưu tại: <span class="queue-outdir">${escapeHtml(res.outputPath)}</span><br><span class="queue-meta">Chế độ: ${mode}</span>`;
    toast('Nối video xong.');
  }catch(err){console.error(err);toast(err.message||'Lỗi khi nối video.');}
  finally{
    unsub&&unsub();
    concatRunning=false;updateConcatButtons();
    setTimeout(()=>$('#concat-progress-track').classList.add('hidden'),1500);
  }
});
renderConcat();updateConcatButtons();

renderAll();
