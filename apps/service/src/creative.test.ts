import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { activeGenerationExecutions } from './generation.js';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';

const adminToken = 'admin-creative-test-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

test('Creative center exposes safe setup state and completes text/image generation through the common core', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-creative-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_IMAGE_SIGNING_SECRET: 'creative-image-signing-secret-1234567890',
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const promptBodies: Array<Record<string, unknown>> = [];
  const uploadedFiles: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/upload/image')) {
      assert.ok(init?.body instanceof FormData);
      const form = init.body as FormData;
      const image = form.get('image');
      assert.ok(image instanceof File);
      uploadedFiles.push(image.name);
      return Response.json({ name: 'creative-input.png', subfolder: '', type: 'input' });
    }
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: Record<string, unknown> };
      promptBodies.push(body.prompt ?? {});
      return Response.json({ prompt_id: `creative-${promptBodies.length}` });
    }
    if (url.includes('/history/creative-')) {
      return Response.json({
        [`creative-${promptBodies.length}`]: {
          status: { status_str: 'success' },
          outputs: {
            '9': { images: [{ filename: 'creative-output.png', type: 'output' }] },
            '10': { images: [{ filename: 'undeclared-output.png', type: 'output' }] },
          },
        },
      });
    }
    if (url.includes('/view')) return new Response(Buffer.from('creative-png'), { status: 200, headers: { 'content-type': 'image/png' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const initialStatus = await app.inject({ method: 'GET', url: '/api/v1/admin/creative/status', headers: adminHeaders });
  assert.equal(initialStatus.statusCode, 200);
  assert.equal(initialStatus.json().modes.textToImage.ready, false);
  assert.equal(initialStatus.json().modes.textToImage.status, 'not_configured');
  assert.equal(JSON.stringify(initialStatus.json()).includes('baseUrl'), false);

  const now = nowIso();
  database.connection.prepare("INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run('creative-engine', '测试 ComfyUI', 'comfyui', 'http://comfy.test:8188', 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run('creative-workflow', '创作中心测试工作流', '', 'comfyui', 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      'creative-workflow',
      1,
      'creative-engine',
      JSON.stringify({ prompt: { type: 'string' }, negativePrompt: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, steps: { type: 'number' }, sourceImage: { type: 'string' } }),
      JSON.stringify({
        prompt: ['1', 'inputs', 'text'],
        negativePrompt: ['2', 'inputs', 'text'],
        width: ['3', 'inputs', 'width'],
        height: ['3', 'inputs', 'height'],
        steps: ['3', 'inputs', 'steps'],
        sourceImage: ['7', 'inputs', 'image'],
      }),
      JSON.stringify(['9']),
      JSON.stringify({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        '3': { class_type: 'KSampler', inputs: { width: 1024, height: 1024, steps: 20, seed: 0 } },
        '7': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
        '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'creative' } },
        '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'should-not-be-saved' } },
      }),
      1,
      now,
    );
  database.connection.prepare('INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES (?,?,?,?,?,?)')
    .run('creative-center', 'text-to-image', 'creative-workflow', 1, 'creative-engine', now);
  database.connection.prepare('INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES (?,?,?,?,?,?)')
    .run('creative-center', 'image-to-image', 'creative-workflow', 1, 'creative-engine', now);

  const status = await app.inject({ method: 'GET', url: '/api/v1/admin/creative/status', headers: adminHeaders });
  assert.equal(status.json().modes.textToImage.ready, true);
  assert.equal(status.json().modes.imageToImage.workflow.name, '创作中心测试工作流');
  assert.equal(JSON.stringify(status.json()).includes('comfy.test'), false);

  const upload = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/creative/uploads',
    headers: { ...adminHeaders, 'content-type': 'image/png', 'x-artifact-original-name': encodeURIComponent('参考图.png') },
    payload: Buffer.from('source-png'),
  });
  assert.equal(upload.statusCode, 201);
  const source = upload.json() as { id: string; appId: string; url: string };
  assert.equal(source.appId, 'creative-center');
  assert.equal(source.url, `/api/v1/admin/creative/artifacts/${source.id}`);
  assert.equal('localPath' in source, false);

  const textTaskResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'creative-text-task-1' },
    payload: { mode: 'text-to-image', prompt: 'a quiet mountain village', negativePrompt: 'blurry', width: 768, height: 1024, steps: 24, seed: 77 },
  });
  assert.equal(textTaskResponse.statusCode, 202);
  const textTaskId = textTaskResponse.json().id as string;
  await Promise.allSettled(Array.from(activeGenerationExecutions));
  const textTask = await app.inject({ method: 'GET', url: `/api/v1/admin/creative/tasks/${textTaskId}`, headers: adminHeaders });
  assert.equal(textTask.json().status, 'succeeded');
  assert.deepEqual(textTask.json().replay.inputs, { prompt: 'a quiet mountain village', negativePrompt: 'blurry', width: 768, height: 1024, steps: 24 });
  assert.equal(textTask.json().artifacts.length, 1, 'only declared output nodes may become artifacts');

  const imageTaskResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'creative-image-task-1' },
    payload: { mode: 'image-to-image', prompt: 'turn this into a watercolor painting', sourceArtifactId: source.id, seed: 88 },
  });
  assert.equal(imageTaskResponse.statusCode, 202);
  const imageTaskId = imageTaskResponse.json().id as string;
  await Promise.allSettled(Array.from(activeGenerationExecutions));
  const imageTask = await app.inject({ method: 'GET', url: `/api/v1/admin/creative/tasks/${imageTaskId}`, headers: adminHeaders });
  assert.equal(imageTask.json().status, 'succeeded');
  assert.deepEqual(imageTask.json().replay.inputArtifactIds, [source.id]);
  assert.equal(uploadedFiles.length, 1);
  assert.equal(promptBodies.length, 2);
  assert.equal((promptBodies[1]['7'] as { inputs: { image: string } }).inputs.image, 'creative-input.png');
  assert.equal(JSON.stringify(promptBodies[1]).includes(source.id), false, 'artifact IDs must not be sent as Comfy filenames');
  assert.equal((await readFile(resolve(artifactDirectory, 'creative-center', `${source.id}.png`))).toString(), 'source-png');

  const gallery = await app.inject({ method: 'GET', url: '/api/v1/admin/creative/artifacts', headers: adminHeaders });
  assert.equal(gallery.statusCode, 200);
  assert.ok(gallery.json().total >= 3);
  assert.equal(JSON.stringify(gallery.json()).includes(artifactDirectory), false);

  const outputId = textTask.json().artifacts[0].artifactId as string;
  const preview = await app.inject({ method: 'GET', url: `/api/v1/admin/creative/artifacts/${outputId}`, headers: adminHeaders });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body, 'creative-png');
  const pin = await app.inject({ method: 'PUT', url: `/api/v1/admin/creative/artifacts/${outputId}/pin`, headers: adminHeaders, payload: { pinned: true } });
  assert.equal(pin.statusCode, 200);
  const blockedDelete = await app.inject({ method: 'DELETE', url: `/api/v1/admin/creative/artifacts/${outputId}`, headers: adminHeaders });
  assert.equal(blockedDelete.statusCode, 409);
  const unpin = await app.inject({ method: 'PUT', url: `/api/v1/admin/creative/artifacts/${outputId}/pin`, headers: adminHeaders, payload: { pinned: false } });
  assert.equal(unpin.statusCode, 200);
  const stillReferenced = await app.inject({ method: 'DELETE', url: `/api/v1/admin/creative/artifacts/${outputId}`, headers: adminHeaders });
  assert.equal(stillReferenced.statusCode, 409);
  assert.equal(stillReferenced.json().error, 'artifact_is_referenced');

  await app.close();
  database.close();
});

test('Creative center rejects unsafe or incomplete image tasks without a silent fallback', async () => {
  const database = new ServiceDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_IMAGE_SIGNING_SECRET: 'creative-image-signing-secret-1234567890' });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  const missingMode = await app.inject({ method: 'POST', url: '/api/v1/admin/creative/tasks', headers: adminHeaders, payload: { prompt: 'test' } });
  assert.equal(missingMode.statusCode, 400);
  assert.equal(missingMode.json().error, 'invalid_mode');

  const missingSource = await app.inject({ method: 'POST', url: '/api/v1/admin/creative/tasks', headers: adminHeaders, payload: { mode: 'image-to-image', prompt: 'test' } });
  assert.equal(missingSource.statusCode, 400);
  assert.equal(missingSource.json().error, 'source_artifact_required');

  const unconfigured = await app.inject({ method: 'POST', url: '/api/v1/admin/creative/tasks', headers: adminHeaders, payload: { mode: 'text-to-image', prompt: 'test' } });
  assert.equal(unconfigured.statusCode, 409);
  assert.equal(unconfigured.json().error, 'generation_assignment_not_found');

  await app.close();
  database.close();
});
