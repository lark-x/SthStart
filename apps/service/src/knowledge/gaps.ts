import type { KnowledgeGap, PlanningKnowledgeSnapshot } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { KnowledgeStore } from './store.js';

/**
 * 缺失问题：只做本次检索范围内的简单分类检查，不假装评估全部事实。
 * 「资料库中没找到」不等于「原作里没有」，所以问题措辞统一是“是否有……”。
 */
export function suggestGaps(
  database: ServiceDatabase,
  input: {
    snapshot?: PlanningKnowledgeSnapshot | null;
    works?: string[];
    characters?: string[];
    locations?: string[];
    theme?: string;
    /** 参考资料里最早/最新的来源时间，用于判断是否需要补近期动态。 */
    referenceDates?: string[];
  },
): KnowledgeGap[] {
  const references = input.snapshot?.references ?? [];
  const store = new KnowledgeStore(database);
  const gaps: KnowledgeGap[] = [];

  // 从引用与其关联资料里收集已有的分类信息。
  const categories = new Set<string>();
  const notesWithKnowledge = references
    .filter((reference) => reference.sourceKind === 'note')
    .map((reference) => store.readKnowledge(reference.sourceId))
    .filter((knowledge): knowledge is NonNullable<typeof knowledge> => Boolean(knowledge));
  for (const knowledge of notesWithKnowledge) {
    if (knowledge.category) categories.add(knowledge.category);
  }
  const hasCanon = references.some((reference) => reference.nature === 'canon');
  const hasRelation = categories.has('relation') || references.some((reference) => /关系/.test(reference.title));
  const hasLocation = categories.has('location') || references.some((reference) => /地点|地图|场景/.test(reference.title));

  const lead = (input.characters ?? [])[0] ?? (input.works ?? [])[0] ?? '主角';

  if (!references.length) {
    // 统一用「是否有……」提问：资料库没找到不等于原作里没有。
    gaps.push({ question: '是否有与' + lead + '相关的人物关系资料？', reason: '本次还没有引用任何资料，先补关系依据最有用。' });
    gaps.push({ question: '是否有能支持本次活动地点安排的资料？', reason: '地点资料可以直接约束方案里的场地写实度。' });
    gaps.push({ question: '是否有' + lead + '相关的近期剧情或版本动态？', reason: '如果活动会涉及近期内容，需要确认是否与最新剧情冲突。' });
    return gaps;
  }
  if (!hasRelation) {
    gaps.push({ question: '是否有与' + lead + '相关的原作人物关系资料？', reason: '现有引用里没有看到人物关系类资料。' });
  }
  if (!hasLocation) {
    gaps.push({ question: '是否有能支持该地点安排的资料？', reason: '现有引用里没有地点类资料，方案的地点可能缺少依据。' });
  }
  if (!hasCanon) {
    gaps.push({ question: '是否有对应的原作资料可以核对？', reason: '现有引用都是社区解读或个人设定，没有原作依据。' });
  }
  // 近期动态：引用来源都比较旧时提示检查，而不是每次打开页面就联网。
  const dates = (input.referenceDates ?? []).map((value) => Date.parse(value)).filter((value) => Number.isFinite(value));
  const newest = dates.length ? Math.max(...dates) : null;
  const staleDays = 90;
  if (newest === null || Date.now() - newest > staleDays * 86_400_000) {
    gaps.push({ question: '是否有与' + lead + '相关的近期剧情或版本动态？', reason: '现有引用的来源时间较旧或未知，建议确认是否有新内容。' });
  }
  return gaps.slice(0, 5);
}
