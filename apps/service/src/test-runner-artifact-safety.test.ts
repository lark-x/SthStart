import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { DEFAULT_ARTIFACT_DIRECTORY, readConfig } from './config.js';
import { ServiceDatabase } from './database.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';

test('an empty in-memory service cannot scan or remove its configured artifact root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sthstart-artifact-safety-'));
  const artifactDirectory = resolve(root, 'artifacts');
  const marker = resolve(artifactDirectory, 'must-survive.png');
  const markerBytes = Buffer.from('test-runner-canary');
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(marker, markerBytes);

  const previousRunner = process.env.STHSTART_TEST_RUNNER;
  const previousArtifactRoot = process.env.STHSTART_TEST_ARTIFACT_DIR;
  process.env.STHSTART_TEST_RUNNER = '1';
  process.env.STHSTART_TEST_ARTIFACT_DIR = artifactDirectory;

  const database = new ServiceDatabase();
  let service: Awaited<ReturnType<typeof createService>> | null = null;
  t.after(async () => {
    if (service) await service.app.close();
    database.close();
    if (previousRunner === undefined) delete process.env.STHSTART_TEST_RUNNER;
    else process.env.STHSTART_TEST_RUNNER = previousRunner;
    if (previousArtifactRoot === undefined) delete process.env.STHSTART_TEST_ARTIFACT_DIR;
    else process.env.STHSTART_TEST_ARTIFACT_DIR = previousArtifactRoot;
    await rm(root, { recursive: true, force: true });
  });

  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'artifact-safety-test-token-at-least-32-characters' });
  assert.equal(config.artifactDirectory, DEFAULT_ARTIFACT_DIRECTORY);
  service = await createService({ config, database, secrets: new SecretStore({}) });

  assert.equal(service.config.artifactDirectory, artifactDirectory, 'the production root must be replaced before service startup');
  assert.deepEqual(await readFile(marker), markerBytes, 'startup must not treat files as orphans in a memory-only service');
});

test('the test runner rejects the production artifact root as its isolation target', async (t) => {
  const previousRunner = process.env.STHSTART_TEST_RUNNER;
  const previousArtifactRoot = process.env.STHSTART_TEST_ARTIFACT_DIR;
  process.env.STHSTART_TEST_RUNNER = '1';
  process.env.STHSTART_TEST_ARTIFACT_DIR = DEFAULT_ARTIFACT_DIRECTORY;
  const database = new ServiceDatabase();
  t.after(() => {
    database.close();
    if (previousRunner === undefined) delete process.env.STHSTART_TEST_RUNNER;
    else process.env.STHSTART_TEST_RUNNER = previousRunner;
    if (previousArtifactRoot === undefined) delete process.env.STHSTART_TEST_ARTIFACT_DIR;
    else process.env.STHSTART_TEST_ARTIFACT_DIR = previousArtifactRoot;
  });

  await assert.rejects(
    () => createService({
      config: readConfig({ STHSTART_ADMIN_TOKEN: 'artifact-safety-test-token-at-least-32-characters' }),
      database,
      secrets: new SecretStore({}),
    }),
    /inside the system temporary directory/,
  );
});
