import { randomUUID } from 'node:crypto';

export function ensureProject(registry, projectKey, now = () => new Date().toISOString()) {
  return registry.projects[projectKey] ||= { projectId: randomUUID(), createdAt: now(), nextNumber: 1, identities: {} };
}

export function resolvePanelIdentities(project, keys, now = () => new Date().toISOString()) {
  return keys.map(key => {
    let identity = project.identities[key];
    if (!identity) {
      identity = { uuid: randomUUID(), id: `P${String(project.nextNumber++).padStart(6, '0')}`, createdAt: now() };
      project.identities[key] = identity;
    }
    return { ...identity };
  });
}
