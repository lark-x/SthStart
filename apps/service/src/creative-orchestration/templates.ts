import type {
  CreativePayloadKind,
  CreativeRole,
  CreativeWorkflowDocument,
} from '@sthstart/contracts';

const role = (
  id: string,
  name: string,
  responsibility: string,
  core: boolean,
  capability: CreativeRole['capability'],
  tools: string[] = []
): CreativeRole => ({
  id,
  name,
  responsibility,
  core,
  capability,
  modelId: null,
  tools,
  revision: 1,
});

export const DEFAULT_CREATIVE_ROLES: readonly CreativeRole[] = [
  role(
    'production_manager',
    '总管/制片',
    '负责目标、范围、预算、里程碑与交付节奏，协调专业岗位并阻止越界执行。',
    true,
    'text',
    ['video_plan']
  ),
  role(
    'creative_director',
    '创作导演',
    '把用户意图转成创作计划，维护叙事方向、优先级和可交付标准。',
    true,
    'text'
  ),
  role(
    'editor_in_chief',
    '总编',
    '独立审核最终内容的一致性、完整性和发布质量，并决定是否需要返修。',
    true,
    'text'
  ),
  role(
    'lead_writer',
    '场景主笔',
    '按导演计划和已确认事实撰写完整场景与人物行动。',
    false,
    'text'
  ),
  role(
    'continuity_editor',
    '连贯编辑',
    '独立核验人物状态、时间线、事实来源与前后场景衔接。',
    false,
    'text',
    ['knowledge_search']
  ),
  role(
    'art_director',
    '美术统筹',
    '按需建立视觉方向并检查图片与创作约束是否一致。',
    false,
    'multimodal',
    ['image_generation']
  ),
  role(
    'prompt_engineer',
    '图像提示词设计',
    '把视觉需求转成可复现的构图、角色、光线和风格提示词。',
    false,
    'text'
  ),
  role(
    'visual_reviewer',
    '视觉审查',
    '同时对照任务、提示词和实际图片，检查图文一致性、伪影与交付质量。',
    false,
    'multimodal'
  ),
  role(
    'research_specialist',
    '考据专员',
    '按任务核查世界观、人物经历、地点与来源，并输出可引用的证据。',
    false,
    'text',
    ['knowledge_search', 'web_search']
  ),
];

export const CORE_CREATIVE_ROLES: readonly CreativeRole[] =
  DEFAULT_CREATIVE_ROLES.filter((item) => item.core);

export const PROFESSIONAL_CREATIVE_ROLES: readonly CreativeRole[] =
  DEFAULT_CREATIVE_ROLES.filter((item) => !item.core);

export function createDefaultCreativeRoles(): CreativeRole[] {
  return DEFAULT_CREATIVE_ROLES.map((item) => structuredClone(item));
}

const input = (nodeId: string, kind: CreativePayloadKind) => ({ nodeId, kind });
const position = (x: number, y: number) => ({ x, y });

export function createDefaultStorySceneWorkflow(): CreativeWorkflowDocument {
  return {
    name: '故事场景创作',
    description: '导演先规划；重大方向先经 plan 人工批准，普通计划直入主笔，再由连贯编辑和总编读取实际场景独立审核。',
    purpose: 'story',
    nodes: [
      {
        id: 'story_context',
        kind: 'context',
        label: '用户请求、世界观与当前事实',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: position(40, 220),
      },
      {
        id: 'story_director_plan',
        kind: 'agent',
        label: '创作导演制定场景方向',
        roleId: 'creative_director',
        outputKind: 'plan',
        inputs: { context: input('story_context', 'context') },
        config: {
          instruction: [
            '输出 JSON plan。必须包含 summary、requiresDirectionApproval、criticalChanges 和场景执行计划。',
            'requiresDirectionApproval=true 只能把方向升级为必须人工确认，不能自行授予批准。',
            'trusted run.input.criticalChange=true 强制确认；模型 false 永远不能降低用户要求。',
            'requiresDirectionApproval=false 且 trusted input=false 才可走普通直行分支。',
            'criticalChanges 每项包含 description 与 reason；没有重大变化时输出空数组。',
          ].join('\n'),
          parameters: {
            outputContract: {
              summary: 'string',
              requiresDirectionApproval: 'boolean',
              criticalChanges: [{ description: 'string', reason: 'string' }],
            },
          },
        },
        position: position(350, 220),
      },
      {
        id: 'story_critical_change',
        kind: 'condition',
        label: '重大变化判断',
        outputKind: 'decision',
        inputs: { plan: input('story_director_plan', 'plan') },
        config: {
          condition: 'critical_change',
          instruction: 'trusted run.input.criticalChange=true 强制方向确认；模型 requiresDirectionApproval=true 可升级为确认；模型 false 不能降级或关闭用户要求。',
        },
        position: position(660, 220),
      },
      {
        id: 'story_direction_approval',
        kind: 'approval',
        label: '重大方向人工批准',
        outputKind: 'decision',
        inputs: {
          plan: input('story_director_plan', 'plan'),
          route: input('story_critical_change', 'decision'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'creative_director'],
          parameters: { directionGate: true },
          instruction: '只审阅导演 plan，尤其是 criticalChanges 的不可逆影响；拒绝时不得进入主笔。',
        },
        position: position(970, 90),
      },
      {
        id: 'story_plan_join',
        kind: 'join',
        label: '导演方案汇合',
        outputKind: 'plan',
        inputs: {
          plan: input('story_director_plan', 'plan'),
          ordinary_path: input('story_critical_change', 'decision'),
          approved_direction: input('story_direction_approval', 'decision'),
        },
        config: {
          instruction: 'plan 是主产物；保留实际执行路径的 decision 依赖，skipped 条件输入不阻塞汇合。',
        },
        position: position(1280, 220),
      },
      {
        id: 'story_writer_scene',
        kind: 'agent',
        label: '场景主笔撰写场景',
        roleId: 'lead_writer',
        outputKind: 'scene',
        inputs: {
          context: input('story_context', 'context'),
          plan: input('story_plan_join', 'plan'),
        },
        config: {
          instruction: '同时直接读取原始 context 与最终 plan，输出完整场景正文、事件、状态变化和新增设定候选。',
        },
        position: position(1590, 220),
      },
      {
        id: 'story_continuity_review',
        kind: 'agent',
        label: '连贯编辑独立审核',
        roleId: 'continuity_editor',
        outputKind: 'review',
        inputs: {
          context: input('story_context', 'context'),
          scene: input('story_writer_scene', 'scene'),
        },
        config: {
          instruction: '同时读取原始 context 与实际场景，核查人物状态、时间线、来源和前后衔接。',
        },
        position: position(1900, 90),
      },
      {
        id: 'story_editor_review',
        kind: 'agent',
        label: '总编独立审核',
        roleId: 'editor_in_chief',
        outputKind: 'review',
        inputs: {
          context: input('story_context', 'context'),
          scene: input('story_writer_scene', 'scene'),
        },
        config: {
          instruction: '同时读取原始 context 与实际场景，独立审核内容完整性、表达质量和交付条件。',
        },
        position: position(1900, 350),
      },
      {
        id: 'story_review_join',
        kind: 'join',
        label: '双审核意见汇合',
        outputKind: 'scene',
        inputs: {
          scene: input('story_writer_scene', 'scene'),
          continuity_review: input('story_continuity_review', 'review'),
          editor_review: input('story_editor_review', 'review'),
        },
        config: {
          instruction: 'scene 为主产物，同时保留两份 review 依赖供返修和最终批准核验。',
        },
        position: position(2210, 220),
      },
      {
        id: 'story_revision',
        kind: 'revision',
        label: '按双审核意见定向返修',
        roleId: 'continuity_editor',
        outputKind: 'review',
        inputs: { reviewed_scene: input('story_review_join', 'scene') },
        config: {
          instruction: '由 runtime 从场景主笔复跑 writer 之后直到两份审核的子图；历史反馈走 ctx.revision。',
          reviewerRoleIds: ['continuity_editor', 'editor_in_chief'],
          maxRevisions: 2,
          targetNodeId: 'story_writer_scene',
        },
        position: position(2520, 220),
      },
      {
        id: 'story_approval',
        kind: 'approval',
        label: '人工批准完整场景',
        outputKind: 'decision',
        inputs: {
          scene: input('story_review_join', 'scene'),
          latest_review: input('story_revision', 'review'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'editor_in_chief'],
          instruction: '这是最终内容门；必须同时核对实际场景与最新审核，未批准不得采用。',
        },
        position: position(2830, 220),
      },
      {
        id: 'story_adopt',
        kind: 'adopt',
        label: '采用到正式故事',
        outputKind: 'result',
        inputs: { approval: input('story_approval', 'decision') },
        config: {
          instruction: '只采用最终场景 approval 的 approved 决定，并保留方向审批与审核谱系。',
        },
        position: position(3140, 220),
      },
    ],
    edges: [
      { id: 'story_context_director', source: 'story_context', target: 'story_director_plan' },
      { id: 'story_director_condition', source: 'story_director_plan', target: 'story_critical_change' },
      { id: 'story_director_join', source: 'story_director_plan', target: 'story_plan_join' },
      { id: 'story_director_direction', source: 'story_director_plan', target: 'story_direction_approval' },
      {
        id: 'story_critical_direction',
        source: 'story_critical_change',
        target: 'story_direction_approval',
        when: 'approved',
      },
      {
        id: 'story_critical_writer_path',
        source: 'story_critical_change',
        target: 'story_plan_join',
        when: 'rejected',
      },
      {
        id: 'story_direction_join',
        source: 'story_direction_approval',
        target: 'story_plan_join',
        when: 'approved',
      },
      { id: 'story_context_writer', source: 'story_context', target: 'story_writer_scene' },
      { id: 'story_join_writer', source: 'story_plan_join', target: 'story_writer_scene' },
      { id: 'story_context_continuity', source: 'story_context', target: 'story_continuity_review' },
      { id: 'story_context_editor', source: 'story_context', target: 'story_editor_review' },
      { id: 'story_writer_continuity', source: 'story_writer_scene', target: 'story_continuity_review' },
      { id: 'story_writer_editor', source: 'story_writer_scene', target: 'story_editor_review' },
      { id: 'story_writer_join', source: 'story_writer_scene', target: 'story_review_join' },
      { id: 'story_continuity_join', source: 'story_continuity_review', target: 'story_review_join' },
      { id: 'story_editor_join', source: 'story_editor_review', target: 'story_review_join' },
      { id: 'story_join_revision', source: 'story_review_join', target: 'story_revision' },
      { id: 'story_join_approval', source: 'story_review_join', target: 'story_approval' },
      { id: 'story_revision_approval', source: 'story_revision', target: 'story_approval' },
      {
        id: 'story_approval_adopt',
        source: 'story_approval',
        target: 'story_adopt',
        when: 'approved',
      },
    ],
  };
}

export function createDefaultVideoPlanWorkflow(): CreativeWorkflowDocument {
  return {
    name: '视频方案创作',
    description: '创作导演形成完整分镜方案；制片岗位的 video_plan 工具严格校验实际 plan，再交给人工批准和采用，不执行视频生成。',
    purpose: 'video-plan',
    nodes: [
      {
        id: 'video_context',
        kind: 'context',
        label: '视频目标、约束与参考资料',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: position(40, 220),
      },
      {
        id: 'video_director_plan',
        kind: 'agent',
        label: '创作导演制定完整视频方案',
        roleId: 'creative_director',
        outputKind: 'plan',
        inputs: { context: input('video_context', 'context') },
        config: {
          instruction: [
            '输出 JSON 视频方案。必须包含非空 shots，不得用 brief、空数组或“待补全”伪造完成。',
            '每个 shot 必须包含 id、durationSeconds、description、dialogue、visualPrompt、camera 和 referenceArtifactIds。',
            'totalDurationSeconds 必须为正数；requiresHumanApproval=true；executionStatus 固定为 planning_only。',
          ].join('\n'),
          parameters: {
            videoPlan: true,
            outputContract: {
              kind: 'video-plan',
              title: 'string',
              brief: 'string',
              shots: [{
                id: 'string',
                durationSeconds: 'number',
                description: 'string',
                dialogue: 'string',
                visualPrompt: 'string',
                camera: 'string',
                referenceArtifactIds: ['string'],
              }],
              totalDurationSeconds: 'number',
              requiresHumanApproval: true,
              executionStatus: 'planning_only',
            },
          },
        },
        position: position(350, 220),
      },
      {
        id: 'video_plan',
        kind: 'tool',
        label: '制片岗位校验完整视频方案',
        roleId: 'production_manager',
        outputKind: 'plan',
        inputs: { plan: input('video_director_plan', 'plan') },
        config: {
          tool: 'video_plan',
          instruction: '只接受实际导演 plan；严格校验非空 shots、字段完整性、总时长及 planning_only，不生成视频。',
          parameters: { videoPlan: true },
        },
        position: position(660, 220),
      },
      {
        id: 'video_approval',
        kind: 'approval',
        label: '人工批准完整视频方案',
        outputKind: 'decision',
        inputs: {
          context: input('video_context', 'context'),
          plan: input('video_plan', 'plan'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'creative_director'],
          instruction: '展示服务校验后的实际分镜、时长和来源；确认后才允许采用方案。',
        },
        position: position(970, 220),
      },
      {
        id: 'video_adopt',
        kind: 'adopt',
        label: '采用已批准视频方案',
        outputKind: 'result',
        inputs: { approval: input('video_approval', 'decision') },
        config: {
          instruction: '仅采用已批准 planning_only 方案并保留计划来源；不启动真实视频渲染。',
        },
        position: position(1280, 220),
      },
    ],
    edges: [
      { id: 'video_context_director', source: 'video_context', target: 'video_director_plan' },
      { id: 'video_director_tool', source: 'video_director_plan', target: 'video_plan' },
      { id: 'video_context_approval', source: 'video_context', target: 'video_approval' },
      { id: 'video_plan_approval', source: 'video_plan', target: 'video_approval' },
      {
        id: 'video_approval_adopt',
        source: 'video_approval',
        target: 'video_adopt',
        when: 'approved',
      },
    ],
  };
}

export function createDefaultIllustrationWorkflow(): CreativeWorkflowDocument {
  return {
    name: '插图生成与审查',
    description: '运行输入选定真实图片工作流；视觉审核同时读取任务、提示词和实际图片，并在返修时先修提示词再复跑生图与审查。',
    purpose: 'illustration',
    nodes: [
      {
        id: 'illustration_context',
        kind: 'context',
        label: '原始 brief、角色与视觉上下文',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: position(40, 220),
      },
      {
        id: 'illustration_prompt',
        kind: 'agent',
        label: '设计图像提示词',
        roleId: 'prompt_engineer',
        outputKind: 'image-prompt',
        inputs: { context: input('illustration_context', 'context') },
        config: {
          instruction: '把原始任务、角色、动作、构图、环境、光线和风格写成可复现提示词。',
        },
        position: position(350, 220),
      },
      {
        id: 'illustration_generate',
        kind: 'tool',
        label: '使用运行输入指定工作流生图',
        roleId: 'art_director',
        outputKind: 'image',
        inputs: { prompt: input('illustration_prompt', 'image-prompt') },
        config: {
          tool: 'image_generation',
          instruction: '从运行 input 选择已登记且可用的图片工作流与版本，不在模板中硬编码工作流 ID。',
          parameters: { workflowSource: 'run_input' },
        },
        position: position(660, 220),
      },
      {
        id: 'illustration_visual_review',
        kind: 'agent',
        label: '对照任务、提示词与图片独立审查',
        roleId: 'visual_reviewer',
        outputKind: 'review',
        inputs: {
          brief: input('illustration_context', 'context'),
          prompt: input('illustration_prompt', 'image-prompt'),
          image: input('illustration_generate', 'image'),
        },
        config: {
          instruction: '必须同时读取原始 brief/context、最终提示词和实际图片；检查图文一致性、伪影、文字污染与交付质量。',
        },
        position: position(970, 220),
      },
      {
        id: 'illustration_revision',
        kind: 'revision',
        label: '定向修提示词并复跑图片审查',
        roleId: 'visual_reviewer',
        outputKind: 'image',
        inputs: { review: input('illustration_visual_review', 'review') },
        config: {
          instruction: '评价当前实际图片；需要返修时先修改 prompt_engineer 的提示词，再由 runtime 复跑生图与审查。历史反馈走 ctx.revision。',
          reviewerRoleIds: ['visual_reviewer'],
          maxRevisions: 2,
          targetNodeId: 'illustration_prompt',
        },
        position: position(1280, 340),
      },
      {
        id: 'illustration_approval',
        kind: 'approval',
        label: '图片采用审批门',
        outputKind: 'decision',
        inputs: {
          brief: input('illustration_context', 'context'),
          prompt: input('illustration_prompt', 'image-prompt'),
          image: input('illustration_generate', 'image'),
          review: input('illustration_visual_review', 'review'),
          revised_image: input('illustration_revision', 'image'),
        },
        config: {
          reviewerRoleIds: ['art_director', 'visual_reviewer'],
          instruction: '普通图片可由 server policy 依据审核结果自动写入批准决定；关键或未知重要性仍需人工确认。模板不声明重要性。',
        },
        position: position(1590, 220),
      },
      {
        id: 'illustration_adopt',
        kind: 'adopt',
        label: '采用插图与媒体引用',
        outputKind: 'result',
        inputs: { approval: input('illustration_approval', 'decision') },
        config: {
          instruction: '仅采用 server policy 或人工形成的最新 approved 决定，并保留提示词、生图、审核与返修谱系。',
        },
        position: position(1900, 220),
      },
    ],
    edges: [
      { id: 'illustration_context_prompt', source: 'illustration_context', target: 'illustration_prompt' },
      { id: 'illustration_prompt_generate', source: 'illustration_prompt', target: 'illustration_generate' },
      { id: 'illustration_context_review', source: 'illustration_context', target: 'illustration_visual_review' },
      { id: 'illustration_prompt_review', source: 'illustration_prompt', target: 'illustration_visual_review' },
      { id: 'illustration_generate_review', source: 'illustration_generate', target: 'illustration_visual_review' },
      {
        id: 'illustration_review_revision',
        source: 'illustration_visual_review',
        target: 'illustration_revision',
        when: 'always',
      },
      { id: 'illustration_context_approval', source: 'illustration_context', target: 'illustration_approval' },
      { id: 'illustration_prompt_approval', source: 'illustration_prompt', target: 'illustration_approval' },
      { id: 'illustration_generate_approval', source: 'illustration_generate', target: 'illustration_approval' },
      {
        id: 'illustration_review_approval',
        source: 'illustration_visual_review',
        target: 'illustration_approval',
        when: 'approved',
      },
      {
        id: 'illustration_revision_approval',
        source: 'illustration_revision',
        target: 'illustration_approval',
        when: 'always',
      },
      {
        id: 'illustration_approval_adopt',
        source: 'illustration_approval',
        target: 'illustration_adopt',
        when: 'approved',
      },
    ],
  };
}

export const DEFAULT_STORY_SCENE_TEMPLATE = createDefaultStorySceneWorkflow();
export const DEFAULT_STANDARD_STORY_SCENE_TEMPLATE = createStandardStorySceneWorkflow();
export const DEFAULT_CRITICAL_STORY_SCENE_TEMPLATE = createCriticalStorySceneWorkflow();
export const DEFAULT_VIDEO_PLAN_TEMPLATE = createDefaultVideoPlanWorkflow();
export const DEFAULT_ILLUSTRATION_TEMPLATE = createDefaultIllustrationWorkflow();

export const createStorySceneTemplate = createDefaultStorySceneWorkflow;
export const createVideoPlanTemplate = createDefaultVideoPlanWorkflow;
export const createIllustrationTemplate = createDefaultIllustrationWorkflow;

export function createCriticalStorySceneWorkflow(): CreativeWorkflowDocument {
  const base = createDefaultStorySceneWorkflow();
  return {
    ...base,
    name: '重要剧情精修（导演+双审）',
    description: '适用于主线大转折、高风险设定变更：创作导演规划＋重大变化确认＋主笔＋连贯编辑与总编双重独立审核（最多 2 轮返修）。',
  };
}

export function createStandardStorySceneWorkflow(): CreativeWorkflowDocument {
  return {
    name: '故事场景创作',
    description: '日常推荐：导演快速定调（重大变化触发确认）→ 主笔结合声线与反套话规范撰写 → 连贯与文风综合单审（最多 1 轮返修）→ 人工批准采用。',
    purpose: 'story',
    nodes: [
      {
        id: 'story_context',
        kind: 'context',
        label: '读取世界观、知情与伏笔',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: position(40, 220),
      },
      {
        id: 'story_director_plan',
        kind: 'agent',
        label: '导演简明定调与风险检查',
        roleId: 'creative_director',
        outputKind: 'plan',
        inputs: { context: input('story_context', 'context') },
        config: {
          instruction: [
            '输出简明 JSON plan（summary、requiresDirectionApproval、criticalChanges 及 3-5 条关键节拍），不写冗长长文。',
            '无角色死亡、永久伤残、身份阵营反转或核心设定颠覆时 requiresDirectionApproval=false 走快速直行；trusted run.input.criticalChange=true 时强制确认。',
          ].join('\n'),
          parameters: {
            outputContract: {
              summary: 'string',
              requiresDirectionApproval: 'boolean',
              criticalChanges: [{ description: 'string', reason: 'string' }],
            },
          },
        },
        position: position(350, 220),
      },
      {
        id: 'story_critical_change',
        kind: 'condition',
        label: '重大变化判断',
        outputKind: 'decision',
        inputs: { plan: input('story_director_plan', 'plan') },
        config: {
          condition: 'critical_change',
          instruction: '重大不可逆变化进入方向确认，常规场景直接交由主笔撰写。',
        },
        position: position(660, 220),
      },
      {
        id: 'story_direction_approval',
        kind: 'approval',
        label: '重大方向人工确认',
        outputKind: 'decision',
        inputs: {
          plan: input('story_director_plan', 'plan'),
          route: input('story_critical_change', 'decision'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'creative_director'],
          parameters: { directionGate: true },
          instruction: '只审阅导演 plan，尤其是 criticalChanges 的不可逆影响；拒绝时不得进入主笔。',
        },
        position: position(970, 90),
      },
      {
        id: 'story_plan_join',
        kind: 'join',
        label: '方案汇合',
        outputKind: 'plan',
        inputs: {
          plan: input('story_director_plan', 'plan'),
          ordinary_path: input('story_critical_change', 'decision'),
          approved_direction: input('story_direction_approval', 'decision'),
        },
        config: {
          instruction: '保留实际路径的 plan 与决策依赖。',
        },
        position: position(1280, 220),
      },
      {
        id: 'story_writer_scene',
        kind: 'agent',
        label: '场景主笔（心智推演＋正文）',
        roleId: 'lead_writer',
        outputKind: 'scene',
        inputs: {
          context: input('story_context', 'context'),
          plan: input('story_plan_join', 'plan'),
        },
        config: {
          instruction: '先写 sceneCraft（人物此刻目的/秘密/误判与微观节拍），再按作品文风指南、角色对白声线样本与活跃伏笔提示写出完整场景正文及结构化事件草案。',
        },
        position: position(1590, 220),
      },
      {
        id: 'story_continuity_review',
        kind: 'agent',
        label: '连贯与文风综合审核',
        roleId: 'continuity_editor',
        outputKind: 'review',
        inputs: {
          context: input('story_context', 'context'),
          scene: input('story_writer_scene', 'scene'),
        },
        config: {
          instruction: '单次合并核查：1) 人物知情隔离、时间线与状态连贯；2) 角色声线一致性、Show-Don\'t-Tell 与去 AI 套话情况；输出 1–5 分 scores；仅真实事实/结构冲突标 blocking。',
        },
        position: position(1900, 220),
      },
      {
        id: 'story_revision',
        kind: 'revision',
        label: '必要时定向返修（最多 1 轮）',
        roleId: 'continuity_editor',
        outputKind: 'review',
        inputs: { reviewed_scene: input('story_continuity_review', 'review') },
        config: {
          instruction: '仅存在 blocking 问题时由 runtime 复跑主笔与审校，最多 1 轮。',
          reviewerRoleIds: ['continuity_editor'],
          maxRevisions: 1,
          targetNodeId: 'story_writer_scene',
        },
        position: position(2210, 340),
      },
      {
        id: 'story_approval',
        kind: 'approval',
        label: '人工审阅并批准场景',
        outputKind: 'decision',
        inputs: {
          scene: input('story_writer_scene', 'scene'),
          review: input('story_continuity_review', 'review'),
          latest_review: input('story_revision', 'review'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'continuity_editor'],
          instruction: '呈现正文、声线与质量评分、审核意见；批准后正式写入故事历史。',
        },
        position: position(2520, 220),
      },
      {
        id: 'story_adopt',
        kind: 'adopt',
        label: '采用到正式故事',
        outputKind: 'result',
        inputs: { approval: input('story_approval', 'decision') },
        config: {
          instruction: '只采用最终人工批准的候选场景与设定/伏笔变化。',
        },
        position: position(2830, 220),
      },
    ],
    edges: [
      { id: 'story_context_director', source: 'story_context', target: 'story_director_plan' },
      { id: 'story_director_condition', source: 'story_director_plan', target: 'story_critical_change' },
      { id: 'story_director_join', source: 'story_director_plan', target: 'story_plan_join' },
      { id: 'story_director_direction', source: 'story_director_plan', target: 'story_direction_approval' },
      {
        id: 'story_critical_direction',
        source: 'story_critical_change',
        target: 'story_direction_approval',
        when: 'approved',
      },
      {
        id: 'story_critical_writer_path',
        source: 'story_critical_change',
        target: 'story_plan_join',
        when: 'rejected',
      },
      {
        id: 'story_direction_join',
        source: 'story_direction_approval',
        target: 'story_plan_join',
        when: 'approved',
      },
      { id: 'story_context_writer', source: 'story_context', target: 'story_writer_scene' },
      { id: 'story_join_writer', source: 'story_plan_join', target: 'story_writer_scene' },
      { id: 'story_context_continuity', source: 'story_context', target: 'story_continuity_review' },
      { id: 'story_writer_continuity', source: 'story_writer_scene', target: 'story_continuity_review' },
      { id: 'story_writer_approval', source: 'story_writer_scene', target: 'story_approval' },
      { id: 'story_continuity_revision', source: 'story_continuity_review', target: 'story_revision' },
      { id: 'story_continuity_approval', source: 'story_continuity_review', target: 'story_approval' },
      { id: 'story_revision_approval', source: 'story_revision', target: 'story_approval' },
      {
        id: 'story_approval_adopt',
        source: 'story_approval',
        target: 'story_adopt',
        when: 'approved',
      },
    ],
  };
}
