export function normalizeSplitPoints(points, height) {
  const imageHeight = Number(height);
  if (!Number.isInteger(imageHeight) || imageHeight < 2) throw new Error('Chiều cao panel không hợp lệ để chia.');
  if (!Array.isArray(points)) throw new Error('Danh sách mốc chia không hợp lệ.');
  const normalized = points.map(value => {
    const position = Number(value);
    if (!Number.isInteger(position) || position < 1 || position >= imageHeight) throw new Error('Mỗi mốc chia phải là pixel nguyên nằm bên trong panel.');
    return position;
  }).sort((a, b) => a - b);
  if (!normalized.length) throw new Error('Hãy thêm ít nhất một mốc chia.');
  if (new Set(normalized).size !== normalized.length) throw new Error('Các mốc chia không được trùng nhau.');
  return normalized;
}

export function splitIntervals(points, height) {
  const imageHeight = Number(height);
  const cuts = normalizeSplitPoints(points, imageHeight);
  const boundaries = [0, ...cuts, imageHeight];
  return boundaries.slice(0, -1).map((start, index) => [start, boundaries[index + 1]]);
}

export function splitPointsAtInterval(height, interval) {
  const imageHeight = Number(height), step = Number(interval);
  if (!Number.isInteger(imageHeight) || imageHeight < 2 || !Number.isInteger(step) || step < 1) throw new Error('Chiều cao panel hoặc ngưỡng chia không hợp lệ.');
  const segmentCount = Math.ceil(imageHeight / step);
  if (segmentCount <= 1) return [];
  return Array.from({ length: segmentCount - 1 }, (_value, index) => Math.round((index + 1) * imageHeight / segmentCount));
}
