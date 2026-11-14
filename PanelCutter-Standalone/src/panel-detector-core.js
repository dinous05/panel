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

// Manga ưu tiên giữ panel nhỏ. Ngưỡng mặc định 0.5% diện tích trang;
// vẫn hỗ trợ giá trị cũ và giữ nguyên giá trị người dùng truyền vào.
export function resolveMinPanelAreaPct(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0.5;
  if (value === 25) return 4; // migrate giá trị mặc định cũ
  return value >= 0.25 && value <= 100 ? Math.round(value * 10) / 10 : 0.5;
}

function boxIou(a, b) {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const intersection = w * h;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return intersection / Math.max(1e-8, areaA + areaB - intersection);
}

// Sắp xếp theo hàng đọc thích ứng. Hai box được xem là cùng hàng khi
// vùng Y giao nhau đủ lớn hoặc tâm Y đủ gần so với chiều cao panel.
export function sortPanelBoxes(boxes, reading = 'rtl') {
  const direction = reading === 'ltr' ? 'ltr' : 'rtl';
  const entries = (Array.isArray(boxes) ? boxes : [])
    .map((box, index) => ({ ...box, index, centerY: box.y + box.h / 2 }))
    .filter(box => Number.isFinite(box.x) && Number.isFinite(box.y)
      && Number.isFinite(box.w) && Number.isFinite(box.h) && box.w > 0 && box.h > 0)
    .sort((a, b) => a.centerY - b.centerY || a.y - b.y || a.index - b.index);

  const rows = [];
  for (const box of entries) {
    let bestRow = null;
    let bestScore = -Infinity;
    for (const row of rows) {
      const overlap = Math.max(0, Math.min(box.y + box.h, row.bottom) - Math.max(box.y, row.top));
      const overlapRatio = overlap / Math.max(0.001, Math.min(box.h, row.height));
      const centerDistance = Math.abs(box.centerY - row.centerY);
      const tolerance = Math.max(1.25, Math.min(box.h, row.height) * 0.35);
      const sameRow = overlapRatio >= 0.45 || centerDistance <= tolerance;
      if (!sameRow) continue;
      const score = Math.max(overlapRatio, 1 - centerDistance / tolerance);
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }

    if (!bestRow) {
      rows.push({
        items: [box],
        top: box.y,
        bottom: box.y + box.h,
        height: box.h,
        centerY: box.centerY,
      });
      continue;
    }

    bestRow.items.push(box);
    bestRow.top = Math.min(bestRow.top, box.y);
    bestRow.bottom = Math.max(bestRow.bottom, box.y + box.h);
    bestRow.height = bestRow.bottom - bestRow.top;
    bestRow.centerY = bestRow.items.reduce((sum, item) => sum + item.centerY * item.h, 0)
      / bestRow.items.reduce((sum, item) => sum + item.h, 0);
  }

  rows.sort((a, b) => a.top - b.top || a.centerY - b.centerY);
  return rows.flatMap(row => row.items
    .sort((a, b) => direction === 'rtl'
      ? (b.x + b.w / 2) - (a.x + a.w / 2) || a.index - b.index
      : (a.x + a.w / 2) - (b.x + b.w / 2) || a.index - b.index)
    .map(({ index, centerY, ...box }) => box));
}

function normalizedBoxIou(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - intersection;
  return intersection / Math.max(1e-8, union);
}

// Bộ lọc Manga:
// - Chỉ loại box sai hình học và box trùng gần như hoàn toàn.
// - Không loại panel inset chỉ vì nó nằm trong panel lớn.
// - Hạ ngưỡng diện tích và không tự gộp panel nhỏ vào panel lân cận.
// - Nới crop thích ứng theo kích thước box để tránh panel nhỏ bị ăn sang khung bên cạnh.
export function filterPanelBoxes(boxes, minAreaPercent = 0.5, reading = 'rtl') {
  const rawThreshold = Number(minAreaPercent);
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(100, Math.max(0.25, rawThreshold))
    : 0.5;

  let candidates = (Array.isArray(boxes) ? boxes : [])
    .filter(box => Number.isFinite(box.x) && Number.isFinite(box.y)
      && Number.isFinite(box.w) && Number.isFinite(box.h)
      && box.w > 0 && box.h > 0)
    .map(box => ({
      x: Math.max(0, Math.min(100, box.x)),
      y: Math.max(0, Math.min(100, box.y)),
      w: Math.max(0, Math.min(100 - Math.max(0, box.x), box.w)),
      h: Math.max(0, Math.min(100 - Math.max(0, box.y), box.h)),
    }))
    .filter(box => box.w > 0 && box.h > 0);

  // Bỏ box bao toàn trang nếu detector đồng thời trả về các panel con.
  if (candidates.length > 1) {
    const pageBoxes = candidates.filter(box => box.x <= 2 && box.y <= 2 && box.w >= 96 && box.h >= 96);
    if (pageBoxes.length && candidates.some(box => !pageBoxes.includes(box))) {
      candidates = candidates.filter(box => !pageBoxes.includes(box));
    }
  }

  // Khử box trùng gần như hoàn toàn. Không dùng containment suppression:
  // panel inset có thể hợp lệ dù nằm bên trong panel lớn.
  const unique = [];
  for (const box of candidates) {
    if (box.w * box.h < Math.max(0.25, Math.min(1.5, threshold)) * 100) continue;
    if (box.w < 0.8 || box.h < 0.8) continue;
    if (unique.some(existing => normalizedBoxIou(existing, box) >= 0.88)) continue;
    unique.push(box);
  }

  for (const box of unique) {
    const padX = Math.min(1, Math.max(0.08, box.w * 0.025));
    const padY = Math.min(1, Math.max(0.08, box.h * 0.025));
    const x2 = Math.min(100, box.x + box.w + padX);
    const y2 = Math.min(100, box.y + box.h + padY);
    box.x = Math.max(0, box.x - padX);
    box.y = Math.max(0, box.y - padY);
    box.w = x2 - box.x;
    box.h = y2 - box.y;
  }

  return sortPanelBoxes(unique, reading);
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
    if (boxW < width * 0.01 || boxH < height * 0.01 || boxW * boxH < width * height * 0.0001) continue;
    candidates.push({ x1, y1, x2, y2, confidence });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  while (candidates.length && kept.length < 100) {
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
  return sortPanelBoxes(boxes, reading);
}
