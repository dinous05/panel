import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProject, resolvePanelIdentities } from '../electron/identity-registry.js';

test('identity registry reuses ID for the same key and never reassigns deleted IDs', () => {
  const registry = { schema_version: 1, projects: {} };
  const now = () => '2026-11-13T00:00:00.000Z';
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
  const registry = { schema_version: 1, projects: {} };
  const one = ensureProject(registry, 'same-source', () => '2026-11-13T00:00:00.000Z');
  const again = ensureProject(registry, 'same-source');
  const other = ensureProject(registry, 'other-source');
  assert.equal(one.projectId, again.projectId);
  assert.notEqual(one.projectId, other.projectId);
});
