import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { ContentDocumentSchema, StudioStoryboardApplySchema, type StudioStoryboardApply, type ActivityScene,
  type StudioJob, type ComicDocument, type ComicStoryboardModelOutput,type StudioTarget,type StudioPlacement } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { ActivityStore } from './store.js';
import { ComicStore } from './comic-store.js';
import { StudioStore, studioError, studioHash } from './studio-store.js';
import { assertStudioVersions, storyboardTargetFingerprint, studioScenes, type FrozenStudioStoryboard } from './studio-storyboard.js';
import { materializeComicStoryboard } from './comic-storyboard.js';
import { updateAiCallRecord } from '../ai-call-trace.js';

export function applyStudioStoryboard(database: ServiceDatabase, activityId: string, jobId: string, request: StudioStoryboardApply,
  createRender?:(targets:StudioTarget[],parent:StudioJob,placement:StudioPlacement)=>StudioJob): StudioJob {
  if (!Value.Check(StudioStoryboardApplySchema,request)) throw studioError('studio_invalid_request','应用请求结构不合法。');
  return database.transaction(() => {
    const jobs = new StudioStore(database), job = jobs.get(activityId,jobId);
    if (!job || job.kind !== 'storyboard') throw studioError('studio_job_not_found','分镜任务不属于此活动。',404);
    // Read the previous application before checking versions changed by that same application.
    if (job.applyState === 'applied') return job;
    if (job.revision !== request.expectedJobRevision || job.status !== 'awaiting_review' || !job.result || job.stopRequested)
      throw studioError('studio_job_conflict','分镜提案尚未就绪或状态已变化。',409);
    if (!('output' in job.result)) throw studioError('studio_job_conflict','任务结果不是分镜提案。',409);
    if (job.result.resultHash !== request.resultHash || studioHash({ output: job.result.output,comic: job.result.comic,
      sourceLabel: job.result.sourceLabel,sourceFingerprint: job.result.sourceFingerprint }) !== request.resultHash)
      throw studioError('studio_job_conflict','待应用的结果已变化，请重新审阅。',409);
    const frozen = job.input as unknown as FrozenStudioStoryboard, input = frozen.request.input;
    if (request.mode === 'replace_scene' && (!request.confirmReplace || !input.sceneId || request.sceneId !== input.sceneId))
      throw studioError('studio_invalid_request','替换需要明确确认预览中的同一场次。');
    const { activity,draft,comic: existingComic } = assertStudioVersions(database,activityId,request.versions);
    const stage = draft.document.stages.find(stage => stage.id === input.stageId);
    if (!stage || stage.locked) throw studioError('studio_target_locked','目标阶段不存在或已锁定。',409);
    if (storyboardTargetFingerprint(draft.document,input) !== frozen.targetFingerprint)
      throw studioError('studio_source_changed','目标场次或允许角色资料已变化，请重新生成提案。',409);
    let sceneId: string, beatIds: string[], contentDraftVersion = draft.draftVersion, contentRevisionId = activity.currentContentRevisionId;
    let materialized: ReturnType<typeof materializeComicStoryboard> | null = null;
    const comics = new ComicStore(database);
    let retained: ComicDocument | null = existingComic?.document ?? null;
    if (input.output === 'comic') {
      if (retained && retained.contentRevisionId !== activity.currentContentRevisionId)
        throw studioError('studio_source_changed','现有漫画绑定另一个剧情版本，不会自动覆盖。',409);
      if (request.mode === 'replace_scene' && retained) {
        const removedPages = new Set<string>();
        for (const page of retained.pages) {
          const panels = page.panelIds.map(id => retained!.panels.find(panel => panel.id === id)!);
          if (!panels.some(panel => panel.source.stageId === input.stageId && panel.source.sceneId === input.sceneId)) continue;
          if (panels.some(panel => panel.source.stageId !== input.stageId || panel.source.sceneId !== input.sceneId))
            throw studioError('studio_source_changed','该漫画页混用了多个场次，不能部分删除画格；请先手工拆页。',409);
          removedPages.add(page.id);
        }
        const removedPanelIds = new Set(retained.pages.filter(page => removedPages.has(page.id)).flatMap(page => page.panelIds));
        retained = { ...retained,pages: retained.pages.filter(page => !removedPages.has(page.id)),panels: retained.panels.filter(panel => !removedPanelIds.has(panel.id)) };
      }
    }
    if (job.result.output) {
      const output = job.result.output;
      sceneId = request.mode === 'replace_scene' ? input.sceneId! : randomUUID();
      const scene: ActivityScene = { id: sceneId,stageId: input.stageId,...output.scene,
        beats: output.beats.map(beat => ({ id: randomUUID(),sceneId,stageId: input.stageId,
          characterId: beat.primaryActorId ?? '',actorIds: beat.actorIds,action: beat.action,dialogue: beat.dialogue,outcome: beat.outcome,
          renderSettings: { director: beat.director,composition: beat.composition } })) };
      beatIds = scene.beats.map(beat => beat.id);
      const scenes = studioScenes(draft.document,input.stageId);
      const updatedScenes = request.mode === 'replace_scene' ? scenes.map(old => old.id === sceneId ? scene : old) : [...scenes,scene];
      const next = { ...draft.document,scenes: [...(draft.document.scenes ?? []).filter(scene => scene.stageId !== input.stageId),...updatedScenes],
        stages: draft.document.stages.map(stage => stage.id === input.stageId ? { ...stage,scenes: updatedScenes } : stage) };
      if (!Value.Check(ContentDocumentSchema,next)) throw studioError('studio_invalid_model_output','应用后的内容结构不合法，未写入。');
      contentDraftVersion = new ActivityStore(database).updateDraft(activityId,draft.draftVersion,next).draftVersion;
      if (input.output === 'comic') {
        const committed = new ActivityStore(database).commitDraft(activityId,activity.headVersion,contentDraftVersion,{ skipTransaction: true });
        contentRevisionId = committed.contentRevisionId;
        contentDraftVersion = new ActivityStore(database).getDraft(activityId)!.draftVersion;
        const comicOutput: ComicStoryboardModelOutput = { panels: output.beats.map((beat,index) => ({ sourceBeatIds: [beatIds[index]],
          actorIds: beat.actorIds,shotSize: beat.director.shotSize === 'full_body' ? 'medium' : beat.director.shotSize ?? 'medium',
          visualDescription: beat.action,composition: beat.composition,textSafeArea: beat.dialogue ? 'top_left' : 'none',
          bubbles: beat.dialogue ? [{ kind: 'speech',speakerActorId: beat.primaryActorId,text: beat.dialogue }] : [] })) };
        materialized = materializeComicStoryboard(comicOutput,next,{ stageId: input.stageId,sceneId,panelCount: input.count });
      }
    } else {
      const source = input.source;
      if (input.output !== 'comic' || !job.result.comic || source.kind !== 'scene') throw studioError('studio_invalid_model_output','提案结果缺少合法内容。');
      sceneId = source.sceneId; beatIds = studioScenes(frozen.content,source.stageId).find(scene => scene.id === sceneId)!.beats.map(beat => beat.id);
      materialized = materializeComicStoryboard(job.result.comic,frozen.content,{ stageId: source.stageId,sceneId,panelCount: input.count });
    }
    let comicDraftVersion: number | null = null;
    if (materialized) {
      if (!contentRevisionId) throw studioError('studio_source_changed','漫画缺少冻结内容版本。',409);
      const current = existingComic ?? comics.createComicDraft(activityId,contentRevisionId,{ skipTransaction: true });
      const base = retained ?? current.document;
      const nextComic: ComicDocument = { ...base,contentRevisionId,pages: [...base.pages,...materialized.pages],panels: [...base.panels,...materialized.panels] };
      comicDraftVersion = comics.saveComicDraft(activityId,current.draftVersion,nextComic,{ skipTransaction: true }).draftVersion;
    }
    let childJobId:string|null=null;
    if(request.renderAfterApply){
      if(!createRender)throw studioError('studio_workflow_incompatible','连续绘制适配器不可用，未应用提案。',409);
      const targets:StudioTarget[]=materialized ? materialized.panels.map(panel=>({kind:'comic_panel',panelId:panel.id})) : beatIds.map(beatId=>({kind:'beat',stageId:input.stageId,sceneId,beatId}));
      childJobId=createRender(targets,job,request.placement ?? 'history_only').id;
    }
    const applied=jobs.recordApplied(activityId,jobId,job.revision,{ sceneId,beatIds,contentDraftVersion,contentRevisionId,comicDraftVersion,
      pageIds: materialized?.pages.map(page => page.id) ?? [],panelIds: materialized?.panels.map(panel => panel.id) ?? [],childJobId });
    // The proposal timeline links the reviewed plan to the content it created.
    // This is a business event, not a fabricated model call.
    if(applied.callId)updateAiCallRecord(database,String(applied.callId),{event:'studio_proposal_applied',
      detail:{activityId,jobId,sceneId,beatIds:beatIds??[],comicDraftVersion:comicDraftVersion??null,childJobId}});
    return applied;
  });
}
