import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { hashToken, issueToken, SecretStore } from './security.js';

type NormalizedCharacter = {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  latest_version: number;
};

type LinsheCharacterIntegration = {
  normalizePublicCharacterList(payload: unknown): NormalizedCharacter[];
};

async function loadLinsheCharacterIntegration(): Promise<LinsheCharacterIntegration> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const modulePath = resolve(repositoryRoot, 'upstream/linshe/agent-core/src/integrations/sthstart/characters.js');
  return await import(pathToFileURL(modulePath).href) as LinsheCharacterIntegration;
}

const ADMIN_TOKEN = 'linshe-contract-admin-token-1234567890';

test('SthStart public character response is consumable by the Linshe adapter', async () => {
  const database = new ServiceDatabase();
  const appToken = issueToken('linshe-contract');
  const now = nowIso();
  database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)')
    .run('linshe-contract', 'Linshe contract test', hashToken(appToken), '["persona"]', now, now);
  database.connection.prepare('INSERT INTO storage_policies(app_id,mode) VALUES (?,?)')
    .run('linshe-contract', 'keep');

  const { normalizePublicCharacterList } = await loadLinsheCharacterIntegration();
  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN }),
    database,
    secrets: new SecretStore({}),
  });

  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/characters',
      headers: { 'x-sthstart-admin-token': ADMIN_TOKEN },
      payload: {
        displayName: '契约角色',
        draft: {
          displayName: '契约角色',
          englishName: 'Contract Character',
          summary: '用于验证跨应用公共角色契约。',
          identity: '契约测试角色',
          appearance: { description: '清晰的契约测试角色头像。' },
        },
      },
    });
    assert.equal(created.statusCode, 201, created.body);

    const characterId = created.json().id as string;
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/characters/${characterId}/publish`,
      headers: { 'x-sthstart-admin-token': ADMIN_TOKEN },
    });
    assert.equal(published.statusCode, 201, published.body);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: { authorization: `Bearer ${appToken}` },
    });
    assert.equal(response.statusCode, 200);

    const payload = response.json() as {
      items?: Array<Record<string, unknown>>;
      characters?: unknown;
    };
    assert.ok(Array.isArray(payload.items), 'SthStart must publish the current items container');
    assert.equal(payload.characters, undefined, 'the producer contract must not silently drift back to characters');
    assert.equal(payload.items.length, 1);

    const item = payload.items[0];
    assert.equal(item.id, characterId);
    assert.equal(item.displayName, '契约角色');
    assert.equal(item.avatarUrl, null);
    assert.equal(item.latestVersion, 1);

    assert.deepEqual(normalizePublicCharacterList(payload), [{
      id: characterId,
      slug: 'contract-character',
      display_name: '契约角色',
      avatar_url: null,
      latest_version: 1,
    }]);

    assert.deepEqual(normalizePublicCharacterList({
      characters: [{ id: 'legacy-1', slug: 'legacy', display_name: '旧结构', avatar_url: null, latest_version: '2' }],
    }), [{
      id: 'legacy-1',
      slug: 'legacy',
      display_name: '旧结构',
      avatar_url: null,
      latest_version: 2,
    }]);
  } finally {
    await app.close();
    database.close();
  }
});
