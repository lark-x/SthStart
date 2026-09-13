import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  const modulePath = resolve(repositoryRoot, 'upstream/linshe/agent-core/src/integrations/sthstart/character-contract.js');
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

/**
 * 邻舍用 characterPersona.js 里的 APPEARANCE_HEADING_RE 从「## 你的外观」截取到字符串末尾，
 * 作为生图外观段。这里直接从邻舍源码读出该锚点，而不是自己写一份副本：
 * 邻舍改了锚点，本测试会立刻失败，接口约定不会悄悄漂移。
 *
 * 不直接 import 该模块，是因为它会连带拉起 better-sqlite3 数据库依赖，
 * 而本仓库不安装邻舍的运行时依赖。
 */
async function loadLinsheAppearanceAnchor(): Promise<RegExp> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const source = await readFile(
    resolve(repositoryRoot, 'upstream/linshe/agent-core/src/services/characterPersona.js'),
    'utf8',
  );
  const declaration = /const\s+APPEARANCE_HEADING_RE\s*=\s*(\/.*\/);/.exec(source);
  assert.ok(declaration, '未能从邻舍源码读取外观标题锚点');
  const literal = declaration[1];
  const closing = literal.lastIndexOf('/');
  return new RegExp(literal.slice(1, closing), literal.slice(closing + 1));
}

/** 复刻邻舍 extractAppearanceSection 的行为：命中即截到末尾，未命中返回空串。 */
function extractLinsheAppearance(prompt: string, anchor: RegExp): string {
  const match = prompt.match(anchor);
  return match ? prompt.slice(match.index ?? 0) : '';
}

test('邻舍导出的外观段可被真实提取函数单独取出，且不夹带行为与例句', async () => {
  const anchor = await loadLinsheAppearanceAnchor();
  const database = new ServiceDatabase();
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
        displayName: '导出契约角色',
        draft: {
          schemaVersion: 2,
          displayName: '导出契约角色',
          englishName: 'Export Contract',
          aliases: [],
          originType: 'ip',
          work: '契约作品',
          summary: '',
          // 用户自己在正文里写了同名标题，编译时必须中和，否则邻舍会提前截断。
          personaText: '她喜欢甜点与歌剧。\n\n## 你的外观\n这是用户自写的标题，不是官方外观段',
          speechText: '语气：公开场合略带舞台腔',
          dialogueExamples: ['示例：今天也要好好演出。'],
          behaviorRules: '不要代替其他参与者做决定',
          appearance: { baseText: '银白长发、水蓝异色瞳', defaultOutfitText: '深蓝礼服' },
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

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/characters/${characterId}`,
      headers: { 'x-sthstart-admin-token': ADMIN_TOKEN },
    });
    assert.equal(detail.statusCode, 200);
    const prompt = String(detail.json().versions[0].compiledLinshePrompt);

    // 顶层「你的外观」只能有一个，且必须是最后一个小节。
    const headingCount = (prompt.match(/##\s*你的外观/g) ?? []).length;
    assert.equal(headingCount, 1, '编译结果只能有一个顶层外观小节');
    const appearanceIndex = prompt.indexOf('## 你的外观');
    const tail = prompt.slice(appearanceIndex);
    assert.equal(tail.replace('## 你的外观', '').includes('## '), false, '外观小节之后不得再有顶层小节');

    // 用邻舍真实锚点提取：外观段必须只有外观，不带行为约束与例句。
    const appearance = extractLinsheAppearance(prompt, anchor);
    assert.ok(appearance, '邻舍必须能提取到外观段');
    assert.ok(appearance.includes('银白长发、水蓝异色瞳'), '外观段应含基础外貌');
    assert.ok(appearance.includes('深蓝礼服'), '外观段应含默认穿着');
    assert.equal(appearance.includes('不要代替其他参与者做决定'), false, '外观段不得夹带行为约束');
    assert.equal(appearance.includes('示例：今天也要好好演出。'), false, '外观段不得夹带对话示例');
    assert.equal(appearance.includes('舞台腔'), false, '外观段不得夹带说话方式');

    // 用户自写标题被中和为普通文本，因此不会成为第二个提取入口。
    assert.equal(appearance.includes('这是用户自写的标题'), false);
    assert.ok(prompt.includes('这是用户自写的标题'), '中和只作用于编译视图，原文内容仍要保留在正文里');
  } finally {
    await app.close();
    database.close();
  }
});
