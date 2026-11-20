import { Type, type Static } from '@sinclair/typebox';
import {
  CreativeScopeSchema, WorldActorSchema, WorldActorStateSchema, WorldEventSchema, WorldMemorySchema,
  type WorldActorState,
} from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
import type { CreativeContext } from './domain.js';

const strict = { additionalProperties: false };
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const id = Type.String({ minLength: 1, maxLength: 200 });
const nullableRevision = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);
export const CreativeSceneBaseSchema = Type.Object({
  branchRevision: nullableRevision,
  projectRevision: nullableRevision,
  projectContentHash: Type.Union([hash, Type.Null()]),
  currentTick: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
}, strict);
export const CreativeSpeculationSchema = Type.Union([
  Type.Object({ parentArtifactId: id, parentHash: hash }, strict), Type.Null(),
]);

export const CreativeSceneCraftSchema = Type.Object({
  characterIntentions: Type.Array(Type.Object({
    actorId: id,
    goal: Type.String({ minLength: 1, maxLength: 400 }),
    hiddenAgenda: Type.Optional(Type.String({ maxLength: 400 })),
    mistakenBelief: Type.Optional(Type.String({ maxLength: 400 })),
  }, strict), { maxItems: 20 }),
  beats: Type.Array(Type.String({ minLength: 1, maxLength: 400 }), { minItems: 1, maxItems: 12 }),
  tensionHook: Type.Optional(Type.String({ maxLength: 400 })),
}, strict);
export type CreativeSceneCraft = Static<typeof CreativeSceneCraftSchema>;

/** Candidate prose and proposed facts travel together, but are never history until adoption. */
export const CreativeSceneSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  sceneCraft: Type.Optional(CreativeSceneCraftSchema),
  body: Type.String({ minLength: 1, maxLength: 100000 }),
  contextHash: hash,
  scope: CreativeScopeSchema,
  base: CreativeSceneBaseSchema,
  sourceRefs: Type.Array(id, { minItems: 1, maxItems: 500, uniqueItems: true }),
  speculation: CreativeSpeculationSchema,
  directionApprovalId: Type.Union([id, Type.Null()]),
  newSettings: Type.Optional(Type.Array(Type.Object({
    id, title: Type.String({ minLength: 1, maxLength: 200 }), content: Type.String({ minLength: 1, maxLength: 12000 }),
    sourceRefs: Type.Array(id, { maxItems: 100 }),
  }, strict), { maxItems: 30 })),
  foreshadowing: Type.Optional(Type.Array(Type.Object({
    id, action: Type.Union([Type.Literal('open'), Type.Literal('advance'), Type.Literal('resolve')]),
    title: Type.String({ minLength: 1, maxLength: 200 }), detail: Type.String({ maxLength: 12000 }),
    sourceRefs: Type.Array(id, { maxItems: 100 }),
  }, strict), { maxItems: 50 })),
  simulation: Type.Union([Type.Object({
    tick: Type.Integer({ minimum: 0 }),
    events: Type.Array(WorldEventSchema, { minItems: 1, maxItems: 30 }),
    states: Type.Array(WorldActorStateSchema, { maxItems: 100 }),
    memories: Type.Array(WorldMemorySchema, { maxItems: 200 }),
    consumedInterventionIds: Type.Array(id, { maxItems: 100, uniqueItems: true }),
    supportingActors: Type.Array(WorldActorSchema, { maxItems: 20 }),
  }, strict), Type.Null()]),
}, strict);
export type CreativeScene = Static<typeof CreativeSceneSchema>;

/** Prompt guidance only: never edits, repairs, commits or supplies facts to a model response. */
export function creativeSceneGuidance(context: CreativeContext): string {
  const common = [
    '场景交付语义（JSON Schema 之外同样必须满足）：',
    '只返回一个完整 JSON 对象，不用 Markdown、不附分析。建议先写出 sceneCraft={characterIntentions:[{actorId,goal,hiddenAgenda?,mistakenBelief?}],beats:[...],tensionHook} 梳理人物此时心理目的与认知差（不可在对话中泄露他人不知道的秘密）和 3–5 个微观节拍，再撰写 title/body。正文、events、facts、stateChanges、memories 必须描述同一组实际发生的事情。',
    'scope/base/contextHash/speculation 逐字段原样复制 context，不自行刷新 revision，不把 currentTick 清零。directionApprovalId 输出 null，由服务器注入真实方向批件。',
    'sourceRefs 至少引用一个 context.sources[].id；只使用实际提供的来源 ID，不自造书籍、设定或证据 ID。检索得到的 evidence: 来源可引用，但导演资料不等于角色已知。',
    'newSettings 和 foreshadowing 总要输出数组，没有变化就 []。newSettings={id,title,content,sourceRefs}；foreshadowing={id,action:"open"|"advance"|"resolve",title,detail,sourceRefs}。新增内容必须有具体依据；advance/resolve 只能指向本时间线已有的开放伏笔，不能收束未知或已结束的 ID。它们的 sourceRefs 可引用 context 来源，或本场景实际新建的 event/fact ID。',
    context.speculation ? `本次是预写。sourceRefs 必须包含 candidate:${context.speculation.parentArtifactId}；data.candidate 是尚未采用的假设，按其结尾继续，但不得称它已进入正式历史。` : '',
    '下面 JSON 是字段与时间计算示例，示例动作不是用户要求，也不是新证据；禁止原样抄写示例正文或拿示例补齐失败输出。你须按导演计划自行创作，逐项替换示例动作、事实、记忆及新 ID，并保留真实上下文绑定。',
  ].filter(Boolean);
  const sourceId = context.sources.find((source) => source.kind === 'definition')?.id ?? context.sources[0]?.id;
  const refs = [...new Set([sourceId, context.speculation ? `candidate:${context.speculation.parentArtifactId}` : undefined].filter((id): id is string => Boolean(id)))];
  const baseExample = {
    schemaVersion: 1 as const, title: '【仅结构示例】短暂停步', body: '【仅结构示例，须替换】角色在当前位置短暂停步。',
    contextHash: context.contextHash, scope: context.scope, base: context.base, sourceRefs: refs,
    speculation: context.speculation, directionApprovalId: null, newSettings: [], foreshadowing: [],
  };
  if (!context.scope.worldId) {
    return [...common, '本次为独立项目：simulation 必须为 null。不要创建 worldId、branchId、世界事件或角色记忆；正文写在 body。',
      '最小结构示例：\n```json\n' + JSON.stringify({ ...baseExample, simulation: null }) + '\n```'].join('\n');
  }
  const now = context.base.currentTick;
  if (now === null || !Number.isSafeInteger(now)) return [...common, '上下文缺少有效 currentTick，不能猜测时间或编造事件；必须停止并请求补充上下文。'].join('\n');
  const world = context.data.world && typeof context.data.world === 'object' ? context.data.world as Record<string, unknown> : {};
  const states = Array.isArray(world.states) ? world.states.filter((state): state is WorldActorState => Value.Check(WorldActorStateSchema, state)) : [];
  const activeIds = Array.isArray(world.activeActorIds) ? world.activeActorIds.filter((id): id is string => typeof id === 'string') : [];
  const candidate = context.speculation && context.data.candidate && typeof context.data.candidate === 'object'
    ? (context.data.candidate as { content?: CreativeScene }).content : undefined;
  const candidateStates = [...candidate?.simulation?.states ?? [], ...candidate?.simulation?.events.flatMap((event) => event.stateChanges) ?? []];
  const initial = states.find((state) => activeIds.includes(state.actorId)) ?? states[0];
  const state = initial ? candidateStates.filter((item) => item.actorId === initial.actorId)
    .sort((left, right) => right.updatedTick - left.updatedTick)[0] ?? initial : undefined;
  const rules = [
    `时间均为这条时间线的绝对分钟整数。当前起点 t0=${now}。simulation.tick 是场景结束时刻，必须 ${now}<tick<=${now + 1440}。event.tick 是事件开始时刻，duration 是持续分钟：${now}<=event.tick，duration>=0，event.tick+duration<=simulation.tick。例如从 ${now} 开始持续25分钟，则 simulation.tick 至少 ${now + 25}；不能把 simulation.tick 写成 ${now}。`,
    'events 至少1项，最多30项，按发生顺序排列。每项精确字段：{id,worldId,branchId,tick,duration,title,summary,locationId,participantIds,facts,perspectives,causeEventIds,storyLineIds,stateChanges,createdAt}。worldId/branchId 复制 scope；createdAt 为 ISO 时间字符串；所有新 event/memory/fact ID 避免与当前历史重复。',
    'locationId 使用 definition.locations[].id；participantIds 至少1个真实 actor ID，优先 activeActorIds/definition.actors。地点应与人物当前状态和移动过程一致。storyLineIds 只能取当前 storyLines[].id，没有就 []。causeEventIds 只能指向上下文已知事件或本场景更早事件，不能指向未来、自己或构成循环。',
    'facts 每项为 {id,content,knownBy,nature}。knownBy 是真正获知此条事实的 actor ID，通常只含实际在场且获知者；不把所有登场人物自动设为知情人。你本次新创作的事实用 nature:"ai"，不能自行升格为 canon/author。perspectives 每项 {actorId,text}，actorId 必须在本事件 participantIds 中。',
    '状态不是字符串，也不是局部 patch。stateChanges 或 simulation.states 的每项都需完整 {actorId,locationId,goals:string[],emotion:string,relationships:[{actorId,description,sourceEventId:string|null}],updatedTick}。复制并保留未改变的目标、关系，仅更新剧情确实改变的部分；变化发生后用新的 updatedTick，建议等于事件结束时刻，且不得超过 simulation.tick。不能用旧状态的 updatedTick 写不同状态；同一actor同一时刻不得有两份不同状态。已在事件stateChanges列出且代表最终状态的，不必再在simulation.states重复。没有状态变化两处都可 []。',
    '角色知识只能来自 actorKnowledge 中该角色已知 facts、合法 memories，以及本场景实际见闻；他人秘密、平行时间线、全知叙述、未来结果不自动成为其知识。beliefs 的 inferred/mistaken 是主观判断，不可当作客观真相。',
    'memories 每项精确字段：{id,worldId,branchId,actorId,sourceEventId,learnedAt,kind,content,importance,fromActorId}。sourceEventId 必须是实际存在的来源事件，不是 fact ID；learnedAt 为绝对分钟，须不早于来源事件发生且不晚于simulation.tick，建议不早于来源事件结束。importance 为0到1数字，content不能为空。',
    'kind:"experienced" 仅供来源事件在场者，fromActorId:null；kind:"heard" 必须 fromActorId 为另一真实角色，而且转述者在learnedAt已知该来源及该事实；正文要真实写出转述。用于客观事实的记忆content应逐字使用获知的fact.content，不能把整段事件摘要和未透露秘密一并转述。inferred/mistaken 只能写有依据的推断/误解，不能借它泄露未知事实。没有新增记忆就 []，不能为凑数组虚构记忆。',
    'consumedInterventionIds 只填 context 内本次已经执行且时间不在未来的干预 ID，否则 []。supportingActors 通常 []；确需新配角须完整 WorldActor、role:"supporting"、新actorId、既有地点，characterId/characterVersion 同时为null或上下文证实的冻结角色版本，不得捏造角色库ID。',
    '提交前自行核算每个事件结束时刻、状态更新时间、记忆获知时刻，确认都落在本场景范围；不要用删事件、删状态或空正文来掩盖不一致。',
  ];
  if (!state || !sourceId) return [...common, ...rules, '当前上下文没有足以构造示例的真实角色状态或来源；不要猜造actor/location/source ID，请先读取对应角色与来源。'].join('\n');
  const endTick = now + 2;
  const exampleId = 'example_event_' + context.contextHash.slice(0, 12);
  const factContent = '【仅结构示例，须替换】角色在当前位置短暂停步。';
  const nextState = { ...structuredClone(state), updatedTick: endTick };
  const example: CreativeScene = { ...baseExample, simulation: { tick: endTick, events: [{
    id: exampleId, worldId: context.scope.worldId, branchId: context.scope.branchId!, tick: now + 1, duration: 1,
    title: '【仅结构示例】短暂停步', summary: factContent, locationId: state.locationId, participantIds: [state.actorId],
    facts: [{ id: 'example_fact_' + context.contextHash.slice(0, 12), content: factContent, knownBy: [state.actorId], nature: 'ai' }],
    perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [nextState], createdAt: '2000-01-01T00:00:00.000Z',
  }], states: [], memories: [{
    id: 'example_memory_' + context.contextHash.slice(0, 12), worldId: context.scope.worldId, branchId: context.scope.branchId!,
    actorId: state.actorId, sourceEventId: exampleId, learnedAt: endTick, kind: 'experienced', content: factContent, importance: 0.2, fromActorId: null,
  }], consumedInterventionIds: [], supportingActors: [] } };
  return [...common, ...rules, '最小合法结构示例（下面时间和身份来自当前上下文；动作、ID、时间戳仅演示格式，不是事实输入）：\n```json\n'
    + JSON.stringify(example) + '\n```'].join('\n');
}
