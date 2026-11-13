// strip-slicer.js — cắt dải dọc cho truyện cuộn Manhwa.
// Module THUẦN (không DOM, không canvas): đầu vào là "hồ sơ hàng" (row profile)
// của ảnh trang — mỗi hàng có màu trung bình + phương sai độ sáng — nên test
// được bằng node --test với profile tổng hợp, không cần file ảnh thật.
// Manga (Nhật) KHÔNG qua module này: vẫn dùng model ONNX như cũ.
//
// Ý tưởng: trang manhwa là dải ảnh cao, các panel ngăn nhau bằng DẢI
// NGANG PHẲNG. Hàng "trống" = phương sai thấp trên toàn chiều ngang; màu của
// dải không quan trọng (trắng, xám, be, đen hay màu khác).

export const COMIC_STYLES = ['manga', 'manhwa', 'hybrid'];

export function normalizeComicStyle(value) {
  return value === 'manhwa' || value === 'hybrid' ? value : 'manga';
}

export function isStripStyle(value) {
  const s = normalizeComicStyle(value);
  return s === 'manhwa';
}

// Ảnh được coi là "dải cao" (cuộn dọc) khi cao/rộng >= 1.3.
export const TALL_RATIO = 1.3;
// Đoạn sau khi phóng lấp chiều ngang 1920 không được cao quá 4.2 lần khung
// 1080 — cao hơn nữa thì lia dọc cũng không đọc kịp, phải chia nhỏ thêm.
// (v6q: nới từ 2.6 -> 4.2 — mức 2.6 ép chia cả panel nguyên vẹn ~1200px gốc
// ở dải rộng 720, cắt ngang thân nhân vật; panel nguyên lia dọc tự nhiên hơn.)
export const MAX_SCALED_HEIGHT = 4.2 * 1080;
// Ngưỡng phương sai (độ sáng) để coi 1 hàng là "phẳng" (một màu đều).
const FLAT_VARIANCE = 64;
// Ngưỡng nới lỏng khi tìm điểm chia trong đoạn quá cao (gần như phẳng).
const NEAR_FLAT_VARIANCE = 900;
// Đoạn ngắn hơn mức này (px gốc) coi là rác/dải phân cách sót -> bỏ.
const MIN_SEGMENT_PX = 60;
// (v6q) Đoạn "yếu" bị gộp vào đoạn kề thay vì đứng một mình thành 1 cảnh:
// dải mỏng < 170px (hiển thị chưa tới 1/2 khung), đoạn "trắng/toàn chữ"
// (bong bóng thoại / hộp thoại lẻ trên nền trắng, sáng trung bình >= 238,
// cao <= 420px), và "thẻ đen" chuyển cảnh (cao <= 240px, >= 80% số hàng
// tối <= 115 — panel đen nguyên khối bị hụt sáng trung bình vì viền trắng
// hai bên nên không dùng ngưỡng sáng trung bình thuần).
const MIN_KEEP_PX = 170;
const WASH_MAX_PX = 420;
const WASH_HI_LUM = 238;
const WASH_LO_LUM = 18;
const BLACKCARD_MAX_PX = 240;
// Hai nửa khi buộc phải chia đoạn quá cao đều >= mức này (px gốc).
const MIN_SPLIT_HALF = 220;

function lumOf(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
function clampNum(x, min, max) { return Math.min(max, Math.max(min, x)); }

// Dựng hồ sơ hàng từ dữ liệu RGBA (Uint8ClampedArray của canvas/ImageData).
// Chỉ lấy mẫu tối đa ~240 cột cho nhanh; đủ tin cậy để nhận diện dải trống.
export function computeRowProfile(rgba, width, height) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const r = new Float64Array(h), g = new Float64Array(h), b = new Float64Array(h);
  const lum = new Float64Array(h), variance = new Float64Array(h);
  const stepX = Math.max(1, Math.ceil(w / 240));
  const samples = Math.max(1, Math.floor((w + stepX - 1) / stepX));
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x += stepX) {
      const i = rowBase + x * 4;
      const pr = rgba[i], pg = rgba[i + 1], pb = rgba[i + 2];
      const pl = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      sr += pr; sg += pg; sb += pb; sl += pl; sl2 += pl * pl;
    }
    r[y] = sr / samples; g[y] = sg / samples; b[y] = sb / samples;
    const mean = sl / samples;
    lum[y] = mean;
    variance[y] = Math.max(0, sl2 / samples - mean * mean);
  }
  return { r, g, b, lum, variance };
}

function flatColorKey(profile, y) {
  return `${Math.round(profile.r[y] / 16)}-${Math.round(profile.g[y] / 16)}-${Math.round(profile.b[y] / 16)}`;
}

// Gom các hàng PHẲNG theo màu (lượng tử hóa 16 mức mỗi kênh).
function flatColorBuckets(profile) {
  const h = profile.lum.length;
  const buckets = new Map();
  for (let y = 0; y < h; y++) {
    if (profile.variance[y] > FLAT_VARIANCE) continue;
    const key = flatColorKey(profile, y);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { r: 0, g: 0, b: 0, count: 0 }; buckets.set(key, bucket); }
    bucket.r += profile.r[y]; bucket.g += profile.g[y]; bucket.b += profile.b[y]; bucket.count++;
  }
  return buckets;
}

// Màu phẳng xuất hiện nhiều nhất trong trang. Giữ helper để phục vụ chẩn đoán
// và tương thích; việc dò dải ngăn không còn phụ thuộc vào một màu chủ đạo.
export function estimateGutterColor(profile) {
  let best = null;
  for (const bucket of flatColorBuckets(profile).values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  const r = best.r / best.count, g = best.g / best.count, b = best.b / best.count;
  return { r, g, b, lum: lumOf(r, g, b), count: best.count };
}

// Điểm chia cho đoạn buộc phải cắt nhỏ (v6q — chấm điểm 3 tầng, chỉ nhận
// điểm mà cả hai nửa đều >= MIN_SPLIT_HALF):
//  1) Tâm cụm hàng "gần phẳng" (phương sai <= 900) dài nhất, cụm >= 6 hàng —
//     thường trúng vùng nền/gradient trống giữa hai panel dính nhau.
//  2) Hàng có bước nhảy màu trung bình mạnh nhất (so hàng y-3 với y+3) —
//     ranh giới hai mảng tranh khác tông trong panel montage/full-bleed.
//  3) Hàng yên nhất (phương sai thấp nhất) trong 1/3 giữa đoạn.
// Không chia được (đoạn < 2 * MIN_SPLIT_HALF) -> -1, giữ nguyên đoạn.
function findSplitPoint(seg, profile) {
  const lo = seg.y0 + MIN_SPLIT_HALF, hi = seg.y1 - MIN_SPLIT_HALF;
  if (hi <= lo) return -1;
  let runStart = -1, bestLen = 0, bestAt = -1;
  for (let y = seg.y0 + 8; y < seg.y1 - 8; y++) {
    if (profile.variance[y] <= NEAR_FLAT_VARIANCE) {
      if (runStart < 0) runStart = y;
      const len = y - runStart + 1;
      const at = runStart + Math.floor(len / 2);
      if (len >= 6 && at >= lo && at <= hi && len > bestLen) { bestLen = len; bestAt = at; }
    } else runStart = -1;
  }
  if (bestAt >= 0) return bestAt;
  let bestJump = -1, jumpAt = -1;
  for (let y = lo; y <= hi; y++) {
    if (y - 3 < seg.y0 || y + 3 >= seg.y1) continue;
    const jump = Math.abs(profile.r[y + 3] - profile.r[y - 3])
      + Math.abs(profile.g[y + 3] - profile.g[y - 3])
      + Math.abs(profile.b[y + 3] - profile.b[y - 3]);
    if (jump > bestJump) { bestJump = jump; jumpAt = y; }
  }
  // Chỉ nhận bước nhảy đủ rõ (> 24 tổng 3 kênh); nhảy ~0 khắp đoạn nghĩa là
  // tranh đồng nhất, điểm yên nhất ở giữa (tầng 3) là lựa chọn cân hơn.
  if (jumpAt >= 0 && bestJump > 24) return jumpAt;
  const segH = seg.y1 - seg.y0;
  const mLo = seg.y0 + Math.floor(segH / 3), mHi = seg.y1 - Math.floor(segH / 3);
  let bestVar = Infinity, splitAt = -1;
  for (let y = mLo; y < mHi; y++) {
    if (profile.variance[y] < bestVar) { bestVar = profile.variance[y]; splitAt = y; }
  }
  return splitAt >= 0 ? splitAt : seg.y0 + Math.floor(segH / 2);
}

// Chia đoạn quá cao: lặp lại cho đến khi mọi đoạn phóng lấp ngang đều
// <= MAX_SCALED_HEIGHT. Đoạn không tìm được điểm chia hợp lệ thì giữ
// nguyên (lia dọc dài còn hơn cắt bừa); vòng lặp chắc chắn kết thúc vì
// mỗi lần chia hai nửa đều nhỏ hơn đoạn cha.
function splitTallSegments(segments, profile, fillScale) {
  const out = [];
  const stack = [...segments];
  let guard = 0;
  while (stack.length && guard++ < 512) {
    const seg = stack.pop();
    const segH = seg.y1 - seg.y0;
    if (segH * fillScale <= MAX_SCALED_HEIGHT) { out.push(seg); continue; }
    const splitAt = findSplitPoint(seg, profile);
    if (splitAt < 0) { out.push(seg); continue; }
    stack.push({ y0: seg.y0, y1: splitAt }, { y0: splitAt, y1: seg.y1 });
  }
  out.sort((a, b) => a.y0 - b.y0);
  return out;
}

function segmentMeanLum(profile, seg) {
  let sum = 0;
  for (let y = seg.y0; y < seg.y1; y++) sum += profile.lum[y];
  return sum / Math.max(1, seg.y1 - seg.y0);
}

// Đoạn "yếu" (v6q): đứng một mình sẽ thành cảnh hụt/lơ lửng trong khung —
// gộp vào đoạn kề để lia dọc đi qua luôn (xem hằng số MIN_KEEP_PX ở đầu file).
function isWeakSegment(profile, seg) {
  const segH = seg.y1 - seg.y0;
  if (segH < MIN_KEEP_PX) return true;
  if (segH <= BLACKCARD_MAX_PX) {
    let dark = 0;
    for (let y = seg.y0; y < seg.y1; y++) if (profile.lum[y] <= 115) dark++;
    if (dark / segH >= 0.8) return true;
  }
  if (segH <= WASH_MAX_PX) {
    const mean = segmentMeanLum(profile, seg);
    if (mean >= WASH_HI_LUM || mean <= WASH_LO_LUM) return true;
  }
  return false;
}

// Gộp các đoạn yếu vào đoạn TRƯỚC (nuốt luôn dải phân cách ở giữa); đoạn
// yếu ở đầu trang thì gộp vào đoạn SAU. Mọi đoạn đều yếu -> 1 đoạn gộp cả.
function mergeWeakSegments(segments, profile) {
  if (segments.length < 2) return segments;
  const out = [];
  let pendingStart = -1;
  for (const seg of segments) {
    if (isWeakSegment(profile, seg)) {
      if (out.length) out[out.length - 1].y1 = seg.y1;
      else if (pendingStart < 0) pendingStart = seg.y0;
      continue;
    }
    out.push({ y0: pendingStart >= 0 ? pendingStart : seg.y0, y1: seg.y1 });
    pendingStart = -1;
  }
  if (!out.length) return [{ y0: segments[0].y0, y1: segments[segments.length - 1].y1 }];
  if (pendingStart >= 0) out[0].y0 = pendingStart;
  return out;
}

// Cắt 1 trang dải dọc thành các đoạn {y0, y1} (px gốc, y1 không gồm).
// profile: {r,g,b,lum,variance} theo hàng; width/height: kích thước ảnh gốc.
// Trả { tall, segments }. Không phải dải cao -> tall:false + 1 đoạn toàn trang.
// Trang toàn trống / không tìm thấy dải phân cách -> 1 đoạn toàn trang (guard
// để logic mốc [TRANG n] không bao giờ thấy trang 0 cảnh ngoài ý muốn).
export function sliceStripProfile(profile, width, height, style) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const whole = [{ y0: 0, y1: h }];
  if (!(h / w >= TALL_RATIO)) return { tall: false, segments: whole };
  if (!profile || !profile.lum || profile.lum.length < h) return { tall: true, segments: whole };
  const minBand = Math.max(10, Math.round(h * 0.004));
  // Phân cách theo cấu trúc hàng phẳng, không theo màu: chấp nhận dải ngang
  // liên tục đủ minBand hàng. Kiểm tra phương sai cả hàng giúp tránh cắt vào
  // bong bóng thoại có chữ/viền. Ngoại lệ: một dải xám tối cô lập, dài kiểu
  // thẻ chuyển cảnh, không phải khe; cùng màu tối lặp lại ở nhiều dải vẫn hợp lệ.
  const colorBuckets = flatColorBuckets(profile);
  const separators = [];
  let runStart = -1;
  const sameFlatColor = (a, b) => Math.max(
    Math.abs(profile.r[a] - profile.r[b]),
    Math.abs(profile.g[a] - profile.g[b]),
    Math.abs(profile.b[a] - profile.b[b]),
  ) <= 26;
  const finishRun = (end) => {
    if (runStart < 0) return;
    const runLength = end - runStart;
    if (runLength >= minBand) {
      let meanLum = 0, meanR = 0, meanG = 0, meanB = 0;
      for (let row = runStart; row < end; row++) {
        meanLum += profile.lum[row]; meanR += profile.r[row]; meanG += profile.g[row]; meanB += profile.b[row];
      }
      meanLum /= runLength; meanR /= runLength; meanG /= runLength; meanB /= runLength;
      const neutral = Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB) <= 16;
      const bucket = colorBuckets.get(flatColorKey(profile, runStart));
      const repeatedDarkBand = Boolean(bucket) && bucket.count >= Math.max(BLACKCARD_MAX_PX, Math.round(h * 0.1));
      const isolatedDarkCard = neutral && meanLum > WASH_LO_LUM && meanLum <= 115
        && runLength >= MIN_KEEP_PX && runLength <= BLACKCARD_MAX_PX && !repeatedDarkBand;
      if (!isolatedDarkCard) separators.push({ y0: runStart, y1: end });
    }
    runStart = -1;
  };
  for (let y = 0; y <= h; y++) {
    const blank = y < h && profile.variance[y] <= FLAT_VARIANCE;
    const sameColor = blank && runStart >= 0 && sameFlatColor(y - 1, y);
    if (runStart >= 0 && (!blank || !sameColor)) finishRun(y);
    if (blank && runStart < 0) runStart = y;
  }
  // Đoạn = phần bù giữa các dải phân cách (tự cắt trắng ở hai đầu trang).
  let segments = [];
  let cursor = 0;
  for (const sep of separators) {
    if (sep.y0 > cursor) segments.push({ y0: cursor, y1: sep.y0 });
    cursor = Math.max(cursor, sep.y1);
  }
  if (cursor < h) segments.push({ y0: cursor, y1: h });
  // Bỏ đoạn quá ngắn (dải phân cách sót / rác).
  segments = segments.filter(seg => seg.y1 - seg.y0 >= MIN_SEGMENT_PX);
  if (!segments.length) return { tall: true, segments: whole };
  // (v6q) Gộp đoạn yếu (dải mỏng / bong bóng thoại lẻ / thẻ đen) vào đoạn kề.
  segments = mergeWeakSegments(segments, profile);
  // Đoạn còn quá cao sau khi phóng lấp ngang -> chia nhỏ thêm.
  segments = splitTallSegments(segments, profile, 1920 / w);
  return { tall: true, segments };
}

// Trọng số chia thời lượng cho 1 đoạn dải dọc (v6r): phần chiều cao TRÀN
// khung khi phóng lấp ngang (đúng ngưỡng pan/zoom của khâu dựng panel:
// scaledH > 1080 -> lia dọc) cộng nền 540 (nửa khung) để đoạn vừa khung vẫn
// có phần thời gian tử tế cho chuyển động zoom. Đoạn lia càng dài -> trọng
// số càng lớn -> được chia càng nhiều thời gian trong trang -> tốc độ lia
// đều giữa các cảnh thay vì chia đều thời gian (đoạn cao lia nhanh gấp
// mấy lần đoạn thấp). Trả null khi số liệu không hợp lệ.
export function stripPanWeight(crop, pageW, pageH) {
  const w = Number(pageW) || 0, h = Number(pageH) || 0;
  if (!crop || !(w > 0) || !(h > 0)) return null;
  const segH = (Number(crop.h) || 0) / 100 * h;
  const scaledH = segH * 1920 / w;
  if (!(scaledH > 0)) return null;
  return Math.max(0, scaledH - 1080) + 540;
}

// Nội dung đoạn theo % trang (đúng định dạng crop của scene): luôn lấp ngang.
export function stripSegmentCrop(segment, height) {
  const h = Math.max(1, Number(height) || 1);
  return {
    x: 0,
    y: clampNum(segment.y0 / h * 100, 0, 100),
    w: 100,
    h: clampNum((segment.y1 - segment.y0) / h * 100, 0, 100),
  };
}
