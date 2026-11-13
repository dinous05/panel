// jobs.js — pure helpers cho HÀNG ĐỢI RENDER (v6f).
// Job = chap đã snapshot vào <userData>/render-jobs/<id>/, xử lý nền TUYỆT ĐỐI
// không chạm state workspace. Module thuần, test được bằng node --test.
import { shareFrames, shareFramesWeighted, computeVoiceDurations, analyzeMarkers } from './voice.js';

export function resolveJobComicStyle(settings = {}, fallback = 'manga') {
  const valid = value => value === 'manga' || value === 'manhwa' || value === 'hybrid';
  return valid(settings?.comicStyle) ? settings.comicStyle : (valid(fallback) ? fallback : 'manga');
}

export const JOB_STATUSES = ['cho', 'voice', 'render', 'xong', 'loi'];
export const JOB_STATUS_TEXT = { cho: 'Chờ', voice: 'Đang tạo voice', render: 'Đang render', xong: 'Xong', loi: 'Lỗi' };

export function newJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'job-' + crypto.randomUUID();
  return 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Tên file an toàn trên Windows (không ký tự cấm).
export function sanitizeJobFileName(name) {
  const clean = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/\.+$/, '');
  return clean || 'video';
}

export function jobOutputFileName(name) {
  const base = sanitizeJobFileName(name);
  return base.toLowerCase().endsWith('.mp4') ? base : base + '.mp4';
}

function extOf(name) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
  return (m && m[1].toLowerCase()) || 'jpg';
}

// Tên file ảnh trang trong thư mục job: page-0001.jpg, page-0002.png, ...
export function pageFileName(index, ext) {
  const clean = String(ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `page-${String(index + 1).padStart(4, '0')}.${clean}`;
}

// Snapshot 1 job từ dữ liệu workspace. scenes/settings/voice được deep-copy JSON
// nên job độc lập hoàn toàn với workspace sau khi enqueue.
export function makeJobSnapshot({ name, pages, scenes, settings, voice, outDir, fileName }) {
  const id = newJobId();
  const cleanName = String(name || '').trim().slice(0, 80) || 'Chap';
  const pageList = (pages || []).map((p, i) => ({
    name: String(p.name || `trang-${i + 1}`),
    path: String(p.path || p.name || `trang-${i + 1}`),
    ...(Number.isInteger(p.pageGroupIndex) ? { pageGroupIndex: p.pageGroupIndex } : {}),
    ...(p.pageGroupName ? { pageGroupName: String(p.pageGroupName) } : {}),
    file: pageFileName(i, extOf(p.name)),
  }));
  return {
    id,
    name: cleanName,
    elapsedMs: 0,
    startedAt: null,
    runStartedAt: null,
    completedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'cho',
    note: '',
    error: null,
    outputPath: null,
    pages: pageList,
    scenes: JSON.parse(JSON.stringify(scenes || [])),
    settings: JSON.parse(JSON.stringify(settings || {})),
    voice: JSON.parse(JSON.stringify(voice || { kind: 'none' })),
    outDir: String(outDir || ''),
    fileName: fileName ? jobOutputFileName(fileName) : jobOutputFileName(cleanName),
  };
}

// Voice ID gửi cho app:tts từ snapshot voice của job: clone + lang 'vi' đi
// đường VieNeu (v6o), clone còn lại đi Chatterbox, edge dùng voiceId đã lưu.
export function jobSnapshotVoiceId(voice) {
  const v = voice || { kind: 'none' };
  if (v.kind === 'clone') return v.lang === 'vi' ? 'vieneu-clone' : 'chatterbox-clone';
  return v.voiceId || '';
}

// Kiểm tra cấu hình voice của job. Trả về chuỗi lỗi hoặc null.
export function validateJobVoice(voice) {
  const v = voice || { kind: 'none' };
  if (v.kind === 'none') return null;
  if (!(v.cues && v.cues.length)) return 'Job có voice nhưng thiếu cues SRT.';
  if (v.kind === 'edge') return v.voiceId ? null : 'Chưa chọn giọng Edge cho job.';
  if (v.kind === 'clone') {
    if (!String(v.refPath || '').trim()) return 'Hãy thả file .wav giọng mẫu vào trước.';
    return null;
  }
  return `Loại voice không hỗ trợ: ${v.kind}`;
}

function clamp(x, min, max) { return Math.min(max, Math.max(min, x)); }

// Bản thuần của durationBounds trong main.js (không chạm state).
function durationBoundsPure(mode, groups) {
  if (mode === 'scene') return { min: 0.5, max: 120 };
  const counts = groups.map(items => items.length);
  if (!counts.length) return { min: 0.5, max: 3600 };
  const pageCount = counts.length, maxPanels = Math.max(...counts), minPanels = Math.min(...counts);
  if (mode === 'total') return { min: pageCount * maxPanels * 0.5, max: Math.max(pageCount * maxPanels * 0.5, pageCount * minPanels * 3600) };
  return { min: maxPanels * 0.5, max: Math.max(maxPanels * 0.5, minPanels * 3600) };
}

// v6r: bản thuần của shareSceneFrames bên main.js — chia theo panWeight khi
// mọi cảnh trong trang đều có trọng số, ngược lại chia đều.
function shareJobSceneFrames(totalFrames, items) {
  const ws = items.map(sc => sc.panWeight);
  const parts = (ws.length && ws.every(w => Number(w) > 0)) ? shareFramesWeighted(totalFrames, ws) : null;
  return parts || shareFrames(totalFrames, items.length);
}

// Tính durations (Map scene.id -> giây) cho 1 job, cùng toán học với getEffectiveDurations
// của workspace: scene / total / page / voice (theo mốc [TRANG n]).
export function jobDurations({ scenes, settings = {}, pageCount = 0, voiceResult = null }) {
  const map = new Map();
  const list = scenes || [];
  const pcs = Math.max(0, Math.round(Number(pageCount) || 0));
  const pageOf = sc => Number.isInteger(sc.groupIndex) ? sc.groupIndex : sc.pageIndex;
  if (voiceResult && Number(voiceResult.duration) > 0) {
    const panelCues=voiceResult.cueDurations||[];
    const panelScenes=list.filter(sc=>Number.isInteger(sc.panelScriptIndex));
    const cueIndices=panelScenes.map(sc=>sc.panelScriptIndex);
    if(panelScenes.length&&panelCues.length===panelScenes.length&&new Set(cueIndices).size===cueIndices.length&&cueIndices.every(index=>index>=0&&index<panelCues.length)&&cueIndices.length===panelCues.length){
      for(const sc of panelScenes){const d=Number(panelCues[sc.panelScriptIndex]);if(!(d>0))return{map:new Map(),fallback:true,reason:'Không có thời lượng audio cho đủ panel TXT.',mode:'panel-txt',droppedPageIndices:[]};map.set(sc.id,d);}
      const markerAnalysis=analyzeMarkers(voiceResult.pageSegments||{},pcs);
      return{map,fallback:false,reason:'',mode:'panel-txt',droppedPageIndices:markerAnalysis.mode==='partial'?markerAnalysis.droppedPageIndices:[]};
    }
    const counts = Array.from({ length: pcs }, () => 0);
    const ordered = [...list].sort((a, b) => pageOf(a) - pageOf(b) || a.pageIndex - b.pageIndex); // ổn định theo folder trang, rồi theo thứ tự panel
    for (const sc of ordered) if (pageOf(sc) >= 0 && pageOf(sc) < pcs) counts[pageOf(sc)]++;
    // v6r: trọng số lia (panWeight trên scene, mang theo trong snapshot) —
    // trang nào đủ trọng số cho mọi cảnh thì chia theo trọng số, khớp
    // getEffectiveDurations phía workspace.
    const weightsByPage = Array.from({ length: pcs }, () => []);
    for (const sc of ordered) if (pageOf(sc) >= 0 && pageOf(sc) < pcs) weightsByPage[pageOf(sc)].push(sc.panWeight);
    const normWeights = weightsByPage.map((ws, p) => (counts[p] > 0 && ws.length === counts[p] && ws.every(w => Number(w) > 0)) ? ws : null);
    const flatWeights = []; let flatOk = true;
    for (let p = 0; p < pcs; p++) { if (!counts[p]) continue; if (normWeights[p]) flatWeights.push(...normWeights[p]); else flatOk = false; }
    const vd = computeVoiceDurations({
      pageCount: pcs, scenesPerPage: counts,
      pageSegments: voiceResult.pageSegments || {}, D: voiceResult.duration, fps: [30,45,60].includes(Number(settings.fps)) ? Number(settings.fps) : 60,
      sceneWeightsPerPage: normWeights, sceneWeights: flatOk ? flatWeights : null,
    });
    // v6k: perScene chỉ chứa các trang CÓ mốc (mode partial) — phải map theo thứ
    // tự scene của CÁC TRANG CÒN LẠI (bỏ qua scene của trang bị loại, kể cả trang
    // ở giữa chap), nếu không duration sẽ lệch sang trang kế. Scene của trang bị
    // bỏ không nhận duration; caller dùng droppedPageIndices để loại khỏi render.
    const droppedPages = new Set(vd.droppedPageIndices || []);
    const keptOrdered = droppedPages.size ? ordered.filter(sc => !droppedPages.has(pageOf(sc))) : ordered;
    keptOrdered.forEach((sc, i) => { if (i < vd.perScene.length) map.set(sc.id, vd.perScene[i] ?? 0); });
    return { map, fallback: vd.fallback, reason: vd.reason, mode: vd.mode || null, droppedPageIndices: vd.droppedPageIndices || [] };
  }
  const mode = settings.durationMode || 'scene';
  const fallbackSeconds = Number(settings.seconds) || 4;
  if (mode === 'scene') {
    for (const sc of list) map.set(sc.id, sc.duration ?? fallbackSeconds);
    return { map, fallback: false, reason: '' };
  }
  // Gom cảnh theo trang (giữ thứ tự render).
  const groups = [];
  const seen = new Map();
  for (const sc of list) {
    const page=pageOf(sc);
    if (!seen.has(page)) { seen.set(page, groups.length); groups.push([]); }
    groups[seen.get(page)].push(sc);
  }
  if (!groups.length) return { map, fallback: false, reason: '' };
  if (mode === 'total') {
    const bounds = durationBoundsPure('total', groups);
    const target = clamp(Number(settings.totalSeconds) || bounds.min, bounds.min, bounds.max);
    const fps = [30,45,60].includes(Number(settings.fps)) ? Number(settings.fps) : 60;
    const totalFrames = Math.max(1, Math.round(target * fps));
    const pageFrames = shareFrames(totalFrames, groups.length);
    groups.forEach((items, gi) => {
      const sceneFrames = shareJobSceneFrames(pageFrames[gi], items);
      items.forEach((sc, i) => map.set(sc.id, sceneFrames[i] / fps));
    });
  } else { // 'page'
    const bounds = durationBoundsPure('page', groups);
    const pageSeconds = clamp(Number(settings.pageSeconds) || bounds.min, bounds.min, bounds.max);
    const fps = [30,45,60].includes(Number(settings.fps)) ? Number(settings.fps) : 60;
    const pageFrameCount = Math.max(1, Math.round(pageSeconds * fps));
    for (const items of groups) {
      const sceneFrames = shareJobSceneFrames(pageFrameCount, items);
      items.forEach((sc, i) => map.set(sc.id, sceneFrames[i] / fps));
    }
  }
  return { map, fallback: false, reason: '' };
}

// Job đang dở (voice/render) lúc app đóng → đánh dấu lỗi gián đoạn, không tự chạy lại.
export function markInterrupted(jobs) {
  let changed = 0;
  for (const j of (jobs || [])) {
    if (j.status === 'voice' || j.status === 'render') {
      const now=Date.now();
      if(Number(j.runStartedAt)>0)j.elapsedMs=(Number(j.elapsedMs)||0)+Math.max(0,now-Number(j.runStartedAt));
      j.runStartedAt=null;j.completedAt=now;
      j.status = 'loi';
      j.note = '';
      j.error = 'Bị gián đoạn (app đã đóng trước khi xong).';
      j.updatedAt = Date.now();
      changed++;
    }
  }
  return changed;
}

export function canRetryJob(job) { return job && job.status === 'loi'; }

function errMessage(err) {
  return String((err && err.message) || err || 'lỗi không rõ').slice(0, 300);
}

// Bộ xử lý hàng đợi tuần tự (thuần): duyệt các job status 'cho' theo thứ tự mảng.
// hooks: { generateVoice(job, onCueProgress) -> voiceResult, renderJob(job, voiceResult, onPct) -> {outputPath},
//          persist(job), onJob(job), onNote(job), shouldStop() }.
// Job lỗi → ghi lỗi, CHẠY TIẾP job sau (không chặn hàng đợi).
export async function runJobQueue(jobs, hooks = {}) {
  const { generateVoice, renderJob, persist, onJob, onNote, shouldStop } = hooks;
  if (typeof generateVoice !== 'function' || typeof renderJob !== 'function') {
    throw new Error('Thiếu hooks generateVoice/renderJob.');
  }
  const stats = { total: 0, done: 0, error: 0, stopped: false };
  const prefetchedVoice = new Map();
  const setStatus = async (job, status, note = '') => {
    const now=Date.now();
    if(status==='voice'||status==='render'){
      if(!job.startedAt)job.startedAt=now;
      if(!job.runStartedAt)job.runStartedAt=now;
      job.completedAt=null;
    }else if(Number(job.runStartedAt)>0){
      job.elapsedMs=(Number(job.elapsedMs)||0)+Math.max(0,now-Number(job.runStartedAt));
      job.runStartedAt=null;job.completedAt=now;
    }
    job.status = status; job.note = note; job.updatedAt = now;
    try { await persist?.(job); } catch {}
    try { onJob?.(job); } catch {}
  };
  const setNote = (job, note) => {
    job.note = note;
    try { onNote?.(job); } catch {}
  };

  const voiceNeeded = job => {
    const v = job.voice || { kind: 'none' };
    return v.kind !== 'none' && Array.isArray(v.cues) && v.cues.length > 0;
  };
  const startVoice = async job => {
    await setStatus(job, 'voice', 'Bắt đầu tạo voice…');
    return generateVoice(job, p => {
      const voice = job.voice || {};
      const done = p && p.done != null ? p.done : 0;
      const total = (p && p.total) || (voice.cues || []).length;
      setNote(job, p?.note || `Đang tạo voice: ${done}/${total} cue`);
    }).then(result => ({ result }), error => ({ error }));
  };
  const prefetchNextVoice = currentIndex => {
    if (shouldStop && shouldStop()) return;
    for (let i = currentIndex + 1; i < jobs.length; i++) {
      const next = jobs[i];
      if (next.status !== 'cho') continue;
      if (!voiceNeeded(next)) continue;
      if (!prefetchedVoice.has(next.id)) prefetchedVoice.set(next.id, startVoice(next));
      return;
    }
  };

  for (let jobIndex = 0; jobIndex < (jobs || []).length; jobIndex++) {
    const job = jobs[jobIndex];
    if (shouldStop && shouldStop()) { stats.stopped = true; break; }
    const voiceTask = prefetchedVoice.get(job.id);
    if (job.status !== 'cho' && !voiceTask) continue;
    stats.total++;
    let voiceResult = null;
    if (voiceNeeded(job)) {
      const task = voiceTask || startVoice(job);
      const outcome = await task;
      prefetchedVoice.delete(job.id);
      if (outcome.error) {
        const err = outcome.error;
        if (shouldStop && shouldStop() && err && err.code === 'CANCELLED') {
          job.error = null;
          await setStatus(job, 'cho', 'Đã dừng theo yêu cầu; có thể chạy lại job này.');
          stats.stopped = true;
          for (const [id, pending] of prefetchedVoice) {
            const next = jobs.find(item => item.id === id);
            await pending;
            if (next && next.status === 'voice') await setStatus(next, 'cho', 'Đã dừng theo yêu cầu; có thể chạy lại job này.');
          }
          break;
        }
        job.error = `Lỗi tạo voice: ${errMessage(err)}`;
        await setStatus(job, 'loi', '');
        stats.error++;
        continue;
      }
      voiceResult = outcome.result;
    }
    if (shouldStop && shouldStop()) {
      await setStatus(job, 'cho', 'Đã dừng theo yêu cầu; có thể chạy lại job này.');
      stats.stopped = true;
      break;
    }
    await setStatus(job, 'render', 'Đang chuẩn bị cảnh…');
    // Tạo voice chap kế tiếp trong khi FFmpeg đang render chap hiện tại.
    prefetchNextVoice(jobIndex);
    try {
      const res = await renderJob(job, voiceResult, (pct) => setNote(job, `Đang render: ${Math.round(Number(pct) || 0)}%`));
      job.outputPath = res && res.outputPath ? res.outputPath : (job.outputPath || null);
      job.error = null;
      // v6k: cho người dùng thấy job đã render bằng GPU (NVENC) hay CPU.
      const encNote = res && res.encoder ? (res.encoder === 'nvenc' ? ' · GPU (NVENC)' : ' · CPU') : '';
      await setStatus(job, 'xong', (job.outputPath ? `Đã lưu: ${job.outputPath}` : 'Xong.') + encNote);
      stats.done++;
    } catch (err) {
      if (shouldStop && shouldStop() && err && err.code === 'CANCELLED') {
        job.error = null;
        await setStatus(job, 'cho', 'Đã dừng theo yêu cầu; có thể chạy lại job này.');
        stats.stopped = true;
        for (const [id, pending] of prefetchedVoice) {
          const next = jobs.find(item => item.id === id);
          const outcome = await pending;
          if (next && next.status === 'voice') {
            if (outcome.error && outcome.error.code !== 'CANCELLED') {
              next.error = `Lỗi tạo voice: ${errMessage(outcome.error)}`;
              await setStatus(next, 'loi', '');
              stats.error++;
            } else await setStatus(next, 'cho', 'Đã dừng theo yêu cầu; có thể chạy lại job này.');
          }
          prefetchedVoice.delete(id);
        }
        break;
      }
      job.error = `Lỗi render: ${errMessage(err)}`;
      await setStatus(job, 'loi', '');
      stats.error++;
    }
  }
  // Không để lại voice prefetch dang dở nếu vòng lặp kết thúc do Stop hoặc lỗi.
  if (prefetchedVoice.size) {
    for (const [id, pending] of prefetchedVoice) {
      const next = jobs.find(item => item.id === id);
      const outcome = await pending;
      if (next && next.status === 'voice') {
        if (outcome.error && outcome.error.code !== 'CANCELLED') {
          next.error = `Lỗi tạo voice: ${errMessage(outcome.error)}`;
          await setStatus(next, 'loi', '');
          stats.error++;
        } else await setStatus(next, 'cho', 'Voice đã tạo xong; bấm chạy hàng đợi để tiếp tục.');
      }
    }
  }
  return stats;
}
