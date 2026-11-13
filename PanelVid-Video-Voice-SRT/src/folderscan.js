// folderscan.js — quét ảnh từ thư mục (webkitdirectory). Module thuần, test được bằng node --test.
export const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp)$/i;

export function isImageFileName(name) {
  return !!name && IMAGE_EXT_RE.test(name);
}

// files: FileList/Array File (có webkitRelativePath khi chọn thư mục).
// compare: hàm so sánh natural sort. Trả về [{name, path, blob}] đã sắp xếp.
export function extractFolderImages(files, compare) {
  const items = [];
  const seenPaths = new Set();
  for (const f of (files || [])) {
    if (!f || !isImageFileName(f.name)) continue;
    const p = f.webkitRelativePath || f.name;
    if (seenPaths.has(p)) continue; // trùng đường dẫn -> giữ mục đầu
    seenPaths.add(p);
    items.push({ name: f.name, path: p, blob: f });
  }
  const cmp = typeof compare === 'function' ? compare : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  items.sort((a, b) => cmp(a.path, b.path));
  return items;
}
