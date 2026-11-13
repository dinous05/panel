import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countImagesInFolder } from '../src/shared/image-files';

const temporaryRoots: string[] = [];
async function makeTempFolder() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'panelvid-images-'));
  temporaryRoots.push(folder);
  return folder;
}
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('countImagesInFolder', () => {
  it('returns zero for an empty folder', async () => {
    expect(await countImagesInFolder(await makeTempFolder())).toBe(0);
  });

  it('counts supported image extensions through nested folders, ignoring non-image files', async () => {
    const root = await makeTempFolder();
    const nested = path.join(root, 'Page 01', 'deep');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'one.JPG'), '');
    await writeFile(path.join(root, 'notes.txt'), '');
    await writeFile(path.join(root, 'Page 01', 'two.webp'), '');
    await writeFile(path.join(nested, 'three.PNG'), '');
    await writeFile(path.join(nested, 'video.mp4'), '');
    expect(await countImagesInFolder(root)).toBe(3);
  });

  it('propagates a not-found path error', async () => {
    const root = await makeTempFolder();
    const missing = path.join(root, 'missing');
    await expect(countImagesInFolder(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates a permission error from the directory reader', async () => {
    const denied = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    const reader = async (_folder: string) => { throw denied; };
    await expect(countImagesInFolder('/permission-denied', reader)).rejects.toMatchObject({ code: 'EACCES' });
  });
});
