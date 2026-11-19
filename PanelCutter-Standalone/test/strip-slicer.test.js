import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeRowProfile, sliceStripProfile } from '../src/strip-slicer.js';

function pageProfile(gutterColors) {
  const height = 1000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height),
    nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y++) {
    const panel = y < 300 || (y >= 320 && y < 680) || y >= 710;
    if (panel) {
      const value = 190 + (y % 37);
      profile.r[y] = value; profile.g[y] = Math.max(0, value - 30); profile.b[y] = Math.max(0, value - 55);
      profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
      profile.variance[y] = 300; profile.colorSpread[y] = 90; profile.nearWhiteCoverage[y] = 0;
    }
  }
  for (let y = 300; y < 320; y++) setColor(profile, y, gutterColors[0]);
  for (let y = 680; y < 710; y++) setColor(profile, y, gutterColors[1]);
  return profile;
}

function setColor(profile, y, [r, g, b]) {
  profile.r[y] = r; profile.g[y] = g; profile.b[y] = b;
  profile.lum[y] = .299 * r + .587 * g + .114 * b;
  profile.variance[y] = 0;
  if (profile.colorSpread) profile.colorSpread[y] = 0;
  if (profile.nearWhiteCoverage) profile.nearWhiteCoverage[y] = r >= 230 && g >= 230 && b >= 230 ? 1 : 0;
}

test('profile scans every column and records row color spread and near-white coverage', () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 200, 20, 30, 255]);
  const profile = computeRowProfile(rgba, 2, 1);
  assert.equal(profile.r[0], 105);
  assert.equal(profile.colorSpread[0], 190);
  assert.equal(profile.nearWhiteCoverage[0], 0);
});

test('full-width solid gutters are found regardless of brightness or hue', () => {
  for (const colors of [
    [[0, 0, 0], [240, 240, 240]],
    [[8, 5, 13], [220, 35, 180]],
    [[30, 80, 190], [190, 145, 45]],
  ]) {
    const result = sliceStripProfile(pageProfile(colors), 500, 1000, 'manhwa');
    assert.equal(result.segments.length, 3);
    assert.ok(result.segments[0].y1 <= 320);
    assert.ok(result.segments[1].y0 >= 300 && result.segments[1].y1 <= 710);
    assert.ok(result.segments[2].y0 >= 680);
  }
});

test('a row with non-uniform color across the width is not a separator when it is not a near-white gutter', () => {
  const profile = pageProfile([[30, 30, 30], [200, 200, 200]]);
  for (let y = 300; y < 320; y++) { profile.colorSpread[y] = 90; profile.nearWhiteCoverage[y] = 0; }
  for (let y = 680; y < 710; y++) { profile.colorSpread[y] = 90; profile.nearWhiteCoverage[y] = 0; }
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa').segments.length, 1);
});

test('near-white gutter rows tolerate sparse compression noise but reject denser text coverage', () => {
  const profile = pageProfile([[250, 250, 250], [255, 255, 255]]);
  for (let y = 300; y < 320; y++) { profile.colorSpread[y] = 255; profile.nearWhiteCoverage[y] = 0.995; }
  for (let y = 680; y < 710; y++) { profile.colorSpread[y] = 255; profile.nearWhiteCoverage[y] = 0.995; }
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa').segments.length, 3);
  for (let y = 300; y < 320; y++) profile.nearWhiteCoverage[y] = 0.98;
  for (let y = 680; y < 710; y++) profile.nearWhiteCoverage[y] = 0.98;
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa').segments.length, 1);
});

test('a white gutter is detected separately from adjacent short flat rows of another color', () => {
  const height = 1000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height),
    nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y++) {
    const value = 150 + (y % 29);
    profile.r[y] = value; profile.g[y] = value - 25; profile.b[y] = value - 45;
    profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
    profile.variance[y] = 300; profile.colorSpread[y] = 80;
  }
  for (let y = 395; y < 400; y++) setColor(profile, y, [0, 0, 0]);
  for (let y = 400; y < 500; y++) setColor(profile, y, [255, 255, 255]);
  for (let y = 500; y < 505; y++) setColor(profile, y, [0, 0, 0]);

  const result = sliceStripProfile(profile, 500, height, 'manhwa', { minGapPx: 12 });
  assert.deepEqual(result.segments, [{ y0: 0, y1: 400 }, { y0: 500, y1: height }]);
});

test('a vertical full-width color gradient is not split into repeated same-color separators', () => {
  const height = 1000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height), nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y++) {
    if (y < 100 || y >= 900) {
      const value = 170 + (y % 20);
      profile.r[y] = value; profile.g[y] = value - 20; profile.b[y] = value - 40;
      profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
      profile.variance[y] = 300; profile.colorSpread[y] = 90;
      continue;
    }
    const value = Math.round(20 + (y - 100) / 800 * 210);
    profile.r[y] = value; profile.g[y] = value; profile.b[y] = value;
    profile.lum[y] = value; profile.variance[y] = 0; profile.colorSpread[y] = 0;
    profile.nearWhiteCoverage[y] = value >= 230 ? 1 : 0;
  }
  assert.equal(sliceStripProfile(profile, 500, height, 'manhwa').segments.length, 1);
});

test('minimum gutter width is adjustable up to 1000 profile pixels', () => {
  const profile = pageProfile([[240, 240, 240], [130, 130, 130]]);
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa', { minGapPx: 16 }).segments.length, 3);
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa', { minGapPx: 31 }).segments.length, 1);
  assert.equal(sliceStripProfile(profile, 500, 1000, 'manhwa', { minGapPx: 1000 }).segments.length, 1);
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /id="min-gap-input" type="range" min="0" max="1000"/);
  assert.doesNotMatch(source, /min-luma-input|min-luma-output|minGapLuminance/);
});

test('a clear 20px separator is accepted automatically on a long source page', () => {
  const height = 20000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height), nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y++) {
    const value = 160 + y % 30;
    profile.r[y] = value; profile.g[y] = value - 20; profile.b[y] = value - 40;
    profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
    profile.variance[y] = 200; profile.colorSpread[y] = 80;
  }
  for (let y = 5000; y < 5020; y++) setColor(profile, y, [255, 255, 255]);
  assert.equal(sliceStripProfile(profile, 800, height, 'manhwa', { referenceHeight: 16000 }).segments.length, 2);
});

function concatenateProfiles(profiles) {
  const keys = ['r', 'g', 'b', 'lum', 'variance', 'colorSpread', 'nearWhiteCoverage'];
  const height = profiles.reduce((sum, profile) => sum + profile.lum.length, 0);
  const output = Object.fromEntries(keys.map(key => [key, new Float64Array(height)]));
  let offset = 0;
  for (const profile of profiles) {
    for (const key of keys) output[key].set(profile[key], offset);
    offset += profile.lum.length;
  }
  return output;
}

test('chapter auto gutter threshold uses a representative source-page height, not the joined chapter height', () => {
  const pages = Array.from({ length: 40 }, () => pageProfile([[240, 240, 240], [130, 130, 130]]));
  const joined = concatenateProfiles(pages);
  const result = sliceStripProfile(joined, 500, joined.lum.length, 'manhwa', { referenceHeight: 1000 });
  assert.equal(result.segments.length, 81);
  assert.equal(result.segments[0].y0, 0);
  assert.equal(result.segments.at(-1).y1, joined.lum.length);
});

test('flat outer margins are kept so a title card or speech bubble touching the image edge is not cropped away', () => {
  const height = 1000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height), nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < 100; y++) setColor(profile, y, [8, 8, 8]);
  for (let y = 100; y < 900; y++) {
    const value = 140 + (y % 31);
    profile.r[y] = value; profile.g[y] = value - 20; profile.b[y] = value - 35;
    profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
    profile.variance[y] = 300; profile.colorSpread[y] = 90;
  }
  for (let y = 900; y < height; y++) setColor(profile, y, [250, 250, 250]);
  const result = sliceStripProfile(profile, 500, height, 'manhua');
  assert.equal(result.segments.length, 1);
  assert.deepEqual(result.segments[0], { y0: 0, y1: height });
});

test('flat runs touching a joined source-file boundary are protected from artificial cuts', () => {
  const height = 2000;
  const profile = {
    r: new Float64Array(height), g: new Float64Array(height), b: new Float64Array(height),
    lum: new Float64Array(height), variance: new Float64Array(height), colorSpread: new Float64Array(height), nearWhiteCoverage: new Float64Array(height),
  };
  for (let y = 0; y < height; y++) {
    if (y >= 900 && y < 1100) { setColor(profile, y, [90, 40, 65]); continue; }
    const value = 170 + (y % 23);
    profile.r[y] = value; profile.g[y] = value - 25; profile.b[y] = value - 45;
    profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
    profile.variance[y] = 250; profile.colorSpread[y] = 90;
  }
  assert.equal(sliceStripProfile(profile, 1000, height, 'manhua', { referenceHeight: 1000 }).segments.length, 2);
  // LONG-FIX: dải dài 200px (>= 150px) chạm ranh giới trang KHÔNG còn bị bảo vệ,
  // vì dải dài ở đó là điểm cắt thật (bản gốc gộp trang Sword Hound thành 8000px).
  // Dải ngắn < 150px vẫn được bảo vệ như cũ.
  const joined = sliceStripProfile(profile, 1000, height, 'manhua', { referenceHeight: 1000, protectedRows: [1000] });
  assert.equal(joined.segments.length, 2);
});

test('screenshot strip: dark gaps with spread 14 are cut into 3 panels', () => {
  // Dải hẹp 83px trong screenshot: 2 dải đen 49px và 62px, spread = 14,
  // bản gốc spread <= 12 trả về 1 đoạn duy nhất.
  const profile = {
    r: new Float64Array(681), g: new Float64Array(681), b: new Float64Array(681),
    lum: new Float64Array(681), variance: new Float64Array(681), colorSpread: new Float64Array(681),
    nearWhiteCoverage: new Float64Array(681), darkCoverage: new Float64Array(681),
  };
  for (let y = 0; y < 681; y++) {
    const inGap = (y >= 149 && y <= 197) || (y >= 399 && y <= 460);
    if (inGap) { setColor(profile, y, [1, 1, 1]); profile.colorSpread[y] = 14; profile.darkCoverage[y] = 1; continue; }
    const value = 100 + (y % 50);
    profile.r[y] = value; profile.g[y] = value - 20; profile.b[y] = value - 30;
    profile.lum[y] = .299 * profile.r[y] + .587 * profile.g[y] + .114 * profile.b[y];
    profile.variance[y] = 300; profile.colorSpread[y] = 150; profile.darkCoverage[y] = 0.2;
  }
  const result = sliceStripProfile(profile, 83, 681, 'manhwa', { minGapPx: 0 });
  assert.equal(result.segments.length, 3);
});
