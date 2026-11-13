import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countImagesInFolder } from '../src/shared/image-files';

const root = process.env.PANELVID_REAL_PANEL_ROOT;

describe('user-provided full panel folders', () => {
  it('counts all exported panel images in both chapters', async () => {
    if (!root) {
      throw new Error('Thiếu PANELVID_REAL_PANEL_ROOT. Đặt biến này tới thư mục chứa Chapter 0001 và Chapter 0002; xem README.md mục Kiểm thử dữ liệu ảnh thật.');
    }
    expect(await countImagesInFolder(path.join(root, 'Chapter 0001'))).toBe(112);
    expect(await countImagesInFolder(path.join(root, 'Chapter 0002'))).toBe(113);
  });
});
