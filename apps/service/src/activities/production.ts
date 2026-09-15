import { compareCandidate, assertCandidateDependencies, recordWholeApplication } from './candidate-review.js';
import { assertCandidateCurrent, assertProtectedContent } from './editing-policy.js';
import type {
  Activity,
  ActivityCandidate,
  ActivityProductionOverview,
  ActivityProductionStageOverview,
  ContentDocument,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { resolveImageCapabilityDescriptor } from './image-attempts.js';
import type { ActivityStore } from './store.js';
import { resolveTextReview } from './change-impact.js';
import { adoptCandidateIntoDocument } from './text-jobs.js';

function conflict(code: string, message: string) {
  const error = new Error(message);
  (error as unknown as { statusCode: number; code: string }).statusCode = 409;
  (error as unknown as { code: string }).code = code;
  return error;
}

export function getActivityProductionOverview(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
): ActivityProductionOverview {
  const activity = store.getActivity(activityId);
  if (!activity) {
    throw new Error('activity_not_found');
  }

  const draft = store.getDraft(activityId);
  const contentRev = activity.currentContentRevisionId
    ? store.getContentRevision(activityId, activity.currentContentRevisionId)
    : null;
  const document: ContentDocument = contentRev?.document || draft?.document || {
    schemaVersion: 1,
    activity: {
      title: activity.title,
      type: activity.type,
      theme: activity.theme,
      location: activity.location,
      rules: activity.rules,
      generationMode: 'autonomous',
    },
    actors: [],
    relationships: [],
    stages: [],
    conversations: [],
    messages: [],
    posts: [],
    comments: [],
    likes: [],
    mediaSlots: [],
    facts: [],
    stageResults: [],
  };

  const mediaRev = activity.currentMediaRevisionId
    ? store.getMediaRevision(activityId, activity.currentMediaRevisionId)
    : null;
  const playbackRev = activity.currentPlaybackRevisionId
    ? store.getPlaybackRevision(activityId, activity.currentPlaybackRevisionId)
    : null;

  const candidates = store.listCandidates(activityId);
  const unadoptedCandidates = candidates.filter((c) => {
    if (c.adopted || c.scope.dismissed) return false;
    if(c.scope.importedReadOnly)return false;
    if(c.scope.reviewBaseline)return compareCandidate(database,store,activityId,c.id).units.some(u=>!u.applied&&!u.conflict);
    try { assertCandidateCurrent(draft?.document || document, c); return true; } catch { return false; }
  });

  const slotAdoptedMap = new Map<string, boolean>();
  if (mediaRev?.slotBindings) {
    for (const b of mediaRev.slotBindings) {
      if (b.assets && b.assets.length > 0) {
        slotAdoptedMap.set(b.slotId, true);
      }
    }
  }

  const stages: ActivityProductionStageOverview[] = (document.stages || []).map((stage) => {
    const stageMessages = document.messages.filter((m) => m.stageId === stage.id);
    const stagePosts = document.posts.filter((p) => p.stageId === stage.id);
    const stageSlots = document.mediaSlots.filter((s) => s.stageId === stage.id && s.kind === 'image');
    const adoptedSlots = stageSlots.filter((s) => slotAdoptedMap.get(s.id));
    const stageCandidates = unadoptedCandidates.filter((c) => {
      const scopeStageId = (c.scope as Record<string, unknown>)?.stageId;
      return scopeStageId === stage.id;
    });

    return {
      id: stage.id,
      title: stage.title,
      order: stage.order,
      locked: Boolean(stage.locked),
      hasMessages: stageMessages.length > 0,
      hasPosts: stagePosts.length > 0,
      unadoptedCandidateCount: stageCandidates.length,
      imageSlotCount: stageSlots.length,
      adoptedImageSlotCount: adoptedSlots.length,
    };
  });

  // Text status
  let textStatus: 'not_started' | 'candidates_ready' | 'adopted' = 'not_started';
  const totalRecords = document.messages.length + document.posts.length;
  if (totalRecords > 0) {
    textStatus = 'adopted';
  } else if (unadoptedCandidates.length > 0) {
    textStatus = 'candidates_ready';
  } else {
    textStatus = 'not_started';
  }

  // Media status
  const imageSlots = document.mediaSlots.filter((s) => s.kind === 'image');
  const totalImageSlots = imageSlots.length;
  const adoptedImageSlots = imageSlots.filter((s) => slotAdoptedMap.get(s.id)).length;
  const pendingImageSlots = Math.max(0, totalImageSlots - adoptedImageSlots);

  // Check if any failed batches or items exist
  const failedBatchRow = database.connection.prepare(
    `SELECT 1 FROM activity_media_batch_items bi
     JOIN activity_media_batches b ON b.id = bi.batch_id
     WHERE b.activity_id = ? AND bi.state = 'failed' LIMIT 1`
  ).get(activityId);

  const mediaStatus = {
    totalSlots: totalImageSlots,
    adoptedSlots: adoptedImageSlots,
    pendingSlots: pendingImageSlots,
    hasFailedBatches: Boolean(failedBatchRow),
  };

  // Playback status
  let playbackStatus: 'not_created' | 'ready' | 'needs_update' = 'not_created';
  if (!playbackRev) {
    const historical=database.connection.prepare('SELECT 1 FROM activity_playback_revisions WHERE activity_id=? LIMIT 1').get(activityId);
    playbackStatus = historical?'needs_update':'not_created';
  } else if (
    (activity.currentContentRevisionId && playbackRev.contentRevisionId !== activity.currentContentRevisionId) ||
    (activity.currentMediaRevisionId && playbackRev.mediaRevisionId !== activity.currentMediaRevisionId)
  ) {
    playbackStatus = 'needs_update';
  } else {
    playbackStatus = 'ready';
  }

  // Check if any unselected successful media candidate outputs exist
  const unselectedMediaCandidatesRow = database.connection.prepare(
    `SELECT 1 FROM activity_image_attempts a
     JOIN activity_image_attempt_outputs o ON o.attempt_id = a.id
     WHERE a.activity_id = ? AND a.status = 'succeeded' LIMIT 1`
  ).get(activityId);
  const hasUnselectedMediaCandidates = Boolean(unselectedMediaCandidatesRow) && pendingImageSlots > 0;

  // Compute suggestedStep
  let suggestedStep: ActivityProductionOverview['suggestedStep'] = 'generate_text';
  if (textStatus === 'not_started') {
    suggestedStep = 'generate_text';
  } else if (textStatus === 'candidates_ready' || stages.some(stage => !stage.hasMessages && !stage.hasPosts && stage.unadoptedCandidateCount > 0)) {
    suggestedStep = 'review_candidates';
  } else if (pendingImageSlots > 0) {
    if (hasUnselectedMediaCandidates) {
      suggestedStep = 'pick_media';
    } else {
      suggestedStep = 'generate_media';
    }
  } else if (playbackStatus === 'not_created' || playbackStatus === 'needs_update') {
    suggestedStep = 'update_playback';
  } else {
    suggestedStep = 'preview_export';
  }

  // Preflight descriptor
  const cap = resolveImageCapabilityDescriptor(database, 'activity_image_text', 'activity_media_slot');
  let engineName: string | undefined;
  let workflowName: string | undefined;
  if (cap.engineId) {
    const engineRow = database.connection.prepare('SELECT name FROM generation_engines WHERE id = ?').get(cap.engineId) as { name: string } | undefined;
    engineName = engineRow?.name;
  }
  if (cap.workflowId) {
    const wfRow = database.connection.prepare('SELECT name FROM generation_workflows WHERE id = ?').get(cap.workflowId) as { name: string } | undefined;
    workflowName = wfRow?.name;
  }

  const imagePreflight = {
    ready: cap.readiness === 'ready',
    reason: cap.reasonCode,
    purpose: cap.purpose,
    engineName,
    workflowName,
  };

  return {
    activityId,
    title: activity.title,
    headVersion: activity.headVersion,
    draftVersion: draft?.draftVersion || 1,
    stages,
    textStatus,
    mediaStatus,
    playbackStatus,
    suggestedStep,
    unadoptedCandidates: unadoptedCandidates.map((c) => ({
      id: c.id,
      stageId: (c.scope as Record<string, unknown>)?.stageId ? String((c.scope as Record<string, unknown>).stageId) : undefined,
      mode: String((c.scope as Record<string, unknown>)?.mode || 'stage'),
      createdAt: c.createdAt,
      summary: (c.payload as Record<string, unknown>)?.summary ? String((c.payload as Record<string, unknown>).summary) : undefined,
    })),
    imagePreflight,
  };
}

export function adoptCandidateBatch(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  params: {
    candidateIds: string[];
    expectedHeadVersion: number;
    expectedDraftVersion: number;
    idempotencyKey?: string;
  },
): {
  activity: Activity;
  contentRevision: NonNullable<ReturnType<ActivityStore['getContentRevision']>>;
  adoptedCandidateIds: string[];
  headVersion: number;
} {
  const activity = store.getActivity(activityId);
  if (!activity) throw new Error('activity_not_found');

  const draft = store.getDraft(activityId);
  if (!draft) throw new Error('draft_not_found');

  if (!params.candidateIds || params.candidateIds.length === 0) {
    throw new Error('candidate_ids_required');
  }

  // Fetch all candidates
  const candidates: ActivityCandidate[] = [];
  for (const cid of new Set(params.candidateIds)) {
    const cand = store.getCandidate(activityId, cid);
    if (!cand) throw new Error(`candidate_not_found: ${cid}`);
    candidates.push(cand);
  }

  // Check if all are already adopted (idempotency)
  const unadopted = candidates.filter((c) => !c.adopted);
  if (unadopted.length === 0) {
    const rev = activity.currentContentRevisionId ? store.getContentRevision(activityId, activity.currentContentRevisionId) : null;
    if (rev) {
      return {
        activity,
        contentRevision: rev,
        adoptedCandidateIds: params.candidateIds,
        headVersion: activity.headVersion,
      };
    }
  }

  if (activity.headVersion !== params.expectedHeadVersion) {
    throw conflict('head_version_conflict', `活动版本已变更（当前版本：${activity.headVersion}，预期版本：${params.expectedHeadVersion}），请刷新后重试。`);
  }

  if (draft.draftVersion !== params.expectedDraftVersion) {
    throw conflict('draft_version_conflict', `草稿版本已变更（当前版本：${draft.draftVersion}，预期版本：${params.expectedDraftVersion}），请先保存或刷新。`);
  }

  // Sort candidates by stage order if available, or keep submission order
  const stageOrderMap = new Map((draft.document.stages || []).map((s) => [s.id, s.order]));
  const lockedStageIds = new Set((draft.document.stages || []).filter((s) => s.locked).map((s) => s.id));
  const editingPolicy = draft.document.editingPolicy;
  const lockedRecordIds = new Set((editingPolicy?.lockedRecords || []).map((r) => r.id));

  const sortedCandidates = [...unadopted].sort((a, b) => {
    const stageA = String((a.scope as Record<string, unknown>)?.stageId || '');
    const stageB = String((b.scope as Record<string, unknown>)?.stageId || '');
    const orderA = stageOrderMap.get(stageA) ?? 9999;
    const orderB = stageOrderMap.get(stageB) ?? 9999;
    return orderA - orderB;
  });

  const stageTargets = sortedCandidates.filter(c => c.scope.mode === 'stage').map(c => c.scope.stageId);
  if (new Set(stageTargets).size !== stageTargets.length) throw conflict('candidate_conflict', '同一阶段只能采用一份候选。');
  const bases = new Set(sortedCandidates.filter(c => c.baseRevisionId).map(c => c.baseRevisionId + ':' + c.draftVersion));
  if (bases.size > 1) throw conflict('candidate_conflict', '所选候选基于不同版本，请分别核对。');

  // Verify locked stages / locked records protection
  for (const cand of sortedCandidates) {
    if(cand.scope.importedReadOnly)throw conflict('candidate_imported_readonly','导入的历史候选请重新生成');
    assertCandidateDependencies(database,store,activityId,cand.id,params.candidateIds);
    assertCandidateCurrent(draft.document, cand);
    const stageId = String((cand.scope as Record<string, unknown>)?.stageId || '');
    const mode = String((cand.scope as Record<string, unknown>)?.mode || '');
    if (stageId && lockedStageIds.has(stageId) && mode !== 'invite' && mode !== 'wish' && mode !== 'moment' && mode !== 'shot') {
      throw conflict('stage_locked', `阶段 ${stageId} 已被锁定，不可采用覆写该阶段内容的候选。请先解锁阶段。`);
    }

    // Check rewritten records
    const payload = cand.payload as Record<string, unknown>;
    if (Array.isArray(payload.rewrittenMessages)) {
      for (const row of payload.rewrittenMessages as Record<string, unknown>[]) {
        if (lockedRecordIds.has(String(row.id))) {
          throw conflict('record_locked', `选中的消息 ${String(row.id)} 已被锁定，不可自动改写。`);
        }
      }
    }
    if (Array.isArray(payload.rewrittenPosts)) {
      for (const row of payload.rewrittenPosts as Record<string, unknown>[]) {
        if (lockedRecordIds.has(String(row.id))) {
          throw conflict('record_locked', `选中的动态 ${String(row.id)} 已被锁定，不可自动改写。`);
        }
      }
    }
  }

  // Apply candidates sequentially in memory
  let currentDoc: ContentDocument = JSON.parse(JSON.stringify(draft.document));
  for (const cand of sortedCandidates) {
    const next = adoptCandidateIntoDocument(currentDoc, cand.payload, cand.scope);
    assertProtectedContent(currentDoc, next);
    currentDoc = next;
  }

  // Atomic database transaction
  return database.transaction(() => {
    const updatedDraft = store.updateDraft(activityId, draft.draftVersion, currentDoc);
    const committed = store.commitDraft(activityId, params.expectedHeadVersion, updatedDraft.draftVersion, { skipTransaction: true });

    const stmt = database.connection.prepare(
      'UPDATE activity_candidates SET adopted = 1 WHERE activity_id = ? AND id = ?'
    );
    for (const cand of candidates) {
      stmt.run(activityId, cand.id);
      recordWholeApplication(database,activityId,cand.id,currentDoc,String(cand.scope.stageId||''),committed.contentRevisionId);
      resolveTextReview(database.connection,activityId,currentDoc,cand.id);
    }

    const contentRevision = store.getContentRevision(activityId, committed.contentRevisionId)!;
    return {
      activity: committed.activity,
      contentRevision,
      adoptedCandidateIds: params.candidateIds,
      headVersion: committed.activity.headVersion,
    };
  });
}
