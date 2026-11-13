function panelFilePath(relativePath, index, width) {
  const value=String(relativePath || '');
  const slash=value.lastIndexOf('/');
  const folder=slash >= 0 ? value.slice(0,slash+1) : '';
  const extension=value.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase() || 'jpg';
  return `${folder}panel_${String(index+1).padStart(width,'0')}.${extension}`;
}

export function moveMangaPanel(items, index, direction) {
  if (!Array.isArray(items) || ![-1,1].includes(direction)) return items;
  const target=index+direction;
  if (!Number.isInteger(index) || index<0 || target<0 || target>=items.length) return items;
  if (items[index]?.pageIndex !== items[target]?.pageIndex) return items;
  const moved=items.slice();
  [moved[index],moved[target]]=[moved[target],moved[index]];
  return moved;
}

export function splitPanelItem(items, index, temporaryRelativePath) {
  if (!Array.isArray(items) || !Number.isInteger(index) || index < 0 || index >= items.length) return items;
  const relativePath = String(temporaryRelativePath || '');
  if (!relativePath || relativePath === items[index]?.relativePath || items.some((item, itemIndex) => itemIndex !== index && item.relativePath === relativePath)) return items;
  const next = items.slice();
  next.splice(index, 1, items[index], { ...items[index], relativePath });
  return next;
}

export function reindexPanelPaths(items, style) {
  const pageCounters=new Map();
  return items.map((item,globalIndex)=>{
    if(style==='manga'){
      const pageIndex=Number(item.pageIndex) || 0;
      const pageOrder=pageCounters.get(pageIndex) || 0;
      pageCounters.set(pageIndex,pageOrder+1);
      return {...item,relativePath:panelFilePath(item.relativePath,pageOrder,3)};
    }
    return {...item,relativePath:panelFilePath(item.relativePath,globalIndex,4)};
  });
}
