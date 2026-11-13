import './style.css';
import { filterPanelBoxes, resolveMinPanelAreaPct } from './panel-detector-core.js';
import { MAX_MIN_GAP_PX, computeRowProfile, sliceStripProfile, splitLongSegments, stripSegmentCrop } from './strip-slicer.js';
import { joinStripProfiles, mapStripCropToSources, mapStripCropToSourceRegions } from './strip-document.js';
import { mangaPanelPath, stripPanelPath } from './output-layout.js';
import { moveMangaPanel, reindexPanelPaths } from './result-editing.js';
import { combineSourceRegions, makeMergeIdentityKey, makeSplitIdentityKeys, sourceIdentityKey, splitSourceRegions, createProjectMetadata, validateManifest } from './manifest-core.js';

// Mức chất lượng JPEG cân bằng dung lượng và độ rõ nét của nét vẽ truyện.
// Canvas bỏ qua tham số này với PNG, nên PNG vẫn được mã hóa lossless.
const JPEG_OUTPUT_QUALITY = 0.82;

const root = document.querySelector('#app');
root.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-mark"><span class="mark-cut"></span><span class="mark-cut"></span><span class="mark-cut"></span></div>
      <div class="brand-copy"><strong>PANEL<span>CUTTER</span></strong><small>OFFLINE PANEL TOOL</small></div>
      <div class="privacy"><i></i> Ảnh xử lý trên máy bạn</div>
    </header>

    <main>
      <section class="hero">
        <div class="hero-copy"><div class="eyebrow">CHỈ CẮT PANEL · KHÔNG TẠO VIDEO</div><h1>Tách khung truyện,<br><em>gọn thành ảnh.</em></h1><p>Chọn chap, chỉnh độ nhạy khe màu, cắt để xem trước và gộp panel nếu cần. Chỉ ghi ảnh ra folder sau khi bạn bấm Lưu.</p></div>
        <div class="hero-steps"><div><b>01</b><span>Chọn nguồn</span></div><i></i><div><b>02</b><span>Chọn kiểu</span></div><i></i><div><b>03</b><span>Cắt &amp; xem</span></div><i></i><div><b>04</b><span>Lưu</span></div></div>
      </section>

      <section class="panel source-panel">
        <div class="section-heading"><div class="section-index">01</div><div><h2>Chọn ảnh truyện</h2><p>Chọn file nén hoặc thư mục có các trang truyện.</p></div></div>
        <div class="source-actions"><button class="source-button primary" id="archive-btn"><span class="source-icon">▧</span><span><b>Chọn file truyện</b><small>ZIP · CBZ · RAR · CBR</small></span><span class="arrow">→</span></button><button class="source-button" id="folder-btn"><span class="source-icon folder-icon">▱</span><span><b>Chọn folder ảnh</b><small>Quét cả thư mục con</small></span><span class="arrow">→</span></button></div>
        <div class="source-summary hidden" id="source-summary"><div class="summary-icon">✓</div><div class="summary-copy"><b id="source-name">Chưa chọn nguồn</b><span id="source-meta">0 ảnh</span></div><button class="text-button" id="change-source">Đổi nguồn</button></div>
        <div class="file-list hidden" id="file-list"></div>
        <p class="privacy-note">Hỗ trợ JPG, PNG, WebP và BMP. Tên file được sắp theo thứ tự tự nhiên (1, 2, 10…).</p>
      </section>

      <section class="panel style-panel">
        <div class="section-heading"><div class="section-index">02</div><div><h2>Chọn kiểu cắt</h2><p>Detector phù hợp với bố cục từng loại truyện.</p></div></div>
        <div class="style-options" role="group" aria-label="Kiểu truyện">
          <button class="style-option" data-style="manga" type="button"><span class="radio"></span><span class="style-name">Manga <small>Nhật</small></span><span class="style-desc">Nhận diện panel bằng model ONNX.</span><span class="style-code">M</span></button>
          <button class="style-option" data-style="manhwa" type="button"><span class="radio"></span><span class="style-name">Manhwa <small>Hàn</small></span><span class="style-desc">Ghép trang trước, chỉ cắt tại dải ngang đồng màu toàn chiều rộng.</span><span class="style-code">H</span></button>
          <button class="style-option" data-style="manhua" type="button"><span class="radio"></span><span class="style-name">Manhua <small>Trung</small></span><span class="style-desc">Ghép trang trước, chỉ cắt tại dải ngang đồng màu toàn chiều rộng.</span><span class="style-code">C</span></button>
        </div>
        <div class="manga-order hidden" id="manga-order"><label for="reading-order">Thứ tự panel Manga</label><select id="reading-order"><option value="rtl" selected>Phải sang trái (mặc định)</option><option value="ltr">Trái sang phải</option></select><span>Áp dụng khi sắp thứ tự panel trong từng trang.</span></div>
        <div class="strip-settings hidden" id="strip-settings"><div class="settings-title"><b>Điều kiện dải phân cách</b><span>Áp dụng cho Manhwa/Manhua · nhận mọi màu, không lọc theo độ sáng.</span></div><label class="range-setting"><span><b>Độ dày khe tối thiểu</b><output id="min-gap-output">Tự động</output></span><input id="min-gap-input" type="range" min="0" max="1000" step="1" value="0"><small>Nhận dải đồng màu toàn chiều ngang; mỗi hàng khe trắng chịu tối đa 0,5% pixel nhiễu. 0 = tự động nhạy hơn; khe mỏng vẫn bỏ sót thì thử 1–10 px.</small></label><label class="range-setting"><span><b>Chia panel dài cho video 16:9</b><input id="split-long-input" type="checkbox" checked></span><small>Panel cao hơn ~1700px (ở dải 728px) tự chia thành mảnh ≤1284px, lên khung 16:9 rộng ≥612px để đọc rõ trên điện thoại. Tắt nếu muốn giữ nguyên panel dài, vẫn chia tay bằng nút Chia trong preview.</small></label></div>
      </section>

      <section class="panel output-panel">
        <div class="section-heading"><div class="section-index">03</div><div><h2>Cắt trước, lưu sau</h2><p>Kết quả được giữ tạm để xem và gộp panel; folder đầu ra chỉ tạo khi bạn bấm Lưu.</p></div></div>
        <div class="width-setting"><label class="width-check"><input id="uniform-width-input" type="checkbox" checked><b>Đồng nhất độ rộng ảnh đầu ra</b></label><label class="width-px">Rộng <input id="output-width-input" type="number" min="0" max="8000" step="1" value="0"> px</label><small>Tất cả ảnh xuất ra có cùng chiều rộng, chiều cao tự co theo tỉ lệ (không méo). Để 0 = tự lấy theo ảnh rộng nhất trong chap; nhập số (vd 728 hoặc 1080) để cố định.</small></div>
        <div class="layout-choice" role="group" aria-label="Cách sắp xếp folder đầu ra"><b>Cách sắp xếp folder đầu ra</b><label><input type="radio" name="output-layout" value="preserve" checked><span><strong>Tách theo folder gốc</strong><small>Giữ nguyên cây thư mục chap/trang của nguồn.</small></span></label><label><input type="radio" name="output-layout" value="flat"><span><strong>Gộp chung một folder</strong><small>Đưa tất cả panel vào cùng một folder, tên file có tiền tố để tránh trùng.</small></span></label></div>
        <div class="output-row"><div class="output-icon">↳</div><div class="output-copy"><b id="output-path">Chưa tạo folder kết quả</b><span id="output-shape">Sau khi kiểm tra panel, chọn nơi lưu. Ảnh nguồn không bị sửa.</span></div></div>
      </section>

      <section class="start-row"><div><b>Sẵn sàng xử lý?</b><span>Panel được cắt vào vùng tạm trước; bạn xem/gộp rồi mới lưu ra folder.</span></div><button class="start-button" id="start-btn" disabled><span class="start-symbol">▶</span> Bắt đầu cắt</button></section>

      <section class="progress-panel hidden" id="progress-panel"><div class="progress-head"><div><b id="progress-title">Đang chuẩn bị</b><span id="progress-detail">Đang xử lý ảnh trên máy…</span></div><strong id="progress-percent">0%</strong></div><div class="progress-track"><i id="progress-bar"></i></div></section>
      <div class="error-box hidden" id="error-box"></div>

      <section class="results-panel hidden" id="results-panel"><div class="results-head"><div><div class="eyebrow">BƯỚC 04 · XEM VÀ LƯU</div><h2 id="results-title">Panel đã cắt</h2><p id="results-detail"></p></div><div class="results-actions"><button class="save-output" id="save-output">Lưu ảnh đã cắt…</button><button class="open-folder hidden" id="open-folder">Mở folder kết quả ↗</button></div></div><div class="preview-grid" id="preview-grid"></div><div class="preview-more"><p class="preview-caption" id="preview-caption"></p><button class="more-panels hidden" id="show-more-btn">Hiện thêm panel</button></div></section>
      <div class="image-viewer hidden" id="image-viewer" role="dialog" aria-modal="true" aria-label="Ảnh panel phóng to" tabindex="-1"><button class="image-viewer-backdrop" id="image-viewer-backdrop" type="button" aria-label="Đóng ảnh"></button><div class="image-viewer-panel"><div class="image-viewer-toolbar"><span id="image-viewer-caption">Panel</span><button class="image-viewer-close" id="image-viewer-close" type="button" aria-label="Đóng ảnh">Đóng <b>×</b></button></div><img class="image-viewer-image" id="image-viewer-image" alt="Panel phóng to"></div></div>
      <div class="manual-split hidden" id="manual-split" role="dialog" aria-modal="true" aria-label="Tách panel thủ công">
        <button class="manual-split-backdrop" id="manual-split-backdrop" type="button" aria-label="Hủy tách panel"></button>
        <section class="manual-split-panel">
          <header class="manual-split-toolbar"><div><b id="manual-split-title">Tách panel thủ công</b><span id="manual-split-caption"></span></div><button class="manual-split-close" id="manual-split-close" type="button" aria-label="Đóng">×</button></header>
          <p class="manual-split-help">Kéo đường ngang hoặc chỉnh thanh trượt để đặt điểm chia. Hai phần được giữ ở vùng tạm cho đến khi bạn bấm Lưu.</p>
          <div class="manual-split-stage" id="manual-split-stage"><div class="manual-split-frame" id="manual-split-frame"><img id="manual-split-image" alt="Panel đang chia"><div class="manual-split-guide" id="manual-split-guide" aria-hidden="true"></div></div></div>
          <label class="manual-split-position" for="manual-split-range"><span>Vị trí đường cắt</span><input id="manual-split-range" type="range" min="1" max="1000" step="1" value="500"><output id="manual-split-output">500 px</output></label>
          <p class="manual-split-error" id="manual-split-error" aria-live="polite"></p>
          <div class="manual-split-actions"><button class="manual-split-cancel" id="manual-split-cancel" type="button">Hủy</button><button class="manual-split-confirm" id="manual-split-confirm" type="button">Chia thành 2 panel</button></div>
        </section>
      </div>
      <footer><span>PANELCUTTER OFFLINE</span><span>Không sửa file nguồn · Không upload ảnh</span></footer>
    </main>
  </div>`;

const $ = (selector) => document.querySelector(selector);
const savedSliceSettings = (() => { try { return JSON.parse(localStorage.getItem('panelcutter-slice-settings') || '{}'); } catch { return {}; } })();
const state = { projectIdentity: null, outputLayout: 'preserve', chapters: [], activeIndices: null, chapterPrefix: '', token: null, sourceName: '', sourceType: '', count: 0, files: [], defaultOutputParent: '', style: '', reading: 'rtl', busy: false, saved: false, outputDir: '', worker: null, workerReady: null, requestId: 0, pending: new Map(), previewUrls: [], results: [], previewCount: 0, sliceOptions: { minGapPx: Math.min(MAX_MIN_GAP_PX, Math.max(0, Math.round(Number(savedSliceSettings.minGapPx) || 0))), splitLongPanels: savedSliceSettings.splitLongPanels !== false, uniformWidth: savedSliceSettings.uniformWidth !== false, outputWidth: Math.min(8000, Math.max(0, Math.round(Number(savedSliceSettings.outputWidth) || 0))) } };
const api = window.panelCutter;
let manualSplitState = null;

function showError(error) { const box = $('#error-box'); box.textContent = error?.message || String(error); box.classList.remove('hidden'); }
function clearError() { $('#error-box').classList.add('hidden'); $('#error-box').textContent = ''; }
function setProgress(percent, title, detail) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  $('#progress-panel').classList.remove('hidden');
  $('#progress-title').textContent = title;
  $('#progress-detail').textContent = detail;
  $('#progress-percent').textContent = `${p}%`;
  $('#progress-bar').style.width = `${p}%`;
}
function pad(n, width = 4) { return String(n).padStart(width, '0'); }
function outputTypeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? { mime: 'image/jpeg', ext: 'jpg' } : { mime: 'image/png', ext: 'png' };
}

async function acceptInput(result) {
  if (!result || result.canceled) return;
  closeImageViewer(); closeManualSplit();
  state.token = result.token;
  state.projectIdentity = await api.getProjectIdentity({ token: result.token });
  state.sourceName = result.sourceName;
  state.sourceType = result.sourceType;
  state.count = result.count;
  state.chapters = result.chapters || []; state.activeIndices = null; state.chapterPrefix = '';
  state.files = result.files || [];
  state.defaultOutputParent = result.defaultOutputParent;
  state.outputDir = ''; state.saved = false; state.results = []; state.previewCount = 0;
  clearPreviewUrls(); $('#preview-grid').innerHTML = '';
  $('#source-name').textContent = result.sourceName;
  $('#source-meta').textContent = `${result.count.toLocaleString()} ảnh · ${result.sourceType}`;
  $('#source-summary').classList.remove('hidden');
  $('.source-actions').classList.add('hidden');
  const list = $('#file-list');
  list.innerHTML = '';
  for (const item of state.files.slice(0, 12)) {
    const row = document.createElement('div'); row.className = 'file-row';
    const index = document.createElement('span'); index.textContent = pad(item.index + 1, 3);
    const name = document.createElement('span'); name.textContent = item.relativePath;
    row.append(index, name); list.append(row);
  }
  if (result.moreFiles) {
    const more = document.createElement('div'); more.className = 'file-more'; more.textContent = `+ ${result.moreFiles.toLocaleString()} ảnh nữa`;
    list.append(more);
  }
  list.classList.toggle('hidden', !result.count);
  $('#output-path').textContent = 'Chưa tạo folder kết quả';
  $('#start-btn').disabled = !state.style || !state.count;
  $('#results-panel').classList.add('hidden');
  $('#progress-panel').classList.add('hidden');
  $('#save-output').disabled = false; $('#save-output').textContent = 'Lưu ảnh đã cắt…'; $('#open-folder').classList.add('hidden');
  clearError();
}

$('#archive-btn').addEventListener('click', async () => { try { await acceptInput(await api.pickArchive()); } catch (e) { showError(e); } });
$('#folder-btn').addEventListener('click', async () => { try { await acceptInput(await api.pickFolder()); } catch (e) { showError(e); } });
$('#change-source').addEventListener('click', () => { clearPreviewUrls(); $('#preview-grid').innerHTML = ''; $('#source-summary').classList.add('hidden'); $('.source-actions').classList.remove('hidden'); $('#file-list').classList.add('hidden'); state.token = null; state.count = 0; state.files = []; state.results = []; state.saved = false; $('#start-btn').disabled = true; $('#results-panel').classList.add('hidden'); $('#progress-panel').classList.add('hidden'); $('#output-path').textContent = 'Chưa tạo folder kết quả'; });

document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-style]').forEach(item => item.classList.toggle('selected', item === button));
  state.style = button.dataset.style;
  $('#manga-order').classList.toggle('hidden', state.style !== 'manga');
  $('#strip-settings').classList.toggle('hidden', state.style === 'manga');
  if (!state.busy) { $('#results-panel').classList.add('hidden'); $('#progress-panel').classList.add('hidden'); }
  $('#output-shape').textContent = state.style === 'manga' ? 'Manga: folder riêng cho từng trang · Manhwa/Manhua: một folder panel' : 'Một folder chứa các panel theo thứ tự từ trên xuống dưới.';
  $('#start-btn').disabled = !state.token || !state.count || state.busy;
}));
$('#reading-order').addEventListener('change', (event) => { state.reading = event.target.value; });
document.querySelectorAll('input[name="output-layout"]').forEach(input => input.addEventListener('change', event => { state.outputLayout = event.target.value === 'flat' ? 'flat' : 'preserve'; }));
function refreshSliceSettings() {
  $('#min-gap-output').textContent = state.sliceOptions.minGapPx ? `${state.sliceOptions.minGapPx} px` : 'Tự động';
  $('#split-long-input').checked = state.sliceOptions.splitLongPanels !== false;
  localStorage.setItem('panelcutter-slice-settings', JSON.stringify(state.sliceOptions));
}
$('#min-gap-input').value = String(state.sliceOptions.minGapPx);
$('#min-gap-input').addEventListener('input', event => { state.sliceOptions.minGapPx = Number(event.target.value); refreshSliceSettings(); });
$('#split-long-input').checked = state.sliceOptions.splitLongPanels !== false;
$('#split-long-input').addEventListener('change', event => { state.sliceOptions.splitLongPanels = event.target.checked; refreshSliceSettings(); });
$('#uniform-width-input').checked = state.sliceOptions.uniformWidth !== false;
$('#output-width-input').value = String(state.sliceOptions.outputWidth || 0);
$('#output-width-input').disabled = state.sliceOptions.uniformWidth === false;
$('#uniform-width-input').addEventListener('change', event => { state.sliceOptions.uniformWidth = event.target.checked; $('#output-width-input').disabled = !event.target.checked; refreshSliceSettings(); });
$('#output-width-input').addEventListener('change', event => { state.sliceOptions.outputWidth = Math.min(8000, Math.max(0, Math.round(Number(event.target.value) || 0))); event.target.value = String(state.sliceOptions.outputWidth); refreshSliceSettings(); });
refreshSliceSettings();

// UNIFORM-WIDTH: chiều rộng đích. 0 = tự động (ảnh rộng nhất). Trả về 0 nếu tắt.
function uniformTargetWidth(autoWidth) {
  if (state.sliceOptions.uniformWidth === false) return 0;
  const fixed = Math.round(Number(state.sliceOptions.outputWidth) || 0);
  return fixed > 0 ? fixed : Math.max(0, Math.round(autoWidth || 0));
}
function scaledCanvasSize(w, h, targetWidth) {
  if (!(targetWidth > 0) || w === targetWidth) return { w, h };
  return { w: targetWidth, h: Math.max(1, Math.round(h * targetWidth / w)) };
}

async function loadImage(index) {
  const actualIndex = state.activeIndices ? state.activeIndices[index] : index;
  const result = await api.readImage({ token: state.token, index: actualIndex });
  return { image: await createImageBitmap(new Blob([result.data])), name: result.name, relativePath: result.relativePath, sourceIndex: actualIndex, sourceFingerprint: result.sourceFingerprint };
}

// LONG-FIX: tìm vùng nội dung theo chiều ngang trước khi tính profile hàng.
// Ảnh chụp màn hình / ảnh có bar đen hai bên: dải truyện chỉ chiếm 1 phần
// chiều rộng (vd screenshot 465px, dải chỉ ~83px ở giữa), các cột ngoài dải
// gần như phẳng (std thấp) làm mọi hàng đều "không đồng màu" nếu tính cả ảnh.
// Cột nào có std độ sáng > 25 theo chiều dọc mới là cột nội dung; nếu vùng
// đó hẹp hơn 50% ảnh thì chỉ tính profile trong vùng đó. Ảnh truyện thường
// (nội dung phủ hết chiều rộng) thì vùng này = toàn ảnh, không đổi gì.
function detectContentXRange(image) {
  const sampleW = Math.min(512, image.width);
  const sampleH = Math.min(1024, image.height);
  const canvas = document.createElement('canvas'); canvas.width = sampleW; canvas.height = sampleH;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, sampleW, sampleH);
  const data = context.getImageData(0, 0, sampleW, sampleH).data;
  let first = -1, last = -1;
  for (let x = 0; x < sampleW; x++) {
    let sum = 0, sum2 = 0;
    for (let y = 0; y < sampleH; y++) {
      const i = (y * sampleW + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum; sum2 += lum * lum;
    }
    const mean = sum / sampleH;
    const std = Math.sqrt(Math.max(0, sum2 / sampleH - mean * mean));
    if (std > 25) { if (first < 0) first = x; last = x; }
  }
  canvas.width = 1; canvas.height = 1;
  if (first < 0 || last <= first) return { x: 0, w: image.width };
  const sx = Math.max(0, first - 2), ex = Math.min(sampleW - 1, last + 2);
  const x = Math.floor(sx / sampleW * image.width);
  const w = Math.max(1, Math.ceil((ex + 1) / sampleW * image.width) - x);
  if (w < image.width * 0.5 && w >= 20) return { x, w };
  return { x: 0, w: image.width };
}

function imageRowProfile(image) {
  const crop = detectContentXRange(image);
  const width = crop.w, height = image.height, sampleWidth = width;
  const chunkHeight = Math.min(2048, height);
  const canvas = document.createElement('canvas'); canvas.width = sampleWidth; canvas.height = chunkHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const result = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height), nearWhiteCoverage: new Float64Array(height), darkCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y += chunkHeight) {
    const rows = Math.min(chunkHeight, height - y);
    context.clearRect(0, 0, sampleWidth, chunkHeight);
    context.drawImage(image, crop.x, y, width, rows, 0, 0, sampleWidth, rows);
    const sample = computeRowProfile(context.getImageData(0, 0, sampleWidth, rows).data, sampleWidth, rows);
    for (const key of Object.keys(result)) {
      if (sample[key]) result[key].set(sample[key], y);
    }
  }
  canvas.width = 1; canvas.height = 1;
  result.cropX = crop.x;
  result.cropW = crop.w;
  return result;
}

function getMangaWorker() {
  if (state.workerReady) return state.workerReady;
  if (!api) return Promise.reject(new Error('Hãy mở Panel Cutter Offline trên máy tính.'));
  const worker = new Worker(new URL('./panel-detector-worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  state.workerReady = new Promise(async (resolve, reject) => {
    const fail = (error) => { state.workerReady = null; worker.terminate(); state.worker = null; reject(error); };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'ready') resolve(worker);
      else if (message.type === 'init-error') fail(new Error(message.message));
      else if (message.type === 'result' || message.type === 'error') {
        const pending = state.pending.get(message.id); if (!pending) return;
        state.pending.delete(message.id);
        message.type === 'result' ? pending.resolve(message.boxes) : pending.reject(new Error(message.message));
      }
    };
    worker.onerror = (error) => fail(error);
    try {
      const assets = await api.getDetectorAssets();
      const model = assets.model instanceof ArrayBuffer ? assets.model : assets.model.buffer.slice(assets.model.byteOffset, assets.model.byteOffset + assets.model.byteLength);
      const wasm = assets.wasm instanceof ArrayBuffer ? assets.wasm : assets.wasm.buffer.slice(assets.wasm.byteOffset, assets.wasm.byteOffset + assets.wasm.byteLength);
      worker.postMessage({ type: 'init', model, wasm }, [model, wasm]);
    } catch (error) { fail(error); }
  });
  return state.workerReady;
}

async function detectWithModel(image) {
  const worker = await getMangaWorker();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const buffer = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  canvas.width = 1; canvas.height = 1;
  const id = ++state.requestId;
  const boxes = new Promise((resolve, reject) => state.pending.set(id, { resolve, reject }));
  worker.postMessage({ type: 'detect', id, width: image.width, height: image.height, rgba: buffer, reading: state.reading }, [buffer]);
  return boxes;
}

function detectPanelsHeuristic(image) {
  const maxWidth = 140, ratio = image.height / image.width, sw = maxWidth, sh = Math.min(300, Math.max(70, Math.round(maxWidth * ratio)));
  const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  const isWhite = (x, y) => { const k = (y * sw + x) * 4; return data[k] > 239 && data[k + 1] > 239 && data[k + 2] > 239; };
  const leaves = [];
  function findGap(axis, rect, depth) {
    if (depth > 6) return null;
    const horizontal = axis === 'y', low = horizontal ? rect.y : rect.x, high = horizontal ? rect.y + rect.h : rect.x + rect.w;
    const acrossLow = horizontal ? rect.x : rect.y, acrossHigh = horizontal ? rect.x + rect.w : rect.y + rect.h;
    const length = high - low; if (length < 16) return null;
    const candidates = [];
    for (let p = low + Math.max(3, Math.floor(length * .08)); p < high - Math.max(3, Math.floor(length * .08)); p++) {
      let white = 0, total = 0;
      for (let q = acrossLow + Math.floor((acrossHigh - acrossLow) * .035); q < acrossHigh - Math.floor((acrossHigh - acrossLow) * .035); q++) { total++; if (horizontal ? isWhite(q, p) : isWhite(p, q)) white++; }
      const score = white / Math.max(1, total); if (score >= .94) candidates.push({ p, score });
    }
    if (!candidates.length) return null;
    const runs = []; let run = [candidates[0]];
    for (let i = 1; i < candidates.length; i++) { if (candidates[i].p - run.at(-1).p <= 2) run.push(candidates[i]); else { runs.push(run); run = [candidates[i]]; } } runs.push(run);
    const valid = runs.filter(items => items.length < length * .12); if (!valid.length) return null;
    valid.sort((a, b) => b.length - a.length);
    const best = valid[0], pos = (best[0].p + best.at(-1).p) / 2, before = pos - low, after = high - pos;
    return before < length * .18 || after < length * .18 ? null : { pos };
  }
  function split(rect, depth = 0) {
    if (depth >= 5 || rect.w * rect.h < sw * sh * .065) { leaves.push(rect); return; }
    const horizontal = findGap('y', rect, depth);
    if (horizontal) { split({ x: rect.x, y: rect.y, w: rect.w, h: horizontal.pos - rect.y }, depth + 1); split({ x: rect.x, y: horizontal.pos, w: rect.w, h: rect.y + rect.h - horizontal.pos }, depth + 1); return; }
    const vertical = findGap('x', rect, depth);
    if (vertical) { split({ x: rect.x, y: rect.y, w: vertical.pos - rect.x, h: rect.h }, depth + 1); split({ x: vertical.pos, y: rect.y, w: rect.x + rect.w - vertical.pos, h: rect.h }, depth + 1); return; }
    leaves.push(rect);
  }
  split({ x: 0, y: 0, w: sw, h: sh });
  const boxes = leaves.map(rect => ({ x: rect.x / sw * 100, y: rect.y / sh * 100, w: rect.w / sw * 100, h: rect.h / sh * 100 }));
  return filterPanelBoxes(boxes, 4, state.reading);
}

async function detectMangaCrops(image) {
  let boxes = [];
  try { boxes = await detectWithModel(image); } catch (error) { console.warn('ONNX detector không sẵn sàng, dùng heuristic:', error); }
  let filtered = filterPanelBoxes(boxes, resolveMinPanelAreaPct(4), state.reading);
  if (!filtered.length) filtered = detectPanelsHeuristic(image);
  return filtered.length ? filtered : [{ x: 0, y: 0, w: 100, h: 100 }];
}

async function cropBlob(image, crop, mime, targetWidth = 0) {
  const x = Math.max(0, Math.floor(crop.x / 100 * image.width));
  const y = Math.max(0, Math.floor(crop.y / 100 * image.height));
  const w = Math.max(1, Math.min(image.width - x, Math.ceil(crop.w / 100 * image.width)));
  const h = Math.max(1, Math.min(image.height - y, Math.ceil(crop.h / 100 * image.height)));
  const out = scaledCanvasSize(w, h, targetWidth);
  const canvas = document.createElement('canvas'); canvas.width = out.w; canvas.height = out.h;
  const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(image, x, y, w, h, 0, 0, out.w, out.h);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Không tạo được ảnh panel.')), mime, JPEG_OUTPUT_QUALITY));
  canvas.width = 1; canvas.height = 1;
  return blob;
}

async function stageBlob(blob, relativePath, metadata = {}) {
  await api.writePanel({ token: state.token, relativePath, data: await blob.arrayBuffer() });
  state.results.push({ reviewRequired: false, decision: 'SHOW', editHistory: [], sourceRegions: [], ...metadata, relativePath });
}

async function assignIdentities(items, keys) {
  const result = await api.resolvePanelIdentities({ token: state.token, keys });
  return items.map((item, index) => ({ ...item, ...result.identities[index], identityKey: keys[index] }));
}

function mangaSourceRegion(pageIndex, sourceFile, sourceFingerprint, sourceWidth, sourceHeight, crop) {
  const x = Math.max(0, Math.floor(crop.x / 100 * sourceWidth));
  const y = Math.max(0, Math.floor(crop.y / 100 * sourceHeight));
  const width = Math.max(1, Math.min(sourceWidth - x, Math.ceil(crop.w / 100 * sourceWidth)));
  const height = Math.max(1, Math.min(sourceHeight - y, Math.ceil(crop.h / 100 * sourceHeight)));
  return { source_page: pageIndex + 1, source_file: sourceFile, source_fingerprint: sourceFingerprint || null, source_width: sourceWidth, source_height: sourceHeight, crop: { x, y, width, height }, output_y: 0, output_height: 1 };
}

function panelRecord(item, index, dimensions) {
  return { id: item.id, uuid: item.uuid, file: item.relativePath, order: index + 1, source_page: item.sourceRegions.length === 1 ? item.sourceRegions[0].source_page : null, source_file: item.sourceRegions.length === 1 ? item.sourceRegions[0].source_file : null, width: dimensions.width, height: dimensions.height, crop: item.sourceRegions.length === 1 ? item.sourceRegions[0].crop : null, source_regions: item.sourceRegions, decision: item.decision || 'SHOW', review_required: item.reviewRequired === true, edit_history: item.editHistory || [], parent_ids: item.parentIds || [] };
}

async function processManga() {
  let panelNumber = 0;
  for (let index = 0; index < state.count; index++) {
    setProgress((index / state.count) * 100, 'Đang nhận diện Manga', `Trang ${index + 1} / ${state.count} · nhận diện panel offline…`);
    const { image, name, relativePath } = await loadImage(index);
    try {
      const crops = await detectMangaCrops(image), format = outputTypeFor(name);
      const records = crops.map(crop => { const region = mangaSourceRegion(state.activeIndices ? state.activeIndices[index] : index, relativePath, image.sourceFingerprint, image.width, image.height, crop); return { region, key: sourceIdentityKey([region]) }; });
      const identities = await assignIdentities(records, records.map(record => record.key));
      for (let j = 0; j < crops.length; j++) {
        const blob = await cropBlob(image, crops[j], format.mime, uniformTargetWidth(0));
        const rel = mangaPanelPath(index, relativePath, j, format.ext);
        await stageBlob(blob, state.chapterPrefix + rel, { ...identities[j], pageIndex: state.activeIndices ? state.activeIndices[index] : index, sourceRegions: [records[j].region] }); panelNumber++;
      }
    } finally { image.close(); }
  }
  await normalizeStagedWidths();
  return panelNumber;
}

// UNIFORM-WIDTH (Manga, chế độ tự động): sau khi cắt xong mới biết ảnh rộng nhất,
// nên đo lại rồi co các panel hẹp hơn lên đúng độ rộng đó (chỉ ghi lại ảnh cần đổi).
async function normalizeStagedWidths() {
  if (state.sliceOptions.uniformWidth === false) return;
  const fixed = Math.round(Number(state.sliceOptions.outputWidth) || 0);
  if (fixed > 0) return; // đã co đúng độ rộng cố định lúc cắt
  const mimeFor = item => /\.png$/i.test(item.relativePath) ? 'image/png' : 'image/jpeg';
  const sizes = [];
  let target = 0;
  for (let i = 0; i < state.results.length; i++) {
    setProgress(i / state.results.length * 100, 'Đang đồng nhất độ rộng', `Đo panel ${i + 1} / ${state.results.length}…`);
    const item = state.results[i];
    const bitmap = await createImageBitmap(new Blob([(await api.readStagedPanel({ token: state.token, relativePath: item.relativePath })).data], { type: mimeFor(item) }));
    sizes.push({ w: bitmap.width, h: bitmap.height }); target = Math.max(target, bitmap.width); bitmap.close();
  }
  for (let i = 0; i < state.results.length; i++) {
    if (sizes[i].w === target) continue;
    setProgress(i / state.results.length * 100, 'Đang đồng nhất độ rộng', `Chỉnh panel ${i + 1} / ${state.results.length} lên ${target}px…`);
    const item = state.results[i], mime = mimeFor(item);
    const bitmap = await createImageBitmap(new Blob([(await api.readStagedPanel({ token: state.token, relativePath: item.relativePath })).data], { type: mime }));
    const out = scaledCanvasSize(bitmap.width, bitmap.height, target);
    const canvas = document.createElement('canvas'); canvas.width = out.w; canvas.height = out.h;
    try {
      const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, out.w, out.h);
      await api.writePanel({ token: state.token, relativePath: item.relativePath, data: await (await canvasBlob(canvas, mime)).arrayBuffer() });
    } finally { bitmap.close(); canvas.width = 1; canvas.height = 1; }
  }
}

function canvasBlob(canvas, mime = 'image/jpeg') {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không ghi được panel.')), mime, JPEG_OUTPUT_QUALITY));
}

async function buildStripParts() {
  const parts = [];
  for (let index = 0; index < state.count; index++) {
    setProgress((index / state.count) * 34, `Đang ghép ${state.style === 'manhwa' ? 'Manhwa' : 'Manhua'}`, `Đọc profile dải ${index + 1} / ${state.count}…`);
    const loaded = await loadImage(index);
    const { image } = loaded;
    try {
      const profile = imageRowProfile(image);
      parts.push({ pageIndex: index, sourceIndex: loaded.sourceIndex, sourceFile: loaded.relativePath, sourceFingerprint: loaded.sourceFingerprint, sourceWidth: image.width, width: profile.cropW || image.width, cropX: profile.cropX || 0, height: image.height, profile });
    }
    finally { image.close(); }
  }
  return parts;
}

async function drawStripSegment(doc, segment, cache, targetWidth = 0) {
  const crop = stripSegmentCrop(segment, doc.height);
  const fragments = mapStripCropToSources(doc, crop);
  const out = scaledCanvasSize(doc.width, Math.max(1, Math.round(segment.y1 - segment.y0)), targetWidth);
  const canvas = document.createElement('canvas'); canvas.width = out.w; canvas.height = out.h;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const fragment of fragments) {
    let image = cache.get(fragment.pageIndex);
    if (!image) {
      const loaded = await loadImage(fragment.pageIndex); image = loaded.image; cache.set(fragment.pageIndex, image);
    }
    ctx.drawImage(image, fragment.sx, fragment.sy, fragment.sw, fragment.sh, 0, fragment.destY * canvas.height, canvas.width, fragment.destH * canvas.height);
  }
  return canvas;
}

async function processJoinedStrip(parts) {
  const sourceParts = parts.map(part => ({ ...part }));
  const doc = joinStripProfiles(parts);
  for (const entry of doc.entries) entry.profile = null;
  parts.length = 0;
  const pageHeights = doc.entries.map(entry => entry.y1 - entry.y0).sort((a, b) => a - b);
  const referenceHeight = pageHeights[Math.floor(pageHeights.length / 2)] || doc.height;
  const protectedRows = doc.entries.slice(1).map(entry => entry.y0);
  let segments = sliceStripProfile(doc.profile, doc.width, doc.height, state.style, {
    ...state.sliceOptions,
    referenceHeight,
    protectedRows,
  }).segments;
  // SPLIT-MOBILE: chia panel dài cho video 16:9, mặc định bật, tắt bằng
  // checkbox trong cài đặt dải. Vẫn xem/gộp/chia tay trong preview sau đó.
  if (state.sliceOptions.splitLongPanels !== false) segments = splitLongSegments(segments, doc.profile, doc.width);
  const cache = new Map();
  try {
    for (let i = 0; i < segments.length; i++) {
      setProgress(35 + (i / segments.length) * 65, 'Đang cắt panel dải ghép', `Panel ${i + 1} / ${segments.length} · có thể cắt qua ranh giới ảnh…`);
      const canvas = await drawStripSegment(doc, segments[i], cache, uniformTargetWidth(doc.width));
      try {
        const crop = stripSegmentCrop(segments[i], doc.height);
        const sourceRegions = mapStripCropToSourceRegions(doc, crop, sourceParts);
        const keys = [sourceIdentityKey(sourceRegions)]; const identity = (await assignIdentities([{}], keys))[0];
        await stageBlob(await canvasBlob(canvas), state.chapterPrefix + stripPanelPath(i, 'jpg'), { ...identity, sourceRegions });
      }
      finally { canvas.width = 1; canvas.height = 1; }
    }
  } finally { for (const image of cache.values()) image.close(); }
  return segments.length;
}

async function processStripPerImage(autoWidth = 0) {
  let panelNumber = 0;
  const targetWidth = uniformTargetWidth(autoWidth);
  for (let index = 0; index < state.count; index++) {
    setProgress((index / state.count) * 100, 'Đang cắt panel', `Ảnh ${index + 1} / ${state.count}…`);
    const { image, name } = await loadImage(index);
    try {
      let segments;
      const format = outputTypeFor(name);
      const profile0 = imageRowProfile(image);
      const effW = profile0.cropW || image.width;
      const cropX0 = profile0.cropX || 0;
      if (image.height / effW >= 1.3) {
        segments = sliceStripProfile(profile0, effW, image.height, state.style, state.sliceOptions).segments;
        if (state.sliceOptions.splitLongPanels !== false) segments = splitLongSegments(segments, profile0, effW);
      } else if (state.style === 'manhua') {
        const boxes = await detectMangaCrops(image);
        const records = boxes.map(box => mangaSourceRegion(image.sourceIndex, image.relativePath, image.sourceFingerprint, image.width, image.height, box));
        const identities = await assignIdentities(records, records.map(region => sourceIdentityKey([region])));
        for (let j = 0; j < boxes.length; j++) await stageBlob(await cropBlob(image, boxes[j], format.mime, targetWidth), state.chapterPrefix + stripPanelPath(panelNumber++, format.ext), { ...identities[j], sourceRegions: [records[j]] });
        continue;
      } else segments = [{ y0: 0, y1: image.height }];
      for (const segment of segments) {
        const crop = stripSegmentCrop(segment, image.height);
        crop.x = cropX0 / image.width * 100;
        crop.w = effW / image.width * 100;
        const region = mangaSourceRegion(image.sourceIndex, image.relativePath, image.sourceFingerprint, image.width, image.height, crop);
        const identity = (await assignIdentities([region], [sourceIdentityKey([region])]))[0];
        await stageBlob(await cropBlob(image, crop, format.mime, targetWidth), state.chapterPrefix + stripPanelPath(panelNumber++, format.ext), { ...identity, sourceRegions: [region] });
      }
    } finally { image.close(); }
  }
  return panelNumber;
}

function panelCanMerge(index) {
  if (state.saved || index <= 0) return false;
  if (state.style !== 'manga') return true;
  return state.results[index - 1].pageIndex === state.results[index].pageIndex;
}
function openImageViewer(index, url) {
  const item=state.results[index];
  if(!item || !url) return;
  $('#image-viewer-caption').textContent=`${item.id || 'Panel'} · ${pad(index+1,3)} · ${item.relativePath}`;
  const image=$('#image-viewer-image'); image.src=url; image.alt=`Panel ${index+1}, phóng to`;
  $('#image-viewer').classList.remove('hidden'); $('#image-viewer-close').focus();
}
function closeImageViewer() {
  $('#image-viewer')?.classList.add('hidden');
  $('#image-viewer-image')?.removeAttribute('src');
}
$('#image-viewer-close').addEventListener('click',closeImageViewer);
$('#image-viewer-backdrop').addEventListener('click',closeImageViewer);
$('#image-viewer').addEventListener('click',event=>{if(event.target.id==='image-viewer')closeImageViewer();});
window.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(!$('#manual-split').classList.contains('hidden')){if(!state.busy)closeManualSplit();return;}
  closeImageViewer();
});
function closeManualSplit(){
  if(manualSplitState?.bitmap)manualSplitState.bitmap.close();
  if(manualSplitState?.url)URL.revokeObjectURL(manualSplitState.url);
  manualSplitState=null;
  $('#manual-split').classList.add('hidden');
  $('#manual-split-image').removeAttribute('src');
  $('#manual-split-error').textContent='';
}
function updateManualSplitPosition(value){
  if(!manualSplitState)return;
  const height=manualSplitState.bitmap.height;
  const cutY=Math.min(height-1,Math.max(1,Math.round(Number(value)||1)));
  manualSplitState.cutY=cutY;
  $('#manual-split-range').value=String(cutY);
  $('#manual-split-output').textContent=`${cutY.toLocaleString()} / ${height.toLocaleString()} px`;
  $('#manual-split-guide').style.top=`${cutY/height*100}%`;
}
function fitManualSplitPreview(){
  if(!manualSplitState)return;
  const stage=$('#manual-split-stage'),frame=$('#manual-split-frame'),bitmap=manualSplitState.bitmap;
  const availableWidth=Math.max(1,stage.clientWidth-24),availableHeight=Math.max(1,stage.clientHeight-24);
  const scale=Math.min(availableWidth/bitmap.width,availableHeight/bitmap.height,1);
  const width=Math.max(1,Math.floor(bitmap.width*scale)),height=Math.max(1,Math.floor(bitmap.height*scale));
  frame.style.width=`${width}px`;frame.style.height=`${height}px`;
}
function updateManualSplitFromPointer(clientY){
  if(!manualSplitState)return;
  const imageRect=$('#manual-split-image').getBoundingClientRect();
  if(!imageRect.height)return;
  updateManualSplitPosition((clientY-imageRect.top)/imageRect.height*manualSplitState.bitmap.height);
}
async function openManualSplit(index){
  if(state.busy||state.saved||index<0||index>=state.results.length)return;
  state.busy=true;clearError();$('#manual-split-error').textContent='';
  try{
    const item=state.results[index];
    const response=await api.readStagedPanel({token:state.token,relativePath:item.relativePath});
    const mime=/\.png$/i.test(item.relativePath)?'image/png':'image/jpeg';
    const blob=new Blob([response.data],{type:mime});
    const bitmap=await createImageBitmap(blob);
    if(bitmap.height<2){bitmap.close();throw new Error('Panel quá thấp để chia thành hai phần.');}
    const url=URL.createObjectURL(blob);
    manualSplitState={index,item:{...item},bitmap,url,cutY:Math.floor(bitmap.height/2)};
    $('#manual-split-caption').textContent=`Panel ${pad(index+1,3)} · ${item.relativePath} · ${bitmap.width} × ${bitmap.height} px`;
    $('#manual-split-image').src=url;
    $('#manual-split-range').min='1';$('#manual-split-range').max=String(bitmap.height-1);
    $('#manual-split').classList.remove('hidden');
    await $('#manual-split-image').decode();
    fitManualSplitPreview();
    updateManualSplitPosition(manualSplitState.cutY);
    $('#manual-split-range').focus();
  }catch(error){closeManualSplit();showError(error);}
  finally{state.busy=false;}
}
$('#manual-split-range').addEventListener('input',event=>updateManualSplitPosition(event.target.value));
$('#manual-split-guide').addEventListener('pointerdown',event=>{
  if(!manualSplitState)return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);updateManualSplitFromPointer(event.clientY);
});
$('#manual-split-guide').addEventListener('pointermove',event=>{
  if(event.currentTarget.hasPointerCapture(event.pointerId))updateManualSplitFromPointer(event.clientY);
});
$('#manual-split-guide').addEventListener('pointerup',event=>{
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
});
window.addEventListener('resize',fitManualSplitPreview);
const cancelManualSplit=()=>{if(!state.busy)closeManualSplit();};
$('#manual-split-close').addEventListener('click',cancelManualSplit);
$('#manual-split-cancel').addEventListener('click',cancelManualSplit);
$('#manual-split-backdrop').addEventListener('click',cancelManualSplit);
function manualSplitTemporaryPath(relativePath){
  const slash=relativePath.lastIndexOf('/'),folder=slash>=0?relativePath.slice(0,slash+1):'';
  const extension=relativePath.match(/\.(png|jpe?g)$/i)?.[0]||'.jpg';
  return `${folder}__manual_split_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`;
}
async function cropBitmapSection(bitmap,y0,y1,mime){
  const height=y1-y0;
  if(height<1)throw new Error('Vị trí cắt phải để lại ảnh ở cả hai phía.');
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=height;
  try{
    canvas.getContext('2d').drawImage(bitmap,0,y0,bitmap.width,height,0,0,bitmap.width,height);
    return await canvasBlob(canvas,mime);
  }finally{canvas.width=1;canvas.height=1;}
}
async function confirmManualSplit(){
  if(state.busy||state.saved||!manualSplitState)return;
  const split=manualSplitState,index=split.index,item=split.item;
  if(state.results[index]?.relativePath!==item.relativePath){$('#manual-split-error').textContent='Danh sách panel đã thay đổi. Hãy đóng và mở lại thao tác chia.';return;}
  state.busy=true;$('#manual-split-confirm').disabled=true;$('#manual-split-error').textContent='';
  try{
    const extension=/\.png$/i.test(item.relativePath)?'image/png':'image/jpeg';
    const top=await cropBitmapSection(split.bitmap,0,split.cutY,extension);
    const bottom=await cropBitmapSection(split.bitmap,split.cutY,split.bitmap.height,extension);
    const topBytes=await top.arrayBuffer(),bottomBytes=await bottom.arrayBuffer();
    const temporaryPath=manualSplitTemporaryPath(item.relativePath);
    const ratio=split.cutY/split.bitmap.height;
    const splitKeys=makeSplitIdentityKeys(item.uuid,ratio);
    const splitIdentities=await assignIdentities([{},{}],splitKeys);
    const regions=splitSourceRegions(item.sourceRegions || [],ratio);
    const topItem={...item,...splitIdentities[0],sourceRegions:regions[0],parentIds:[item.id],editHistory:[...(item.editHistory||[]),{action:'split',parent_id:item.id,part:'top',ratio,at:new Date().toISOString()}]};
    const bottomItem={...item,...splitIdentities[1],sourceRegions:regions[1],parentIds:[item.id],editHistory:[...(item.editHistory||[]),{action:'split',parent_id:item.id,part:'bottom',ratio,at:new Date().toISOString()}]};
    const nextItems=state.results.slice(); nextItems.splice(index,1,topItem,{...bottomItem,relativePath:temporaryPath});
    const updated=await persistStagedResults(state.results,nextItems,new Map([[item.relativePath,topBytes],[temporaryPath,bottomBytes]]));
    state.results=updated;
    state.previewCount=Math.min(state.results.length,Math.max(12,state.previewCount+1));
    updateResultsSummary();closeManualSplit();await renderPreviewGrid();
  }catch(error){$('#manual-split-error').textContent=error?.message||String(error);}
  finally{state.busy=false;$('#manual-split-confirm').disabled=false;}
}
$('#manual-split-confirm').addEventListener('click',confirmManualSplit);
function clearPreviewUrls() {
  for (const url of state.previewUrls) URL.revokeObjectURL(url);
  state.previewUrls = [];
}
async function renderPreviewGrid() {
  closeImageViewer(); closeManualSplit();
  clearPreviewUrls();
  const grid = $('#preview-grid'); grid.innerHTML = '';
  const shown = Math.min(state.previewCount, state.results.length);
  for (let index = 0; index < shown; index++) {
    const item = state.results[index];
    const data = await api.readStagedPanel({ token: state.token, relativePath: item.relativePath });
    const mime = /\.png$/i.test(item.relativePath) ? 'image/png' : 'image/jpeg';
    const url = URL.createObjectURL(new Blob([data.data], { type: mime })); state.previewUrls.push(url);
    const card = document.createElement('article'); card.className = 'preview-card';
    const image = document.createElement('img'); image.src = url; image.alt = `Panel ${index + 1}`; image.loading = 'lazy';
    image.title='Bấm để phóng to'; image.addEventListener('click',()=>openImageViewer(index,url));
    const label = document.createElement('span'); label.textContent = `${item.id || 'Panel'} · ${pad(index + 1, 3)} · ${item.relativePath}`; label.title = `${item.id || ''} ${item.relativePath}`;
    card.append(image, label);
    if (panelCanMerge(index)) {
      const merge = document.createElement('button'); merge.type = 'button'; merge.className = 'merge-panel'; merge.textContent = 'Gộp vào ảnh trước';
      merge.addEventListener('click', () => mergeIntoPrevious(index)); card.append(merge);
    } else if (state.style === 'manga' && index > 0 && !state.saved) {
      const note = document.createElement('small'); note.className = 'merge-note'; note.textContent = 'Khác trang Manga'; card.append(note);
    }
    if(!state.saved){
      const actions=document.createElement('div'); actions.className='panel-card-actions';
      if(state.style==='manga'){
        const reorder=document.createElement('div'); reorder.className='panel-reorder-controls';
        const up=document.createElement('button'); up.type='button'; up.className='panel-action-button'; up.textContent='↑'; up.title='Đưa panel lên trước trong trang Manga'; up.setAttribute('aria-label',up.title);
        const previousIndex=index-1; up.disabled=state.results[previousIndex]?.pageIndex!==item.pageIndex; up.addEventListener('click',()=>movePanelWithinPage(index,-1));
        const down=document.createElement('button'); down.type='button'; down.className='panel-action-button'; down.textContent='↓'; down.title='Đưa panel xuống sau trong trang Manga'; down.setAttribute('aria-label',down.title);
        const nextIndex=index+1; down.disabled=state.results[nextIndex]?.pageIndex!==item.pageIndex; down.addEventListener('click',()=>movePanelWithinPage(index,1));
        reorder.append(up,down); actions.append(reorder);
      }
      const split=document.createElement('button');split.type='button';split.className='panel-action-button split-panel';split.textContent='Chia';split.title='Chia panel này theo đường ngang';split.setAttribute('aria-label',`Chia panel ${index+1} thủ công`);split.addEventListener('click',()=>openManualSplit(index));
      const remove=document.createElement('button');remove.type='button';remove.className='panel-action-button delete-panel';remove.textContent='Xóa';remove.title='Xóa panel này khỏi kết quả';remove.addEventListener('click',()=>deletePanel(index));
      actions.append(split,remove); card.append(actions);
    }
    grid.append(card);
  }
  $('#show-more-btn').classList.toggle('hidden', shown >= state.results.length || state.saved);
  $('#show-more-btn').textContent = `Hiện thêm ${Math.min(12, state.results.length - shown)} panel (${shown}/${state.results.length})`;
  $('#save-output').disabled=state.saved||state.results.length===0;
  $('#save-output').textContent=state.saved?'Đã lưu ảnh':state.results.length?'Lưu ảnh đã cắt…':'Không còn panel';
  $('#preview-caption').textContent = !state.results.length
    ? 'Đã xóa hết panel. Bạn có thể chạy lại bước cắt để tạo kết quả mới.'
    : state.saved
      ? `${state.results.length.toLocaleString()} ảnh đã lưu. Bấm vào ảnh đang xem để phóng to; mở folder để xem toàn bộ.`
      : `Đang xem ${shown.toLocaleString()} / ${state.results.length.toLocaleString()} panel. Bấm ảnh để phóng to; Chia để cắt thủ công, hoặc gộp/xóa panel. Với Manga, dùng ↑ ↓ để đổi thứ tự trong cùng trang.`;
}
function updateResultsSummary(){
  const count=state.results.length;
  $('#results-title').textContent=count?`Đã cắt ${count.toLocaleString()} panel`:'Không còn panel';
  $('#results-detail').textContent=!count?'Đã xóa toàn bộ kết quả tạm; có thể chạy lại bước cắt.':state.style==='manga'?`${state.count.toLocaleString()} trang · thứ tự panel trong từng trang sẽ được giữ khi lưu.`:'Panel theo thứ tự từ trên xuống · kết quả chưa lưu.';
  $('#save-output').disabled=state.saved||count===0;
  $('#save-output').textContent=state.saved?'Đã lưu ảnh':count?'Lưu ảnh đã cắt…':'Không còn panel';
}
async function persistStagedResults(previousItems,nextItems,overrides=new Map()){
  const snapshots=await Promise.all(previousItems.map(async item=>({relativePath:item.relativePath,data:(await api.readStagedPanel({token:state.token,relativePath:item.relativePath})).data})));
  const dataByPath=new Map(snapshots.map(entry=>[entry.relativePath,entry.data]));
  const updated=reindexPanelPaths(nextItems,state.style);
  const targetPaths=new Set(updated.map(item=>item.relativePath));
  const previousPaths=new Set(previousItems.map(item=>item.relativePath));
  try{
    for(let index=0;index<updated.length;index++){
      const sourcePath=nextItems[index].relativePath;
      const bytes=overrides.has(sourcePath)?overrides.get(sourcePath):dataByPath.get(sourcePath);
      if(!bytes) throw new Error(`Không tìm thấy dữ liệu panel ${sourcePath}.`);
      await api.writePanel({token:state.token,relativePath:updated[index].relativePath,data:bytes});
    }
    for(const item of previousItems) if(!targetPaths.has(item.relativePath)) await api.deleteStagedPanel({token:state.token,relativePath:item.relativePath});
    return updated;
  }catch(error){
    for(const snapshot of snapshots){try{await api.writePanel({token:state.token,relativePath:snapshot.relativePath,data:snapshot.data});}catch{}}
    for(const relativePath of targetPaths) if(!previousPaths.has(relativePath)){try{await api.deleteStagedPanel({token:state.token,relativePath});}catch{}}
    throw error;
  }
}
async function movePanelWithinPage(index,direction){
  if(state.busy||state.saved||state.style!=='manga')return;
  const moved=moveMangaPanel(state.results,index,direction); if(moved===state.results)return;
  const changed=[index,index+direction];
  for(const changedIndex of changed){const item=moved[changedIndex];moved[changedIndex]={...item,editHistory:[...(item.editHistory||[]),{action:'reorder',at:new Date().toISOString()}]};}
  state.busy=true;clearError();
  try{state.results=await persistStagedResults(state.results,moved);updateResultsSummary();await renderPreviewGrid();}
  catch(error){showError(error);}
  finally{state.busy=false;}
}
async function deletePanel(index){
  if(state.busy||state.saved||index<0||index>=state.results.length)return;
  state.busy=true;clearError();
  try{
    const remaining=state.results.filter((_item,itemIndex)=>itemIndex!==index);
    state.results=await persistStagedResults(state.results,remaining);
    state.previewCount=Math.min(state.results.length,Math.max(12,state.previewCount));
    updateResultsSummary();await renderPreviewGrid();
  }catch(error){showError(error);}
  finally{state.busy=false;}
}
async function mergeIntoPrevious(index) {
  if (!panelCanMerge(index) || state.busy) return;
  state.busy = true; clearError();
  document.querySelectorAll('.merge-panel').forEach(button => { button.disabled = true; });
  try {
    const previous = state.results[index - 1], current = state.results[index];
    const [left, right] = await Promise.all([
      api.readStagedPanel({ token: state.token, relativePath: previous.relativePath }),
      api.readStagedPanel({ token: state.token, relativePath: current.relativePath }),
    ]);
    const mimeFor = item => /\.png$/i.test(item.relativePath) ? 'image/png' : 'image/jpeg';
    const [top, bottom] = await Promise.all([
      createImageBitmap(new Blob([left.data], { type: mimeFor(previous) })),
      createImageBitmap(new Blob([right.data], { type: mimeFor(current) })),
    ]);
    const combinedWidth = Math.max(top.width, bottom.width), combinedHeight = top.height + bottom.height;
    const scale = Math.min(1, 32000 / Math.max(combinedWidth, combinedHeight), Math.sqrt(40000000 / (combinedWidth * combinedHeight)));
    const width = Math.max(1, Math.round(combinedWidth * scale));
    const height = Math.max(1, Math.round(combinedHeight * scale));
    const topSourceHeight=top.height,bottomSourceHeight=bottom.height;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(top, (width - top.width * scale) / 2, 0, top.width * scale, top.height * scale);
    context.drawImage(bottom, (width - bottom.width * scale) / 2, top.height * scale, bottom.width * scale, bottom.height * scale);
    top.close(); bottom.close();
    const merged = await canvasBlob(canvas, mimeFor(previous)); canvas.width = 1; canvas.height = 1;
    const mergedBytes=await merged.arrayBuffer();
    const combinedRegions = combineSourceRegions(previous.sourceRegions || [], topSourceHeight, current.sourceRegions || [], bottomSourceHeight);
    const identityKey = makeMergeIdentityKey([previous.uuid, current.uuid]);
    const mergedIdentity = (await assignIdentities([{}], [identityKey]))[0];
    const mergedItem = { ...previous, ...mergedIdentity, sourceRegions: combinedRegions, parentIds: [previous.id, current.id], editHistory: [...(previous.editHistory || []), ...(current.editHistory || []), { action: 'merge', source_ids: [previous.id, current.id], at: new Date().toISOString() }] };
    const remaining=state.results.filter((_item,itemIndex)=>itemIndex!==index).map((item,itemIndex)=>itemIndex===index-1?mergedItem:item);
    state.results=await persistStagedResults(state.results,remaining,new Map([[previous.relativePath,mergedBytes]]));
    state.previewCount = Math.min(state.results.length, Math.max(12, state.previewCount));
    updateResultsSummary();
    await renderPreviewGrid();
  } catch (error) { showError(error); }
  finally { state.busy = false; }
}
$('#show-more-btn').addEventListener('click', async () => {
  if(state.saved)return;
  state.previewCount = Math.min(state.results.length, state.previewCount + 12);
  try { await renderPreviewGrid(); } catch (error) { showError(error); }
});
$('#start-btn').addEventListener('click', async () => {
  if (state.busy || !state.token || !state.style) return;
  state.busy = true; state.saved = false; state.results = []; state.previewCount = 0; state.outputDir = '';
  clearError(); clearPreviewUrls(); $('#preview-grid').innerHTML = ''; $('#results-panel').classList.add('hidden'); $('#start-btn').disabled = true;
  $('#save-output').disabled = false; $('#save-output').textContent = 'Lưu ảnh đã cắt…'; $('#open-folder').classList.add('hidden');
  try {
    await api.beginStaging({ token: state.token, style: state.style });
    const chapters = state.chapters.length ? state.chapters : [{ name: '', indices: Array.from({length: state.count}, (_, i) => i) }];
    const sourceCount = state.count; let count = 0;
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];
      state.activeIndices = chapter.indices; state.count = chapter.indices.length;
      state.chapterPrefix = state.chapters.length ? `${chapter.name}/` : '';
      setProgress(chapterIndex / chapters.length * 100, 'Đang xử lý các chap', `${chapter.name || 'Truyện'} · chap ${chapterIndex + 1}/${chapters.length} · ${state.count} trang…`);
      if (state.style === 'manga') count += await processManga();
      else {
        const parts = await buildStripParts();
        const width = Math.max(1, ...parts.map(part => part.width));
        const totalHeight = parts.reduce((sum, part) => sum + Math.round(part.height * width / part.width), 0);
        if (totalHeight / width >= 1.3) count += await processJoinedStrip(parts);
        else { parts.length = 0; count += await processStripPerImage(width); }
      }
    }
    state.count = sourceCount; state.activeIndices = null; state.chapterPrefix = '';
    if (!count || !state.results.length) throw new Error('Không tạo được panel nào để xem.');
    state.previewCount = Math.min(12, state.results.length);
    await renderPreviewGrid();
    setProgress(100, 'Đã cắt xong · chưa lưu', `${count.toLocaleString()} panel đang ở vùng tạm. Kiểm tra/gộp xong rồi bấm Lưu ảnh đã cắt.`);
    $('#results-title').textContent = `Đã cắt ${count.toLocaleString()} panel`;
    $('#results-detail').textContent = state.chapters.length ? `${state.chapters.length} chap · mỗi chap được lưu trong folder riêng.` : state.style === 'manga'
      ? `${state.count.toLocaleString()} trang · folder theo từng trang sẽ được tạo khi lưu.`
      : `Panel theo thứ tự từ trên xuống · chưa ghi vào folder kết quả.`;
    $('#results-panel').classList.remove('hidden');
    $('#output-path').textContent = 'Chưa lưu · kết quả tạm sẽ tự xóa khi đóng app';
    $('#results-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(error); setProgress(0, 'Chưa hoàn tất', 'Kiểm tra thông báo lỗi rồi thử lại.'); }
  finally { state.busy = false; $('#start-btn').disabled = !state.token || !state.style; }
});
$('#save-output').addEventListener('click', async () => {
  if (state.busy || state.saved || !state.results.length) return;
  state.busy = true; $('#save-output').disabled = true; clearError();
  try {
    const choice = await api.chooseOutputParent();
    if (choice.canceled) return;
    setProgress(0, 'Đang lưu ảnh đã cắt', `Đang tạo folder kết quả và chép ${state.results.length.toLocaleString()} panel…`);
    const exportedAt = new Date().toISOString();
    const panels=[];
    for(let index=0;index<state.results.length;index++){
      const item=state.results[index], response=await api.readStagedPanel({token:state.token,relativePath:item.relativePath});
      const bitmap=await createImageBitmap(new Blob([response.data],{type:/\.png$/i.test(item.relativePath)?'image/png':'image/jpeg'}));
      panels.push(panelRecord(item,index,{width:bitmap.width,height:bitmap.height})); bitmap.close();
    }
    const manifest={...createProjectMetadata({projectId:state.projectIdentity.projectId,projectName:state.projectIdentity.projectName,createdAt:state.projectIdentity.createdAt,exportedAt,sourceType:state.sourceType,sourceName:state.sourceName,readingDirection:state.style==='manga'?state.reading:null,comicType:state.style}),export_layout:state.outputLayout,panels};
    const validation=validateManifest(manifest); if(!validation.valid) throw new Error(`Manifest không hợp lệ: ${validation.errors.join(' ')}`);
    const result = await api.finalizeExport({ token: state.token, outputParent: choice.path, layout: state.outputLayout, manifest });
    state.outputDir = result.outputDir; state.saved = true;
    setProgress(100, 'Đã lưu ảnh', `Đã lưu ${state.results.length.toLocaleString()} panel.`);
    $('#output-path').textContent = state.outputDir;
    $('#save-output').textContent = 'Đã lưu ảnh'; $('#open-folder').classList.remove('hidden');
    document.querySelectorAll('.merge-panel,.panel-card-actions').forEach(control => { control.classList.add('hidden'); });
    $('#show-more-btn').classList.add('hidden');
    $('#preview-caption').textContent = `${state.results.length.toLocaleString()} ảnh đã lưu. Bấm vào ảnh đang xem để phóng to; mở folder để xem toàn bộ: ${state.outputDir}`;
  } catch (error) { showError(error); }
  finally { state.busy = false; $('#save-output').disabled = state.saved; }
});

$('#open-folder').addEventListener('click', async () => { try { const result = await api.openOutput({ token: state.token }); if (!result.ok) showError(result.error || 'Không mở được folder kết quả.'); } catch (e) { showError(e); } });
window.addEventListener('beforeunload', () => { closeManualSplit(); if (state.worker) state.worker.terminate(); for (const url of state.previewUrls) URL.revokeObjectURL(url); });

if (!api) {
  showError(new Error('Đây là app desktop. Chạy Panel Cutter Offline trên Windows để chọn archive/folder và xuất ảnh.'));
}
