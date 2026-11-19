// strip-slicer.js — dò separator cho ảnh cuộn Manhwa/Manhua.
// VÁ LONG-FIX (26/10/2026, cho ảnh dài nền đen / ảnh chụp màn hình có dải hẹp):
// - Hàng separator không còn bắt buộc spread <= 12 nữa: dải đen chụp màn hình
//   có spread = 14 (nhiễu JPEG / nền xanh đen) đã bị loại sạch trước đây.
//   Nay: spread <= 32, hoặc hàng >= 95% pixel tối (< 50), hoặc gần trắng >= 99,5%.
// - Dải tối / trắng được phép trôi màu tới 80 (gradient đỏ->đen, trời tối dần),
//   thay vì tổng trôi > 16 là hỏng dải.
// - Ngưỡng tự động tối thiểu 12px (giữ tương thích test dải 20px gốc);
//   với ảnh dài kiểu Sword Hound, nên kéo thanh "Độ dày khe tối thiểu"
//   lên 25-50px để không tách khoảng đen giữa các dòng chữ / giọt máu.
// - Dải dài >= 150px không còn bị "bảo vệ ranh giới trang" chặn cắt nữa:
//   dải dài ở ranh giới trang vẫn là điểm cắt thật, chỉ dải ngắn mới được bảo vệ.
// Một điểm cắt chỉ hợp lệ khi có dải ngang đồng màu trên toàn chiều rộng
// VÙNG NỘI DUNG (sau khi main.js đã cắt bỏ viền/bar bên ngoài, nếu có).

export const COMIC_STYLES = ['manga', 'manhwa', 'manhua'];
export const MAX_MIN_GAP_PX = 1000;

export function normalizeComicStyle(value) {
  return value === 'manhwa' || value === 'manhua' ? value : 'manga';
}

export function isStripStyle(value) {
  const style = normalizeComicStyle(value);
  return style === 'manhwa' || style === 'manhua';
}

export const TALL_RATIO = 1.3;
const FLAT_VARIANCE = 64;
const MAX_ROW_COLOR_SPREAD = 32;
const MAX_BAND_COLOR_DELTA = 16;
const MAX_DARK_WHITE_BAND_DELTA = 80;
const MIN_NEAR_WHITE_COVERAGE = 0.995;
const MIN_DARK_COVERAGE = 0.95;
const LONG_SEPARATOR_PX = 150;
const MIN_SEGMENT_PX = 60;
const MIN_KEEP_PX = 170;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Tính trung bình và độ trải màu theo từng hàng, đọc toàn bộ cột để một họa
// tiết/chữ nhỏ cũng ngăn hàng đó khỏi bị xem là separator đồng màu.
export function computeRowProfile(rgba, width, height) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const r = new Float64Array(h), g = new Float64Array(h), b = new Float64Array(h);
  const lum = new Float64Array(h), variance = new Float64Array(h), colorSpread = new Float64Array(h), nearWhiteCoverage = new Float64Array(h), darkCoverage = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
    let nearWhitePixels = 0;
    let darkPixels = 0;
    let minR = 255, minG = 255, minB = 255, minA = 255;
    let maxR = 0, maxG = 0, maxB = 0, maxA = 0;
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowBase + x * 4;
      const pr = rgba[i], pg = rgba[i + 1], pb = rgba[i + 2], pa = rgba[i + 3];
      const pixelLum = luminance(pr, pg, pb);
      sr += pr; sg += pg; sb += pb; sl += pixelLum; sl2 += pixelLum * pixelLum;
      if (pr >= 230 && pg >= 230 && pb >= 230 && pa >= 240) nearWhitePixels++;
      if (pixelLum < 50) darkPixels++;
      minR = Math.min(minR, pr); minG = Math.min(minG, pg); minB = Math.min(minB, pb); minA = Math.min(minA, pa);
      maxR = Math.max(maxR, pr); maxG = Math.max(maxG, pg); maxB = Math.max(maxB, pb); maxA = Math.max(maxA, pa);
    }
    r[y] = sr / w; g[y] = sg / w; b[y] = sb / w;
    const meanLum = sl / w;
    lum[y] = meanLum;
    variance[y] = Math.max(0, sl2 / w - meanLum * meanLum);
    colorSpread[y] = Math.max(maxR - minR, maxG - minG, maxB - minB, maxA - minA);
    nearWhiteCoverage[y] = nearWhitePixels / w;
    darkCoverage[y] = darkPixels / w;
  }
  return { r, g, b, lum, variance, colorSpread, nearWhiteCoverage, darkCoverage };
}

function flatColorKey(profile, y) {
  return `${Math.round(profile.r[y] / 16)}-${Math.round(profile.g[y] / 16)}-${Math.round(profile.b[y] / 16)}`;
}

function flatColorBuckets(profile) {
  const buckets = new Map();
  for (let y = 0; y < profile.lum.length; y++) {
    if (profile.variance[y] > FLAT_VARIANCE) continue;
    const key = flatColorKey(profile, y);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { r: 0, g: 0, b: 0, count: 0 }; buckets.set(key, bucket); }
    bucket.r += profile.r[y]; bucket.g += profile.g[y]; bucket.b += profile.b[y]; bucket.count++;
  }
  return buckets;
}

export function estimateGutterColor(profile) {
  let best = null;
  for (const bucket of flatColorBuckets(profile).values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  const r = best.r / best.count, g = best.g / best.count, b = best.b / best.count;
  return { r, g, b, lum: luminance(r, g, b), count: best.count };
}

function isUniformRow(profile, y) {
  if (profile.colorSpread && profile.colorSpread.length > y) {
    if (profile.colorSpread[y] <= MAX_ROW_COLOR_SPREAD) return true;
    if (profile.nearWhiteCoverage?.length > y && profile.nearWhiteCoverage[y] >= MIN_NEAR_WHITE_COVERAGE) return true;
    // Hàng gần như toàn tối: dải đen có nhiễu JPEG / nền xanh đen (spread 14-30)
    // vẫn là separator, miễn là không có họa tiết/chữ sáng xuyên qua hàng.
    return profile.darkCoverage?.length > y && profile.darkCoverage[y] >= MIN_DARK_COVERAGE;
  }
  // Backward compatibility for profiles made by older versions/tests.
  return profile.variance[y] <= FLAT_VARIANCE;
}

// LONG-FIX: ngưỡng "đoạn quá nhỏ" phải tính theo chiều rộng dải, không
// phải px tuyệt đối. Đoạn 149px ở dải hẹp 83px, phóng lên 1920px rộng sẽ
// cao ~3446px (panel đầy đủ), trong khi đoạn 149px ở dải 728px chỉ cao
// ~393px (chưa tới nửa khung). Công thức cũ MIN_KEEP_PX = 170 gộp sạch
// panel đầu/cuối của ảnh chụp màn hình hẹp thành 1 đoạn duy nhất.
function mergeSmallSegments(segments, width) {
  const w = Math.max(1, Number(width) || 1);
  const minKeep = Math.max(MIN_SEGMENT_PX, Math.round(440 * w / 1920));
  const segmentIsTooSmall = segment => segment.y1 - segment.y0 < minKeep;
  if (segments.length < 2) return segments;
  const out = [];
  let pendingStart = -1;
  for (const segment of segments) {
    if (segmentIsTooSmall(segment)) {
      if (out.length) out[out.length - 1].y1 = segment.y1;
      else if (pendingStart < 0) pendingStart = segment.y0;
      continue;
    }
    out.push({ y0: pendingStart >= 0 ? pendingStart : segment.y0, y1: segment.y1 });
    pendingStart = -1;
  }
  if (!out.length) return [{ y0: segments[0].y0, y1: segments[segments.length - 1].y1 }];
  if (pendingStart >= 0) out[0].y0 = pendingStart;
  return out;
}

// Cắt chỉ tại separator đồng màu trải hết chiều ngang; không lọc màu theo
// luminance và không tự chia các đoạn dài nếu không có separator hợp lệ.
export function sliceStripProfile(profile, width, height, style, options = {}) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const whole = [{ y0: 0, y1: h }];
  if (!(h / w >= TALL_RATIO)) return { tall: false, segments: whole };
  if (!profile?.lum || profile.lum.length < h) return { tall: true, segments: whole };

  const requestedReferenceHeight = Number(options.referenceHeight);
  const referenceHeight = Number.isFinite(requestedReferenceHeight) && requestedReferenceHeight > 0
    ? Math.min(h, Math.round(requestedReferenceHeight)) : h;
  const requestedMinGap = Number(options.minGapPx);
  const minBand = Number.isFinite(requestedMinGap) && requestedMinGap > 0
    ? Math.min(MAX_MIN_GAP_PX, Math.max(1, Math.round(requestedMinGap)))
    : normalizeComicStyle(style) === 'manhua'
      ? Math.max(12, Math.round(referenceHeight * 0.00045))
      : Math.max(12, Math.round(referenceHeight * 0.00075));
  const protectedRows = Array.isArray(options.protectedRows)
    ? options.protectedRows.map(Number).filter(row => Number.isFinite(row) && row > 0 && row < h)
    : [];

  const separators = [];
  let runStart = -1;
  let runColorRange = null;
  let runHasOneColor = true;
  let runLastColor = null;
  let runBandDelta = MAX_BAND_COLOR_DELTA;
  const finishRun = end => {
    if (runStart >= 0 && runHasOneColor && end - runStart >= minBand) separators.push({ y0: runStart, y1: end });
    runStart = -1;
    runColorRange = null;
    runHasOneColor = true;
    runLastColor = null;
    runBandDelta = MAX_BAND_COLOR_DELTA;
  };

  for (let y = 0; y <= h; y++) {
    const uniform = y < h && isUniformRow(profile, y);
    if (runStart >= 0 && !uniform) finishRun(y);
    if (uniform) {
      const color = { r: profile.r[y], g: profile.g[y], b: profile.b[y] };
      if (runStart >= 0 && runLastColor && Math.max(
        Math.abs(color.r - runLastColor.r),
        Math.abs(color.g - runLastColor.g),
        Math.abs(color.b - runLastColor.b),
      ) > runBandDelta) finishRun(y);
      if (runStart < 0) {
        runStart = y;
        // Dải tối (< 80) hoặc trắng (> 200) được phép trôi màu dần (gradient).
        const rowLum = luminance(color.r, color.g, color.b);
        runBandDelta = (rowLum < 80 || rowLum > 200) ? MAX_DARK_WHITE_BAND_DELTA : MAX_BAND_COLOR_DELTA;
        runColorRange = { minR: color.r, maxR: color.r, minG: color.g, maxG: color.g, minB: color.b, maxB: color.b };
      } else {
        runColorRange.minR = Math.min(runColorRange.minR, color.r);
        runColorRange.maxR = Math.max(runColorRange.maxR, color.r);
        runColorRange.minG = Math.min(runColorRange.minG, color.g);
        runColorRange.maxG = Math.max(runColorRange.maxG, color.g);
        runColorRange.minB = Math.min(runColorRange.minB, color.b);
        runColorRange.maxB = Math.max(runColorRange.maxB, color.b);
        if (Math.max(
          runColorRange.maxR - runColorRange.minR,
          runColorRange.maxG - runColorRange.minG,
          runColorRange.maxB - runColorRange.minB,
        ) > runBandDelta) runHasOneColor = false;
      }
      runLastColor = color;
    }
  }

  // Mép ảnh và vùng nối file được giữ nguyên để không cắt mất title/content,
  // TRỪ dải dài >= 150px: dải dài ở ranh giới trang vẫn là điểm cắt thật.
  const pageEdgeMargin = Math.max(16, Math.round(referenceHeight * 0.01));
  const interiorSeparators = separators.filter(item => item.y0 > 0 && item.y1 < h
    && (item.y1 - item.y0 >= LONG_SEPARATOR_PX
      || !protectedRows.some(row => row >= item.y0 - pageEdgeMargin && row <= item.y1 + pageEdgeMargin)));
  let segments = [];
  let cursor = 0;
  for (const separator of interiorSeparators) {
    if (separator.y0 > cursor) segments.push({ y0: cursor, y1: separator.y0 });
    cursor = Math.max(cursor, separator.y1);
  }
  if (cursor < h) segments.push({ y0: cursor, y1: h });
  // LONG-FIX: không vứt đoạn < 60px đi (mất caption "BEING PUT DOWN" chỉ
  // cao ~12px trong ảnh chụp màn hình hẹp). Để mergeSmallSegments gộp
  // đoạn nhỏ vào đoạn kề, giữ nguyên nội dung thay vì xóa.
  segments = segments.filter(segment => segment.y1 - segment.y0 >= 10);
  if (!segments.length) return { tall: true, segments: whole };
  return { tall: true, segments: mergeSmallSegments(segments, w) };
}

export function stripPanWeight(crop, pageW, pageH) {
  const width = Number(pageW) || 0, height = Number(pageH) || 0;
  if (!crop || !(width > 0) || !(height > 0)) return null;
  const segmentHeight = (Number(crop.h) || 0) / 100 * height;
  const scaledHeight = segmentHeight * 1920 / width;
  if (!(scaledHeight > 0)) return null;
  return Math.max(0, scaledHeight - 1080) + 540;
}

export function stripSegmentCrop(segment, height) {
  const sourceHeight = Math.max(1, Number(height) || 1);
  return {
    x: 0,
    y: clamp(segment.y0 / sourceHeight * 100, 0, 100),
    w: 100,
    h: clamp((segment.y1 - segment.y0) / sourceHeight * 100, 0, 100),
  };
}
