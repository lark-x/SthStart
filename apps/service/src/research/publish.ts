import { randomUUID } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { NarrativeCorpusProvider } from './corpus.js';
import { ResearchStore, nowIso, stableHash, type ResearchClaimRow, type ResearchDraftRow } from './store.js';
import { natureForClaims } from './engine.js';

export interface PublishOptions {
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase;
  provider: NarrativeCorpusProvider;
  store: ResearchStore;
  fetcher: typeof fetch;
}

export interface PublishResult {
  noteId: string;
  created: boolean;
  revision: number;
  nature: 'canon' | 'unconfirmed';
  href: string;
}

interface DraftContent {
  title?: string; summary?: string;
  sections?: Array<{ heading?: string; body?: string; claimIds?: string[]; evidenceIds?: string[] }>;
  evidenceIndex?: Array<{ evidenceId?: string; locator?: string; note?: string }>;
}

/** 总稿固定八段；缺少的段落保留标题，避免资料正文看起来像被截断。 */
const SECTION_ORDER = ['研究问题', '已确认事实', '主要暗线与推论', '互相矛盾的证据', '尚未回答的问题', '可继续查找的方向', '对活动创作可能有帮助的元素'];

const CLAIM_TYPE_LABELS: Record<string, string> = {
  fact: '原作明确事实', inference: '研究推论', speculation: '未确认猜想',
  contradiction: '矛盾与疑点', 'open-question': '开放问题',
};

/** 正文按类型分区，用户一眼能分辨哪些能直接引用、哪些只是推论。 */
function renderSections(draft: ResearchDraftRow, claims: ResearchClaimRow[], evidenceById: Map<string, { locator: string; quote: string }>): Array<{ heading: string; body: string }> {
  const content = draft.content as DraftContent;
  const byHeading = new Map<string, string>();
  for (const section of content.sections ?? []) {
    if (section.heading) byHeading.set(section.heading.trim(), String(section.body ?? '').trim());
  }
  const sections: Array<{ heading: string; body: string }> = [];
  for (const heading of SECTION_ORDER) {
    const body = byHeading.get(heading);
    if (body) sections.push({ heading, body });
  }

  // 结论按类型分组补一份结构化清单，便于按性质取用。
  const grouped = new Map<string, ResearchClaimRow[]>();
  for (const claim of claims) {
    const key = claim.claimType ?? 'open-question';
    grouped.set(key, [...(grouped.get(key) ?? []), claim]);
  }
  for (const [type, items] of grouped) {
    const label = CLAIM_TYPE_LABELS[type] ?? type;
    const body = items.map((claim) => {
      const evidence = (claim.evidenceRefs ?? []).map((id) => {
        const entry = evidenceById.get(id);
        return entry ? `  - 证据：${entry.locator}` : `  - 证据：${id}`;
      });
      return [`- ${claim.title}`, claim.body, claim.uncertainty ? `  不确定点：${claim.uncertainty}` : '', ...evidence].filter(Boolean).join('\n');
    }).join('\n');
    sections.push({ heading: `结论卡 · ${label}`, body });
  }
  return sections;
}

/** 从接受结论与证据里汇总作品、角色与地点。 */
function collectRefs(claims: ResearchClaimRow[], workTitle: string): { works: Array<{ key: string; name: string }>; characters: Array<{ work: string; name: string }>; locations: Array<{ work: string; name: string }> } {
  const characters = new Set<string>(); const locations = new Set<string>();
  for (const claim of claims) {
    // 结论标题里出现的人名是保守线索：宁缺勿滥，不猜。
    for (const match of claim.title.matchAll(/[《「]([^》」]{1,20})[》」]/g)) characters.add(match[1]);
  }
  return {
    works: workTitle ? [{ key: workTitle, name: workTitle }] : [],
    characters: [...characters].map((name) => ({ work: workTitle, name })),
    locations: [...locations].map((name) => ({ work: workTitle, name })),
  };
}

/**
 * 发布研究总稿到创作资料库。
 * 幂等：同一专题 + 同一总稿内容 hash 重复点击返回已有资料，不重复创建。
 */
export async function publishResearchDraft(
  options: PublishOptions,
  input: { projectId: string; draftId: string; noteId?: string | null },
): Promise<PublishResult> {
  const { database, store } = options;
  const project = store.getProject(input.projectId);
  if (!project) throw new Error('研究专题不存在。');
  const draft = store.getDraft(input.draftId);
  if (!draft) throw new Error('研究总稿不存在。');
  const claims = store.listClaims({ projectId: project.id }).filter((claim) => claim.status === 'accepted');
  if (!claims.length) throw new Error('至少需要一条已接受的结论才能发布。');

  // 只发布挂在结论上的证据；候选行是检索过程产物，不应进入资料。
  const evidence = store.listClaimEvidence(project.id).filter((item) => item.valid);
  const evidenceById = new Map(evidence.map((item) => [item.id, { locator: item.locator, quote: item.quoteSnapshot }]));
  for (const claim of claims) {
    claim.evidenceRefs = store.listEvidenceForClaim(claim.id).map((item) => item.id);
  }

  const workRow = options.narrativeDatabase.connection.prepare('SELECT title FROM narrative_works WHERE id=?').get(project.workId) as { title: string } | undefined;
  const workTitle = workRow?.title ?? '';
  const content = draft.content as DraftContent;
  const sections = renderSections(draft, claims, evidenceById);
  /*
   * 标题优先取总稿自身的 title：审核页编辑的就是这个字段。
   * content.title 是模型初次生成的原始标题，只在总稿标题为空时兜底。
   */
  const title = (draft.title || content.title || project.title).slice(0, 200);
  const nature = natureForClaims(claims.map((claim) => claim.claimType ?? 'open-question'));

  /*
   * 资料正文只用笔记支持的块类型（text / archive-reference）。
   * 小节标题写进 text 块而不是自造 heading 类型，否则编辑器会因 schema 校验失败打不开。
   */
  const blocks: Array<Record<string, unknown>> = [];
  const summaryText = content.summary || draft.summary || '';
  if (summaryText.trim()) blocks.push({ id: randomUUID(), type: 'text', text: summaryText });
  for (const section of sections) {
    blocks.push({ id: randomUUID(), type: 'text', text: `## ${section.heading}\n${section.body}` });
  }
  /*
   * 证据索引用 archive-reference，用户能一键跳回叙事档案核对原文。
   * 该块类型只支持 utterance 目标，节点级证据写进 text 块，不伪装成可跳转的引用。
   */
  const utteranceEvidence = evidence.filter((item) => item.targetType === 'utterance');
  const nodeEvidence = evidence.filter((item) => item.targetType !== 'utterance');
  for (const item of utteranceEvidence.slice(0, 20)) {
    blocks.push({
      id: randomUUID(), type: 'archive-reference', workId: item.workId,
      targetType: 'utterance', targetId: item.targetId,
      quote: item.quoteSnapshot.slice(0, 1_000), locator: item.locator,
    });
  }
  if (nodeEvidence.length) {
    blocks.push({
      id: randomUUID(), type: 'text',
      text: `## 节点级证据索引\n${nodeEvidence.map((item) => `- ${item.locator}：${item.quoteSnapshot.slice(0, 160)}`).join('\n')}`,
    });
  }

  /*
   * 幂等键包含标题与概述：只比较正文会让「改了标题再发布」被误判成同一份内容，
   * 用户以为更新了、实际什么都没发生。
   */
  const publishKey = stableHash({ projectId: project.id, title, summary: draft.summary, contentHash: draft.contentHash });
  const existingLink = database.connection.prepare('SELECT note_id FROM research_note_links WHERE publish_key=?').get(publishKey) as { note_id: string } | undefined;
  if (existingLink) {
    return { noteId: existingLink.note_id, created: false, revision: draft.revision, nature, href: `/apps/notebook/${existingLink.note_id}` };
  }
  /*
   * 同一专题已经发布过资料时，编辑后重新发布更新那一篇，
   * 而不是在资料库里留下两篇标题相近的副本。旧活动引用的是自己的冻结快照，不受影响。
   */
  const previousLink = database.connection.prepare('SELECT note_id FROM research_note_links WHERE project_id=? ORDER BY created_at DESC LIMIT 1').get(project.id) as { note_id: string } | undefined;

  const now = nowIso();
  const sources = evidence.slice(0, 30).map((item) => ({
    id: item.id, kind: 'narrative' as const, providerId: item.providerId, work: workTitle,
    externalKey: item.targetId, title: item.locator, excerpt: item.quoteSnapshot.slice(0, 4_000),
    locator: { workId: item.workId, targetType: item.targetType, targetId: item.targetId, ...(item.nodeId ? { nodeId: item.nodeId } : {}) },
    retrievedAt: item.createdAt, contentHash: item.contentHash,
  }));

  const refs = collectRefs(claims, workTitle);
  const knowledge = {
    schemaVersion: 1 as const, works: refs.works, characters: refs.characters, locations: refs.locations,
    category: 'plot' as const, nature, authorship: 'ai-organized' as const, usage: 'reference' as const,
    sources,
    origin: { kind: 'research' as const, refId: project.id, label: project.title, note: `研究专题「${project.title}」第 ${draft.revision} 版总稿`, createdAt: now },
    contentRevision: draft.revision,
    contentHash: stableHash(blocks),
  };

  const noteId = input.noteId ?? previousLink?.note_id ?? randomUUID();
  const existingNote = database.connection.prepare('SELECT revision FROM creative_notes WHERE id=?').get(noteId) as { revision: number } | undefined;
  database.transaction(() => {
    if (existingNote) {
      database.connection.prepare('UPDATE creative_notes SET title=?,summary=?,content_json=?,tags_json=?,stage=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(title, draft.summary.slice(0, 400), JSON.stringify(blocks), JSON.stringify(['剧情研究', workTitle].filter(Boolean)), 'reference', now, noteId);
    } else {
      database.connection.prepare(`INSERT INTO creative_notes (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
        VALUES (?,?,'story',?,?,?,'reference',0,?,?,1)`)
        .run(noteId, title, draft.summary.slice(0, 400), JSON.stringify(blocks), JSON.stringify(['剧情研究', workTitle].filter(Boolean)), now, now);
    }
    database.connection.prepare(`INSERT INTO note_knowledge
      (note_id,nature,authorship,usage,category,works_json,characters_json,locations_json,sources_json,origin_json,content_hash,content_revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(note_id) DO UPDATE SET nature=excluded.nature,authorship=excluded.authorship,usage=excluded.usage,
        category=excluded.category,works_json=excluded.works_json,characters_json=excluded.characters_json,
        locations_json=excluded.locations_json,sources_json=excluded.sources_json,origin_json=excluded.origin_json,
        content_hash=excluded.content_hash,content_revision=excluded.content_revision,updated_at=excluded.updated_at`)
      .run(noteId, nature, 'ai-organized', 'reference', 'plot', JSON.stringify(refs.works), JSON.stringify(refs.characters),
        JSON.stringify(refs.locations), JSON.stringify(sources), JSON.stringify(knowledge.origin), knowledge.contentHash, draft.revision, now, now);
    database.connection.prepare('INSERT INTO research_note_links(publish_key,project_id,note_id,run_id,draft_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(publishKey, project.id, noteId, draft.runId, draft.id, now);
  });
  store.updateDraft(draft.id, { status: 'published' });
  store.setProjectPublishedNote(project.id, noteId);
  return { noteId, created: !existingNote, revision: draft.revision, nature, href: `/apps/notebook/${noteId}` };
}
