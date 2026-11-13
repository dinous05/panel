import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

export interface DirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export type DirectoryReader = (folder: string) => Promise<DirectoryEntry[]>;

const readDirectory: DirectoryReader = async (folder) => readdir(folder, { withFileTypes: true });

export async function countImagesInFolder(folder: string, reader: DirectoryReader = readDirectory): Promise<number> {
  const entries = await reader(folder);
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) count += await countImagesInFolder(entryPath, reader);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) count++;
  }
  return count;
}
