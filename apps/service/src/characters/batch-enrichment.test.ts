import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import {
  repairCharacterAssetsMetadata,
  runBatchEnrichRpCards,
  runBatchImportLocalPersonaCards,
  runBatchOfficialAssets,
} from './batch-enrichment.js';
import { resolveCharacterOfficialAssetBundle } from './official-avatars.js';
import { loadLocalCuratedPersonaCard } from './upstream/local-persona-cards.js';
import { fetchStarRailResCharacter } from './upstream/starrailres-adapter.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

const PNG_BYTES_ALT = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000e49444154789c63f80f040c0c0001c600fe6d1f7f7d0000000049454e44ae426082',
  'hex',
);

const PNG_BYTES_COSTUME = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000308060000005628b5bf0000001049444154789c636060606060000000490001a16220580000000049454e44ae426082',
  'hex',
);

function jsonResp(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function pngResp(buf: Buffer) {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

test('repairCharacterAssetsMetadata fixes category=other/empty title and removes duplicate source urls', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const now = '2026-11-18T00:00:00.000Z';
    db.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色库','test-hash','[]',1,?,?)").run(now, now);
    db.connection.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, tags_json, created_at, updated_at, draft_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run('char-1', 'mavuika', '玛薇卡', JSON.stringify({ schemaVersion: 2, displayName: '玛薇卡', work: '原神', originType: 'ip' }), '[]', now, now);

    db.connection.prepare(`
      INSERT INTO artifacts (id, app_id, file_status, original_name, content_type, byte_size, created_at)
      VALUES ('art-1', 'characters', 'ready', 'a.png', 'image/png', 64, ?)
    `).run(now);

    // 两条同源重复头像且均为 category='other'、title=''
    db.connection.prepare(`
      INSERT INTO character_assets (id, character_id, kind, created_at, artifact_id, source_url, category, title)
      VALUES ('asset-1', 'char-1', 'avatar', ?, 'art-1', 'https://cdn.example/mavuika.png', 'other', '')
    `).run(now);
    db.connection.prepare(`
      INSERT INTO character_assets (id, character_id, kind, created_at, artifact_id, source_url, category, title)
      VALUES ('asset-2', 'char-1', 'avatar', ?, 'art-1', 'https://cdn.example/mavuika.png', 'other', '')
    `).run(now);
    db.connection.prepare('UPDATE character_profiles SET avatar_asset_id=? WHERE id=?').run('asset-2', 'char-1');

    const res = repairCharacterAssetsMetadata(db);
    assert.equal(res.fixedMetadata, 2);
    assert.equal(res.removedDuplicates, 1);

    const remaining = db.connection.prepare('SELECT id, category, title FROM character_assets WHERE character_id=?').all('char-1') as Array<{ id: string; category: string; title: string }>;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'asset-2');
    assert.equal(remaining[0].category, 'avatar');
    assert.equal(remaining[0].title, '玛薇卡 官方头像');
  } finally {
    db.close();
  }
});

test('fetchStarRailResCharacter resolves 开拓者 ({NICKNAME}) and path variants cleanly', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/characters.json')) {
      return jsonResp({
        '8001': { id: '8001', name: '{NICKNAME}', tag: 'playerboy', rarity: 5, path: 'Warrior', element: 'Physical', icon: 'icon/character/8001.png', portrait: 'image/character_portrait/8001.png' },
        '8002': { id: '8002', name: '{NICKNAME}', tag: 'playergirl', rarity: 5, path: 'Warrior', element: 'Physical', icon: 'icon/character/8002.png', portrait: 'image/character_portrait/8002.png' },
        '8004': { id: '8004', name: '{NICKNAME}', tag: 'playergirl2', rarity: 5, path: 'Knight', element: 'Fire', icon: 'icon/character/8004.png', portrait: 'image/character_portrait/8004.png' },
      });
    }
    if (url.endsWith('/nickname.json')) {
      return jsonResp({ characters: {} });
    }
    throw new Error(`unexpected: ${url}`);
  };

  const result = await fetchStarRailResCharacter('开拓者', fetcher);
  assert.ok(result);
  assert.equal(result.resolvedName, '开拓者');
  assert.ok(result.assets?.some((a) => a.category === 'avatar' && a.url.endsWith('8002.png')));
  assert.ok(result.assets?.some((a) => a.category === 'portrait' && a.url.endsWith('8002.png')));
  assert.ok(result.skinOrVariantCandidates?.some((v) => v.name.includes('存护')));
});

test('resolveCharacterOfficialAssetBundle picks single non-duplicated source per asset type for Genshin, HSR & Paimon', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === 'https://gi.yatta.moe/api/v2/chs/avatar') {
      return jsonResp({ data: { items: { '10000002': { id: 10000002, name: '神里绫华', route: 'Ayaka', icon: 'UI_AvatarIcon_Ayaka' } } } });
    }
    if (url === 'https://gi.yatta.moe/api/v2/chs/avatar/10000002') {
      return jsonResp({
        data: {
          id: 10000002,
          name: '神里绫华',
          icon: 'UI_AvatarIcon_Ayaka',
          other: {
            costume: [
              { name: '花时来信', description: '祭典礼服', isDefault: false, icon: 'UI_AvatarIcon_AyakaCostume' },
              { name: '默认常服', description: '日常甲胄', isDefault: true, icon: 'UI_AvatarIcon_Ayaka' },
            ],
          },
        },
      });
    }
    if (url === 'https://gi.yatta.moe/api/v2/chs/avatarFetter/10000002') {
      return jsonResp({ data: { story: {}, quotes: {} } });
    }
    throw new Error(`unexpected: ${url}`);
  };

  const paimon = await resolveCharacterOfficialAssetBundle('派蒙', undefined, '原神', undefined, fetcher);
  assert.ok(paimon?.avatar?.url);
  assert.ok(paimon?.portrait?.url);
  assert.equal(paimon?.costumes.length, 0);

  const ayaka = await resolveCharacterOfficialAssetBundle('神里绫华', 'Ayaka', '原神', { genshin: 'yatta' }, fetcher);
  assert.ok(ayaka?.avatar?.url.includes('UI_AvatarIcon_Ayaka.png'));
  assert.ok(ayaka?.portrait?.url.includes('UI_Gacha_AvatarImg_Ayaka.png'));
  assert.equal(ayaka?.costumes.length, 1);
  assert.equal(ayaka?.costumes[0].skinName, '花时来信');
  assert.ok(ayaka?.costumes[0].url.includes('UI_Costume_AyakaCostume.png'));
});

test('runBatchOfficialAssets downloads avatar+portrait+costume once and never duplicates on rerun', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sthstart-batch-assets-'));
  const db = new ServiceDatabase(':memory:');
  const config = readConfig({ STHSTART_ARTIFACT_DIR: dir });
  try {
    const now = '2026-11-18T00:00:00.000Z';
    db.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色库','test-hash','[]',1,?,?)").run(now, now);
    db.connection.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, tags_json, created_at, updated_at, draft_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      'char-ayaka',
      'ayaka',
      '神里绫华',
      JSON.stringify({ schemaVersion: 2, displayName: '神里绫华', englishName: 'Ayaka', work: '原神', originType: 'ip' }),
      '[]',
      now,
      now,
    );

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatar') {
        return jsonResp({ data: { items: { '10000002': { id: 10000002, name: '神里绫华', route: 'Ayaka', icon: 'UI_AvatarIcon_Ayaka' } } } });
      }
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatar/10000002') {
        return jsonResp({
          data: {
            id: 10000002,
            name: '神里绫华',
            icon: 'UI_AvatarIcon_Ayaka',
            other: {
              costume: [{ name: '花时来信', description: '礼服', isDefault: false, icon: 'UI_AvatarIcon_AyakaCostume' }],
            },
          },
        });
      }
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatarFetter/10000002') {
        return jsonResp({ data: { story: {}, quotes: {} } });
      }
      if (url.includes('UI_AvatarIcon_Ayaka.png')) return pngResp(PNG_BYTES);
      if (url.includes('UI_Gacha_AvatarImg_Ayaka.png')) return pngResp(PNG_BYTES_ALT);
      if (url.includes('UI_Costume_AyakaCostume.png')) return pngResp(PNG_BYTES_COSTUME);
      return new Response('', { status: 404 });
    };

    const first = await runBatchOfficialAssets(config, db, fetcher, {
      onlyMissing: true,
      assetTypes: ['avatar', 'portrait', 'costume'],
      preferredSources: { genshin: 'yatta' },
    });
    assert.equal(first.updated, 1);
    assert.equal(first.items[0].avatarAdded, true);
    assert.equal(first.items[0].portraitAdded, true);
    assert.equal(first.items[0].skinsAdded, 1);

    const second = await runBatchOfficialAssets(config, db, fetcher, {
      onlyMissing: false,
      assetTypes: ['avatar', 'portrait', 'costume'],
      preferredSources: { genshin: 'yatta' },
    });
    assert.equal(second.updated, 0);
    assert.equal(second.skipped, 1);
    assert.equal(second.failed, 0);
    assert.equal(second.items[0].avatarAdded, false);
    assert.equal(second.items[0].portraitAdded, false);
    assert.equal(second.items[0].skinsAdded, 0);

    const rows = db.connection.prepare('SELECT category, title FROM character_assets WHERE character_id=? ORDER BY category').all('char-ayaka') as Array<{ category: string; title: string }>;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.category).sort(), ['avatar', 'costume', 'portrait']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLocalCuratedPersonaCard & runBatchEnrichRpCards populate clean structured V2 fields', async () => {
  const card = loadLocalCuratedPersonaCard('玛薇卡', 'genshin');
  assert.ok(card);
  assert.ok(card.speechText.length > 20);
  assert.ok(card.behaviorRules.length > 20);
  assert.ok(card.dialogueExamples.length >= 2);
  assert.equal(/genshin:voice:|quest\/\d+/.test(card.personaText), false);

  const db = new ServiceDatabase(':memory:');
  try {
    const now = '2026-11-18T00:00:00.000Z';
    db.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色库','test-hash','[]',1,?,?)").run(now, now);
    db.connection.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, tags_json, created_at, updated_at, draft_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      'char-mavuika',
      'mavuika',
      '玛薇卡',
      JSON.stringify({ schemaVersion: 2, displayName: '玛薇卡', work: '原神', originType: 'ip', personaText: '纳塔火神。' }),
      '[]',
      now,
      now,
    );

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatar') {
        return jsonResp({ data: { items: { '10000106': { id: 10000106, name: '玛薇卡', route: 'Mavuika', icon: 'UI_AvatarIcon_Mavuika' } } } });
      }
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatar/10000106') {
        return jsonResp({
          data: {
            id: 10000106,
            name: '玛薇卡',
            element: 'Fire',
            region: 'NATLAN',
            birthday: [8, 28],
            fetter: { title: '焚夜以炎', native: '纳塔', detail: '纳塔的火神。', cv: { CHS: '李晔' } },
          },
        });
      }
      if (url === 'https://gi.yatta.moe/api/v2/chs/avatarFetter/10000106') {
        return jsonResp({ data: { story: {}, quotes: {} } });
      }
      throw new Error(`unexpected: ${url}`);
    };

    const res = await runBatchEnrichRpCards(db, fetcher, { scope: 'incomplete' });
    assert.equal(res.updated, 1);

    const updated = db.connection.prepare('SELECT draft_json, tags_json FROM character_profiles WHERE id=?').get('char-mavuika') as { draft_json: string; tags_json: string };
    const draft = JSON.parse(updated.draft_json);
    assert.ok(draft.summary.length > 10);
    assert.ok(draft.speechText.length > 20);
    assert.ok(draft.behaviorRules.length > 20);
    assert.ok(draft.dialogueExamples.length >= 2);
    assert.equal(draft.birthday.month, 8);
    assert.equal(draft.birthday.day, 28);
  } finally {
    db.close();
  }
});

test('loadLocalCuratedPersonaCard strips all internal IDs, schema debug notes, placeholders, and punctuation defects across all 850+ cards', () => {
  const walkNames = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walkNames(p));
      else if (e.name.endsWith('.md') && !e.name.startsWith('_') && e.name.toLowerCase() !== 'readme.md') {
        out.push(e.name.replace(/\.md$/i, '').trim());
      }
    }
    return [...new Set(out)];
  };

  const residual = /(?:achievement\s*[:：/]\s*\d+|\bnode\s*[\/：:\s]?\d+|\bnpc\/\d+|\bspeakerKey\b|\btalk\s*[\/：:\s]?\d+|\bsubquest\/\d+|_roster_|sp@|\bentity_not_found\b|【\s*(?:doc|[A-C]|·)\s*(?:[\s，,][^】]*)?\s*】|\b(?:weaponType|title|affiliation|structuredKind|dialogueNodeKey|documentId|stableId|null)\b|profile[.\s]*path\b|title\/affiliation|speaker\s*=|库内的|\{\{[^}]+\}\}|\{NICKNAME\}|\{F#|\{M#|sr_char_\d+|sr_ach_\d+|[0-9a-f]{8}-[0-9a-f]{4}|[，、；：。]{2,}|[（(]\s*[，、；：。]|[，、；：]\s*[)）]|`)/i;
  const checkBalance = (text: string): string | null => {
    for (const [o, c] of [['（', '）'], ['(', ')'], ['「', '」'], ['『', '』']] as const) {
      let d = 0;
      for (const ch of text) {
        if (ch === o) d += 1;
        else if (ch === c) {
          d -= 1;
          if (d < 0) return `${o}${c}`;
        }
      }
      if (d !== 0) return `${o}${c}`;
    }
    return null;
  };

  for (const [wt, dir] of [['genshin', '角色人设卡_skill'], ['starrail', '星铁人设卡_skill']] as const) {
    const names = walkNames(dir);
    assert.ok(names.length >= 380);
    for (const name of names) {
      const card = loadLocalCuratedPersonaCard(name, wt);
      assert.ok(card, `Failed to load ${dir}/${name}`);
      assert.equal(checkBalance(card.summary), null, `Unbalanced summary delimiters for ${name}: ${card.summary}`);
      for (const val of [card.summary, card.personaText, card.speechText, card.behaviorRules, ...card.dialogueExamples]) {
        assert.equal(residual.test(val), false, `Residual marker in ${card.filePath}: ${val.slice(0, 300)}`);
      }
    }
  }

  // 验证重名目录路由（火花应命中自机角色而非 NPC）及修正后的星铁命途
  const sparkle = loadLocalCuratedPersonaCard('火花', 'starrail');
  assert.ok(sparkle && /自机角色[\\/]火花\.md$/.test(sparkle.filePath));
  assert.match(loadLocalCuratedPersonaCard('星期日', 'starrail')?.summary || '', /同谐命途/);
  assert.match(loadLocalCuratedPersonaCard('停云', 'starrail')?.summary || '', /同谐命途/);
  assert.match(loadLocalCuratedPersonaCard('灵砂', 'starrail')?.summary || '', /丰饶命途/);
});

test('runBatchImportLocalPersonaCards imports playable/story/npc cleanly without duplicates on rerun', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const now = '2026-11-18T00:00:00.000Z';
    db.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色库','test-hash','[]',1,?,?)").run(now, now);

    const first = runBatchImportLocalPersonaCards(db, {
      includePlayable: false,
      includeStory: true,
      includeNpc: false,
    });
    assert.equal(first.failed, 0);
    assert.equal(first.created, first.totalFiles);
    assert.ok(first.created >= 40);

    const second = runBatchImportLocalPersonaCards(db, {
      includePlayable: false,
      includeStory: true,
      includeNpc: false,
    });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.skipped, first.totalFiles);
  } finally {
    db.close();
  }
});
