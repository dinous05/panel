const DEFAULT_CAPACITY = 10;
const DEFAULT_LAYOUT = Object.freeze({
  maxHeight: 3200,
  maxWidth: 2400,
  maxColumns: 4,
  panelGap: 16,
  columnGap: 24,
  margin: 48,
  headerHeight: 92,
  labelHeight: 36,
});

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
  const batches = [];
  for (const group of groups) {
    for (let start = 0; start < group.panels.length; start += size) {
      batches.push({ chapterId: group.chapterId, panels: group.panels.slice(start, start + size) });
    }
  }
  return batches;
}

function getDimensions(panel) {
  const width = Number(panel.width), height = Number(panel.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Kích thước ảnh không hợp lệ: ${panel.id || panel.uuid}`);
  }
  return { width, height };
}

function splitForContactSheet(panel, maxSliceHeight) {
  const { height } = getDimensions(panel);
  const segmentCount = Math.ceil(height / maxSliceHeight);
  if (segmentCount <= 1) return [{ ...panel, source_y: 0, source_height: height, segment_index: 1, segment_count: 1 }];
  return Array.from({ length: segmentCount }, (_value, index) => {
    const sourceY = index * maxSliceHeight;
    const sourceHeight = Math.min(maxSliceHeight, height - sourceY);
    return { ...panel, height: sourceHeight, source_y: sourceY, source_height: sourceHeight, segment_index: index + 1, segment_count: segmentCount };
  });
}

function sheetWidth(columns, config) {
  if (!columns.length) return config.margin * 2;
  return config.margin * 2 + columns.reduce((sum, column) => sum + column.width, 0) + config.columnGap * (columns.length - 1);
}

function startColumn(panel, config) {
  const { width, height } = getDimensions(panel);
  const y = config.headerHeight + config.margin;
  return {
    width,
    items: [{ panel, x: 0, y, width, height, reading_order: panel.order, uuid: panel.uuid, source_y: panel.source_y, source_height: panel.source_height, segment_index: panel.segment_index, segment_count: panel.segment_count }],
    bottom: y + height + config.labelHeight,
  };
}

function finalizeSheet(columns, config, extraOverflow = null) {
  let x = config.margin;
  const panels = [];
  let bottom = config.headerHeight + config.margin;
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const column = columns[columnIndex];
    for (const item of column.items) {
      panels.push({
        panel_id: item.panel.id,
        uuid: item.panel.uuid,
        chapter_id: item.panel.chapterId || 'Chapter 1',
        reading_order: item.panel.order,
        column: columnIndex + 1,
        x,
        y: item.y,
        width: item.width,
        height: item.height,
        source_y: item.source_y,
        source_height: item.source_height,
        segment_index: item.segment_index,
        segment_count: item.segment_count,
        overflow_height: Boolean(item.overflow_height),
        overflow_width: Boolean(item.overflow_width),
      });
      bottom = Math.max(bottom, item.y + item.height + config.labelHeight);
    }
    x += column.width + config.columnGap;
  }
  const contentWidth = columns.length ? x - config.columnGap : config.margin * 2;
  const overflowWidth = contentWidth + config.margin > config.maxWidth;
  const overflowHeight = bottom + config.margin > config.maxHeight;
  return {
    width: Math.max(1, contentWidth + config.margin),
    height: Math.max(1, bottom + config.margin),
    panels,
    columns: columns.length,
    overflow: extraOverflow || overflowWidth || overflowHeight ? {
      width: Boolean(extraOverflow?.width || overflowWidth),
      height: Boolean(extraOverflow?.height || overflowHeight),
      reason: extraOverflow?.reason || (overflowHeight ? 'single_panel_exceeds_max_height' : overflowWidth ? 'single_panel_exceeds_max_width' : null),
    } : null,
  };
}

/**
 * Places panels top-to-bottom in columns. A panel taller than the usable sheet
 * height is represented by contiguous, native-pixel visual slices. The source
 * panel file and identity are never changed; each slice records its pixel range.
 */
export function layoutVerticalSequential(panels, options = {}) {
  if (!Array.isArray(panels)) throw new Error('Danh sách panel không hợp lệ.');
  const config = { ...DEFAULT_LAYOUT };
  for (const key of Object.keys(DEFAULT_LAYOUT)) {
    if (options[key] !== undefined) config[key] = Number(options[key]);
    if (!Number.isFinite(config[key]) || config[key] < 1) throw new Error(`Cấu hình ${key} không hợp lệ.`);
  }
  if (config.maxColumns > 20) throw new Error('MAX_COLUMNS không được lớn hơn 20.');
  const originalUuids = panels.map(panel => panel.uuid);
  if (new Set(originalUuids).size !== originalUuids.length) throw new Error('UUID panel bị trùng trong layout.');

  const availablePanelHeight = config.maxHeight - config.headerHeight - config.margin * 2 - config.labelHeight;
  const availablePanelWidth = config.maxWidth - config.margin * 2;
  if (availablePanelHeight < 1 || availablePanelWidth < 1) throw new Error('Giới hạn Contact Sheet quá nhỏ so với phần đầu trang và lề.');
  const layoutPanels = panels.flatMap(panel => splitForContactSheet(panel, availablePanelHeight));
  const expectedSegments = layoutPanels.map(panel => `${panel.uuid}:${panel.segment_index}`);

  const sheets = [];
  let columns = [];
  let index = 0;
  const flush = (overflow = null) => {
    if (columns.length) sheets.push(finalizeSheet(columns, config, overflow));
    columns = [];
  };
  const startNewSheetWith = panel => {
    const { width, height } = getDimensions(panel);
    const tooWide = width > availablePanelWidth;
    const column = startColumn(panel, config);
    if (tooWide) {
      column.items[0].overflow_width = true;
      sheets.push(finalizeSheet([column], config, { width: true, height: false, reason: 'single_panel_exceeds_max_width' }));
      index++;
      return;
    }
    columns = [column];
    index++;
  };

  while (index < layoutPanels.length) {
    const panel = layoutPanels[index];
    const { width, height } = getDimensions(panel);
    if (!columns.length) {
      startNewSheetWith(panel);
      continue;
    }

    const lastColumn = columns.at(-1);
    const lastItem = lastColumn.items.at(-1);
    const nextY = lastItem.y + lastItem.height + config.labelHeight + config.panelGap;
    const nextBottom = nextY + height + config.labelHeight;
    const newColumnWidth = Math.max(lastColumn.width, width);
    const projectedWidths = columns.reduce((sum, column) => sum + column.width, 0) - lastColumn.width + newColumnWidth;
    const projectedSheetWidth = config.margin * 2 + projectedWidths + config.columnGap * (columns.length - 1);

    if (nextBottom + config.margin <= config.maxHeight && projectedSheetWidth <= config.maxWidth) {
      lastColumn.items.push({ panel, x: 0, y: nextY, width, height, reading_order: panel.order, uuid: panel.uuid, source_y: panel.source_y, source_height: panel.source_height, segment_index: panel.segment_index, segment_count: panel.segment_count });
      lastColumn.width = newColumnWidth;
      lastColumn.bottom = nextBottom;
      index++;
      continue;
    }

    const candidateWidth = sheetWidth(columns, config) + config.columnGap + width;
    if (columns.length < config.maxColumns && candidateWidth <= config.maxWidth && height <= availablePanelHeight && width <= availablePanelWidth) {
      const column = startColumn(panel, config);
      column.width = width;
      columns.push(column);
      index++;
      continue;
    }

    flush();
  }
  flush();

  const actualSegments = sheets.flatMap(sheet => sheet.panels.map(panel => `${panel.uuid}:${panel.segment_index}`));
  if (actualSegments.length !== expectedSegments.length || expectedSegments.some((segment, i) => actualSegments[i] !== segment)) {
    throw new Error('Layout không bảo toàn thứ tự hoặc số lượng đoạn panel.');
  }
  return sheets;
}

export const DEFAULT_VERTICAL_LAYOUT = DEFAULT_LAYOUT;
