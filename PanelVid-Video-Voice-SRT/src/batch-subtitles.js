import JSZip from 'jszip';

const SUBTITLE_EXT = /\.(?:txt|srt)$/i;

export async function readSubtitleZip(file) {
  if (!file) throw new Error('Chưa chọn ZIP TXT/SRT.');
  const bytes = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
  const zip = await JSZip.loadAsync(bytes);
  const paths = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && !name.split('/').some(part => part === '__MACOSX') && !name.split('/').at(-1).startsWith('.') && SUBTITLE_EXT.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const items = [];
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    const name = path.split('/').at(-1);
    items.push({
      id: `subzip-${Date.now()}-${index}-${path}`,
      name,
      path,
      type: /\.txt$/i.test(name) ? 'txt' : 'srt',
      rawText: await zip.files[path].async('string'),
      rootLabel: file.name || 'subtitle ZIP',
    });
  }
  if (!items.length) throw new Error('ZIP không có file .txt hoặc .srt.');
  return items;
}
