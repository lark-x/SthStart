import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from '../database.js';
import { validateInputArtifacts } from './inputs.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-generation-input-access-'));
  const database = new ServiceDatabase(':memory:');
  const now = nowIso();
  for (const appId of ['activities', 'story-worlds']) {
    database.connection.prepare(`INSERT INTO managed_apps
      (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
      VALUES (?,?,?,'[]',1,?,?)`).run(appId, appId, `${appId}-token`, now, now);
  }
  database.connection.prepare(`INSERT INTO generation_engines
    (id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('cloud-input','Cloud Input','cloud','https://cloud.invalid/v1',1,1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows
    (id,name,description,engine_kind,category,latest_version,created_at,updated_at)
    VALUES ('cloud-input-wf','Cloud Input','','cloud','image',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,input_capabilities_json,definition_json,is_published,created_at)
    VALUES ('cloud-input-wf',1,'cloud-input',?,?,?,1,?)`).run(
    JSON.stringify({ prompt: { type: 'string', required: true } }),
    JSON.stringify({ referenceImage: { semantic: 'init_image', mediaTypes: ['image/*'], maxCount: 1 } }),
    JSON.stringify({ type: 'cloud_recipe', modelId: 'gpt-image-2', operation: 'image-to-image' }),
    now,
  );
  database.connection.prepare(`INSERT INTO app_generation_assignments
    (app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('story-worlds','story_world_image','cloud-input-wf',1,'cloud-input',?)`).run(now);
  const artifact = (id: string, appId: string, contentType: string, fileStatus = 'ready') => {
    const path = join(directory, `${id}.bin`);
    writeFileSync(path, png);
    database.connection.prepare(`INSERT INTO artifacts
      (id,app_id,local_path,content_type,byte_size,file_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, appId, path, contentType, png.length, fileStatus, now, now);
  };
  return {
    directory, database, artifact,
    cleanup: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('generation input access follows reference grants and rejects missing, unavailable or non-image media', () => {
  const f = fixture();
  try {
    f.artifact('owned-image', 'story-worlds', 'image/png');
    f.artifact('foreign-image', 'activities', 'image/png');
    f.artifact('foreign-audio', 'activities', 'audio/mpeg');
    f.artifact('foreign-pending', 'activities', 'image/png', 'pending');
    const capabilities = { referenceImage: { mediaTypes: ['image/*'], maxCount: 1 } };
    f.database.connection.prepare(`INSERT INTO artifact_grants
      (id,artifact_id,owner_app_id,grantee_app_id,access,expires_at,created_at)
      VALUES ('grant-reference','foreign-image','activities','story-worlds','reference',NULL,?)`).run(nowIso());
    assert.doesNotThrow(() => validateInputArtifacts(f.database, 'story-worlds', [
      { artifactId: 'owned-image', inputKey: 'referenceImage' },
    ], capabilities));
    assert.doesNotThrow(() => validateInputArtifacts(f.database, 'story-worlds', [
      { artifactId: 'foreign-image', inputKey: 'referenceImage' },
    ], capabilities));
    assert.throws(() => validateInputArtifacts(f.database, 'story-worlds', [
      { artifactId: 'foreign-audio', inputKey: 'referenceImage' },
    ], capabilities), (error: unknown) => (error as { code?: string }).code === 'input_artifact_access_denied');
    assert.throws(() => validateInputArtifacts(f.database, 'story-worlds', [
      { artifactId: 'missing-image', inputKey: 'referenceImage' },
    ], capabilities), (error: unknown) => (error as { code?: string }).code === 'input_artifact_not_found');
    assert.throws(() => validateInputArtifacts(f.database, 'story-worlds', [
      { artifactId: 'foreign-pending', inputKey: 'referenceImage' },
    ], capabilities), (error: unknown) => (error as { code?: string }).code === 'input_artifact_access_denied');
  } finally {
    f.cleanup();
  }
});
