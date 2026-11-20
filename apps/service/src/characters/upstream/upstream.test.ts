import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CharacterDraftV2Schema,
  CharacterUpstreamResearchPreviewSchema,
} from '@sthstart/contracts';
import { ServiceDatabase } from '../../database.js';
import { SecretStore } from '../../security.js';
import { fetchBwikiCharacter } from './bwiki-adapter.js';
import { runUpstreamCharacterResearch } from './orchestrator.js';
import { fetchStarRailResCharacter } from './starrailres-adapter.js';
import { fetchYattaGenshinCharacter } from './yatta-adapter.js';

const YATTA_API_BASE = 'https://gi.yatta.moe/api/v2/chs';
const YATTA_CHARACTER_ID = 10000002;
const YATTA_INDEX_URL = `${YATTA_API_BASE}/avatar`;
const YATTA_DETAIL_URL = `${YATTA_API_BASE}/avatar/${YATTA_CHARACTER_ID}`;
const YATTA_FETTER_URL = `${YATTA_API_BASE}/avatarFetter/${YATTA_CHARACTER_ID}`;

const STARRAIL_RES_BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master';
const STARRAIL_CHARACTERS_URL = `${STARRAIL_RES_BASE}/index_min/cn/characters.json`;
const STARRAIL_NICKNAMES_URL = `${STARRAIL_RES_BASE}/index_min/cn/nickname.json`;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function yattaIndexPayload() {
  return {
    data: {
      items: {
        [YATTA_CHARACTER_ID]: {
          id: YATTA_CHARACTER_ID,
          name: '神里绫华',
          route: 'kamisato-ayaka',
          icon: 'UI_AvatarIcon_Ayaka',
        },
      },
    },
  };
}

function yattaDetailPayload() {
  return {
    data: {
      id: YATTA_CHARACTER_ID,
      name: '神里绫华',
      route: 'kamisato-ayaka',
      element: 'Ice',
      region: 'INAZUMA',
      icon: 'UI_AvatarIcon_Ayaka',
      birthday: [9, 28],
      fetter: {
        title: '白鹭霜华',
        detail: '<color=#FFFFFFFF>神里家的长女</color>，以优雅与责任感守护稻妻。',
        native: '稻妻',
        cv: { CHS: '早见沙织' },
      },
      other: {
        costume: [
          {
            name: '花时来信',
            description: '<color=#FFB7C5FF>黑红礼服</color>缀有银白羽饰，呈现祭典观礼时的庄重姿态。',
            isDefault: false,
            icon: 'UI_AvatarIcon_AyakaCostume',
          },
          {
            name: '神里绫华默认装束',
            description: '白蓝相间的神里家传统衣装。',
            isDefault: true,
            icon: 'UI_AvatarIcon_AyakaDefault',
          },
        ],
      },
    },
  };
}

function yattaFetterPayload() {
  return {
    data: {
      story: {
        '1': {
          title: '神里家的长女',
          text: '神里绫华自幼学习礼仪与剑术，在家族责任和个人愿望之间不断寻找平衡。',
        },
      },
      quotes: {
        '1': { title: '初次见面', text: '我是神里绫华，请多指教。' },
        '2': { title: '关于旅行者', text: '与旅行者同行时，我总能看到更广阔的世界。' },
      },
    },
  };
}

function createYattaFetcher() {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === YATTA_INDEX_URL) return jsonResponse(yattaIndexPayload());
    if (url === YATTA_DETAIL_URL) return jsonResponse(yattaDetailPayload());
    if (url === YATTA_FETTER_URL) return jsonResponse(yattaFetterPayload());
    throw new Error(`unexpected upstream request: ${url}`);
  };
  return { fetcher, requests };
}

test('fetchYattaGenshinCharacter maps stories, quotes, portraits, and costume skins', async () => {
  const { fetcher, requests } = createYattaFetcher();
  const result = await fetchYattaGenshinCharacter('神里绫华', fetcher);

  assert.ok(result);
  assert.equal(result.resolvedName, '神里绫华');
  assert.equal(result.resolvedWork, '原神');
  assert.equal(result.stories?.[0]?.title, '神里家的长女');
  assert.match(result.stories?.[0]?.content ?? '', /神里绫华自幼学习礼仪与剑术/);
  assert.ok(result.voiceLines?.some((line) => line.title === '初次见面' && line.text.includes('请多指教')));

  const avatar = result.assets?.find((asset) => asset.kind === 'avatar' && asset.category === 'avatar');
  const portrait = result.assets?.find((asset) => asset.kind === 'portrait' && asset.category === 'portrait');
  assert.equal(avatar?.url, 'https://gi.yatta.moe/assets/UI/UI_AvatarIcon_Ayaka.png');
  assert.equal(portrait?.url, 'https://gi.yatta.moe/assets/UI/UI_Gacha_AvatarImg_Ayaka.png');

  const costume = result.skinOrVariantCandidates?.find((skin) => skin.name === '花时来信');
  assert.ok(costume);
  assert.equal(costume.classification, 'skin');
  assert.equal(costume.isDefault, false);
  assert.match(costume.outfitDescription, /黑红礼服/);
  assert.match(costume.loreStory, /银白羽饰/);
  assert.equal(
    costume.avatarUrl,
    'https://gi.yatta.moe/assets/UI/UI_AvatarIcon_AyakaCostume.png',
  );
  assert.equal(
    costume.portraitUrl,
    'https://gi.yatta.moe/assets/UI/UI_Costume_AyakaCostume.png',
  );

  assert.ok(requests.includes(YATTA_DETAIL_URL));
  assert.ok(requests.includes(YATTA_FETTER_URL));
  assert.ok(requests.every((url) => url.startsWith(`${YATTA_API_BASE}/`)));
});

test('fetchStarRailResCharacter resolves 丹恒•饮月 as an SP variant', async () => {
  const requests: string[] = [];
  const characters = {
    '1002': {
      id: '1002',
      name: '丹恒',
      tag: '1001',
      rarity: 4,
      path: 'Rogue',
      element: 'Wind',
      icon: 'avatar/1001.png',
      preview: 'preview/1001.png',
      portrait: 'portrait/1001.png',
    },
    '1213': {
      id: '1213',
      name: '丹恒•饮月',
      tag: '1213',
      rarity: 5,
      path: 'Mage',
      element: 'Imaginary',
      icon: 'avatar/1213.png',
      preview: 'preview/1213.png',
      portrait: 'portrait/1213.png',
    },
  };
  const nicknames = {
    characters: {
      '1002': ['冷面小青龙'],
      '1213': ['饮月君'],
    },
  };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === STARRAIL_CHARACTERS_URL) return jsonResponse(characters);
    if (url === STARRAIL_NICKNAMES_URL) return jsonResponse(nicknames);
    throw new Error(`unexpected upstream request: ${url}`);
  };

  const result = await fetchStarRailResCharacter('丹恒', fetcher);

  assert.ok(result);
  assert.equal(result.resolvedName, '丹恒');
  assert.equal(result.resolvedWork, '崩坏：星穹铁道');
  assert.ok(result.aliases?.includes('冷面小青龙'));
  assert.ok(result.facts?.includes('命途：巡猎'));
  assert.ok(result.facts?.includes('属性：风'));
  assert.ok(result.assets?.some((asset) => asset.url === `${STARRAIL_RES_BASE}/avatar/1001.png`));
  assert.ok(result.assets?.some((asset) => asset.url === `${STARRAIL_RES_BASE}/portrait/1001.png`));

  const spVariant = result.skinOrVariantCandidates?.find((variant) => variant.name === '丹恒•饮月');
  assert.ok(spVariant);
  assert.equal(spVariant.classification, 'variant');
  assert.equal(spVariant.variantKind, 'sp');
  assert.equal(spVariant.avatarUrl, `${STARRAIL_RES_BASE}/avatar/1213.png`);
  assert.equal(spVariant.portraitUrl, `${STARRAIL_RES_BASE}/portrait/1213.png`);
  assert.equal(spVariant.outfitDescription, '');
  assert.equal(spVariant.loreStory, '');
  assert.ok(result.warnings?.some((w) => w.includes('不含衣装描述或背景故事')));

  assert.equal(requests.length, 2);
  assert.deepEqual(new Set(requests), new Set([STARRAIL_CHARACTERS_URL, STARRAIL_NICKNAMES_URL]));
});

test('fetchBwikiCharacter parses sections and filters skill and undersized images', async () => {
  const requests: string[] = [];
  const wikitext = [
    '== 角色故事 ==',
    '阿蕾奇诺是壁炉之家的父亲，以严苛而冷静的方式守护孩子们。',
    '== 语音 ==',
    '初次见面：欢迎来到壁炉之家，请证明你的价值。',
    '关于我们：我不需要无用的承诺。',
    '== 装扮 ==',
    '「致终幕的欢宴」是一套以黑红与银白为主色的礼服，象征她掌控终幕的姿态。',
    '== 技能 ==',
    '这是一段足够长的技能说明，但它不应被当成角色故事或装扮内容。',
  ].join('\n');
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('action=query') && url.includes('list=search')) {
      return jsonResponse({
        query: {
          search: [
            { title: '阿蕾奇诺/攻略' },
            { title: '阿蕾奇诺' },
          ],
        },
      });
    }
    if (url.includes('action=parse')) {
      return jsonResponse({
        parse: {
          title: '阿蕾奇诺',
          wikitext: { '*': wikitext },
          images: [
            '阿蕾奇诺头像.png',
            '阿蕾奇诺抽卡立绘.png',
            '阿蕾奇诺技能图标.png',
            '阿蕾奇诺小尺寸头像.png',
          ],
        },
      });
    }
    if (url.includes('prop=imageinfo')) {
      return jsonResponse({
        query: {
          pages: {
            '1': {
              title: 'File:阿蕾奇诺头像.png',
              imageinfo: [{ url: 'https://example.test/bwiki/aventurine-avatar.png', width: 512, height: 512 }],
            },
            '2': {
              title: 'File:阿蕾奇诺抽卡立绘.png',
              imageinfo: [{ url: 'https://example.test/bwiki/aventurine-portrait.png', width: 1024, height: 2048 }],
            },
            '3': {
              title: 'File:阿蕾奇诺小尺寸头像.png',
              imageinfo: [{ url: 'https://example.test/bwiki/aventurine-small.png', width: 64, height: 64 }],
            },
          },
        },
      });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  };

  const result = await fetchBwikiCharacter('阿蕾奇诺', 'genshin', fetcher);

  assert.ok(result);
  assert.equal(result.resolvedName, '阿蕾奇诺');
  assert.ok(result.stories?.some((story) => story.title === '角色故事' && story.content.includes('壁炉之家')));
  assert.ok(result.voiceLines?.some((line) => line.text.includes('请证明你的价值')));
  assert.ok(result.skinOrVariantCandidates?.some((skin) => skin.name === '致终幕的欢宴' && skin.classification === 'skin'));

  const assetUrls = (result.assets ?? []).map((asset) => asset.url);
  assert.ok(assetUrls.includes('https://example.test/bwiki/aventurine-avatar.png'));
  assert.ok(assetUrls.includes('https://example.test/bwiki/aventurine-portrait.png'));
  assert.equal(assetUrls.includes('https://example.test/bwiki/aventurine-small.png'), false);
  assert.equal(assetUrls.some((url) => url.includes('skill')), false);

  const imageInfoUrl = requests.find((url) => url.includes('prop=imageinfo'));
  assert.ok(imageInfoUrl);
  const requestedTitles = new URL(imageInfoUrl).searchParams.get('titles') ?? '';
  assert.ok(requestedTitles.includes('阿蕾奇诺头像.png'));
  assert.equal(requestedTitles.includes('阿蕾奇诺技能图标.png'), false);
});

test('fetchBwikiCharacter returns warnings without throwing on an EdgeOne 567 WAF page', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(
      '<!doctype html><html><head><title>EdgeOne</title></head><body>访问受限</body></html>',
      { status: 567, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  };

  const result = await fetchBwikiCharacter('丹恒', 'starrail', fetcher);

  assert.ok(result);
  assert.equal(calls, 1);
  assert.equal(result.resolvedName, undefined);
  assert.ok(result.warnings?.some((warning) => warning.includes('EdgeOne WAF')));
});

test('runUpstreamCharacterResearch creates deterministic V2 fallback without an LLM', async () => {
  const database = new ServiceDatabase(':memory:');
  const { fetcher, requests } = createYattaFetcher();

  try {
    const preview = await runUpstreamCharacterResearch(
      database,
      new SecretStore({}),
      undefined,
      fetcher,
      {
        query: '神里绫华',
        work: '原神',
        preferSources: ['yatta'],
        includeSkins: true,
        includeVariants: true,
      },
    );

    assert.equal(preview.draft.schemaVersion, 2);
    assert.equal(Value.Check(CharacterDraftV2Schema, preview.draft), true);
    assert.equal(Value.Check(CharacterUpstreamResearchPreviewSchema, preview), true);
    assert.equal(preview.resolvedName, '神里绫华');
    assert.equal(preview.resolvedWork, '原神');
    assert.ok(preview.skinsAndVariants.length > 0);
    assert.ok(preview.skinsAndVariants.every((item) => item.selected));
    assert.ok(preview.assets.some((asset) => asset.kind === 'avatar'));
    assert.ok(preview.assets.some((asset) => asset.kind === 'portrait'));
    assert.ok(preview.warnings.some((warning) => warning.includes('未配置角色文本模型')));
    assert.ok(requests.includes(YATTA_DETAIL_URL));
    assert.ok(requests.includes(YATTA_FETTER_URL));
    assert.ok(requests.every((url) => url.startsWith(`${YATTA_API_BASE}/`)));
  } finally {
    database.close();
  }
});
