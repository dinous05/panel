import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSerialQueue, emptyRegistry, ensureProject, loadRegistryWithRecovery, resolvePanelIdentities, saveRegistryAtomic, validateRegistry } from '../electron/identity-registry.js';

const now = () => '2026-11-13T00:00:00.000Z';

test('identity registry reuses ID for the same key and never reassigns deleted IDs', () => {
  const registry = emptyRegistry();
  const project = ensureProject(registry, 'source-hash', now);
  const first = resolvePanelIdentities(project, ['source-page1-cropA', 'source-page1-cropB'], now);
  assert.deepEqual(first.map(item => item.id), ['P000001', 'P000002']);
  delete project.identities['source-page1-cropA'];
  const repeated = resolvePanelIdentities(project, ['source-page1-cropB', 'source-page1-cropA'], now);
  assert.equal(repeated[0].id, 'P000002');
  assert.equal(repeated[1].id, 'P000003');
  assert.notEqual(repeated[1].uuid, first[0].uuid);
});

test('project identity is stable for the same project key and separate for another source', () => {
  const registry = emptyRegistry();
  const one = ensureProject(registry, 'same-source', now);
  const again = ensureProject(registry, 'same-source');
  const other = ensureProject(registry, 'other-source');
  assert.equal(one.projectId, again.projectId);
  assert.notEqual(one.projectId, other.projectId);
});

test('registry rejects duplicate identities, invalid schema and a counter that could reuse IDs', () => {
  const valid = emptyRegistry();
  const project = ensureProject(valid, 'p', now);
  resolvePanelIdentities(project, ['a', 'b'], now);
  assert.equal(validateRegistry(valid), valid);
  const duplicate = structuredClone(valid);
  duplicate.projects.p.identities.b.uuid = duplicate.projects.p.identities.a.uuid;
  assert.throws(() => validateRegistry(duplicate), /trùng/);
  const resetCounter = structuredClone(valid);
  resetCounter.projects.p.nextNumber = 2;
  assert.throws(() => validateRegistry(resetCounter), /tái sử dụng/);
  assert.throws(() => validateRegistry({ schema_version: 99, projects: {} }), /schema/);
});

test('registry writes atomic backups and recovers a corrupt primary without losing the backup state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-registry-test-'));
  const file = path.join(dir, 'panel-identities.json');
  try {
    const first = emptyRegistry();
    const p1 = ensureProject(first, 'p', now);
    resolvePanelIdentities(p1, ['one'], now);
    await saveRegistryAtomic(file, first);
    const second = structuredClone(first);
    resolvePanelIdentities(second.projects.p, ['two'], now);
    await saveRegistryAtomic(file, second);
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'));
    assert.deepEqual(Object.keys(backup.projects.p.identities), ['one']);
    await fs.writeFile(file, '{broken-json', 'utf8');
    const recovered = await loadRegistryWithRecovery(file);
    assert.deepEqual(Object.keys(recovered.projects.p.identities), ['one']);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schema_version, 1);
    const savedFiles = await fs.readdir(dir);
    const corruptCopy = savedFiles.find(name => name.startsWith('panel-identities.json.corrupt-'));
    assert.ok(corruptCopy);
    assert.equal(await fs.readFile(path.join(dir,corruptCopy),'utf8'),'{broken-json');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('registry does not reset or overwrite corrupt data when no valid backup exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-registry-corrupt-'));
  const file = path.join(dir, 'panel-identities.json');
  try {
    await fs.writeFile(file, '{not-json', 'utf8');
    await assert.rejects(loadRegistryWithRecovery(file), /giữ nguyên/);
    assert.equal(await fs.readFile(file, 'utf8'), '{not-json');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('registry transaction queue prevents same-process counter races', async () => {
  const serialize = createSerialQueue();
  const registry = emptyRegistry();
  ensureProject(registry, 'p', now);
  const resolve = key => serialize(async () => {
    await new Promise(r => setTimeout(r, 2));
    return resolvePanelIdentities(registry.projects.p, [key], now)[0].id;
  });
  const ids = await Promise.all(Array.from({ length: 40 }, (_, i) => resolve(`key-${i}`)));
  assert.equal(new Set(ids).size, 40);
  assert.equal(new Set(Object.values(registry.projects.p.identities).map(item => item.uuid)).size, 40);
});
