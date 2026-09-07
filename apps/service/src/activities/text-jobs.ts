import crypto from 'node:crypto';
import type { ContentDocument } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile, resolveProfile, upstreamHeaders } from '../providers.js';
import type { ActivityStore } from './store.js';
import {
  buildPlanPrompt,
  buildStagePrompt,
  buildRewritePrompt,
  parseAiJsonOutput,
  type PlanGenerationOutput,
  type StageGenerationOutput,
} from './prompts.js';

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
}

export async function executeTextJob(options: ExecuteJobOptions): Promise<void> {
  const { store, database, secrets, jobId, activityId, mode, scope, instructions } = options;
  const fetchFn = options.fetcher ?? fetch;

  try {
    store.updateJob(jobId, { status: 'running' });
    store.appendJobEvent(jobId, activityId, 'started', { mode });

    // 1. Resolve LLM profile
    let profile = await resolveAssignedLlmProfile(database, secrets, 'activities', 'text');
    if (!profile) {
      profile = await resolveProfile(database, secrets, 'llm');
    }
    if (!profile) {
      throw new Error('未配置可用的 LLM 模型。请在控制中心配置并启用一个 LLM Profile。');
    }

    // 2. Fetch current draft
    const draft = store.getDraft(activityId);
    if (!draft) throw new Error('活动草稿不存在');

    let prompt = '';
    if (mode === 'plan') {
      prompt = buildPlanPrompt(draft.document, instructions);
    } else if (mode === 'stage') {
      const stageId = String(scope.stageId || draft.document.stages[0]?.id);
      const stage = draft.document.stages.find((s) => s.id === stageId);
      if (!stage) throw new Error(`阶段 ${stageId} 未找到`);
      prompt = buildStagePrompt(draft.document, stage, instructions);
    } else if (mode === 'rewrite-records') {
      const recordIds = (scope.recordIds as string[]) || [];
      const reason = instructions || '优化对白';
      prompt = buildRewritePrompt(draft.document, recordIds, reason);
    } else if (mode === 'whole-text') {
      // Whole text sequentially generates each stage
      for (let i = 0; i < draft.document.stages.length; i++) {
        const currentDraft = store.getDraft(activityId);
        if (!currentDraft) break;
        const currentStage = currentDraft.document.stages[i];
        store.appendJobEvent(jobId, activityId, 'stage_progress', { stageIndex: i, stageId: currentStage.id });
        const stPrompt = buildStagePrompt(currentDraft.document, currentStage, instructions);
        const stResp = await callLlm(profile, stPrompt, fetchFn);
        const stOutput = parseAiJsonOutput<StageGenerationOutput>(stResp);
        const candidate = store.createCandidate({
          activityId,
          baseRevisionId: currentDraft.baseContentRevisionId,
          draftVersion: currentDraft.draftVersion,
          scope: { stageId: currentStage.id, batchIndex: i },
          payload: stOutput as unknown as Record<string, unknown>,
          validation: { valid: true },
        });
        const currentJob = store.getJob(activityId, jobId);
        const candidateIds = [...(currentJob?.resultCandidateIds || []), candidate.id];
        store.updateJob(jobId, { resultCandidateIds: candidateIds });
      }

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
    const llmResponse = await callLlm(profile, prompt, fetchFn);

    // Parse & Validate
    const parsedPayload = parseAiJsonOutput<Record<string, unknown>>(llmResponse);

    // Create Candidate
    const candidate = store.createCandidate({
      activityId,
      baseRevisionId: draft.baseContentRevisionId,
      draftVersion: draft.draftVersion,
      scope,
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
    const msg = (err as Error).message;
    store.updateJob(jobId, { status: 'failed', errorMessage: msg });
    store.appendJobEvent(jobId, activityId, 'failed', { error: msg });
  }
}

async function callLlm(
  profile: NonNullable<Awaited<ReturnType<typeof resolveProfile>>>,
  prompt: string,
  fetchFn: typeof fetch
): Promise<string> {
  const url = `${profile.baseUrl}/chat/completions`;
  const headers = upstreamHeaders(profile.secret, true);
  if (profile.headers) {
    Object.assign(headers, profile.headers);
  }

  const payload: Record<string, unknown> = {
    model: profile.model || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an expert story director and screenwriter.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    ...profile.extraBody,
  };

  const resp = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
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
    const newStages = plan.stages.map((s, idx) => ({
      id: s.stageId || `stage_${idx + 1}`,
      title: s.title,
      order: idx + 1,
      actorIds: s.actorIds && s.actorIds.length > 0 ? s.actorIds : updatedDoc.actors.map((a) => a.id),
      location: s.location || updatedDoc.activity.location,
      instruction: s.description,
      requiredBeats: (s.requiredBeats || []).map((text, bIdx) => ({
        id: `beat_${idx + 1}_${bIdx + 1}`,
        text,
        actorIds: s.actorIds || [],
      })),
      locked: false,
      endCondition: s.endCondition || '',
    }));
    updatedDoc.stages = newStages;
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

    // Remove existing records belonging to this stage
    updatedDoc.messages = updatedDoc.messages.filter((m) => m.stageId !== stageId);
    updatedDoc.posts = updatedDoc.posts.filter((p) => p.stageId !== stageId);
    updatedDoc.facts = updatedDoc.facts.filter((f) => f.stageId !== stageId);
    updatedDoc.mediaSlots = updatedDoc.mediaSlots.filter((s) => s.stageId !== stageId);

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
      reviewState: 'ready' as const,
      summary: stageOut.summary || '阶段记录已生成',
      factIds: (stageOut.facts || []).map((f) => getOrAssignId(f.clientId, 'fact')),
    };
    if (stageResultIdx >= 0) {
      updatedDoc.stageResults[stageResultIdx] = newStageResult;
    } else {
      updatedDoc.stageResults.push(newStageResult);
    }
  }

  return updatedDoc;
}

export async function runTextGenerationJob(
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  params: {
    mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text';
    targetRevisionId?: string;
    scope?: Record<string, unknown>;
    userInstruction?: string;
    idempotencyKey?: string;
  },
  fetcher?: typeof fetch,
) {
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({
      activityId,
      mode: params.mode,
      targetRevisionId: params.targetRevisionId,
      scope: params.scope,
      userInstruction: params.userInstruction,
    }))
    .digest('hex');

  const { job, isExisting } = store.createJob({
    activityId,
    kind: 'text',
    mode: params.mode,
    requestHash,
    idempotencyKey: params.idempotencyKey,
    targetRevisionId: params.targetRevisionId,
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

  // Update draft
  const updatedDraft = store.updateDraft(activityId, draft.draftVersion, updatedDoc);

  // Commit draft to new ContentRevision
  const committed = store.commitDraft(
    activityId,
    expectedHeadVersion,
    updatedDraft.draftVersion,
  );

  // Mark candidate as adopted
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
}

