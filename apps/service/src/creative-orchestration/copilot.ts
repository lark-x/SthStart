import type {
  WorldChapterCopilotRequest,
  WorldChapterCopilotResponse,
  WorldCopilotIssue,
  WorldHub,
  StoryDocument,
  WorldManuscriptCreateDoc,
  WorldManuscriptDeleteResponse,
  WorldManuscriptDocResponse,
  WorldManuscriptSaveDoc,
} from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import { executeTextLlm, parseCommonAiJson } from '../llm/common-llm.js';
import { resolveEffectiveModelProfile, resolveProfile } from '../providers.js';
import type { SecretStore } from '../security.js';
import { StoryError, StoryStore } from '../story/store.js';
import { StoryWorldError, StoryWorldStore } from '../story-worlds/store.js';
import { getWorldHub, summarizeDoc } from './hub.js';

function ensureProjectBindingsTable(database: ServiceDatabase): void {
  database.connection.exec(`
    CREATE TABLE IF NOT EXISTS sw_project_bindings (
      project_id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sw_project_bindings_branch ON sw_project_bindings(branch_id);
  `);
}

function rethrowStoryError(error: unknown): never {
  if (error instanceof StoryError) {
    throw new StoryWorldError(error.code, error.statusCode, error.message);
  }
  throw error;
}

/**
 * 在作品工作台内为指定世界创建手稿文档（自动复用或创建并绑定创作项目）。
 */
export function createWorldManuscriptDocument(
  database: ServiceDatabase,
  worldId: string,
  input: WorldManuscriptCreateDoc,
  options: { requireExplicitProject?: boolean; onCreated?: (document: StoryDocument) => void } = {},
): WorldManuscriptDocResponse {
  const worldStore = new StoryWorldStore(database);
  ensureProjectBindingsTable(database);
  const storyStore = new StoryStore(database);

  return database.transaction(() => {
    const overview = worldStore.overview(worldId);
    const branch = input.branchId
      ? worldStore.getBranch(worldId, input.branchId)
      : (overview.branches[0] ?? worldStore.createBranch(worldId, {
          expectedRevision: overview.world.revision,
          title: '主线分支',
          mode: 'canon-gap',
          direction: '',
        }));
    let projectId: string | null = null;
    if (input.projectId) {
      const matched = database.connection.prepare(
        'SELECT project_id FROM sw_project_bindings WHERE project_id=? AND world_id=?',
      ).get(input.projectId, worldId) as { project_id: string } | undefined;
      if (matched && storyStore.getProject(matched.project_id)) {
        projectId = matched.project_id;
      }
      if (!projectId && options.requireExplicitProject) {
        throw new StoryWorldError('manuscript_project_mismatch', 404, '未找到归属该作品的创作手稿项目。');
      }
    }

    if (!projectId) {
      const boundRows = database.connection.prepare(
        `SELECT b.project_id FROM sw_project_bindings b JOIN story_projects p ON p.id=b.project_id
         WHERE b.world_id=? ORDER BY b.updated_at DESC`,
      ).all(worldId) as Array<{ project_id: string }>;
      if (options.requireExplicitProject && boundRows.length > 1) {
        throw new StoryWorldError('manuscript_project_required', 409, '该作品关联多份创作手稿，请选择收入哪一份。');
      }
      projectId = boundRows[0]?.project_id ?? null;
    }

    if (!projectId) {
      const createdProject = storyStore.createProject({
        title: `${overview.world.title} · 创作手稿`,
        summary: overview.world.summary.slice(0, 500),
        workId: overview.world.title,
        projectType: 'fiction',
      });
      const now = nowIso();
      database.connection.prepare(`
        INSERT INTO sw_project_bindings (project_id, world_id, branch_id, source_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(createdProject.id, worldId, branch.id, branch.sourceRevision ?? 1, now, now);
      projectId = createdProject.id;
    }

    try {
      const createdDoc = storyStore.createDocument(projectId, {
        kind: input.kind ?? 'chapter',
        title: input.title.trim(),
        body: input.body ?? '',
      }, options.onCreated);
      return {
        projectId,
        document: summarizeDoc(createdDoc),
      };
    } catch (error) {
      rethrowStoryError(error);
    }
  });
}

/**
 * 在作品工作台内按乐观锁版本保存指定手稿文档，保留 409 版本冲突状态码。
 */
export function saveWorldManuscriptDocument(
  database: ServiceDatabase,
  worldId: string,
  docId: string,
  input: WorldManuscriptSaveDoc,
): WorldManuscriptDocResponse {
  const worldStore = new StoryWorldStore(database);
  const world = worldStore.overview(worldId).world;
  ensureProjectBindingsTable(database);
  const storyStore = new StoryStore(database);

  const project = storyStore.getProject(input.projectId);
  const binding = database.connection.prepare(
    'SELECT 1 FROM sw_project_bindings WHERE project_id=? AND world_id=?',
  ).get(input.projectId, worldId);

  if (!project || (!binding && project.workId !== world.title)) {
    throw new StoryWorldError('manuscript_project_mismatch', 404, '未找到归属该作品的创作手稿项目。');
  }

  if (!storyStore.getDocument(input.projectId, docId)) {
    throw new StoryWorldError('manuscript_document_not_found', 404, '未找到指定章节手稿。');
  }

  try {
    const updated = storyStore.updateDocument(input.projectId, docId, {
      expectedRevision: input.expectedRevision,
      title: input.title,
      body: input.body,
    });
    return {
      projectId: input.projectId,
      document: summarizeDoc(updated),
    };
  } catch (error) {
    rethrowStoryError(error);
  }
}

/**
 * 在作品工作台内删除指定的章节或场景手稿（主线大纲与世界设定受保护禁止删除）。
 */
export function deleteWorldManuscriptDocument(
  database: ServiceDatabase,
  worldId: string,
  docId: string,
  projectId?: string,
): WorldManuscriptDeleteResponse {
  const worldStore = new StoryWorldStore(database);
  const world = worldStore.overview(worldId).world;
  ensureProjectBindingsTable(database);
  const storyStore = new StoryStore(database);

  let resolvedProjectId: string | null = null;
  let targetDoc = null as ReturnType<StoryStore['getDocument']>;

  if (projectId) {
    const project = storyStore.getProject(projectId);
    const binding = database.connection.prepare(
      'SELECT 1 FROM sw_project_bindings WHERE project_id=? AND world_id=?',
    ).get(projectId, worldId);
    if (!project || (!binding && project.workId !== world.title)) {
      throw new StoryWorldError('manuscript_project_mismatch', 404, '未找到归属该作品的创作手稿项目。');
    }
    targetDoc = storyStore.getDocument(projectId, docId);
    if (targetDoc) resolvedProjectId = projectId;
  } else {
    const boundRows = database.connection.prepare(`
      SELECT project_id AS id FROM sw_project_bindings WHERE world_id=?
      UNION
      SELECT id FROM story_projects WHERE project_type='fiction' AND work_id=?
    `).all(worldId, world.title) as Array<{ id: string }>;
    for (const row of boundRows) {
      const candidate = storyStore.getDocument(row.id, docId);
      if (candidate) {
        resolvedProjectId = row.id;
        targetDoc = candidate;
        break;
      }
    }
  }

  if (!resolvedProjectId || !targetDoc) {
    throw new StoryWorldError('manuscript_document_not_found', 404, '未找到指定章节手稿。');
  }

  if (targetDoc.kind !== 'chapter' && targetDoc.kind !== 'scene') {
    throw new StoryWorldError(
      'manuscript_document_protected',
      400,
      '仅允许删除章节或场景手稿，不能删除主线大纲或世界设定。',
    );
  }

  const now = nowIso();
  return database.transaction(() => {
    database.connection.prepare(
      'DELETE FROM story_entry_revisions WHERE project_id=? AND entry_kind=? AND entry_id=?',
    ).run(resolvedProjectId!, targetDoc!.kind, docId);
    database.connection.prepare(
      "UPDATE story_proposals SET status='rejected', decided_at=? WHERE project_id=? AND target_id=? AND status='pending'",
    ).run(now, resolvedProjectId!, docId);
    database.connection.prepare(
      'DELETE FROM story_documents WHERE project_id=? AND id=?',
    ).run(resolvedProjectId!, docId);
    database.connection.prepare("DELETE FROM artifact_references WHERE app_id='creative-center' AND ref_type='story-document' AND ref_id=?").run(docId);
    database.connection.prepare(
      'UPDATE story_projects SET revision=revision+1, updated_at=? WHERE id=?',
    ).run(now, resolvedProjectId!);
    return {
      projectId: resolvedProjectId!,
      deletedId: docId,
    };
  });
}

function buildCopilotContext(hub: WorldHub, input: WorldChapterCopilotRequest): string {
  const definition = hub.definition ?? {
    title: hub.world.title,
    summary: hub.world.summary,
    timeLabel: hub.world.timeLabel,
    locations: hub.world.locations,
    actors: hub.world.actors,
    lockedFacts: hub.world.lockedFacts,
  };

  const arc = input.arcId
    ? hub.storyLines.find((item) => item.id === input.arcId)
    : undefined;

  const selectedLocationId = input.locationId ?? arc?.locationIds?.[0];
  const location = selectedLocationId
    ? definition.locations.find((item) => item.id === selectedLocationId)
    : undefined;

  const requestedActorIds = input.actorIds?.length
    ? input.actorIds
    : (arc?.actorIds ?? []);
  const actors = requestedActorIds.length > 0
    ? definition.actors.filter((actor) => requestedActorIds.includes(actor.id))
    : definition.actors.slice(0, 4);

  const voices = hub.scopePolicy?.characterVoices ?? {};
  const styleGuide = hub.scopePolicy?.styleGuide;
  const lockedFacts = (definition.lockedFacts ?? []).slice(0, 15);

  const sections: string[] = [];

  sections.push([
    '## 作品与时间背景',
    `- 作品名称：${hub.world.title}`,
    `- 时间标签：${definition.timeLabel || '未指定'}`,
    hub.activeBranch ? `- 当前分支：${hub.activeBranch.title}（${hub.activeBranch.mode}）` : '',
    definition.summary ? `- 世界简介：${definition.summary.slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n'));

  if (lockedFacts.length > 0) {
    sections.push([
      '## 不可违背的锁定设定（Locked Facts）',
      ...lockedFacts.map((fact) => `- ${fact}`),
    ].join('\n'));
  }

  if (arc || input.chapterTitle) {
    sections.push([
      '## 当前章节与篇章脉络',
      input.chapterTitle ? `- 目标章节标题：${input.chapterTitle}` : '',
      arc ? `- 所属篇章：${arc.title}${arc.chapterCode ? ` [${arc.chapterCode}]` : ''}` : '',
      arc?.timeWindowLabel ? `- 时间窗口：${arc.timeWindowLabel}` : '',
      arc?.description ? `- 篇章梗概：${arc.description}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (location) {
    sections.push([
      '## 场景舞台',
      `- 地点：${location.name}${location.region ? `（${location.region}）` : ''}`,
      location.description ? `- 环境描写要点：${location.description}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (actors.length > 0) {
    const actorBlocks = actors.map((actor) => {
      const card = hub.characterCards.find(
        (item) => item.id === actor.characterId || item.displayName === actor.name,
      );
      const voice = voices[actor.id]
        ?? voices[actor.name]
        ?? (actor.characterId ? voices[actor.characterId] : undefined)
        ?? (card ? voices[card.displayName] : undefined);

      const lines = [
        `### ${actor.name}（${actor.role === 'main' ? '主要角色' : '配角'}）`,
        actor.personality ? `- 性格特征：${actor.personality}` : '',
        actor.speechStyle ? `- 说话风格：${actor.speechStyle}` : '',
        actor.goals.length > 0 ? `- 当前目标：${actor.goals.join('；')}` : '',
        card?.personaText ? `- 权威人设：${card.personaText.slice(0, 1000)}` : '',
        card?.speechText ? `- 语感说明：${card.speechText.slice(0, 600)}` : '',
        card?.behaviorRules ? `- 行为边界：${card.behaviorRules.slice(0, 600)}` : '',
        card?.dialogueExamples?.length
          ? `- 典型台词示例：${card.dialogueExamples.slice(0, 4).map((d) => `「${d}」`).join(' / ')}`
          : '',
        voice?.voiceSamples?.length
          ? `- 声纹样本：${voice.voiceSamples.slice(0, 4).map((v) => `「${v}」`).join(' / ')}`
          : '',
        voice?.mannerisms ? `- 习惯动作/口癖：${voice.mannerisms}` : '',
        voice?.taboos?.length ? `- 角色禁区（绝不可违背）：${voice.taboos.join('；')}` : '',
      ];
      return lines.filter(Boolean).join('\n');
    });
    sections.push(['## 出场角色与声纹约束', ...actorBlocks].join('\n\n'));
  }

  sections.push([
    '## 文风与写作铁律',
    styleGuide?.tone ? `- 叙事基调：${styleGuide.tone}` : '',
    styleGuide?.pacingHint ? `- 节奏提示：${styleGuide.pacingHint}` : '',
    styleGuide?.bannedCliches?.length ? `- 禁用陈词/套话：${styleGuide.bannedCliches.join('、')}` : '',
    styleGuide?.styleSample ? `- 参考文风样本：\n${styleGuide.styleSample.slice(0, 1500)}` : '',
    '- 严格践行 Show, Don\'t Tell：通过具体动作、神态、环境细节与潜台词对话展现情绪和冲突，避免空泛情绪概括。',
    '- 严禁说教式或强行升华式结尾：章末须停留在真实动作、具体画面或叙事悬念上，不要总结人生道理。',
  ].filter(Boolean).join('\n'));

  if (input.references?.length) {
    sections.push([
      '## 固定参考原文摘录（Reference Basket）',
      ...input.references.map((ref, idx) => [
        `### 参考 ${idx + 1}：${ref.title}${ref.locator ? `（${ref.locator}）` : ''}`,
        ref.excerpt.slice(0, 4000),
      ].join('\n')),
    ].join('\n\n'));
  }

  if (input.beats?.length) {
    sections.push([
      '## 已确认的场纲节拍（Beats）',
      ...input.beats.map((beat, idx) => `${idx + 1}. ${beat}`),
    ].join('\n'));
  }

  if (input.instruction?.trim()) {
    sections.push(`## 作者具体指令\n${input.instruction.trim()}`);
  }

  if (input.existingBody?.trim()) {
    sections.push(`## 当前已有正文手稿\n${input.existingBody.trim().slice(0, 60_000)}`);
  }

  return sections.join('\n\n');
}

function parseBeatsOutput(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^```/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*•]+|\d+[.、)）])\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 12)
    .map((line) => line.slice(0, 1000));

  if (lines.length === 0 && raw.trim()) {
    return [raw.trim().slice(0, 1000)];
  }
  return lines;
}

function stripOuterCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:markdown|md|txt)?\r?\n([\s\S]*?)\r?\n```$/i);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

const VALID_ISSUE_CATEGORIES = new Set<WorldCopilotIssue['category']>(['canon', 'tom', 'voice', 'style']);

function parseCheckOutput(raw: string): {
  issues: WorldCopilotIssue[];
  extractedFacts: string[];
} {
  try {
    const parsed = parseCommonAiJson<Record<string, unknown>>(raw);
    const hasStructuredKeys = Array.isArray(parsed.issues) || Array.isArray(parsed.extractedFacts);
    if (!hasStructuredKeys) {
      const detail = raw.trim().slice(0, 2000);
      return {
        issues: detail ? [{ severity: 'suggestion', category: 'style', detail }] : [],
        extractedFacts: [],
      };
    }

    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues: WorldCopilotIssue[] = [];
    for (const entry of rawIssues) {
      if (typeof entry === 'string' && entry.trim()) {
        issues.push({
          severity: 'suggestion',
          category: 'style',
          detail: entry.trim().slice(0, 2000),
        });
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const detail = String(rec.detail ?? rec.message ?? rec.description ?? '').trim().slice(0, 2000);
      if (!detail) continue;
      const severity: WorldCopilotIssue['severity'] = rec.severity === 'warning' ? 'warning' : 'suggestion';
      const rawCat = String(rec.category ?? 'style') as WorldCopilotIssue['category'];
      const category: WorldCopilotIssue['category'] = VALID_ISSUE_CATEGORIES.has(rawCat) ? rawCat : 'style';
      const quote = typeof rec.quote === 'string' && rec.quote.trim()
        ? rec.quote.trim().slice(0, 500)
        : undefined;
      issues.push({
        severity,
        category,
        ...(quote ? { quote } : {}),
        detail,
      });
    }

    const rawFacts = Array.isArray(parsed.extractedFacts) ? parsed.extractedFacts : [];
    const extractedFacts = rawFacts
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter(Boolean)
      .map((item) => item.slice(0, 1000));

    return { issues, extractedFacts };
  } catch {
    const detail = raw.trim().slice(0, 2000);
    return {
      issues: detail ? [{ severity: 'suggestion', category: 'style', detail }] : [],
      extractedFacts: [],
    };
  }
}

function parseTurnOutput(raw: string): { prose: string; choices: string[] } {
  const parsed = parseCommonAiJson<Record<string, unknown>>(raw);
  const prose = String(parsed.prose ?? parsed.scene ?? '').trim().slice(0, 100_000);
  const choices = Array.isArray(parsed.choices)
    ? parsed.choices.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 2).map((item) => item.slice(0, 500))
    : [];
  if (!prose || choices.length !== 2) {
    throw Object.assign(new Error('互动推演输出缺少场景正文或两条有效选项。'), {
      statusCode: 502,
      code: 'copilot_turn_invalid',
    });
  }
  return { prose, choices };
}

/**
 * 作品工作台轻量章节写作助手：支持节拍规划（beats）、纯文本起草（draft）、润色续写（polish）与事后非阻断体检（check）。
 */
export async function runWorldChapterCopilot(
  database: ServiceDatabase,
  secrets: SecretStore,
  worldId: string,
  input: WorldChapterCopilotRequest,
  fetcher?: typeof fetch,
): Promise<WorldChapterCopilotResponse> {
  const hub = getWorldHub(database, worldId, input.branchId);

  if (input.mode === 'check' && !input.existingBody?.trim()) {
    throw new StoryWorldError('copilot_body_required', 400, '请先提供需要体检的正文内容。');
  }

  const profile =
    (await resolveEffectiveModelProfile(database, secrets, 'story-worlds'))
    ?? (await resolveProfile(database, secrets, 'llm'));

  if (!profile) {
    throw Object.assign(
      new Error('尚未配置可用的文本大模型，请先在「系统设置 → 模型与连接」中配置并启用聊天模型。'),
      { statusCode: 503, code: 'copilot_model_unavailable' },
    );
  }

  const contextPrompt = buildCopilotContext(hub, input);
  let modelUsed = profile.model?.trim() || profile.name || 'unknown';
  const audit = {
    database,
    applicationId: 'story-worlds',
    feature: 'chapter-copilot',
    businessEvent: input.mode,
    objectType: 'story_world',
    objectId: worldId,
  };

  if (input.mode === 'beats') {
    const raw = await executeTextLlm({
      profile,
      systemPrompt: '你是资深中文叙事策划与小说编辑，擅长把世界观设定与角色张力拆解为紧凑可拍的场景节拍。',
      prompt: `${contextPrompt}\n\n---\n请为本章节规划 4 到 6 条简洁的编号 Markdown 场纲节拍（仅输出 1. ~ 6. 编号行，每条交代出场冲突、行动转折或关键伏笔，不要输出 JSON 或多余开场白）。`,
      jsonMode: false,
      maxTokens: 1500,
      fetchFn: fetcher,
      audit,
      onResult: (result) => {
        if (result.model) modelUsed = result.model;
      },
    });

    return {
      mode: 'beats',
      modelUsed: modelUsed.slice(0, 200),
      beats: parseBeatsOutput(raw),
      choices: [],
      prose: '',
      issues: [],
      extractedFacts: [],
    };
  }

  if (input.mode === 'turn') {
    const action = input.action?.trim();
    if (!action && !input.existingBody?.trim()) {
      throw new StoryWorldError('copilot_turn_context_required', 400, '请先写下一个人物、情境或开场念头。');
    }
    const raw = await executeTextLlm({
      profile,
      systemPrompt: '你是互动小说的场景主持人。由作者提供核心人物、处境和行动方向，你负责呈现人物有自主性的现场反应，并把下一步决定留给作者。不得替作者规划整部故事或擅自定下长期主线。',
      prompt: `${contextPrompt}\n\n---\n请只推进当前这一回合。${action ? `作者本回合选择的行动是：${action}` : '这是开场回合，请从作者提供的方向切入一个具体现场。'}\n人物的回应须结合其目标、性格和已知信息，情节只能建立在现有世界设定和前文之上。场景停在新的行动门槛，给出两条方向明显不同且都可执行的下一步选择，不替作者选择，也不提前收束。\n严格只输出下列 JSON，不附解释：\n{"prose":"当前场景正文，约 150 到 500 字，写动作、感受和对话，不写创作说明","choices":["下一步行动选项 A，具体且可执行","与 A 走向不同的行动选项 B，具体且可执行"]}`,
      jsonMode: true,
      maxTokens: 1800,
      fetchFn: fetcher,
      audit: { ...audit, businessEvent: action ? 'turn' : 'turn-start' },
      onResult: (result) => {
        if (result.model) modelUsed = result.model;
      },
    });
    const turn = parseTurnOutput(raw);
    return {
      mode: 'turn',
      modelUsed: modelUsed.slice(0, 200),
      beats: [],
      prose: turn.prose,
      choices: turn.choices,
      issues: [],
      extractedFacts: [],
    };
  }

  if (input.mode === 'draft' || input.mode === 'polish') {
    const targetWordCount = input.targetWordCount ?? 2200;
    const maxTokens = Math.min(Math.max(targetWordCount * 2, 3200), 8000);
    const taskPrompt = input.mode === 'draft'
      ? `请严格根据以上设定、角色声纹、参考原文与场纲节拍，撰写约 ${targetWordCount} 字的章节正文。`
      : `请严格对照以上设定与角色声纹，对「当前已有正文手稿」进行润色打磨或顺畅续写（目标体量约 ${targetWordCount} 字），重点强化镜头感、对话口吻与节奏张力。`;

    const raw = await executeTextLlm({
      profile,
      systemPrompt: '你是中文文学小说作家。你只输出纯净的文学 Markdown 正文，绝不输出 JSON、代码块围栏（```）、结构标签、写作说明或与作者对话的元话语。',
      prompt: `${contextPrompt}\n\n---\n${taskPrompt}\n硬性输出要求：只输出纯文学 Markdown 正文，禁止输出 JSON、禁止使用 \`\`\` 代码块包裹、禁止添加开场白或结语。`,
      jsonMode: false,
      maxTokens,
      fetchFn: fetcher,
      audit,
      onResult: (result) => {
        if (result.model) modelUsed = result.model;
      },
    });

    return {
      mode: input.mode,
      modelUsed: modelUsed.slice(0, 200),
      beats: [],
      choices: [],
      prose: stripOuterCodeFence(raw).slice(0, 100_000),
      issues: [],
      extractedFacts: [],
    };
  }

  const raw = await executeTextLlm({
    profile,
    systemPrompt: '你是严谨的作品设定与人设审校编辑，负责对草稿进行非阻断式一致性体检并提取新确立事实。',
    prompt: `${contextPrompt}\n\n---\n请检查「当前已有正文手稿」是否存在以下四类问题：\n- canon：与锁定设定（Locked Facts）或参考原文矛盾\n- tom：角色信息差泄漏（说出或知道其尚未目击/获知的信息）\n- voice：角色口吻、动作习惯或禁区违背\n- style：Tell-don't-show 概括说教、禁用套话或升华式结尾\n\n请只输出一个紧凑 JSON 对象：\n{"issues":[{"severity":"warning"|"suggestion","category":"canon"|"tom"|"voice"|"style","quote":"原文片段","detail":"问题描述与改写建议"}],"extractedFacts":["本章新确立的剧情事实"]}`,
    jsonMode: true,
    maxTokens: 2000,
    fetchFn: fetcher,
    audit,
    onResult: (result) => {
      if (result.model) modelUsed = result.model;
    },
  });

  const checked = parseCheckOutput(raw);
  return {
    mode: 'check',
    modelUsed: modelUsed.slice(0, 200),
    beats: [],
    choices: [],
    prose: '',
    issues: checked.issues,
    extractedFacts: checked.extractedFacts,
  };
}
