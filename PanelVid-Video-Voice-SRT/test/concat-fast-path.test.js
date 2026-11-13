import test from 'node:test';
import assert from 'node:assert/strict';
import { canFastConcat } from '../electron/concat.js';

const info = fps => ({
  vcodec: 'h264', width: 1920, height: 1080, fps,
  hasAudio: true, acodec: 'aac', duration: 12,
});

test('fast concat accepts equal-FPS batch videos at 30, 45, or 60 FPS', () => {
  for (const fps of [30, 45, 60]) assert.equal(canFastConcat([info(fps), info(fps)]), true);
});

test('fast concat falls back when batch video formats or frame rates differ', () => {
  assert.equal(canFastConcat([info(30), info(45)]), false);
  assert.equal(canFastConcat([info(60), { ...info(60), acodec: 'mp3' }]), false);
});
