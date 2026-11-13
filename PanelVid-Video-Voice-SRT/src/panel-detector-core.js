const INPUT_SIZE = 640;
const GAUSS = [1, 2, 1];

function reflect101(value, size) {
  if (size <= 1) return 0;
  while (value < 0 || value >= size) value = value < 0 ? -value : 2 * size - 2 - value;
  return value;
}

function toGray(rgba, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
    gray[p] = Math.max(0, Math.min(255, Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])));
  }
  return gray;
}

function gaussianBlur3(gray, width, height) {
  const blurred = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = reflect101(y + ky, height), wy = GAUSS[ky + 1];
        for (let kx = -1; kx <= 1; kx++) {
          const sx = reflect101(x + kx, width);
          sum += gray[sy * width + sx] * wy * GAUSS[kx + 1];
        }
      }
      blurred[y * width + x] = Math.min(255, Math.max(0, Math.floor((sum + 8) / 16)));
    }
  }
  return blurred;
}

function laplacian8(blurred, width, height) {
  const lap = new Uint8Array(blurred.length);
  for (let y = 0; y < height; y++) {
    const y0 = reflect101(y - 1, height), y1 = reflect101(y + 1, height);
    for (let x = 0; x < width; x++) {
      const x0 = reflect101(x - 1, width), x1 = reflect101(x + 1, width), i = y * width + x;
      const value = blurred[y0 * width + x] + blurred[y * width + x0] + blurred[y * width + x1] + blurred[y1 * width + x] - 4 * blurred[i];
      lap[i] = Math.max(0, Math.min(255, value));
    }
  }
  return lap;
}

function resizeBilinear(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = new Uint8Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth, scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(sourceHeight - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(sourceWidth - 1, x0 + 1), fx = sx - x0;
      const top = source[y0 * sourceWidth + x0] * (1 - fx) + source[y0 * sourceWidth + x1] * fx;
      const bottom = source[y1 * sourceWidth + x0] * (1 - fx) + source[y1 * sourceWidth + x1] * fx;
      output[y * targetWidth + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return output;
}

export function makePanelModelInput(rgba, width, height) {
  const gray = toGray(rgba, width, height);
  const lap = laplacian8(gaussianBlur3(gray, width, height), width, height);
  const gain = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const resizedWidth = Math.max(1, Math.round(width * gain));
  const resizedHeight = Math.max(1, Math.round(height * gain));
  const padX = Math.round((INPUT_SIZE - resizedWidth) / 2 - 0.1);
  const padY = Math.round((INPUT_SIZE - resizedHeight) / 2 - 0.1);
  const resized = resizeBilinear(lap, width, height, resizedWidth, resizedHeight);
  const planeSize = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * planeSize);
  tensor.fill(114 / 255);
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const value = resized[y * resizedWidth + x] / 255;
      const offset = (padY + y) * INPUT_SIZE + padX + x;
      tensor[offset] = value;
      tensor[planeSize + offset] = value;
      tensor[2 * planeSize + offset] = value;
    }
  }
  return { tensor, padX, padY, gain };
}

// Ngưỡng diện tích panel tối thiểu (v6j): mặc định mới 4% (bộ lọc cũ mặc định 25%
// gộp mất panel nhỏ). Giá trị lưu đúng 25 được coi là mặc định cũ chưa ai cố ý chọn
// -> migrate về 4. Giá trị khác giữ nguyên, kẹp 1..100; rác -> 4.
export function resolveMinPanelAreaPct(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 4;
  if (value === 25) return 4;
  return value >= 1 && value <= 100 ? Math.round(value) : 4;
}

function boxIou(a, b) {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const intersection = w * h;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return intersection / Math.max(1e-8, areaA + areaB - intersection);
}

// Bộ lọc panel v6j — giữ panel thật, chỉ gộp mảnh vụn:
// 1) Bỏ box không hợp lệ; bỏ box toàn trang khi còn box khác.
// 2) Bỏ box lồng: box bị box LỚN hơn phủ >= 85% diện tích thì loại (tránh cảnh trùng).
// 3) Box có diện tích >= minAreaPercent (% diện tích trang) được giữ nguyên.
// 4) Mảnh nhỏ hơn ngưỡng: gộp vào box đã giữ GẦN NHẤT trong khoảng gap 8% (nới bounds
//    của box đó). Không có box giữ gần -> thử gom các mảnh với nhau; nhóm nào có
//    bounds đạt ngưỡng thì thành 1 box, còn lại bỏ hẳn.
// 5) Cuối cùng nới mọi box +1.5% mỗi phía (kẹp trong trang) để viền không cắt chữ.
export function filterPanelBoxes(boxes, minAreaPercent = 4, reading = 'rtl') {
  const threshold = Math.min(100, Math.max(1, Number(minAreaPercent) || 4));
  let candidates = boxes.filter(box => Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.w) && Number.isFinite(box.h)
    && box.w > 0 && box.h > 0);

  if (candidates.length > 1) {
    const pageBoxes = candidates.filter(box => box.x <= 2 && box.y <= 2 && box.w >= 96 && box.h >= 96);
    if (pageBoxes.length && candidates.some(box => !pageBoxes.includes(box))) {
      candidates = candidates.filter(box => !pageBoxes.includes(box));
    }
  }

  const nonNested = candidates.filter((box, index) => {
    const area = box.w * box.h;
    return !candidates.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const otherArea = other.w * other.h;
      if (otherArea <= area) return false;
      const intersectionWidth = Math.max(0, Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x));
      const intersectionHeight = Math.max(0, Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y));
      return intersectionWidth * intersectionHeight / area >= 0.85;
    });
  });

  const minArea = threshold * 100; // diện tích theo % trang: w*h (w,h theo %)
  const maxGap = 8;
  const gapBetween = (a, b) => {
    const gapX = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
    const gapY = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
    return Math.hypot(gapX, gapY);
  };
  const boundsOf = group => group.reduce((bounds, box) => ({
    x: Math.min(bounds.x, box.x), y: Math.min(bounds.y, box.y),
    w: Math.max(bounds.x + bounds.w, box.x + box.w) - Math.min(bounds.x, box.x),
    h: Math.max(bounds.y + bounds.h, box.y + box.h) - Math.min(bounds.y, box.y),
  }), { ...group[0] });

  const kept = nonNested.filter(box => box.w * box.h >= minArea).map(box => ({ ...box }));
  const fragments = nonNested.filter(box => box.w * box.h < minArea).map(box => ({ ...box }));

  // Mảnh -> gộp vào box đã giữ gần nhất trong gap 8 (nới bounds của box đó).
  const homeless = [];
  for (const fragment of fragments) {
    let nearest = -1, nearestGap = Infinity;
    for (let i = 0; i < kept.length; i++) {
      const gap = gapBetween(kept[i], fragment);
      if (gap <= maxGap && gap < nearestGap) { nearest = i; nearestGap = gap; }
    }
    if (nearest >= 0) kept[nearest] = boundsOf([kept[nearest], fragment]);
    else homeless.push(fragment);
  }

  // Mảnh vô gia cư: gom với nhau; nhóm đạt ngưỡng thì giữ làm 1 box, không đạt thì bỏ.
  const grouped = [];
  const pending = [...homeless];
  while (pending.length) {
    let seedIndex = 0;
    for (let i = 1; i < pending.length; i++) if (pending[i].w * pending[i].h > pending[seedIndex].w * pending[seedIndex].h) seedIndex = i;
    const group = [pending.splice(seedIndex, 1)[0]];
    let bounds = boundsOf(group);
    while (bounds.w * bounds.h < minArea) {
      let bestIndex = -1, bestGap = Infinity, bestBounds = null;
      for (let i = 0; i < pending.length; i++) {
        const gap = gapBetween(bounds, pending[i]);
        if (gap > maxGap || gap >= bestGap) continue;
        bestIndex = i; bestGap = gap; bestBounds = boundsOf([...group, pending[i]]);
      }
      if (bestIndex < 0) break;
      group.push(pending.splice(bestIndex, 1)[0]);
      bounds = bestBounds;
    }
    if (bounds.w * bounds.h >= minArea) grouped.push(bounds);
  }

  const result = kept.concat(grouped);
  // Nới +1.5% mỗi phía, kẹp trong [0,100].
  for (const box of result) {
    const x2 = Math.min(100, box.x + box.w + 1.5);
    const y2 = Math.min(100, box.y + box.h + 1.5);
    box.x = Math.max(0, box.x - 1.5);
    box.y = Math.max(0, box.y - 1.5);
    box.w = x2 - box.x;
    box.h = y2 - box.y;
  }
  result.sort((a, b) => Math.abs(a.y - b.y) > 3.5 ? a.y - b.y : reading === 'rtl' ? b.x - a.x : a.x - b.x);
  return result;
}

export function decodePanelPredictions(predictions, width, height, reading = 'rtl') {
  const gain = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const resizedWidth = Math.max(1, Math.round(width * gain));
  const resizedHeight = Math.max(1, Math.round(height * gain));
  const offsetX = Math.round((INPUT_SIZE - resizedWidth) / 2 - 0.1);
  const offsetY = Math.round((INPUT_SIZE - resizedHeight) / 2 - 0.1);
  const candidates = [];
  for (let i = 0; i + 5 < predictions.length; i += 6) {
    const cx = predictions[i], cy = predictions[i + 1], boxWidth = predictions[i + 2], boxHeight = predictions[i + 3];
    const confidence = predictions[i + 4] * predictions[i + 5];
    if (!Number.isFinite(confidence) || confidence < 0.25 || boxWidth <= 0 || boxHeight <= 0) continue;
    const x1 = Math.max(0, Math.min(width, (cx - boxWidth / 2 - offsetX) / gain));
    const y1 = Math.max(0, Math.min(height, (cy - boxHeight / 2 - offsetY) / gain));
    const x2 = Math.max(0, Math.min(width, (cx + boxWidth / 2 - offsetX) / gain));
    const y2 = Math.max(0, Math.min(height, (cy + boxHeight / 2 - offsetY) / gain));
    const boxW = x2 - x1, boxH = y2 - y1;
    if (boxW < width * 0.025 || boxH < height * 0.025 || boxW * boxH < width * height * 0.001) continue;
    candidates.push({ x1, y1, x2, y2, confidence });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  while (candidates.length && kept.length < 60) {
    const best = candidates.shift();
    kept.push(best);
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (boxIou(best, candidates[i]) > 0.42) candidates.splice(i, 1);
    }
  }
  const boxes = kept.map(box => ({
    x: box.x1 / width * 100,
    y: box.y1 / height * 100,
    w: (box.x2 - box.x1) / width * 100,
    h: (box.y2 - box.y1) / height * 100,
  }));
  boxes.sort((a, b) => Math.abs(a.y - b.y) > 3.5 ? a.y - b.y : reading === 'rtl' ? b.x - a.x : a.x - b.x);
  return boxes;
}
