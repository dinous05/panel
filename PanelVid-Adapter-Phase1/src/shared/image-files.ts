import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

export async function countImagesInFolder(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) count += await countImagesInFolder(entryPath);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) count++;
  }
  return count;
}
