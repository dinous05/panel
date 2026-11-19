const DEFAULT_CAPACITY = 10;
const MAX_COLUMNS = 4;
const TARGET_ROW_HEIGHT = 520;
const MIN_ROW_HEIGHT = 300;
const MIN_TILE_WIDTH = 160;

export function partitionPanelsByChapter(panels, capacity = DEFAULT_CAPACITY) {
  if (!Array.isArray(panels)) throw new Error('Danh sách panel không hợp lệ.');
  const size = Number(capacity);
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new Error('Số panel mỗi sheet phải từ 1 đến 20.');
  const groups = [];
  const uuids = new Set(), ids = new Set();
  let previousOrder = 0;
  for (const panel of panels) {
    if (!panel || typeof panel.uuid !== 'string' || !panel.uuid.trim()) throw new Error('Panel thiếu UUID hợp lệ.');
    if (uuids.has(panel.uuid)) throw new Error(`UUID panel bị trùng: ${panel.uuid}`);
    if (panel.id && ids.has(panel.id)) throw new Error(`Panel ID bị trùng: ${panel.id}`);
    if (!Number.isInteger(panel.order) || panel.order <= previousOrder) throw new Error('Thứ tự đọc panel phải tăng liên tục và không bị đảo.');
    uuids.add(panel.uuid); if (panel.id) ids.add(panel.id); previousOrder = panel.order;
    const chapterId = String(panel.chapterId || 'Chapter 1');
    let group = groups.at(-1);
    if (!group || group.chapterId !== chapterId) {
      group = { chapterId, panels: [] };
      groups.push(group);
    }
    group.panels.push(panel);
  }
  const sheets = [];
  for (const group of groups) {
    for (let start = 0; start < group.panels.length; start += size) {
      sheets.push({ chapterId: group.chapterId, panels: group.panels.slice(start, start + size) });
    }
  }
  return sheets;
}

function dimensions(panel) {
  const width = Number(panel.width), height = Number(panel.height);
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Kích thước ảnh không hợp lệ: ${panel.id || panel.uuid}`);
  }
  return { width, height, ratio: width / height };
}

export function layoutSequentialRows(panels, options = {}) {
  const canvasWidth = Number(options.canvasWidth) || 2400;
  const margin = Number(options.margin) || 48;
  const gap = Number(options.gap) || 24;
  const targetHeight = Number(options.targetRowHeight) || TARGET_ROW_HEIGHT;
  const minRowHeight = Number(options.minRowHeight) || MIN_ROW_HEIGHT;
  const maxColumns = Math.max(1, Math.min(6, Number(options.maxColumns) || MAX_COLUMNS));
  const availableWidth = canvasWidth - margin * 2;
  const rows = [];
  let index = 0;
  while (index < panels.length) {
    let best = null;
    const maxCount = Math.min(maxColumns, panels.length - index);
    for (let count = 1; count <= maxCount; count++) {
      const meta = panels.slice(index, index + count).map(dimensions);
      const ratioWidth = meta.reduce((sum, item) => sum + Math.max(MIN_TILE_WIDTH, item.ratio * targetHeight), 0);
      const rowHeight = Math.min(targetHeight, (availableWidth - gap * (count - 1)) / ratioWidth * targetHeight);
      if (rowHeight < minRowHeight && count > 1) continue;
      const tileWidths = meta.map(item => Math.max(MIN_TILE_WIDTH, item.ratio * rowHeight));
      const occupiedWidth = tileWidths.reduce((sum, value) => sum + value, 0) + gap * (count - 1);
      const area = meta.reduce((sum, item, i) => sum + Math.min(item.ratio * rowHeight, tileWidths[i]) * rowHeight, 0);
      const score = area - Math.max(0, availableWidth - occupiedWidth) * rowHeight * 0.12;
      if (!best || score > best.score) best = { count, rowHeight, tileWidths, occupiedWidth, score, meta };
    }
    if (!best) {
      const meta = dimensions(panels[index]);
      const rowHeight = Math.max(1, Math.min(targetHeight, availableWidth / Math.max(meta.ratio, 0.001)));
      best = { count: 1, rowHeight, tileWidths: [Math.max(MIN_TILE_WIDTH, meta.ratio * rowHeight)], occupiedWidth: Math.max(MIN_TILE_WIDTH, meta.ratio * rowHeight), meta: [meta] };
    }
    const items = panels.slice(index, index + best.count).map((panel, offset) => {
      const meta = best.meta[offset];
      const displayWidth = meta.ratio * best.rowHeight;
      return {
        panel_id: panel.id,
        uuid: panel.uuid,
        chapter_id: panel.chapterId || 'Chapter 1',
        reading_order: panel.order,
        row: rows.length + 1,
        column: offset + 1,
        display_width: Math.round(displayWidth),
        display_height: Math.round(best.rowHeight),
        detail_required: displayWidth < 260 || best.rowHeight < 280 || meta.ratio < 0.22,
      };
    });
    rows.push({ items, height: Math.round(best.rowHeight), tileWidths: best.tileWidths.map(Math.round), occupiedWidth: Math.round(best.occupiedWidth) });
    index += best.count;
  }
  const expected = panels.map(panel => panel.uuid);
  const actual = rows.flatMap(row => row.items.map(panel => panel.uuid));
  if (expected.length !== actual.length || expected.some((uuid, i) => uuid !== actual[i])) throw new Error('Layout không bảo toàn thứ tự hoặc số lượng panel.');
  return rows;
}
