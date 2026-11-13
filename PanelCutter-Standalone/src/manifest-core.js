export const MANIFEST_SCHEMA_VERSION = '1.0';

export function makePanelIdentityKey(sourceKey, crop) {
  const quantize = value => Math.round(Number(value) || 0);
  const c = crop || {};
  return `${sourceKey}|${quantize(c.x)},${quantize(c.y)},${quantize(c.width)},${quantize(c.height)}`;
}

export function makeSplitIdentityKeys(parentUuid, ratio) {
  const q = Math.max(1, Math.min(999999, Math.round(Number(ratio) * 1_000_000)));
  return [`edit:split:${parentUuid}:${q}:top`, `edit:split:${parentUuid}:${q}:bottom`];
}

export function makeMergeIdentityKey(parentUuids) {
  return `edit:merge:${parentUuids.join(':')}`;
}

export function sourceIdentityKey(regions) {
  return `source:${JSON.stringify(regions.map(region => ({
    source_fingerprint: region.source_fingerprint,
    source_page: region.source_page,
    crop: region.crop,
  })))}`;
}

export function splitSourceRegions(regions, ratio) {
  const cut = Math.max(0, Math.min(1, Number(ratio)));
  const parts = [[], []];
  for (const region of regions || []) {
    const top = Number(region.output_y) || 0;
    const height = Number(region.output_height) || 1;
    const bottom = top + height;
    for (let side = 0; side < 2; side++) {
      const lo = side === 0 ? top : Math.max(top, cut);
      const hi = side === 0 ? Math.min(bottom, cut) : bottom;
      if (hi <= lo) continue;
      const fraction0 = (lo - top) / height, fraction1 = (hi - top) / height;
      const c = region.crop;
      const y0 = c.y + c.height * fraction0, y1 = c.y + c.height * fraction1;
      parts[side].push({ ...region, crop: { ...c, y: Math.round(y0), height: Math.max(1, Math.round(y1 - y0)) }, output_y: side === 0 ? lo / Math.max(cut, 1e-9) : (lo - cut) / Math.max(1 - cut, 1e-9), output_height: (hi - lo) / Math.max(side === 0 ? cut : 1 - cut, 1e-9) });
    }
  }
  return parts;
}

export function combineSourceRegions(topRegions, topHeight, bottomRegions, bottomHeight) {
  const total = Math.max(1, Number(topHeight) + Number(bottomHeight));
  return [
    ...(topRegions || []).map(region => ({ ...region, output_y: (Number(region.output_y) || 0) * Number(topHeight) / total, output_height: (Number(region.output_height) || 1) * Number(topHeight) / total })),
    ...(bottomRegions || []).map(region => ({ ...region, output_y: (Number(topHeight) + (Number(region.output_y) || 0) * Number(bottomHeight)) / total, output_height: (Number(region.output_height) || 1) * Number(bottomHeight) / total })),
  ];
}

export function createProjectMetadata({ projectId, projectName, createdAt, exportedAt, sourceType, sourceName, readingDirection, comicType }) {
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    project: { project_id: projectId, project_name: projectName, created_at: createdAt, exported_at: exportedAt },
    source: { source_type: sourceType, source_name: sourceName, reading_direction: readingDirection ?? null, comic_type: comicType },
    coordinate_system: { units: 'pixel', origin: 'top_left', crop: 'half-open rectangle [x,x+width) × [y,y+height) in original source image' },
  };
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.schema_version !== MANIFEST_SCHEMA_VERSION) errors.push('schema_version không hợp lệ.');
  if (!manifest?.project?.project_id) errors.push('Thiếu project.project_id.');
  if (!Array.isArray(manifest?.panels)) errors.push('panels phải là mảng.');
  const seenIds = new Set(), seenOrders = new Set();
  for (const [index, panel] of (manifest?.panels || []).entries()) {
    if (!panel?.id || seenIds.has(panel.id)) errors.push(`ID panel thiếu hoặc trùng tại vị trí ${index + 1}.`);
    seenIds.add(panel?.id);
    if (typeof panel?.uuid !== 'string' || !panel.uuid) errors.push(`UUID thiếu tại vị trí ${index + 1}.`);
    if (!Number.isInteger(panel?.order) || panel.order < 1 || seenOrders.has(panel.order)) errors.push(`order thiếu, sai hoặc trùng tại vị trí ${index + 1}.`);
    seenOrders.add(panel?.order);
    if (typeof panel?.file !== 'string' || !panel.file || panel.file.split(/[\\/]/).includes('..') || panel.file.startsWith('/') || /^[A-Za-z]:/.test(panel.file)) errors.push(`Đường dẫn file không hợp lệ tại vị trí ${index + 1}.`);
    if (!(Number(panel?.width) > 0) || !(Number(panel?.height) > 0)) errors.push(`Kích thước ảnh không hợp lệ tại vị trí ${index + 1}.`);
    if (!Array.isArray(panel?.source_regions) || !panel.source_regions.length) errors.push(`source_regions phải có ít nhất một vùng tại vị trí ${index + 1}.`);
    for (const [regionIndex, region] of (panel?.source_regions || []).entries()) {
      const crop = region?.crop;
      if (region?.source_file != null && typeof region.source_file !== 'string') errors.push(`source_file không hợp lệ ở panel ${index + 1}, vùng ${regionIndex + 1}.`);
      if (region?.source_page != null && (!Number.isInteger(region.source_page) || region.source_page < 1)) errors.push(`source_page không hợp lệ ở panel ${index + 1}, vùng ${regionIndex + 1}.`);
      if (![region?.source_width, region?.source_height, crop?.x, crop?.y, crop?.width, crop?.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > region.source_width || crop.y + crop.height > region.source_height) errors.push(`Crop pixel ngoài phạm vi ảnh nguồn ở panel ${index + 1}, vùng ${regionIndex + 1}.`);
      if (!Number.isFinite(region?.output_y) || !Number.isFinite(region?.output_height) || region.output_y < 0 || region.output_height <= 0 || region.output_y + region.output_height > 1.00001) errors.push(`Tỷ lệ vùng nguồn ngoài phạm vi panel ở panel ${index + 1}, vùng ${regionIndex + 1}.`);
    }
    if (!['SHOW', 'SUPPORT', 'SKIP'].includes(panel?.decision)) errors.push(`decision không hợp lệ tại vị trí ${index + 1}.`);
    if (typeof panel?.review_required !== 'boolean') errors.push(`review_required phải là boolean tại vị trí ${index + 1}.`);
    if (!Array.isArray(panel?.edit_history)) errors.push(`edit_history phải là mảng tại vị trí ${index + 1}.`);
  }
  if (seenOrders.size && [...seenOrders].sort((a,b)=>a-b).some((order,index)=>order!==index+1)) errors.push('order phải liên tục từ 1 đến số panel.');
  return { valid: errors.length === 0, errors };
}

export function remapManifestPaths(manifest, pathMap) {
  return {
    ...manifest,
    panels: manifest.panels.map(panel => {
      const key = String(panel.file).replace(/\\/g, '/');
      const file = pathMap.get(key);
      if (!file) throw new Error(`Manifest trỏ tới panel không được xuất: ${panel.file}`);
      return { ...panel, file: String(file).replace(/\\/g, '/') };
    }),
  };
}

export function newUuid() { return globalThis.crypto.randomUUID(); }
