import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeCharacterDraftV2, toCharacterRuntime } from '@sthstart/contracts';
import { fetchBwikiCharacter, parseBwikiCharacterPage } from './bwiki-adapter.js';
import { fetchStarRailResCharacter } from './starrailres-adapter.js';
import { fetchAkashaDialogueSlices } from './akasha-bridge.js';
import { applyGroundedSynthesisResponse, buildDeterministicDraft, buildSynthesisEvidenceChunks, synthesizeRpCharacter } from './rp-synthesizer.js';
import { createEmptyBundle, hasSubstantiveEvidence, parseWikiTemplates, stripWikiMarkup } from './types.js';
import { runUpstreamCharacterResearch } from './orchestrator.js';
import { ServiceDatabase } from '../../database.js';
import { SecretStore } from '../../security.js';
import type { ServiceConfig } from '../../config.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/public-character-responses.json', import.meta.url), 'utf8')) as {
  captures: Array<{ url: string; status: number; body: any }>;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function publicPage(title: string) {
  const row = fixture.captures.find((c) => c.body.parse?.title === title);
  assert.ok(row, `missing real public fixture ${title}`); return row.body;
}
function replayPublicFetcher(requests: string[]): typeof fetch {
  return async (input) => {
    const url = String(input); requests.push(url); const u = new URL(url);
    if (u.searchParams.get('action') === 'parse') return json(publicPage(u.searchParams.get('page') || ''));
    const row = fixture.captures.find((c) => {
      const saved = new URL(c.url);
      return saved.hostname === u.hostname && saved.pathname === u.pathname
        && (u.searchParams.get('list') !== 'search' || saved.searchParams.get('srsearch') === u.searchParams.get('srsearch'));
    });
    if (u.searchParams.get('prop') === 'imageinfo') return json({ query: { pages: {} } });
    assert.ok(row, `unexpected fixture request ${url}`); return json(row.body);
  };
}

test('actual BWiki 琴 templates preserve all eight stories and ignore commented skin placeholders', () => {
  const raw = publicPage('琴').parse;
  const result = parseBwikiCharacterPage(raw, 'genshin', '琴');
  assert.equal(result.stories?.length, 8);
  assert.ok(result.stories?.find((s) => s.title === '角色故事5')?.content.endsWith('琴低下头，在洒满星辉的窗台边偷偷想着。'));
  assert.ok(result.facts?.some((s) => s.includes('正直严谨的蒲公英骑士')));
  assert.equal(result.skinOrVariantCandidates?.length, 0);
  assert.equal(result.sources?.[0]?.rawText, raw.wikitext['*']);
  assert.equal(result.sources?.[0]?.contentHash, createHash('sha256').update(raw.wikitext['*']).digest('hex'));
  assert.ok(result.sources?.[0]?.rawText?.includes('这里是皮肤的背景故事'));
  assert.equal(result.stories?.some((s) => s.content.includes('这里是皮肤')), false);
});

test('actual standalone 琴 voice and skin pages retain native text and ownership', () => {
  const voices = parseBwikiCharacterPage(publicPage('琴语音').parse, 'genshin', '琴');
  assert.equal(voices.voiceLines?.length, 77);
  assert.match(voices.voiceLines?.[0]?.text || '', /我的荣誉与忠诚将与你同在/);
  const skin = parseBwikiCharacterPage(publicPage('海风之梦').parse, 'genshin', '琴').skinOrVariantCandidates?.[0];
  assert.equal(skin?.name, '海风之梦'); assert.equal(skin?.classification, 'skin');
  assert.ok(skin?.loreStory.endsWith('「我还是头一次…度过如此安逸的夏日假期。」'));
  assert.equal(parseBwikiCharacterPage(publicPage('海风之梦').parse, 'genshin', '芭芭拉').skinOrVariantCandidates?.length, 0);
});

test('production BWiki adapter replays complete public main/voice/skin bodies, preserves text on image failure', async () => {
  const requests: string[] = [];
  const replay = replayPublicFetcher(requests);
  const fetcher: typeof fetch = async (input, init) => String(input).includes('prop=imageinfo') ? json({}, 404) : replay(input, init);
  const result = await fetchBwikiCharacter('琴', 'genshin', fetcher);
  assert.equal(result?.stories?.length, 8); assert.equal(result?.voiceLines?.length, 77);
  assert.equal(result?.skinOrVariantCandidates?.length, 2);
  assert.ok(result?.skinOrVariantCandidates?.every((s) => s.loreStory.length > 200));
  assert.ok(result?.sources?.every((s) => s.rawText && s.rawPayload && s.contentHash));
  assert.ok(result?.warnings?.some((w) => w.includes('文字证据仍保留')));
});

test('ordinary BWiki skin is associated only to its retrieved imageinfo paths', async () => {
  const requests: string[] = []; const replay = replayPublicFetcher(requests);
  const result = await fetchBwikiCharacter('琴', 'genshin', async (input, init) => {
    if (String(input).includes('prop=imageinfo')) return json({ query: { pages: { a: { title: 'File:琴-海风之梦-立绘.png', imageinfo: [{ url: 'https://public.test/jean-skin.png', width: 1000, height: 2000 }] } } } });
    return replay(input, init);
  });
  assert.equal(result?.skinOrVariantCandidates?.find((s) => s.name === '海风之梦')?.portraitUrl, 'https://public.test/jean-skin.png');
  assert.ok(result?.assets?.some((a) => a.skinName === '海风之梦' && a.category === 'costume'));
});

test('production adapter consumes actual captured public imageinfo and connects both ordinary skin portraits', async () => {
  const base = replayPublicFetcher([]);
  const imageResponse = fixture.captures.find((c) => new URL(c.url).pathname.includes('/ys/') && new URL(c.url).searchParams.get('prop') === 'imageinfo');
  assert.ok(imageResponse, 'live imageinfo sample must be retained');
  const result = await fetchBwikiCharacter('琴', 'genshin', async (input, init) => String(input).includes('prop=imageinfo') ? json(imageResponse.body) : base(input, init));
  assert.ok(result?.skinOrVariantCandidates?.every((skin) => skin.portraitUrl?.startsWith('https://patchwiki.biligame.com/')));
});

test('actual 崩三 armor body proves owner and leaves absent outfit/story blank', async () => {
  const result = parseBwikiCharacterPage(publicPage('始源之律者').parse, 'bh3', '雷电芽衣');
  assert.equal(result.skinOrVariantCandidates?.[0]?.name, '始源之律者');
  assert.equal(result.skinOrVariantCandidates?.[0]?.outfitDescription, '');
  assert.equal(result.skinOrVariantCandidates?.[0]?.loreStory, '');
  assert.equal(parseBwikiCharacterPage(publicPage('始源之律者').parse, 'bh3', '琪亚娜').skinOrVariantCandidates?.length, 0);
});

test('production 崩三 adapter reads real armor pages instead of creating variants from search titles', async () => {
  const requests: string[] = [];
  const result = await fetchBwikiCharacter('雷电芽衣', 'bh3', replayPublicFetcher(requests));
  assert.ok(result?.skinOrVariantCandidates?.some((s) => s.name === '雷之律者'));
  assert.ok(result?.skinOrVariantCandidates?.some((s) => s.name === '始源之律者'));
  assert.ok(result?.skinOrVariantCandidates?.every((s) => !/图鉴|PV/.test(s.name)));
  for (const candidate of result?.skinOrVariantCandidates || []) {
    const page = result?.sources?.find((s) => s.url === candidate.source);
    assert.ok(page?.rawText?.includes('|角色名=雷电芽衣'));
  }
  assert.ok(requests.some((s) => new URL(s).searchParams.get('page') === '始源之律者'));
});

test('actual StarRailRes stable IDs include same-name hunt March and never invent outfits', async () => {
  const requests: string[] = []; const result = await fetchStarRailResCharacter('三月七', replayPublicFetcher(requests));
  const hunt = result?.skinOrVariantCandidates?.find((s) => s.id === 'starrailres:1224');
  assert.equal(hunt?.name, '三月七·巡猎'); assert.equal(hunt?.outfitDescription, ''); assert.equal(hunt?.loreStory, '');
  assert.ok(result?.skinOrVariantCandidates?.some((s) => s.id === 'starrailres:1413'));
  const byPath = await fetchStarRailResCharacter('三月七·巡猎', replayPublicFetcher([]));
  assert.ok(byPath?.facts?.includes('命途：巡猎'));
  assert.equal(byPath?.sources?.[0]?.externalId, '1224');
});

test('Akasha search is followed by all body pages, speaker filtering, and explicit read failure', async () => {
  const calls: any[] = [];
  const config = { akashaMcpUrl: 'https://mcp.test', mcpTimeoutMs: 1000 } as ServiceConfig;
  const fetcher: typeof fetch = async (_input, init) => {
    const call = JSON.parse(String(init?.body)); calls.push(call.params);
    if (call.params.name === 'akasha_search') return json({ result: { structuredContent: { results: [
      { fileName: '任务正文', pathHash: 'stable-id', totalLines: 3, hits: [{ line: 2, snippet: '只是一条摘要' }] },
      { fileName: '失败来源', pathHash: 'failed-id', hits: [{ line: 1, snippet: '不要冒充正文' }] },
    ] } } });
    const args = call.params.arguments;
    if (args.pathHash === 'failed-id') return json({}, 503);
    return json({ result: { structuredContent: { fileName: '任务正文', pathHash: 'stable-id', totalLines: 3,
      lineRange: args.offset === 1 ? '1-2' : '3-3', remainingCharacters: args.offset === 1 ? 10 : 0,
      content: args.offset === 1 ? '旁人：这句不能当成琴的台词。\n琴：我的荣誉与忠诚将与你同在！' : '旁白：任务最后一行上下文。' } } });
  };
  const result = await fetchAkashaDialogueSlices('琴', 'genshin', config, fetcher);
  assert.equal(calls.filter((c) => c.name === 'akasha_read').length, 3);
  assert.ok(result?.stories?.[0]?.content.endsWith('任务最后一行上下文。'));
  assert.deepEqual(result?.dialogueSamples, ['琴：我的荣誉与忠诚将与你同在！']);
  assert.equal(result?.sources?.find((s) => s.externalId?.endsWith('failed-id'))?.evidenceKind, 'snippet');
  assert.ok(result?.warnings?.some((w) => w.includes('读取失败')));
});

test('lossless RP evidence chunks and deterministic draft preserve every story ending without generic appearance', () => {
  const bundle = createEmptyBundle('琴', '原神');
  bundle.stories = Array.from({ length: 8 }, (_, i) => ({ title: `篇${i}`, content: `${'原文😀'.repeat(1500)}结尾${i}`, source: `url:${i}` }));
  const chunks = buildSynthesisEvidenceChunks(bundle, 200);
  for (let i = 0; i < 8; i += 1) assert.equal(chunks.flatMap((c) => c.segments).filter((s) => s.sourceId === `story:${i}:url:${i}`).map((s) => s.text).join(''), `【篇${i}】\n${bundle.stories[i].content}`);
  const draft = buildDeterministicDraft(bundle); assert.ok(draft.personaText.includes('结尾7')); assert.equal(draft.appearance.baseText, '');
  assert.equal(hasSubstantiveEvidence({ stories: [{ title: '简介', content: '这里是皮肤的背景故事', source: '' }], voiceLines: [], dialogueSamples: [] }), false);
});

test('upstream synthesis survives save normalization and runtime round trips with >60k text and all 77 actual voice lines', async () => {
  const bundle = createEmptyBundle('琴', '原神');
  const actualStories = parseBwikiCharacterPage(publicPage('琴').parse, 'genshin', '琴').stories || [];
  bundle.stories = actualStories.map((story, i) => ({ ...story, content: `${story.content.repeat(35)}原文保留结尾${i}` }));
  bundle.voiceLines = parseBwikiCharacterPage(publicPage('琴语音').parse, 'genshin', '琴').voiceLines || [];
  bundle.dialogueSamples = ['琴：额外剧情对白也必须在保存之后保留。'];
  const db = new ServiceDatabase(':memory:');
  try {
    const result = await synthesizeRpCharacter(db, new SecretStore({}), async () => { throw new Error('no live model request allowed'); }, bundle);
    assert.ok(result.draft.personaText.length > 60_000); assert.equal(result.draft.dialogueExamples.length, 78);
    const withLongSections = { ...result.draft, speechText: '完整语流依据。'.repeat(1800), behaviorRules: '完整行为边界依据。'.repeat(1800) };
    const normalized = normalizeCharacterDraftV2(withLongSections);
    // Mirrors storing data_json and normalizing it on read, without using any real database.
    const reloaded = normalizeCharacterDraftV2(JSON.parse(JSON.stringify(normalized)));
    const runtime = toCharacterRuntime(reloaded);
    for (const stage of [normalized, reloaded, runtime]) {
      assert.equal(stage.personaText, withLongSections.personaText);
      assert.equal(stage.speechText, withLongSections.speechText); assert.equal(stage.behaviorRules, withLongSections.behaviorRules);
      assert.deepEqual(stage.dialogueExamples, result.draft.dialogueExamples);
      assert.ok(stage.personaText.endsWith('原文保留结尾7'));
    }
  } finally { db.close(); }
});

test('controlled model request count scales with packed character length rather than 77 individual voices', async () => {
  const db = new ServiceDatabase(':memory:'); const now = new Date().toISOString();
  try {
    db.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色','test','[]',1,?,?)").run(now, now);
    db.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('packed','packed','llm','https://controlled.invalid/v1','test-model',1,?,?)").run(now, now);
    db.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('characters','text','packed',?)").run(now);
    const bundle = createEmptyBundle('琴', '原神');
    bundle.voiceLines = parseBwikiCharacterPage(publicPage('琴语音').parse, 'genshin', '琴').voiceLines || [];
    const voiceCharacters = bundle.voiceLines.map((v) => `【${v.title}】\n${v.text}`).join('\n\n').length;
    assert.equal(bundle.voiceLines.length, 77);
    const packed = buildSynthesisEvidenceChunks(bundle);
    assert.equal(packed.length, Math.ceil(voiceCharacters / 18_000)); assert.ok(packed.length < 5);
    assert.ok(packed.every((c) => c.text.length <= 18_000));
    assert.equal(packed.flatMap((c) => c.segments).length, 77);
    let calls = 0;
    const fetcher: typeof fetch = async (input) => {
      assert.equal(String(input), 'https://controlled.invalid/v1/chat/completions'); calls += 1;
      return json({ choices: [{ message: { content: '{}' } }] });
    };
    const result = await synthesizeRpCharacter(db, new SecretStore({}), fetcher, bundle);
    assert.equal(calls, packed.length); assert.equal(result.draft.dialogueExamples.length, 77);
    bundle.voiceLines = bundle.voiceLines.map((v) => ({ ...v, text: v.text.repeat(20) }));
    const largerPacked = buildSynthesisEvidenceChunks(bundle);
    calls = 0; await synthesizeRpCharacter(db, new SecretStore({}), fetcher, bundle);
    assert.equal(calls, largerPacked.length); assert.ok(largerPacked.length > packed.length);
  } finally { db.close(); }
});

test('packed skin evidence retains exact owner IDs and rejects cross-skin citations', () => {
  const bundle = createEmptyBundle('琴', '原神');
  bundle.skinOrVariantCandidates = [
    { id: 'skin-a', name: '皮肤甲', classification: 'skin', outfitDescription: '', loreStory: '皮肤甲确有原文故事。', source: 'a' },
    { id: 'skin-b', name: '皮肤乙', classification: 'skin', outfitDescription: '', loreStory: '皮肤乙穿着白色礼服。', source: 'b' },
  ];
  const chunks = buildSynthesisEvidenceChunks(bundle); assert.equal(chunks.length, 1);
  const proposals = bundle.skinOrVariantCandidates.map((p) => ({ ...p, selected: true }));
  const warnings: string[] = [];
  applyGroundedSynthesisResponse({ skinUpdates: [{ id: 'skin-a', outfitDescription: '白色礼服' }], evidence: [
    { field: 'skinUpdates.skin-a.outfitDescription', sourceId: 'skin:skin-b', quote: '皮肤乙穿着白色礼服。' },
  ] }, chunks[0], buildDeterministicDraft(bundle), proposals, warnings);
  assert.equal(proposals[0].outfitDescription, ''); assert.ok(warnings.some((w) => w.includes('无对应原文')));
  applyGroundedSynthesisResponse({ skinUpdates: [{ id: 'skin-b', outfitDescription: '白色礼服' }], evidence: [
    { field: 'skinUpdates.skin-b.outfitDescription', sourceId: 'skin:skin-b', quote: '皮肤乙穿着白色礼服。' },
  ] }, chunks[0], buildDeterministicDraft(bundle), proposals, warnings);
  assert.equal(proposals[1].outfitDescription, '白色礼服');
});

test('model cannot promote commented raw text or unrelated visual quotes to evidence', () => {
  const bundle = createEmptyBundle('琴', '原神');
  bundle.sources.push({ title: '原文', sourceType: 'bwiki', url: null, excerpt: '', rawText: '<!-- 假皮肤红色双马尾 -->', evidenceKind: 'fulltext' });
  bundle.stories.push({ title: '正文', content: '琴始终将蒙德放在首位。', source: 'real-page' });
  const chunks = buildSynthesisEvidenceChunks(bundle);
  assert.equal(chunks.some((c) => c.text.includes('假皮肤')), false);
  const draft = buildDeterministicDraft(bundle); const warnings: string[] = [];
  applyGroundedSynthesisResponse({ appearance: { baseText: '蒙德' }, evidence: [{ field: 'appearance.baseText', quote: '琴始终将蒙德放在首位。' }] }, chunks[0], draft, [], warnings);
  assert.equal(draft.appearance.baseText, ''); assert.ok(warnings.length);
});

test('controlled LLM path processes last chunk and rejects unsupported visual facts without calling any paid endpoint', async () => {
  const db = new ServiceDatabase(':memory:'); const now = new Date().toISOString();
  try {
    db.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('characters','角色','test','[]',1,?,?)").run(now, now);
    db.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('controlled','controlled','llm','https://controlled.invalid/v1','test-model',1,?,?)").run(now, now);
    db.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('characters','text','controlled',?)").run(now);
    const bundle = createEmptyBundle('琴', '原神'); bundle.stories = [{ title: '角色故事', content: `${'永护蒙德。'.repeat(5000)}独有结尾证据`, source: 'public-fixture' }];
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(String(input), 'https://controlled.invalid/v1/chat/completions');
      const request = JSON.parse(String(init?.body)); const prompt = request.messages[1].content as string; calls.push(prompt);
      return json({ choices: [{ message: { content: JSON.stringify({ personaText: '她坚守保护蒙德的责任。', appearance: { baseText: '红色双马尾和紫色瞳孔' },
        skinUpdates: [{ id: 'invented', loreStory: '编造的往事' }], evidence: [{ field: 'personaText', quote: '永护蒙德。' }, { field: 'appearance.baseText', quote: '永护蒙德。' }] }) } }] });
    };
    const result = await synthesizeRpCharacter(db, new SecretStore({}), fetcher, bundle);
    assert.ok(calls.length >= 2); assert.ok(calls.at(-1)?.includes('独有结尾证据'));
    assert.ok(result.draft.personaText.includes('独有结尾证据')); assert.equal(result.draft.appearance.baseText, '');
    assert.ok(result.warnings.some((w) => w.includes('不是上游原文'))); assert.ok(result.warnings.some((w) => w.includes('未检索到的形态')));
  } finally { db.close(); }
});

test('general work rejects Genshin routing and enum-only sources report unsupported capability', async () => {
  const db = new ServiceDatabase(':memory:'); const urls: string[] = [];
  try {
    const result = await runUpstreamCharacterResearch(db, new SecretStore({}), undefined, async (input) => { urls.push(String(input)); throw new Error('no network expected'); },
      { query: '福尔摩斯', work: '福尔摩斯探案集', preferSources: ['bwiki', 'mihoyo-obc', 'enka'] });
    assert.equal(urls.length, 0); assert.ok(result.warnings.some((w) => w.includes('拒绝猜测为原神')));
    assert.ok(result.warnings.some((w) => w.includes('mihoyo-obc'))); assert.ok(result.warnings.some((w) => w.includes('enka')));
    assert.equal(result.draft.appearance.baseText, '');
  } finally { db.close(); }
});

test('short wiki menu text cannot suppress fallback and generic works never call Genshin', async () => {
  const db = new ServiceDatabase(':memory:'); const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); requests.push(url); const u = new URL(url);
    if (u.hostname === 'mzh.moegirl.org.cn') return json({ query: { pages: { '123': { title: '琴(原神)', extract: '正式人物资料。'.repeat(100) } } } });
    if (u.searchParams.get('list') === 'search') return json({ query: { search: u.searchParams.get('srsearch') === '琴' ? [{ title: '琴' }] : [] } });
    if (u.searchParams.get('page') === '琴') return json({ parse: { title: '琴', images: [], wikitext: { '*': '==人物背景==\n这里只是非常短小的一段页面导航说明。' } } });
    return json({ error: { info: 'no page' } });
  };
  try {
    const result = await runUpstreamCharacterResearch(db, new SecretStore({}), undefined, fetcher,
      { query: '琴', work: '原神', preferSources: ['bwiki', 'moegirl'] });
    assert.ok(requests.some((url) => url.startsWith('https://mzh.moegirl.org.cn/')));
    assert.ok(result.draft.personaText.includes('正式人物资料。'));
    requests.length = 0;
    await runUpstreamCharacterResearch(db, new SecretStore({}), undefined, fetcher,
      { query: '福尔摩斯', work: '福尔摩斯探案集', preferSources: ['bwiki', 'moegirl'] });
    assert.ok(requests.length); assert.ok(requests.every((url) => url.startsWith('https://mzh.moegirl.org.cn/')));
  } finally { db.close(); }
});

test('nested real wiki formatting keeps display text and pipes inside links', () => {
  const templates = parseWikiTemplates('{{角色/故事|角色故事1=前文{{颜色|描述|[[琴|代理团长]]}}后文|角色故事2=最后一段}}');
  const story = templates.find((t) => t.name === '角色/故事');
  assert.equal(story?.fields.角色故事1, '前文{{颜色|描述|[[琴|代理团长]]}}后文');
  assert.equal(stripWikiMarkup(story?.fields.角色故事1 || ''), '前文代理团长后文');
});
