import crypto from 'node:crypto';
import { validateGeneratedOutput } from './generation-validation.js';
import type { ContentDocument } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../providers.js';
import { llmNotReadyError, resolveAppLlmBindingStatus } from '../llm-status.js';
import type { ActivityStore } from './store.js';
import {
  buildPlanPrompt,
  buildSnippetPrompt,
  buildStagePrompt,
  buildRewritePrompt,
  parseAiJsonOutput,
  type SnippetMode,
  type PlanGenerationOutput,
  type StageGenerationOutput,
} from './prompts.js';
import { validateSnippetOutput } from './generation-validation.js';

export interface ExecuteJobOptions {
  store: ActivityStore;
  database: ServiceDatabase;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  jobId: string;
  activityId: string;
  mode: string;
  scope: Record<string, unknown>;
  instructions?: string;
  inputSnapshot?: ContentDocument;
}

export async function executeTextJob(options: ExecuteJobOptions): Promise<void> {
  const { store, database, secrets, jobId, activityId, mode, scope, instructions } = options;
  const fetchFn = options.fetcher ?? fetch;

  try {
    const existingJob = store.getJob(activityId, jobId);
    if (existingJob?.status === 'cancelled') {
      return;
    }

    store.updateJob(jobId, { status: 'running' });
    store.appendJobEvent(jobId, activityId, 'started', { mode });

    // 1. Resolve LLM profile（执行前复检：排队期间配置可能变化）
    const bindingStatus = await resolveAppLlmBindingStatus(database, secrets, 'activities', 'text');
    const profile = bindingStatus.ready ? await resolveAssignedLlmProfile(database, secrets, 'activities', 'text') : null;
    if (!profile) {
      throw llmNotReadyError(bindingStatus);
    }

    // 2. Fetch input document (prefer frozen snapshot)
    const draft = store.getDraft(activityId);
    const document = options.inputSnapshot || draft?.document;
    if (!document) throw new Error('活动文档不存在');

    let prompt = '';
    let snippetMode: SnippetMode | null = null;
    if (mode === 'plan') {
      prompt = buildPlanPrompt(document, instructions);
    } else if (mode === 'stage') {
      const stageId = String(scope.stageId || document.stages[0]?.id);
      const stage = document.stages.find((s) => s.id === stageId);
      if (!stage) throw new Error(`阶段 ${stageId} 未找到`);
      prompt = buildStagePrompt(document, stage, instructions);
    } else if (mode === 'invite' || mode === 'wish' || mode === 'moment' || mode === 'shot') {
      const stageId = String(scope.stageId || document.stages[0]?.id);
      const stage = document.stages.find((s) => s.id === stageId);
      if (!stage) throw new Error(`阶段 ${stageId} 未找到`);
      snippetMode = mode;
      prompt = buildSnippetPrompt(document, stage, mode, scope, instructions);
    } else if (mode === 'rewrite-records') {
      const recordIds = (scope.recordIds as string[]) || [];
      const reason = instructions || '优化对白';
      prompt = buildRewritePrompt(document, recordIds, reason);
    } else if (mode === 'whole-text') {
      const precedingStages: StageGenerationOutput[] = [];
      // Whole text sequentially generates each stage
      for (let i = 0; i < document.stages.length; i++) {
        const check = store.getJob(activityId, jobId);
        if (check?.status === 'cancelled') return;

        const currentStage = document.stages[i];
        store.appendJobEvent(jobId, activityId, 'stage_progress', { stageIndex: i, stageId: currentStage.id });
        const stPrompt = buildStagePrompt(document, currentStage, instructions) +
          '\n【本批已生成的前序阶段（尚未采用，后续必须保持事实连续；clientId 仅在各阶段内有效）】\n' + JSON.stringify(precedingStages);
        const stResp = await callLlm(profile, stPrompt, fetchFn);
        const stOutput = parseAiJsonOutput<StageGenerationOutput>(stResp);
        validateGeneratedOutput(stOutput, document, 'stage', currentStage.id);
        precedingStages.push(stOutput);
        const candidate = store.createCandidate({
          activityId,
          baseRevisionId: draft?.baseContentRevisionId || null,
          draftVersion: draft?.draftVersion || 1,
          scope: { stageId: currentStage.id, batchIndex: i, mode: 'stage', batchSize: document.stages.length },
          payload: stOutput as unknown as Record<string, unknown>,
          validation: { valid: true },
        });
        const currentJob = store.getJob(activityId, jobId);
        const candidateIds = [...(currentJob?.resultCandidateIds || []), candidate.id];
        store.updateJob(jobId, { resultCandidateIds: candidateIds });
      }

      const finalCheck = store.getJob(activityId, jobId);
      if (finalCheck?.status === 'cancelled') return;

      store.updateJob(jobId, {
        status: 'succeeded',
        modelMetadata: { model: profile.model, profileId: profile.id },
      });
      store.appendJobEvent(jobId, activityId, 'succeeded', {});
      return;
    } else {
      throw new Error(`未知生成模式: ${mode}`);
    }

    // Call LLM
    // 取消时通过 AbortSignal 尝试终止请求，避免迟到结果被采纳。
    const abortController = new AbortController();
    const cancelWatch = setInterval(() => {
      const latest = store.getJob(activityId, jobId);
      if (latest?.status === 'cancelled') abortController.abort();
    }, 1_000);
    if (typeof (cancelWatch as { unref?: () => void }).unref === 'function') (cancelWatch as unknown as { unref: () => void }).unref();
    let llmResponse: string;
    try {
      llmResponse = await callLlm(profile, prompt, fetchFn, abortController.signal);
    } finally {
      clearInterval(cancelWatch);
    }

    const checkMid = store.getJob(activityId, jobId);
    if (checkMid?.status === 'cancelled') return;

    // Parse & Validate
    const parsedPayload = parseAiJsonOutput<Record<string, unknown>>(llmResponse);
    const targetStageId = String(scope.stageId || document.stages[0]?.id || '');
    if (snippetMode) {
      validateSnippetOutput(parsedPayload, document, targetStageId, snippetMode);
    } else {
      validateGeneratedOutput(parsedPayload, document, mode, mode === 'stage' ? targetStageId : undefined);
    }

    // Create Candidate
    const candidate = store.createCandidate({
      activityId,
      baseRevisionId: draft?.baseContentRevisionId || null,
      draftVersion: draft?.draftVersion || 1,
      scope: { ...scope, mode },
      payload: parsedPayload,
      validation: { valid: true },
    });

    store.updateJob(jobId, {
      status: 'succeeded',
      resultCandidateIds: [candidate.id],
      modelMetadata: { model: profile.model, profileId: profile.id },
    });
    store.appendJobEvent(jobId, activityId, 'succeeded', { candidateId: candidate.id });
  } catch (err) {
    const currentJob = store.getJob(activityId, jobId);
    if (currentJob?.status === 'cancelled') return;
    const msg = (err as Error).message;
    store.updateJob(jobId, { status: 'failed', errorMessage: msg });
    store.appendJobEvent(jobId, activityId, 'failed', { error: msg });
  }
}

export async function callLlm(
  profile: NonNullable<Awaited<ReturnType<typeof resolveAssignedLlmProfile>>>,
  prompt: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<string> {
  const url = `${profile.baseUrl}/chat/completions`;
  const headers = upstreamHeaders(profile.secret, true);
  if (profile.headers) {
    Object.assign(headers, profile.headers);
  }

  // 核心字段在 extraBody 之后写入，供应商配置不能覆盖 model/messages。
  const payload: Record<string, unknown> = {
    ...profile.extraBody,
    model: profile.model || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an expert story director and screenwriter.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  };

  const resp = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 供应商响应错误 [${resp.status}]: ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM 供应商返回内容为空');
  }

  return content;
}

/**
 * Adopts an AI-generated candidate into the activity draft or directly into a revision.
 */
export function adoptCandidateIntoDocument(
  currentDoc: ContentDocument,
  candidatePayload: Record<string, unknown>,
  scope: Record<string, unknown>
): ContentDocument {
  const updatedDoc: ContentDocument = JSON.parse(JSON.stringify(currentDoc));

  // If candidate is a plan
  if (Array.isArray(candidatePayload.stages)) {
    const plan = candidatePayload as unknown as PlanGenerationOutput;
    const existingStages = currentDoc.stages || [];
    const existingById = new Map(existingStages.map((s) => [s.id, s]));
    const lockedByOrder = new Map(existingStages.filter((s) => s.locked).map((s) => [s.order, s]));

    const mergedStages = plan.stages.map((s, idx) => {
      const order = idx + 1;
      // 锁定阶段按稳定 ID 保护；模型未回传 ID 时才退回顺序匹配。
      const matched = s.stageId ? existingById.get(s.stageId) : undefined;
      if (matched?.locked) return { ...matched };
      const locked = !matched ? lockedByOrder.get(order) : undefined;
      if (locked) return { ...locked };
      return {
        id: matched?.id || s.stageId || `stage_${order}`,
        title: s.title,
        order,
        actorIds: s.actorIds && s.actorIds.length > 0 ? s.actorIds : updatedDoc.actors.map((a) => a.id),
        location: s.location || updatedDoc.activity.location,
        instruction: s.description,
        requiredBeats: (s.requiredBeats || []).map((text, bIdx) => ({
          id: `beat_${order}_${bIdx + 1}`,
          text,
          actorIds: s.actorIds || [],
        })),
        locked: false,
        endCondition: s.endCondition || '',
      };
    });

    // Retain any higher-order locked stages
    for (const [order, locked] of lockedByOrder.entries()) {
      if (!mergedStages.some((m) => m.order === order)) {
        mergedStages.push({ ...locked });
      }
    }
    mergedStages.sort((a, b) => a.order - b.order);
    updatedDoc.stages = mergedStages;

    // Any plan change requires downstream review of all stage results
    if (updatedDoc.stageResults && updatedDoc.stageResults.length > 0) {
      updatedDoc.stageResults = updatedDoc.stageResults.map((sr) => ({
        ...sr,
        reviewState: 'needs_review' as const,
      }));
    }

    return updatedDoc;
  }

  // If candidate is a stage detail
  if (candidatePayload.stageId || scope.stageId || Array.isArray(candidatePayload.messages)) {
    const stageOut = candidatePayload as unknown as StageGenerationOutput;
    const stageId = String(scope.stageId || stageOut.stageId || currentDoc.stages[0]?.id || 'stage_1');

    // Map clientId to real UUID
    const clientIdMap = new Map<string, string>();
    const getOrAssignId = (clientId: string, prefix = 'rec'): string => {
      if (!clientIdMap.has(clientId)) {
        clientIdMap.set(clientId, `${prefix}_${crypto.randomUUID().slice(0, 8)}`);
      }
      return clientIdMap.get(clientId)!;
    };

    // 快捷文案入口（邀请 / 祝福 / 朋友圈 / 配图）是追加写入；阶段生成则替换该阶段内容。
    const appendOnly = String(scope.mode || '') === 'invite' || String(scope.mode || '') === 'wish'
      || String(scope.mode || '') === 'moment' || String(scope.mode || '') === 'shot';
    if (!appendOnly) {
      const removedPostIds = new Set(updatedDoc.posts.filter((p) => p.stageId === stageId).map((p) => p.id));
      updatedDoc.posts = updatedDoc.posts.filter((p) => p.stageId !== stageId);
      if (removedPostIds.size) {
        // 帖子被替换时同步清理评论与点赞，避免出现悬空引用。
        updatedDoc.comments = updatedDoc.comments.filter((c) => !removedPostIds.has(c.postId));
        updatedDoc.likes = updatedDoc.likes.filter((l) => !removedPostIds.has(l.postId));
      }
      updatedDoc.messages = updatedDoc.messages.filter((m) => m.stageId !== stageId);
      updatedDoc.facts = updatedDoc.facts.filter((f) => f.stageId !== stageId);
      updatedDoc.mediaSlots = updatedDoc.mediaSlots.filter((s) => s.stageId !== stageId);
    }

    // Add media slots
    for (const slot of stageOut.mediaSlots || []) {
      const realSlotId = getOrAssignId(slot.clientId, 'slot');
      updatedDoc.mediaSlots.push({
        id: realSlotId,
        stageId,
        kind: slot.kind,
        caption: slot.caption,
        shotDescription: slot.shotDescription,
        actorIds: slot.actorIds || [],
        sourceFactIds: [],
      });
    }

    // Add messages
    for (const msg of stageOut.messages || []) {
      const realMsgId = getOrAssignId(msg.clientId, 'msg');
      const mediaSlotIds = (msg.mediaClientIds || []).map((cid) => getOrAssignId(cid, 'slot'));
      updatedDoc.messages.push({
        id: realMsgId,
        conversationId: msg.conversationId || updatedDoc.conversations[0]?.id || 'group_main',
        stageId,
        kind: 'message',
        speakerActorId: msg.speakerActorId,
        text: msg.text,
        mediaSlotIds,
        storyOrder: msg.order || updatedDoc.messages.length + 1,
        storyTimeLabel: msg.storyTimeLabel,
      });
    }

    // Add posts and comments
    for (const post of stageOut.posts || []) {
      const realPostId = getOrAssignId(post.clientId, 'post');
      const mediaSlotIds = (post.mediaClientIds || []).map((cid) => getOrAssignId(cid, 'slot'));
      updatedDoc.posts.push({
        id: realPostId,
        stageId,
        authorActorId: post.authorActorId,
        text: post.text,
        mediaSlotIds,
        storyOrder: post.order || updatedDoc.posts.length + 1,
        storyTimeLabel: post.storyTimeLabel,
        sourceFactIds: [],
      });

      // Find comments for this post
      const postComments = (stageOut.comments || []).filter((c) => c.postClientId === post.clientId);
      for (const comment of postComments) {
        updatedDoc.comments.push({
          id: `comment_${crypto.randomUUID().slice(0, 8)}`,
          postId: realPostId,
          authorActorId: comment.authorActorId,
          text: comment.text,
          storyOrder: comment.order || updatedDoc.comments.length + 1,
        });
      }
    }

    // Add facts
    for (const fact of stageOut.facts || []) {
      updatedDoc.facts.push({
        id: getOrAssignId(fact.clientId, 'fact'),
        stageId,
        text: fact.text,
        status: fact.status || 'happened',
        sourceRecordIds: (fact.sourceRecordClientIds || []).map((cid) => clientIdMap.get(cid) || cid),
        knownByActorIds: fact.knownByActorIds || [],
      });
    }

    // Add stage result
    const stageResultIdx = updatedDoc.stageResults.findIndex((sr) => sr.stageId === stageId);
    const newStageResult = {
      stageId,
      sourceContextHash: crypto.createHash('sha256').update(JSON.stringify(stageOut)).digest('hex').slice(0, 16),
      // 追加文案时原有纪要仍然有效，只标记为需要复核。
      reviewState: appendOnly ? ('needs_review' as const) : ('ready' as const),
      summary: stageOut.summary || updatedDoc.stageResults.find((sr) => sr.stageId === stageId)?.summary || '阶段记录已生成',
      factIds: (stageOut.facts || []).map((f) => getOrAssignId(f.clientId, 'fact')),
    };
    if (stageResultIdx >= 0) {
      updatedDoc.stageResults[stageResultIdx] = appendOnly
        ? { ...updatedDoc.stageResults[stageResultIdx], reviewState: 'needs_review' as const, factIds: [...new Set([...updatedDoc.stageResults[stageResultIdx].factIds, ...newStageResult.factIds])] }
        : newStageResult;
    } else {
      updatedDoc.stageResults.push(newStageResult);
    }

    // Crucial: When an earlier stage changes, all subsequent stages must be flagged with needs_review
    const currentStage = updatedDoc.stages.find((s) => s.id === stageId);
    const currentOrder = currentStage?.order ?? 1;
    updatedDoc.stageResults = updatedDoc.stageResults.map((sr) => {
      const targetStage = updatedDoc.stages.find((s) => s.id === sr.stageId);
      if (targetStage && (targetStage.order > currentOrder || (appendOnly && targetStage.id === stageId))) {
        return { ...sr, reviewState: 'needs_review' as const };
      }
      return sr;
    });
  }

  // 局部重写：只替换选中记录的文本，不触碰其他内容。
  if (Array.isArray(candidatePayload.rewrittenMessages) || Array.isArray(candidatePayload.rewrittenPosts)) {
    const messageUpdates = new Map(
      (Array.isArray(candidatePayload.rewrittenMessages) ? candidatePayload.rewrittenMessages : [])
        .map((row) => [String((row as Record<string, unknown>).id), String((row as Record<string, unknown>).text || '')]),
    );
    const postUpdates = new Map(
      (Array.isArray(candidatePayload.rewrittenPosts) ? candidatePayload.rewrittenPosts : [])
        .map((row) => [String((row as Record<string, unknown>).id), String((row as Record<string, unknown>).text || '')]),
    );
    updatedDoc.messages = updatedDoc.messages.map((message) => messageUpdates.has(message.id) ? { ...message, text: messageUpdates.get(message.id)! } : message);
    updatedDoc.posts = updatedDoc.posts.map((post) => postUpdates.has(post.id) ? { ...post, text: postUpdates.get(post.id)! } : post);
    const touchedStageIds = new Set([
      ...updatedDoc.messages.filter((message) => messageUpdates.has(message.id)).map((message) => message.stageId),
      ...updatedDoc.posts.filter((post) => postUpdates.has(post.id)).map((post) => post.stageId),
    ]);
    const orderOf = new Map(updatedDoc.stages.map((stage) => [stage.id, stage.order]));
    updatedDoc.stageResults = updatedDoc.stageResults.map((result) => {
      const touchedOrder = Math.min(...[...touchedStageIds].map((id) => orderOf.get(id) ?? Number.MAX_SAFE_INTEGER));
      const resultOrder = orderOf.get(result.stageId) ?? 0;
      return resultOrder >= touchedOrder ? { ...result, reviewState: 'needs_review' as const } : result;
    });
  }

  return updatedDoc;
}

export async function runTextGenerationJob(
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  params: {
    mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text' | 'invite' | 'wish' | 'moment' | 'shot';
    targetRevisionId?: string;
    scope?: Record<string, unknown>;
    userInstruction?: string;
    idempotencyKey?: string;
  },
  fetcher?: typeof fetch,
) {
  // Snapshot input document to isolate from concurrent draft modifications
  let inputSnapshot: ContentDocument | undefined;
  if (params.targetRevisionId) {
    const rev = store.getContentRevision(activityId, params.targetRevisionId);
    if (rev) inputSnapshot = rev.document;
  }
  if (!inputSnapshot) {
    const draft = store.getDraft(activityId);
    if (draft) inputSnapshot = draft.document;
  }

  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      activityId,
      mode: params.mode,
      targetRevisionId: params.targetRevisionId,
      scope: params.scope,
      userInstruction: params.userInstruction,
    }))
    .digest('hex');

  // 创建任务前结构预检：未就绪直接 409，不产生注定失败的排队任务。
  const bindingStatus = await resolveAppLlmBindingStatus(database, secrets, 'activities', 'text');
  if (!bindingStatus.ready) throw llmNotReadyError(bindingStatus);

  const { job, isExisting } = store.createJob({
    activityId,
    kind: 'text',
    mode: params.mode,
    requestHash,
    idempotencyKey: params.idempotencyKey,
    targetRevisionId: params.targetRevisionId,
    // 保存原始请求，重试时按原样恢复，不读取当前草稿替代。
    request: {
      mode: params.mode,
      scope: params.scope || {},
      userInstruction: params.userInstruction ?? null,
      targetRevisionId: params.targetRevisionId ?? null,
      inputSnapshot,
    },
  });

  if (isExisting) {
    return job;
  }

  // Execute job asynchronously
  setImmediate(async () => {
    try {
      await executeTextJob({
        store,
        database,
        secrets,
        fetcher,
        jobId: job.id,
        activityId,
        mode: params.mode,
        scope: params.scope || {},
        instructions: params.userInstruction,
        inputSnapshot,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateJob(job.id, {
        status: 'failed',
        errorMessage: msg,
      });
    }
  });

  return job;
}

export function cancelTextJob(
  store: ActivityStore,
  activityId: string,
  jobId: string,
) {
  return store.cancelJob(activityId, jobId);
}

export async function retryTextJob(
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  jobId: string,
  fetcher?: typeof fetch,
) {
  const job = store.retryJob(activityId, jobId);
  if (!job) return null;

  // 重试沿用原输入、范围与补充要求；没有快照的旧任务不能用当前草稿冒充原请求。
  const snapshot = store.getJobRequest(jobId);
  if (!snapshot) {
    store.updateJob(jobId, { status: 'failed', errorMessage: '该任务没有保存原始输入快照，无法原样重试。请重新发起生成。' });
    return store.getJob(activityId, jobId);
  }

  setImmediate(async () => {
    try {
      await executeTextJob({
        store,
        database,
        secrets,
        fetcher,
        jobId: job.id,
        activityId,
        mode: String(snapshot.mode || job.mode),
        scope: (snapshot.scope as Record<string, unknown>) || {},
        instructions: typeof snapshot.userInstruction === 'string' ? snapshot.userInstruction : undefined,
        inputSnapshot: snapshot.inputSnapshot as ContentDocument | undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateJob(job.id, {
        status: 'failed',
        errorMessage: msg,
      });
    }
  });

  return job;
}

export function adoptCandidate(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  candidateId: string,
  expectedHeadVersion: number,
) {
  const candidate = store.getCandidate(activityId, candidateId);
  if (!candidate) throw new Error('candidate_not_found');

  const draft = store.getDraft(activityId);
  if (!draft) throw new Error('draft_not_found');

  const updatedDoc = adoptCandidateIntoDocument(
    draft.document,
    candidate.payload,
    candidate.scope,
  );

  // 采用前按当前文档复核引用：记录被删除或被重写后必须重新生成，不能静默写入。
  const messageIds = new Set(draft.document.messages.map((message) => message.id));
  const postIds = new Set(draft.document.posts.map((post) => post.id));
  const payload = candidate.payload as Record<string, unknown>;
  for (const row of (Array.isArray(payload.rewrittenMessages) ? payload.rewrittenMessages : []) as Record<string, unknown>[]) {
    if (!messageIds.has(String(row.id))) throw conflict('candidate_stale', '选中的消息已被修改，请重新生成。');
  }
  for (const row of (Array.isArray(payload.rewrittenPosts) ? payload.rewrittenPosts : []) as Record<string, unknown>[]) {
    if (!postIds.has(String(row.id))) throw conflict('candidate_stale', '选中的动态已被修改，请重新生成。');
  }

  // 草稿更新、版本提交与候选标记必须在同一事务内完成，避免出现部分写入。
  return database.transaction(() => {
    const updatedDraft = store.updateDraft(activityId, draft.draftVersion, updatedDoc);
    const committed = store.commitDraft(activityId, expectedHeadVersion, updatedDraft.draftVersion, { skipTransaction: true });
    database.connection.prepare(
      `UPDATE activity_candidates SET adopted = 1 WHERE id = ? AND activity_id = ?`
    ).run(candidateId, activityId);
    const contentRevision = store.getContentRevision(activityId, committed.contentRevisionId)!;
    return {
      activity: committed.activity,
      contentRevision,
      candidate: { ...candidate, adopted: true },
      headVersion: committed.activity.headVersion,
    };
  });
}

function conflict(code: string, message: string) {
  const error = new Error(message);
  (error as unknown as { statusCode: number; code: string }).statusCode = 409;
  (error as unknown as { code: string }).code = code;
  return error;
}

