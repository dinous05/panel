import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { backupProject, createProject, inspectProjectAccess, listProjects, openProject, restoreProject } from '../src/project-manager.mjs';

let tmp;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'cps-test-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });
async function newProject(name='Demo') { return createProject(tmp, name); }
async function makeSymlink(t, target, link, type='dir') {
  try { await symlink(target, link, type); return true; }
  catch (error) {
    if (['EPERM','EACCES','ENOTSUP','EINVAL'].includes(error.code)) { t.skip(`Symlink creation unavailable in this environment (${error.code}).`); return false; }
    throw error;
  }
}

test('create/open/list establishes the canonical Project layout', async () => {
  const project = await newProject();
  assert.equal(project.metadata.schemaVersion, 1);
  assert.equal((await openProject(project.path)).metadata.projectId, project.metadata.projectId);
  assert.equal((await listProjects(tmp)).length, 1);
  assert.ok((await readdir(project.path)).includes('project.json'));
});

test('rejects existing destination, traversal, reserved Windows names, and malformed paths without altering data', async () => {
  const existing = path.join(tmp, 'Keep');
  await mkdir(existing); await writeFile(path.join(existing, 'important.txt'), 'preserve me');
  await assert.rejects(createProject(tmp, 'Keep'), /đã tồn tại/);
  assert.equal(await readFile(path.join(existing, 'important.txt'), 'utf8'), 'preserve me');
  for (const name of ['../escape', 'A/B', 'CON', 'name.']) await assert.rejects(createProject(tmp, name), /không hợp lệ/);
  assert.equal((await createProject(tmp, ' normalized ')).metadata.name, 'normalized');
  await assert.rejects(createProject('', 'invalid'), /không hợp lệ/);
  await assert.rejects(createProject(existing + path.sep + 'important.txt', 'child'), /không phải thư mục/);
  assert.equal(await readFile(path.join(existing, 'important.txt'), 'utf8'), 'preserve me');
});

test('project can be opened after the creating process exits', async () => {
  const project = await newProject('Reopen');
  const moduleUrl = new URL('../src/project-manager.mjs', import.meta.url).href;
  const script = `import {openProject} from ${JSON.stringify(moduleUrl)}; const p=await openProject(process.argv[1]); console.log(p.metadata.projectId);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, project.path], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), project.metadata.projectId);
});

test('reports module-owned directory write access without changing project data', async () => {
  const project = await newProject('AccessCheck');
  const before = await readFile(path.join(project.path, 'project.json'), 'utf8');
  const access = await inspectProjectAccess(project.path);
  assert.equal(access.projectId, project.metadata.projectId);
  assert.deepEqual(access.readOnlyModules, []);
  assert.ok(Object.values(access.writable).every(Boolean));
  assert.equal(await readFile(path.join(project.path, 'project.json'), 'utf8'), before);
});

test('detects a read-only module folder where POSIX permissions are enforced', async t => {
  if (process.platform === 'win32') { t.skip('Windows ACL behavior requires execution on Windows.'); return; }
  const project = await newProject('ReadOnly');
  const folder = path.join(project.path, 'audio', 'tts');
  const original = (await stat(folder)).mode & 0o777;
  try {
    await chmod(folder, 0o555);
    const result = await inspectProjectAccess(project.path);
    assert.equal(result.writable.audio, false);
    assert.ok(result.readOnlyModules.includes('audio'));
  } finally { await chmod(folder, original); }
});

test('rejects symlink project roots and symlinked owned directories', async t => {
  const project = await newProject('LinkCheck');
  const outside = path.join(tmp, 'outside'); await mkdir(outside);
  const linkedRoot = path.join(tmp, 'root-link');
  if (!await makeSymlink(t, project.path, linkedRoot)) return;
  await assert.rejects(openProject(linkedRoot), /symbolic link|reparse point/i);
  const images = path.join(project.path, 'panels', 'images');
  await rm(images, { recursive: true });
  if (!await makeSymlink(t, outside, images)) return;
  await assert.rejects(openProject(project.path), /symbolic link|reparse point/i);
});

test('rejects symlink parents instead of writing through them', async t => {
  const realParent = path.join(tmp, 'real-parent'); await mkdir(realParent);
  const alias = path.join(tmp, 'parent-link');
  if (!await makeSymlink(t, realParent, alias)) return;
  await assert.rejects(createProject(alias, 'MustNotAppear'), /symbolic link|reparse point/i);
  assert.deepEqual(await readdir(realParent), []);
});

test('backup preserves project files, creates distinct archives, and can be stored only in the dedicated in-project backup folder', async () => {
  const project = await newProject('Archive');
  await mkdir(path.join(project.path, 'panels', 'images', 'sub'), { recursive: true });
  await writeFile(path.join(project.path, 'panels', 'manifest.json'), '{"schema_version":"1.0"}');
  await writeFile(path.join(project.path, 'panels', 'images', 'sub', 'panel.jpg'), 'image-bytes');
  await writeFile(path.join(project.path, 'backups', 'older-marker.txt'), 'should not be nested');
  const backupDir = path.join(tmp, 'external-backups');
  const first = await backupProject(project.path, backupDir);
  const second = await backupProject(project.path, backupDir);
  assert.notEqual(first, second);
  assert.equal(await readFile(path.join(first, 'panels', 'manifest.json'), 'utf8'), '{"schema_version":"1.0"}');
  assert.equal(await readFile(path.join(first, 'panels', 'images', 'sub', 'panel.jpg'), 'utf8'), 'image-bytes');
  assert.equal(await readFile(path.join(project.path, 'panels', 'manifest.json'), 'utf8'), '{"schema_version":"1.0"}');
  assert.equal((await readdir(first)).includes('backups'), false);
  await assert.rejects(backupProject(project.path, project.path), /backup lồng/i);
  const internal = await backupProject(project.path, path.join(project.path, 'backups'));
  assert.ok((await readFile(path.join(internal, 'backup-info.json'), 'utf8')).includes(project.metadata.projectId));
});

test('refuses backup if any source subtree contains a symbolic link', async t => {
  const project = await newProject('LinkedData'), outside = path.join(tmp, 'outside.txt');
  await writeFile(outside, 'private');
  const link = path.join(project.path, 'panels', 'images', 'outside.txt');
  try { await symlink(outside, link, 'file'); }
  catch (error) { if (['EPERM','EACCES','ENOTSUP','EINVAL'].includes(error.code)) { t.skip(`Symlink creation unavailable (${error.code}).`); return; } throw error; }
  await assert.rejects(backupProject(project.path, path.join(tmp, 'backups')), /symbolic link/i);
});

test('restore is atomic, preserves bytes, refuses collisions, and leaves existing data untouched', async () => {
  const project = await newProject('Recover');
  await writeFile(path.join(project.path, 'panels', 'manifest.json'), 'legacy manifest bytes');
  const archive = await backupProject(project.path, path.join(tmp, 'backups'));
  const destination = path.join(tmp, 'restored');
  const restored = await restoreProject(archive, destination);
  assert.equal(await readFile(path.join(restored.path, 'panels', 'manifest.json'), 'utf8'), 'legacy manifest bytes');
  assert.equal(restored.metadata.projectId, project.metadata.projectId);
  await assert.rejects(restoreProject(archive, destination), /đã tồn tại/i);
  assert.equal(await readFile(path.join(destination, 'panels', 'manifest.json'), 'utf8'), 'legacy manifest bytes');
  await assert.rejects(restoreProject(archive, path.join(archive, 'inside')), /bên trong thư mục backup/i);
});

test('malformed backup fails without leaving a partial destination or staging folder', async () => {
  const project = await newProject('Incomplete');
  const archive = await backupProject(project.path, path.join(tmp, 'backups'));
  await rm(path.join(archive, 'panels'), { recursive: true, force: true });
  const destination = path.join(tmp, 'should-not-exist');
  await assert.rejects(restoreProject(archive, destination), /thiếu thư mục bắt buộc/);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
  const siblings = await readdir(tmp);
  assert.equal(siblings.some(name => name.endsWith('.restore-staging')), false);
});

test('refuses backup source symlinks and mismatched backup identity', async t => {
  const project = await newProject('Integrity');
  const archive = await backupProject(project.path, path.join(tmp, 'backups'));
  const infoPath = path.join(archive, 'backup-info.json');
  const info = JSON.parse(await readFile(infoPath, 'utf8'));
  await writeFile(infoPath, JSON.stringify({ ...info, projectId: 'not-the-project-id' }));
  await assert.rejects(restoreProject(archive, path.join(tmp, 'wrong-id')), /identity does not match/i);
  await writeFile(infoPath, JSON.stringify(info));
  const outside = path.join(tmp, 'external'); await writeFile(outside, 'x');
  try { await symlink(outside, path.join(archive, 'external'), 'file'); }
  catch (error) { if (['EPERM','EACCES','ENOTSUP','EINVAL'].includes(error.code)) { t.skip(`Symlink creation unavailable (${error.code}).`); return; } throw error; }
  await assert.rejects(restoreProject(archive, path.join(tmp, 'linked-restore')), /symbolic link/i);
});
