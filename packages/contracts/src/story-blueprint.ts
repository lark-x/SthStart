import { Type, type Static } from '@sinclair/typebox';
import {
  CreativeCharacterVoiceSchema,
  CreativeStyleGuideSchema,
} from './creative-orchestration.js';
import {
  WorldFactionSchema,
  WorldLocationSchema,
  WorldModelBindingsSchema,
  WorldRegionSchema,
  WorldSourceSchema,
  WorldStoryLineArcKindSchema,
  WorldStoryLineStatusSchema,
  WorldVisualReferenceSchema,
} from './story-worlds.js';
import { InitialWorldBranchSchema } from './world-authoring.js';

const shortId = Type.String({ minLength: 1, maxLength: 120 });
const text = (maxLength = 4000) => Type.String({ maxLength });
const nullableId = Type.Union([shortId, Type.Null()]);

export const StoryBodyCharacterSeedSchema = Type.Object({
  idHint: Type.Optional(shortId),
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  englishName: Type.Optional(text(160)),
  aliases: Type.Optional(Type.Array(text(120), { maxItems: 30 })),
  originType: Type.Union([Type.Literal('ip'), Type.Literal('derivative'), Type.Literal('original')]),
  work: Type.String({ minLength: 1, maxLength: 200 }),
  summary: Type.String({ minLength: 1, maxLength: 2000 }),
  personaText: Type.String({ minLength: 1, maxLength: 20000 }),
  speechText: Type.Optional(text(8000)),
  dialogueExamples: Type.Optional(Type.Array(text(800), { maxItems: 20 })),
  behaviorRules: Type.Optional(text(8000)),
  appearance: Type.Object({
    baseText: text(8000),
    defaultOutfitText: text(8000),
  }),
  birthday: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  tags: Type.Optional(Type.Array(text(80), { maxItems: 50 })),
});
export type StoryBodyCharacterSeed = Static<typeof StoryBodyCharacterSeedSchema>;

export const StoryBodyActorSeedSchema = Type.Object({
  id: shortId,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  role: Type.Union([
    Type.Literal('main'),
    Type.Literal('supporting'),
    Type.Literal('companion'),
    Type.Literal('antagonist'),
  ]),
  faction: Type.Optional(text(200)),
  factionId: Type.Optional(shortId),
  regionId: Type.Optional(nullableId),
  characterHint: Type.Optional(text(160)),
  characterId: Type.Optional(nullableId),
  characterVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  background: text(6000),
  personality: text(6000),
  speechStyle: text(3000),
  appearance: text(4000),
  goals: Type.Array(text(1000), { maxItems: 30 }),
  locationId: shortId,
  referenceArtifactIds: Type.Array(shortId, { maxItems: 30 }),
});
export type StoryBodyActorSeed = Static<typeof StoryBodyActorSeedSchema>;

export const StoryBodyWorldDefinitionSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  summary: Type.String({ minLength: 1, maxLength: 6000 }),
  timeLabel: Type.String({ minLength: 1, maxLength: 200 }),
  workNature: Type.Union([Type.Literal('canon'), Type.Literal('derivative'), Type.Literal('original')]),
  parentWork: Type.Union([text(200), Type.Null()]),
  narrativeMode: Type.Optional(Type.Union([Type.Literal('quest-chapter'), Type.Literal('sandbox-tick')])),
  regions: Type.Optional(Type.Array(WorldRegionSchema, { maxItems: 100 })),
  factions: Type.Optional(Type.Array(WorldFactionSchema, { maxItems: 100 })),
  startMinuteOfDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 1439 })),
  locations: Type.Array(WorldLocationSchema, { minLength: 1, maxItems: 100 }),
  visualReferences: Type.Array(WorldVisualReferenceSchema, { maxItems: 100 }),
  actors: Type.Array(StoryBodyActorSeedSchema, { minLength: 1, maxItems: 100 }),
  sources: Type.Array(WorldSourceSchema, { minLength: 1, maxItems: 100 }),
  lockedFacts: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 100 }),
  models: WorldModelBindingsSchema,
  visualStyle: text(4000),
});
export type StoryBodyWorldDefinition = Static<typeof StoryBodyWorldDefinitionSchema>;

export const StoryBodyStoryLineSeedSchema = Type.Object({
  id: Type.Optional(shortId),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: text(3000),
  actorIds: Type.Array(shortId, { maxItems: 50 }),
  arcKind: Type.Optional(WorldStoryLineArcKindSchema),
  chapterCode: Type.Optional(text(120)),
  mcpQueryHint: Type.Optional(text(300)),
  timeWindowLabel: Type.Optional(text(200)),
  regionIds: Type.Optional(Type.Array(shortId, { maxItems: 50 })),
  locationIds: Type.Optional(Type.Array(shortId, { maxItems: 50 })),
  status: Type.Optional(WorldStoryLineStatusSchema),
  orderIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
});
export type StoryBodyStoryLineSeed = Static<typeof StoryBodyStoryLineSeedSchema>;

export const StoryBodyOpenThreadSchema = Type.Object({
  id: Type.Optional(shortId),
  title: Type.String({ minLength: 1, maxLength: 240 }),
  detail: Type.String({ minLength: 1, maxLength: 3000 }),
});
export type StoryBodyOpenThread = Static<typeof StoryBodyOpenThreadSchema>;

export const StoryBodyProjectSeedSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  summary: text(4000),
  outlineTitle: Type.String({ minLength: 1, maxLength: 200 }),
  outlineBody: Type.String({ minLength: 1, maxLength: 60000 }),
});
export type StoryBodyProjectSeed = Static<typeof StoryBodyProjectSeedSchema>;

/**
 * 7 层通用故事主体蓝图包（Universal Story Body Blueprint Pack）：
 * 1) 作品与时间窗锚定 2) 世界本体与硬约束 3) 空间舞台与视觉母题
 * 4) 角色库与在场演员图 5) 分支主旨与多线冲突 6) 触发式伏笔账本 7) 声纹与文风治理
 */
export const StoryBodyPackSchema = Type.Object({
  schemaVersion: Type.Optional(Type.Literal(1)),
  work: Type.String({ minLength: 1, maxLength: 200 }),
  setupId: Type.Optional(nullableId),
  characters: Type.Array(StoryBodyCharacterSeedSchema, { minLength: 1, maxItems: 100 }),
  worldDefinition: StoryBodyWorldDefinitionSchema,
  initialBranch: InitialWorldBranchSchema,
  storyLines: Type.Array(StoryBodyStoryLineSeedSchema, { maxItems: 200 }),
  styleGuide: CreativeStyleGuideSchema,
  characterVoices: Type.Record(Type.String({ minLength: 1, maxLength: 160 }), CreativeCharacterVoiceSchema),
  openThreads: Type.Array(StoryBodyOpenThreadSchema, { maxItems: 200 }),
  storyProject: StoryBodyProjectSeedSchema,
});
export type StoryBodyPack = Static<typeof StoryBodyPackSchema>;

export const StoryBodyImportResultSchema = Type.Object({
  work: Type.String({ minLength: 1, maxLength: 200 }),
  worldId: shortId,
  branchId: shortId,
  projectId: shortId,
  setupCompleted: Type.Boolean(),
  charactersCreated: Type.Integer({ minimum: 0 }),
  charactersUpdated: Type.Integer({ minimum: 0 }),
  storyLinesCreated: Type.Integer({ minimum: 0 }),
  characterIdsByHint: Type.Record(Type.String(), shortId),
});
export type StoryBodyImportResult = Static<typeof StoryBodyImportResultSchema>;

/** 生成可复用的 7 层通用故事主体框架模板，便于新作品快速填装。 */
export function createUniversalStoryBlueprintTemplate(workName = '新故事作品'): StoryBodyPack {
  return {
    schemaVersion: 1,
    work: workName,
    setupId: null,
    characters: [
      {
        idHint: 'char_protagonist',
        displayName: '主角（待命名）',
        originType: 'original',
        work: workName,
        summary: '承担观察者与变数角色，拥有明确核心渴望与尚未解答的来历盲区。',
        personaText: '核心动机、代价承受边界与认知盲区说明。',
        speechText: '自然克制的对白语态，先有动作与停顿，再有观点表达。',
        dialogueExamples: ['「别急着写结论，先把桌上的账本翻到最后。」'],
        behaviorRules: '不在未知信息上全知发言；遇到利益冲突时先核对眼前证据。',
        appearance: {
          baseText: '外貌基线与可延续视觉识别特征。',
          defaultOutfitText: '常驻服装材质、色系与随身信物。',
        },
      },
    ],
    worldDefinition: {
      title: `${workName} · 通用故事主体骨架`,
      summary: '围绕核心法则、舞台空间、势力张力与日常锚点搭建可推进的故事世界。',
      timeLabel: '第一卷 · 初始时间窗',
      workNature: 'original',
      parentWork: null,
      startMinuteOfDay: 540,
      locations: [
        {
          id: 'loc_hub',
          name: '中立交汇点（酒馆/站台/议事厅）',
          description: '各势力交汇、日常烟火与信息交换发生的核心舞台。',
        },
      ],
      visualReferences: [
        {
          id: 'vis_hub',
          name: '中立交汇点光影规范',
          kind: 'location',
          locationId: 'loc_hub',
          description: '光线、建筑材质与固定道具规范，保证跨场视觉一致性。',
          referenceArtifactIds: [],
        },
      ],
      actors: [
        {
          id: 'actor_protagonist',
          name: '主角（待命名）',
          role: 'main',
          characterHint: 'char_protagonist',
          background: '带着尚未公开的目标进入当前时间窗舞台。',
          personality: '冷静观察、保留底牌但重视具体之人的承诺。',
          speechStyle: '短句为主，善于通过细节反问试探对手。',
          appearance: '延续角色库基础外貌与随身信物。',
          goals: ['查明核心失落线索并守住身边同盟'],
          locationId: 'loc_hub',
          referenceArtifactIds: [],
        },
      ],
      sources: [
        {
          id: 'src_world_ontology',
          title: `${workName} 世界本体与制度规则`,
          nature: 'author',
          content: '定义力量来源、不可违逆的代价边界、核心制度冲突与日常运作规则。',
          sourceUrl: '',
          sourceVersion: 'v1',
          capturedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      lockedFacts: [
        '力量或奇迹必须伴随等价代价，不可无成本改写既定因果。',
        '各阵营掌握各自情报壁垒，不存在无条件全知旁白。',
      ],
      models: {
        action: null,
        adjudication: null,
        narration: null,
      },
      visualStyle: '实感细腻的电影级叙事插画：明确冷暖主光对照、克制环境尘埃与服材质纹理。',
    },
    initialBranch: {
      title: '主线推进 · 多方交汇',
      mode: 'canon-gap',
      direction: '以中立交汇点为舞台，让不同阵营围绕共同危机展开局部试探与日常对照。',
    },
    storyLines: [
      {
        id: 'line_main_catalyst',
        title: '核心谜团与阵营试探',
        description: '主角与核心势力在信息不对称中第一次正面试探。',
        actorIds: ['actor_protagonist'],
      },
    ],
    styleGuide: {
      tone: '克制具体，先写环境质感与人物细微动作，再推进台词博弈',
      bannedCliches: ['眼神瞬间冰冷', '嘴角勾起一抹弧度', '空气仿佛凝固了', '众人倒吸一口凉气'],
      styleSample: '杯沿的水汽散得很快，他没有急着回答，只把折角的信纸压回碟子底下。',
      pacingHint: '前三分之一锚定地点与生活气，中段信息错位交锋，结尾留一件具体物件或未解之问',
    },
    characterVoices: {
      actor_protagonist: {
        voiceSamples: ['「这话你刚才已经换过三种说法了，哪一句才是真的？」'],
        mannerisms: '回答前习惯先看对方手指或随身物件，再开口',
        taboos: ['不在没见过实证前代他人下定论', '不使用现代网络流行语'],
      },
    },
    openThreads: [
      {
        id: 'thread_origin_secret',
        title: '未揭晓的来历契约 【触发词：旧信, 信物, 契约】',
        detail: '主角随身携带有缺损的旧物，其真正立约方与代价条款留待后续剧情解锁。',
      },
    ],
    storyProject: {
      title: `${workName} · 正文共创卷`,
      summary: '承载该故事主体世界分支采纳章节与正式设定账本的写作项目。',
      outlineTitle: '全卷结构大纲',
      outlineBody: '# 第一卷\n\n- 序幕：日常锚点与第一次信息错位\n- 中盘：阵营利益碰撞与历史创伤浮现',
    },
  };
}
