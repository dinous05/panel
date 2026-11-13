import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const REGISTRY_SCHEMA_VERSION = 1;

export function emptyRegistry() {
  return { schema_version: REGISTRY_SCHEMA_VERSION, projects: {} };
}

export function validateRegistry(registry) {
  if (!registry || registry.schema_version !== REGISTRY_SCHEMA_VERSION || !registry.projects || typeof registry.projects !== 'object' || Array.isArray(registry.projects)) {
    throw new Error(`Registry schema không hợp lệ (yêu cầu version ${REGISTRY_SCHEMA_VERSION}).`);
  }
  for (const [projectKey, project] of Object.entries(registry.projects)) {
    if (!projectKey || !project || typeof project.projectId !== 'string' || !project.projectId || typeof project.createdAt !== 'string' || !Number.isSafeInteger(project.nextNumber) || project.nextNumber < 1 || !project.identities || typeof project.identities !== 'object' || Array.isArray(project.identities)) {
      throw new Error(`Project registry không hợp lệ: ${projectKey || '(trống)'}.`);
    }
    const ids = new Set(), uuids = new Set();
    let maxNumber = 0;
    for (const [key, identity] of Object.entries(project.identities)) {
      const match = /^P(\d+)$/.exec(identity?.id || '');
      if (!key || !match || typeof identity.uuid !== 'string' || !identity.uuid || typeof identity.createdAt !== 'string') throw new Error(`Identity registry không hợp lệ trong project ${projectKey}.`);
      if (ids.has(identity.id) || uuids.has(identity.uuid)) throw new Error(`ID/UUID bị trùng trong registry project ${projectKey}.`);
      ids.add(identity.id); uuids.add(identity.uuid);
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
    if (project.nextNumber <= maxNumber) throw new Error(`Counter registry không an toàn trong project ${projectKey}; có nguy cơ tái sử dụng ID.`);
  }
  return registry;
}

export function ensureProject(registry, projectKey, now = () => new Date().toISOString()) {
  validateRegistry(registry);
  return registry.projects[projectKey] ||= { projectId: randomUUID(), createdAt: now(), nextNumber: 1, identities: {} };
}

export function resolvePanelIdentities(project, keys, now = () => new Date().toISOString()) {
  if (!project || !Number.isSafeInteger(project.nextNumber) || !project.identities || typeof project.identities !== 'object') throw new Error('Project registry không hợp lệ.');
  const ids = new Set(Object.values(project.identities).map(item => item.id));
  const uuids = new Set(Object.values(project.identities).map(item => item.uuid));
  return keys.map(key => {
    let identity = project.identities[key];
    if (!identity) {
      while (ids.has(`P${String(project.nextNumber).padStart(6, '0')}`)) project.nextNumber++;
      identity = { uuid: randomUUID(), id: `P${String(project.nextNumber++).padStart(6, '0')}`, createdAt: now() };
      while (uuids.has(identity.uuid)) identity.uuid = randomUUID();
      project.identities[key] = identity;
      ids.add(identity.id); uuids.add(identity.uuid);
    }
    return { ...identity };
  });
}

async function readAndValidate(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return validateRegistry(JSON.parse(text));
}

async function atomicWrite(filePath, registry) {
  validateRegistry(registry);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    try {
      await fs.rename(temporary, filePath);
    } catch (error) {
      if (!['EEXIST','EPERM','ENOTEMPTY'].includes(error.code)) throw error;
      const previous = `${filePath}.${randomUUID()}.old`;
      await fs.rename(filePath, previous);
      try {
        await fs.rename(temporary, filePath);
      } catch (replacementError) {
        await fs.rename(previous, filePath).catch(() => {});
        throw replacementError;
      }
      await fs.rm(previous,{force:true});
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function loadRegistryWithRecovery(filePath) {
  const backupPath = `${filePath}.bak`;
  const restore = async (registry, preserveCorruptPrimary) => {
    if (preserveCorruptPrimary) {
      const preservedPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
      await fs.copyFile(filePath, preservedPath);
    }
    await atomicWrite(filePath, registry);
    return registry;
  };
  try {
    return await readAndValidate(filePath);
  } catch (primaryError) {
    if (primaryError.code === 'ENOENT') {
      try {
        const recovered = await readAndValidate(backupPath);
        return await restore(recovered, false);
      } catch (backupError) {
        if (backupError.code === 'ENOENT') return emptyRegistry();
        throw new Error(`Không đọc được registry chính (thiếu) hoặc backup: ${backupError.message}. Các file hiện có được giữ nguyên.`);
      }
    }
    try {
      const recovered = await readAndValidate(backupPath);
      return await restore(recovered, true);
    } catch (backupError) {
      throw new Error(`Registry chính bị lỗi: ${primaryError.message}. Không phục hồi được backup: ${backupError.code === 'ENOENT' ? 'không tồn tại' : backupError.message}. Không ghi đè hoặc xóa file nào; giữ nguyên để khôi phục thủ công.`);
    }
  }
}

export async function saveRegistryAtomic(filePath, registry) {
  validateRegistry(registry);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const backupPath = `${filePath}.bak`;
  try {
    const existing = await readAndValidate(filePath);
    const backupTemp = `${backupPath}.${randomUUID()}.tmp`;
    try {
      await fs.copyFile(filePath, backupTemp);
      const backupHandle = await fs.open(backupTemp, 'r+');
      try { await backupHandle.sync(); } finally { await backupHandle.close(); }
      // Windows may reject rename-over-existing; remove only the old backup.
      // The current primary remains untouched until the new backup is ready.
      await fs.rm(backupPath, { force: true });
      await fs.rename(backupTemp, backupPath);
    } catch (error) {
      await fs.rm(backupTemp, { force: true }).catch(() => {});
      throw new Error(`Không tạo được backup registry; không lưu thay đổi: ${error.message}`);
    }
    // Ensure the backup represents a valid prior state; the parsed value is
    // intentionally referenced so static analyzers and maintainers see this invariant.
    validateRegistry(existing);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await atomicWrite(filePath, registry);
}

export function createSerialQueue() {
  let tail = Promise.resolve();
  return function serialize(operation) {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
}
