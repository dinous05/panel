export function sanitizeSegment(value, fallback = 'page') {
  const safe = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) return fallback;
  return safe.slice(0, 80);
}

export function mangaPanelPath(pageIndex, sourcePath, panelIndex, extension = 'jpg') {
  const cleanExt = String(extension).replace(/^\./, '').toLowerCase() === 'png' ? 'png' : 'jpg';
  const base = String(sourcePath || 'page').replace(/\\/g, '/').split('/').pop().replace(/\.(jpe?g|png|webp|bmp)$/i, '');
  const pageFolder = `${String(Number(pageIndex) + 1).padStart(4, '0')}_${sanitizeSegment(base)}`;
  return `${pageFolder}/panel_${String(Number(panelIndex) + 1).padStart(3, '0')}.${cleanExt}`;
}

export function stripPanelPath(panelIndex, extension = 'jpg') {
  const cleanExt = String(extension).replace(/^\./, '').toLowerCase() === 'png' ? 'png' : 'jpg';
  return `panel_${String(Number(panelIndex) + 1).padStart(4, '0')}.${cleanExt}`;
}
