// strip-document.js — mô hình dải Manhwa/Manhua ghép logic từ nhiều ảnh nguồn.
// Không tạo canvas khổng lồ: nối row-profile để dò khe, rồi ánh xạ crop về ảnh gốc.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function joinStripProfiles(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('Cần ít nhất một ảnh để ghép dải.');
  const width = Math.max(1, ...parts.map(part => Math.round(Number(part.width) || 1)));
  const entries = [];
  let height = 0;
  for (const part of parts) {
    const sourceWidth = Math.max(1, Number(part.width) || 1);
    const sourceHeight = Math.max(1, Number(part.height) || part.profile?.lum?.length || 1);
    const scale = width / sourceWidth;
    const virtualHeight = Math.max(1, Math.round(sourceHeight * scale));
    const profile = part.profile;
    if (!profile?.lum || profile.lum.length < sourceHeight) throw new Error('Hồ sơ hàng ảnh không khớp kích thước nguồn.');
    entries.push({
      pageIndex: Number(part.pageIndex) || 0,
      y0: height,
      y1: height + virtualHeight,
      width: sourceWidth,
      cropX: Number(part.cropX) || 0,
      height: sourceHeight,
      scale,
      profile,
    });
    height += virtualHeight;
  }

  const hasColorSpread = parts.every(part => part.profile?.colorSpread?.length >= Math.round(Number(part.height) || part.profile?.lum?.length || 1));
  const hasNearWhiteCoverage = parts.every(part => part.profile?.nearWhiteCoverage?.length >= Math.round(Number(part.height) || part.profile?.lum?.length || 1));
  const hasDarkCoverage = parts.every(part => part.profile?.darkCoverage?.length >= Math.round(Number(part.height) || part.profile?.lum?.length || 1));
  const joined = {
    r: new Float64Array(height),
    g: new Float64Array(height),
    b: new Float64Array(height),
    lum: new Float64Array(height),
    variance: new Float64Array(height),
    ...(hasColorSpread ? { colorSpread: new Float64Array(height) } : {}),
    ...(hasNearWhiteCoverage ? { nearWhiteCoverage: new Float64Array(height) } : {}),
    ...(hasDarkCoverage ? { darkCoverage: new Float64Array(height) } : {}),
  };
  for (const entry of entries) {
    const source = entry.profile;
    const virtualHeight = entry.y1 - entry.y0;
    for (let y = 0; y < virtualHeight; y++) {
      const sy = Math.min(entry.height - 1, Math.floor((y + 0.5) / entry.scale));
      const dy = entry.y0 + y;
      for (const key of ['r', 'g', 'b', 'lum', 'variance']) joined[key][dy] = source[key][sy];
      if (joined.colorSpread) joined.colorSpread[dy] = source.colorSpread[sy];
      if (joined.nearWhiteCoverage) joined.nearWhiteCoverage[dy] = source.nearWhiteCoverage[sy];
      if (joined.darkCoverage) joined.darkCoverage[dy] = source.darkCoverage[sy];
    }
  }
  return { width, height, entries, profile: joined };
}

export function stripPageIndexAt(document, y) {
  if (!document?.entries?.length) return 0;
  const row = clamp(Number(y) || 0, 0, Math.max(0, document.height - 1));
  return document.entries.find(entry => row >= entry.y0 && row < entry.y1)?.pageIndex
    ?? document.entries[document.entries.length - 1].pageIndex;
}

// crop is expressed as percentages of the complete logical strip. Each returned
// fragment maps its source pixels to a vertical fraction of the crop rectangle.
export function mapStripCropToSources(document, crop) {
  if (!document?.entries?.length || !crop) return [];
  const x = clamp(Number(crop.x) || 0, 0, 100) / 100 * document.width;
  const y = clamp(Number(crop.y) || 0, 0, 100) / 100 * document.height;
  const w = clamp(Number(crop.w) || 0, 0, 100 - Number(crop.x || 0)) / 100 * document.width;
  const h = clamp(Number(crop.h) || 0, 0, 100 - Number(crop.y || 0)) / 100 * document.height;
  if (!(w > 0) || !(h > 0)) return [];
  const bottom = y + h;
  const fragments = [];
  for (const entry of document.entries) {
    const top = Math.max(y, entry.y0), end = Math.min(bottom, entry.y1);
    if (end - top <= 1e-9) continue;
    fragments.push({
      pageIndex: entry.pageIndex,
      sx: (entry.cropX || 0) + x / entry.scale,
      sy: (top - entry.y0) / entry.scale,
      sw: w / entry.scale,
      sh: (end - top) / entry.scale,
      destY: (top - y) / h,
      destH: (end - top) / h,
    });
  }
  return fragments;
}

export function mapStripCropToSourceRegions(document, crop, sourceParts) {
  const partsByPage = new Map((sourceParts || []).map(part => [part.pageIndex, part]));
  return mapStripCropToSources(document, crop).map(fragment => {
    const entry = document.entries.find(item => item.pageIndex === fragment.pageIndex);
    const part = partsByPage.get(fragment.pageIndex);
    if (!entry || !part) throw new Error(`Thiếu source mapping cho ảnh số ${fragment.pageIndex + 1}.`);
    const sourceWidth = Number(part.sourceWidth), sourceHeight = Number(part.height);
    const sourcePage = Number(part.sourceIndex) + 1;
    const sourceFile = part.sourceFile;
    const sourceFingerprint = part.sourceFingerprint;
    if (!Number.isInteger(sourceWidth) || sourceWidth < 1 || !Number.isInteger(sourceHeight) || sourceHeight < 1
      || !Number.isInteger(sourcePage) || sourcePage < 1 || typeof sourceFile !== 'string' || !sourceFile
      || typeof sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(sourceFingerprint)) {
      throw new Error(`Metadata nguồn không đầy đủ cho ảnh số ${fragment.pageIndex + 1}.`);
    }
    const x = Math.max(0, Math.min(sourceWidth - 1, Math.floor(fragment.sx + 1e-9)));
    const y = Math.max(0, Math.min(sourceHeight - 1, Math.floor(fragment.sy + 1e-9)));
    const right = Math.max(x + 1, Math.min(sourceWidth, Math.ceil(fragment.sx + fragment.sw - 1e-9)));
    const bottom = Math.max(y + 1, Math.min(sourceHeight, Math.ceil(fragment.sy + fragment.sh - 1e-9)));
    return {
      source_page: sourcePage,
      source_file: sourceFile,
      source_fingerprint: sourceFingerprint,
      source_width: sourceWidth,
      source_height: sourceHeight,
      crop: { x, y, width: right - x, height: bottom - y },
      output_y: fragment.destY,
      output_height: fragment.destH,
    };
  });
}

// Each panel alternates push-in / pull-out. Peak magnification gently eases
// down over the chapter so later panels feel a little smaller, never below 1x.
export function stripZoomRange(index, count, style = 'manhwa') {
  const i = Math.max(0, Math.round(Number(index) || 0));
  const total = Math.max(1, Math.round(Number(count) || 1));
  const progress = total <= 1 ? 0 : clamp(i / (total - 1), 0, 1);
  const manhua = style === 'manhua';
  const firstPeak = manhua ? 1.035 : 1.024;
  const lastPeak = manhua ? 1.020 : 1.014;
  const peak = firstPeak + (lastPeak - firstPeak) * progress;
  const zoomIn = i % 2 === 0;
  return { zoomFrom: zoomIn ? 1 : peak, zoomTo: zoomIn ? peak : 1, peak, direction: zoomIn ? 'in' : 'out' };
}
