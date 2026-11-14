import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { importAnalysisFiles } from '../src/importer.mjs';

test('imports original JSON bytes into module-owned incoming folder without overwriting duplicates', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cps-ai-import-'));
  try {
    const project = path.join(temp, 'project');
    const source = path.join(temp, 'source');
    await mkdir(path.join(project, 'analysis', 'incoming'), { recursive: true });
    await mkdir(source);
    const data = Buffer.from('\uFEFF{ "chapter": {"number": 7}, "voice_beats": [{}, {}] }\r\n', 'utf8');
    const first = path.join(source, 'analysis.json');
    const second = path.join(source, 'same-name.json');
    await writeFile(first, data);
    await writeFile(second, '{"chapter":{"number":8}}');
    await writeFile(path.join(project, 'analysis', 'incoming', 'analysis.json'), 'keep-this');
    const result = await importAnalysisFiles(project, [first, second]);
    assert.equal(result.length, 2);
    assert.equal(result[0].fileName, 'analysis (1).json');
    assert.equal(result[0].voiceBeatCount, 2);
    assert.deepEqual(await readFile(result[0].path), data);
    assert.equal(await readFile(path.join(project, 'analysis', 'incoming', 'analysis.json'), 'utf8'), 'keep-this');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('rejects malformed JSON and non-object roots without leaving files', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cps-ai-import-'));
  try {
    const project = path.join(temp, 'project');
    const bad = path.join(temp, 'bad.json');
    await mkdir(path.join(project, 'analysis', 'incoming'), { recursive: true });
    await writeFile(bad, '[1,2]');
    await assert.rejects(importAnalysisFiles(project, [bad]), /JSON object/);
    assert.deepEqual(await (await import('node:fs/promises')).readdir(path.join(project, 'analysis', 'incoming')), []);
    await writeFile(bad, '{broken');
    await assert.rejects(importAnalysisFiles(project, [bad]), /JSON không hợp lệ/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('accepts the supplied PanelVid Adapter AI Analysis fixture unchanged', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cps-ai-fixture-'));
  try {
    const project = path.join(temp, 'project');
    const fixture = new URL('./fixtures/analysis_result_chapter_0001.json', import.meta.url);
    await mkdir(path.join(project, 'analysis', 'incoming'), { recursive: true });
    const imported = await importAnalysisFiles(project, [fileURLToPath(fixture)]);
    assert.equal(imported[0].voiceBeatCount, 29);
    assert.deepEqual(await readFile(imported[0].path), await readFile(fixture));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
