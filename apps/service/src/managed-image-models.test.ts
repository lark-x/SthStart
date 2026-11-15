import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';
import { createGenerationTask, executeQueuedTask } from './generation/execution.js';
import { getGenerationTask } from './generation/task-store.js';
import { stopGenerationExecutions } from './generation/events.js';

class MemorySecrets extends SecretStore {
  values = new Map<string, string>();
  environmentValues = new Map<string, string>();
  reads: Array<string | undefined> = [];
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string, env?: string) {
    this.reads.push(env);
    const value = this.values.get(account);
    if (value) return { value, source: 'keyring' as const };
    const fallback = env ? this.environmentValues.get(env) : null;
    return fallback ? { value: fallback, source: 'environment' as const } : { value: null, source: 'none' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('managed image recipes publish without dispatch and run via shared supplier credentials, headers and model options', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sthstart-managed-image-'));
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'managed-image-tests-admin-credential', STHSTART_ARTIFACT_DIR: directory });
  const headers = { 'x-sthstart-admin-token': config.adminToken! };
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> | FormData }> = [];
  let expectTimeout = 8765;
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(init?.signal);
    requests.push({ url: String(url), headers: new Headers(init.headers), body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)) });
    const headers = requests.at(-1)!.headers;
    assert.equal(headers.get('authorization'), 'Bearer supplier-key');
    assert.equal(headers.get('X-Tenant'), requests.length === 1 ? 'first' : 'updated');
    assert.equal(headers.get('content-type'), init.body instanceof FormData ? null : 'application/json');
    return Response.json({ data: [{ b64_json: png }] });
  };
  const { app } = await createService({ config, database, secrets, fetcher });
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/admin/${path}`, headers, payload });
  const connection = { id: 'supplier', name: '同一个供应商', kind: 'openai-compatible-text', baseUrl: 'https://supplier.invalid/v1',
    secret: 'supplier-key', headers: { 'X-Tenant': 'first' }, options: { vendorOption: 'shared' }, timeoutMs: 4321 };
  const model = { id: 'image-model', name: '绘图模型', modelId: 'vendor-image', modelType: 'image', connectionId: 'supplier', capabilities: [],
    timeoutMs: expectTimeout, defaultParams: { vendorOption: 'model', model: 'must-not-override', n: 8 }, advancedJson: { vendorAdvanced: 7 } };
  try {
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/admin/models/image-model/image-workflow', payload: {} });
    assert.equal(anonymous.statusCode, 401);
    assert.equal((await post('connections', connection)).statusCode, 201);
    assert.equal((await post('models', model)).statusCode, 201);
    const publish = await post('models/image-model/image-workflow', {});
    assert.equal(publish.statusCode, 201, publish.body);
    const published = publish.json() as { workflowId: string; engineId: string };
    assert.equal(requests.length, 0, 'creating a recipe must never submit a paid task');
    assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 0);
    assert.equal(secrets.values.size, 1, 'generated engines reuse the supplier credential account');
    const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id=?').get(published.engineId)!;
    assert.equal(engine.connection_id, 'supplier');
    assert.equal(engine.credential_account, 'conn:supplier');
    const version = database.connection.prepare('SELECT * FROM generation_workflow_versions WHERE workflow_id=?').get(published.workflowId)!;
    assert.equal(version.is_published, 1);
    assert.equal(JSON.parse(String(version.definition_json)).modelProfileId, 'image-model');
    for (const changes of [{ enabled: false }, { modelType: 'chat' }, { modelId: 'changed' }]) {
      assert.equal((await post('models', { ...model, ...changes })).statusCode, 409);
    }
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/admin/models/image-model', headers })).statusCode, 409);
    assert.equal((await post('connections', { ...connection, enabled: false })).statusCode, 409);
    assert.equal((await post('models/image-model/test', {})).json().error, 'use_generation_test');

    // Capture the actual dispatch timeout synchronously without waiting for it.
    const originalTimeout = AbortSignal.timeout;
    let observedTimeout = false;
    AbortSignal.timeout = (ms: number) => { if (ms === expectTimeout) observedTimeout = true; return originalTimeout(ms); };
    try {
      const task = await createGenerationTask(config, database, secrets, { appId: 'activities', workflowId: published.workflowId,
        isInternal: true, inputs: { prompt: 'test image' } }, fetcher);
      assert.equal(requests.length, 0);
      await executeQueuedTask(config, database, secrets, task.id, fetcher);
      const completed = getGenerationTask(database, task.id)!;
      assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
      assert.equal(completed.artifacts.length, 1);
      assert.equal(observedTimeout, true, 'model timeout overrides supplier timeout');
      assert.ok(secrets.reads.includes('STHSTART_SECRET_SUPPLIER'));
    } finally { AbortSignal.timeout = originalTimeout; }
    const body = requests[0].body as Record<string, unknown>;
    assert.equal(requests[0].url, 'https://supplier.invalid/v1/images/generations');
    assert.equal(body.model, 'vendor-image');
    assert.equal(body.n, 1);
    assert.equal(body.vendorOption, 'model');
    assert.equal(body.vendorAdvanced, 7);

    assert.equal((await post('connections', { ...connection, baseUrl: 'https://updated.invalid/v1', headers: { 'X-Tenant': 'updated' }, timeoutMs: 9876 })).statusCode, 201);
    assert.equal((await post('models', { ...model, timeoutMs: null })).statusCode, 201);
    secrets.values.clear();
    secrets.environmentValues.set('STHSTART_SECRET_IMAGE_MODEL', 'supplier-key');
    const edit = await post('models/image-model/image-workflow', { operation: 'image-to-image' });
    assert.equal(edit.statusCode, 201, edit.body);
    assert.equal(edit.json().engineId, published.engineId, 'multiple model recipes share a single supplier engine');
    assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_engines WHERE connection_id=?').get('supplier')!.count, 1);
    const editedVersion = database.connection.prepare('SELECT * FROM generation_workflow_versions WHERE workflow_id=?').get(edit.json().workflowId)!;
    assert.equal(JSON.parse(String(editedVersion.input_capabilities_json)).referenceImage.required, true);
    await assert.rejects(createGenerationTask(config, database, secrets, { appId: 'activities', workflowId: edit.json().workflowId,
      isInternal: true, inputs: { prompt: 'edit image' } }, fetcher), /referenceImage/);
    const imagePath = join(config.artifactDirectory, 'reference.png');
    await writeFile(imagePath, Buffer.from(png, 'base64'));
    database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,storage_key,content_type,byte_size,file_status,created_at,updated_at)
      VALUES ('reference','activities',?,'reference.png','image/png',?,'ready',?,?)`).run(imagePath, Buffer.from(png, 'base64').length, nowIso(), nowIso());
    expectTimeout = 9876;
    let supplierTimeoutObserved = false;
    AbortSignal.timeout = (ms: number) => { if (ms === expectTimeout) supplierTimeoutObserved = true; return originalTimeout(ms); };
    try {
      const task = await createGenerationTask(config, database, secrets, { appId: 'activities', workflowId: edit.json().workflowId,
        isInternal: true, inputs: { prompt: 'edit image' }, inputArtifacts: [{ artifactId: 'reference', inputKey: 'referenceImage' }] }, fetcher);
      await executeQueuedTask(config, database, secrets, task.id, fetcher);
      assert.equal(getGenerationTask(database, task.id)!.status, 'succeeded');
      assert.equal(supplierTimeoutObserved, true, 'supplier timeout applies when the model override is cleared');
    } finally { AbortSignal.timeout = originalTimeout; }
    assert.equal(requests[1].url, 'https://updated.invalid/v1/images/edits');
    const editBody = requests[1].body as FormData;
    assert.equal(editBody.get('model'), 'vendor-image');
    assert.equal(editBody.get('prompt'), 'edit image');
    assert.ok(editBody.get('image') instanceof Blob);
    assert.equal(editBody.get('vendorOption'), 'model');
    assert.ok(secrets.reads.includes('STHSTART_SECRET_IMAGE_MODEL'), 'legacy model environment credentials remain usable');

    // Queued snapshots re-check model state even if storage was changed outside
    // the guarded management endpoints. Nothing may reach the vendor here.
    const queued = await createGenerationTask(config, database, secrets, { appId: 'activities', workflowId: published.workflowId,
      isInternal: true, inputs: { prompt: 'must not dispatch' } }, fetcher);
    database.connection.prepare("UPDATE model_profiles SET model_type='embedding' WHERE id='image-model'").run();
    await executeQueuedTask(config, database, secrets, queued.id, fetcher);
    assert.equal(getGenerationTask(database, queued.id)!.status, 'failed');
    assert.match(getGenerationTask(database, queued.id)!.errorMessage ?? '', /managed_image_model_unavailable/);
    assert.equal(requests.length, 2);
  } finally {
    stopGenerationExecutions(database);
    await app.close();
    await new Promise<void>(done => setImmediate(done));
    database.close();
    const root = resolve(tmpdir());
    const rel = relative(root, resolve(directory));
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(':'));
    await rm(directory, { recursive: true, force: true });
  }
});
