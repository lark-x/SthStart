import type { ContentDocument, ActivityProductionOverview } from '@sthstart/contracts';

export function activityNextStep(document: ContentDocument, overview?: ActivityProductionOverview) {
  if (!document.actors.length || !document.stages.length) return {
    action: 'settings' as const, title: '先确认参与者与活动安排',
    description: '确认谁来参加、活动分几段，再开始写内容。', button: '完善活动设定',
  };
  if (overview?.unadoptedCandidates.length) return {
    action: 'review_candidates' as const, title: '有生成好的内容等你确认',
    description: '先阅读结果，满意后采用；不会直接覆盖你写好的内容。', button: '查看生成结果',
  };
  const hasContent = document.messages.length > 0 || document.posts.length > 0;
  if (!hasContent) return {
    action: 'generate_text' as const, title: '设定已就绪，开始写活动内容',
    description: '让 AI 按活动安排写群聊和朋友圈，也可以在下方自己填写。配图稍后再做。', button: '生成活动内容',
  };
  const emptyStages = document.stages.filter(stage => !stage.locked && !document.messages.some(item => item.stageId === stage.id) && !document.posts.some(item => item.stageId === stage.id));
  if (emptyStages.length) return {
    action: 'generate_text' as const, title: `已有内容，还有 ${emptyStages.length} 段可以补充`,
    description: '继续写其余阶段，或直接进入回放预览已有内容。', button: '继续写活动内容',
  };
  if (overview?.suggestedStep === 'generate_media' || overview?.suggestedStep === 'pick_media') return {
    action: overview.suggestedStep, title: '内容已有了，要为活动配图吗？',
    description: '可以生成图片或上传自己的图片。不需要配图，也能预览文字。', button: '为活动配图',
  };
  if (overview?.suggestedStep === 'preview_export') return {
    action: 'preview_export' as const, title: '活动已可预览，准备分享',
    description: '确认回放效果后，选择需要的导出方式。', button: '导出活动',
  };
  return {
    action: 'update_playback' as const, title: '看看活动的呈现效果',
    description: '进入回放检查顺序与节奏；需要时再返回修改内容。', button: '预览活动',
  };
}

export function imageSetupMessage(reason?: string | null) {
  if (reason === 'not_configured') return '图片生成还没有配置。你可以先上传图片，或跳过配图。';
  if (reason === 'engine_disabled' || reason === 'engine_unavailable') return '图片生成服务暂不可用。检查连接后重试，也可以先上传图片。';
  return '图片生成暂未就绪。检查生成配置后重试；这不影响编辑和预览文字。';
}
