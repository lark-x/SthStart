import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCloudGeneration, ingestCloudImagesToArtifacts } from './cloud-adapter.js';
import { ServiceDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { createGenerationTask, executeQueuedTask, cancelGenerationTask } from './execution.js';
import { getGenerationTask } from './task-store.js';
import { SecretStore } from '../security.js';

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

test('cloud image adapter: text-to-image and image-to-image', async () => {
  const mock1x1PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/images/generations')) {
      const body = JSON.parse(String(init?.body)) as { prompt: string; model: string };
      assert.equal(body.model, 'dall-e-3');
      assert.equal(body.prompt, 'a beautiful sunset');
      return Response.json({
        data: [{ b64_json: mock1x1PngBase64 }],
      });
    }
    if (url.includes('/images/edits')) {
      return Response.json({
        data: [{ b64_json: mock1x1PngBase64 }],
      });
    }
    return new Response('not found', { status: 404 });
  };

  // 1. Text-to-image
  const t2iResult = await executeCloudGeneration({
    engine: { id: 'cloud-engine', baseUrl: 'https://api.openai.com/v1', secret: 'sk-test' },
    model: 'dall-e-3',
    operation: 'text-to-image',
    prompt: 'a beautiful sunset',
    fetchFn: fetcher,
  });
  assert.equal(t2iResult.images.length, 1);
  assert.equal(t2iResult.images[0].contentType, 'image/png');

  // 2. Image-to-image
  const i2iResult = await executeCloudGeneration({
    engine: { id: 'cloud-engine', baseUrl: 'https://api.openai.com/v1', secret: 'sk-test' },
    model: 'dall-e-2',
    operation: 'image-to-image',
    prompt: 'make it night',
    referenceImage: {
      buffer: Buffer.from(mock1x1PngBase64, 'base64'),
      contentType: 'image/png',
      filename: 'ref.png',
    },
    fetchFn: fetcher,
  });
  assert.equal(i2iResult.images.length, 1);
});

test('cloud engine execution integrates with generation task flow and persists artifacts', async () => {
  const db = new ServiceDatabase();
  const config = readConfig();
  const secrets = new MemorySecrets();
  const mock1x1PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const fetcher: typeof fetch = async (input, init) => {
    return Response.json({
      data: [{ b64_json: mock1x1PngBase64 }],
    });
  };

  try {
    // Seed managed app, cloud engine, and workflow
    db.connection.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('activities', '活动', 'token', '["generation","image"]', 1, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_engines (id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at)
      VALUES ('cloud-openai', 'OpenAI Cloud', 'cloud', 'https://api.openai.com/v1', 1, 2, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, latest_version, created_at, updated_at)
      VALUES ('cloud-recipe-t2i', 'Cloud T2I', 'OpenAI compatible text to image', 'cloud', 1, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_workflow_versions (workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES ('cloud-recipe-t2i', 1, 'cloud-openai', '{}', '{"type":"cloud_recipe","model":"dall-e-3"}', 1, '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO app_generation_assignments (app_id, purpose, workflow_id, workflow_version, engine_id, updated_at)
      VALUES ('activities', 'beat-image', 'cloud-recipe-t2i', 1, 'cloud-openai', '2026-01-01')
    `).run();

    // Create generation task
    const taskDesc = await createGenerationTask(
      config,
      db,
      secrets,
      {
        appId: 'activities',
        purpose: 'beat-image',
        isInternal: true,
        inputs: {
          prompt: '测试云端生图任务',
          size: '1024x1024',
        },
      },
      fetcher,
    );

    assert.ok(taskDesc.id);
    assert.equal(taskDesc.status, 'queued');

    // Execute task
    await executeQueuedTask(config, db, secrets, taskDesc.id, fetcher);

    // Verify task succeeded and artifact created
    const completedTask = getGenerationTask(db, taskDesc.id);
    assert.ok(completedTask);
    assert.equal(completedTask.status, 'succeeded');
    assert.equal(completedTask.artifacts.length, 1);
    assert.ok(completedTask.artifacts[0].artifactId);
  } finally {
    db.close();
  }
});

test('cloud engine execution: in-flight task cancellation safely aborts without state tampering', async () => {
  const db = new ServiceDatabase();
  const config = readConfig();
  const secrets = new MemorySecrets();
  const mock1x1PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  let abortedSignalReceived = false;
  const delayedFetcher: typeof fetch = async (input, init) => {
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        abortedSignalReceived = true;
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
      setTimeout(() => {
        resolve(Response.json({ data: [{ b64_json: mock1x1PngBase64 }] }));
      }, 5000);
    });
  };

  try {
    db.connection.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('activities', '活动', 'token', '["generation","image"]', 1, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_engines (id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at)
      VALUES ('cloud-openai-cancel', 'OpenAI Cloud Cancel', 'cloud', 'https://api.openai.com/v1', 1, 2, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, latest_version, created_at, updated_at)
      VALUES ('cloud-cancel-recipe', 'Cloud Cancel Recipe', 'OpenAI compatible text to image', 'cloud', 1, '2026-01-01', '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO generation_workflow_versions (workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES ('cloud-cancel-recipe', 1, 'cloud-openai-cancel', '{}', '{"type":"cloud_recipe","model":"dall-e-3"}', 1, '2026-01-01')
    `).run();

    db.connection.prepare(`
      INSERT INTO app_generation_assignments (app_id, purpose, workflow_id, workflow_version, engine_id, updated_at)
      VALUES ('activities', 'avatar', 'cloud-cancel-recipe', 1, 'cloud-openai-cancel', '2026-01-01')
    `).run();

    const taskDesc = await createGenerationTask(
      config,
      db,
      secrets,
      {
        appId: 'activities',
        purpose: 'avatar',
        isInternal: true,
        inputs: {
          prompt: '测试取消生图',
        },
      },
      delayedFetcher,
    );

    // Launch queued task execution asynchronously
    const execPromise = executeQueuedTask(config, db, secrets, taskDesc.id, delayedFetcher);

    // Give it a brief moment to transition to running and register in ExecutionRegistry
    await new Promise((resolve) => setTimeout(resolve, 50));

    const runningTask = getGenerationTask(db, taskDesc.id);
    assert.equal(runningTask?.status, 'running');

    // Cancel task
    const cancelledTask = await cancelGenerationTask(config, db, secrets, taskDesc.id, 'activities', delayedFetcher);
    assert.equal(cancelledTask.status, 'cancelled');

    // Await background execution completion
    await execPromise;

    // Verify task status remained cancelled and was NOT overwritten by error or success
    const finalTask = getGenerationTask(db, taskDesc.id);
    assert.ok(finalTask);
    assert.equal(finalTask.status, 'cancelled');
    assert.ok(abortedSignalReceived, 'Fetch signal should have received abort event');
  } finally {
    db.close();
  }
});
