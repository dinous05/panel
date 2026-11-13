const IMAGE_DIRS = new Set(['page', 'pages', 'panel', 'panels', 'image', 'images', 'output', 'export', 'assets']);

function parts(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
}

function isGenericDir(value) {
  return IMAGE_DIRS.has(String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function relativeDirs(item, baseFolder) {
  let dirs = parts(item.path || item.name).slice(0, -1);
  const base = parts(baseFolder);
  if (base.length && dirs.length >= base.length && base.every((part, index) => dirs[index] === part)) {
    dirs = dirs.slice(base.length);
  } else if (!base.length && dirs.length >= 2 && !isGenericDir(dirs[0])) {
    // Folder picker includes the chosen chapter/root directory in webkitRelativePath.
    dirs = dirs.slice(1);
  }
  while (dirs.length && isGenericDir(dirs[0])) dirs.shift();
  return dirs;
}

/**
 * Group a chapter's cut panel files by their page subfolder. Flat folders and
 * generic `panels/` folders retain the legacy behavior: one logical page per image.
 * Returns sorted page groups and a path-to-page-index map.
 */
export function groupPanelItemsByPage(items, { baseFolder = '', compare = naturalCompare } = {}) {
  const source = Array.isArray(items) ? items : [];
  const grouped = new Map();
  source.forEach((item, index) => {
    const dirs = relativeDirs(item, baseFolder);
    const groupKey = dirs.length ? `folder:${dirs[0]}` : `file:${item.path || item.name || index}`;
    const groupName = dirs.length ? dirs[0] : String(item.name || item.path || `Panel ${index + 1}`).replace(/\.[^.]+$/, '');
    if (!grouped.has(groupKey)) grouped.set(groupKey, { key: groupKey, name: groupName, items: [] });
    grouped.get(groupKey).items.push(item);
  });
  const groups = [...grouped.values()];
  groups.forEach(group => group.items.sort((a, b) => compare(a.path || a.name, b.path || b.name)));
  groups.sort((a, b) => compare(a.name, b.name) || compare(a.key, b.key));
  const groupIndexByPath = new Map();
  groups.forEach((group, groupIndex) => group.items.forEach(item => groupIndexByPath.set(String(item.path || item.name), groupIndex)));
  return { groups, groupIndexByPath, pageCount: groups.length };
}

export function logicalPageIndex(scene) {
  return Number.isInteger(scene?.groupIndex) ? scene.groupIndex : (Number.isInteger(scene?.pageIndex) ? scene.pageIndex : 0);
}

export function logicalPageCount(scenes) {
  const indices = new Set((Array.isArray(scenes) ? scenes : []).map(logicalPageIndex));
  return indices.size;
}
