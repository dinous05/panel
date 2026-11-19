export const MAX_PANEL_LENGTH_PX = 16000;

export function splitAtMaxPanelLength(height, maxLength, mode = 'remainder') {
  const total = Math.round(Number(height));
  const limit = Math.round(Number(maxLength));
  if (!Number.isInteger(total) || total < 1) throw new Error('Chiều cao panel không hợp lệ.');
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_PANEL_LENGTH_PX) throw new Error('Độ dài tối đa phải từ 0 đến 16000 px.');
  if (!['remainder', 'even'].includes(mode)) throw new Error('Chế độ chia panel không hợp lệ.');
  if (limit === 0 || total <= limit) return [[0, total]];
  if (mode === 'remainder') {
    const intervals = [];
    for (let start = 0; start < total; start += limit) intervals.push([start, Math.min(total, start + limit)]);
    return intervals;
  }
  const count = Math.ceil(total / limit);
  const base = Math.floor(total / count), extra = total % count;
  const intervals = [];
  let start = 0;
  for (let index = 0; index < count; index++) {
    const partLength = base + (index < extra ? 1 : 0);
    intervals.push([start, start + partLength]);
    start += partLength;
  }
  return intervals;
}
