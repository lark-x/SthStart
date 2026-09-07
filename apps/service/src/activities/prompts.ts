import type { ContentDocument, StageDefinition } from '@sthstart/contracts';

export interface PlanGenerationOutput {
  schemaVersion: 1;
  overview: string;
  stages: {
    clientId: string;
    stageId?: string;
    title: string;
    actorIds: string[];
    location: string;
    description: string;
    requiredBeats: string[];
    endCondition: string;
  }[];
}

export interface StageGenerationOutput {
  schemaVersion: 1;
  stageId: string;
  summary: string;
  messages: {
    clientId: string;
    conversationId: string;
    speakerActorId: string;
    text: string;
    mediaClientIds?: string[];
    order: number;
    storyTimeLabel?: string;
  }[];
  posts: {
    clientId: string;
    authorActorId: string;
    text: string;
    mediaClientIds?: string[];
    sourceFactClientIds?: string[];
    order: number;
    storyTimeLabel?: string;
  }[];
  comments: {
    clientId: string;
    postClientId: string;
    authorActorId: string;
    text: string;
    order: number;
  }[];
  facts: {
    clientId: string;
    text: string;
    status: 'happened';
    sourceRecordClientIds: string[];
    knownByActorIds: string[];
  }[];
  mediaSlots: {
    clientId: string;
    kind: 'image' | 'video';
    caption: string;
    shotDescription: string;
    actorIds: string[];
    sourceFactClientIds: string[];
  }[];
}

export function buildPlanPrompt(content: ContentDocument, instructions?: string): string {
  const actorSummaries = content.actors
    .map((a) => {
      const p = a.persona as Record<string, unknown>;
      return `- [ID: ${a.id}] ${a.displayName}（职责: ${a.activityRole}，人设: ${p.personality || p.summary || '无'}，语气习惯: ${(p.speech as Record<string, unknown>)?.habits || p.speakingStyle || '自然'}）`;
    })
    .join('\n');

  const existingStages = content.stages
    .map((s, idx) => `- 阶段 ${idx + 1} [ID: ${s.id}]: ${s.title} (${s.locked ? '已锁定' : '可调整'}) - 地点: ${s.location} - 描述: ${s.instruction}`)
    .join('\n');

  return `你是一位专业的多角色互动故事编剧。请根据以下活动设定和角色人设，规划活动的各个阶段（至少 2 个阶段）。

【活动信息】
- 标题: ${content.activity.title}
- 类型: ${content.activity.type}
- 主题: ${content.activity.theme || '自由创作'}
- 地点: ${content.activity.location || '活动现场'}
- 规则: ${content.activity.rules || '自由'}
- 补充指示: ${instructions || '请合理安排起承转合，创造温馨有趣的多角色互动。'}

【参与角色列表】
${actorSummaries}

【已有阶段参考】
${existingStages || '暂无'}

【输出要求】
1. 必须输出且仅输出一个合法的 JSON 对象，不要包含 markdown 代码块以外的任何文字。
2. 包含至少 2 个阶段。若已有阶段已被标记为“已锁定”，请保留其 stageId、标题与核心约束；新建阶段使用 clientId（如 "plan_s1"）。
3. 严格使用以下 JSON 格式：
\`\`\`json
{
  "schemaVersion": 1,
  "overview": "整场活动方案的简要概述",
  "stages": [
    {
      "clientId": "plan_s1",
      "title": "阶段一标题",
      "actorIds": ["${content.actors[0]?.id || 'actor_1'}"],
      "location": "具体地点",
      "description": "本阶段发生的事情及角色行动",
      "requiredBeats": ["必须达成的关键事件"],
      "endCondition": "阶段结束条件"
    },
    {
      "clientId": "plan_s2",
      "title": "阶段二标题",
      "actorIds": ["${content.actors[0]?.id || 'actor_1'}"],
      "location": "具体地点",
      "description": "主要互动、合照或总结",
      "requiredBeats": ["合影留念"],
      "endCondition": "活动圆满结束"
    }
  ]
}
\`\`\``;
}

export function buildStagePrompt(
  content: ContentDocument,
  stage: StageDefinition,
  instructions?: string
): string {
  const actorSummaries = content.actors
    .map((a) => {
      const p = a.persona as Record<string, unknown>;
      return `- [ID: ${a.id}] ${a.displayName}（职责: ${a.activityRole}，人设: ${p.personality || p.summary || '无'}，说话习惯: ${(p.speech as Record<string, unknown>)?.habits || p.speakingStyle || '自然'}，口头禅: ${(p.speech as Record<string, unknown>)?.catchphrases || '无'}）`;
    })
    .join('\n');

  // Prior facts
  const priorFacts = content.facts
    .filter((f) => f.stageId !== stage.id && f.status === 'happened')
    .map((f) => `- [前序事实] ${f.text}`)
    .join('\n');

  const convId = content.conversations[0]?.id || 'group_main';

  return `你是一位专业的多角色互动故事编剧。请根据角色人设、前序事实与当前阶段要求，为本阶段生成真实的群聊对话、朋友圈动态与评论。

【活动主题】
${content.activity.title}（${content.activity.theme}）

【前序已发生事实】
${priorFacts || '无（这是活动的初始阶段）'}

【当前阶段要求】
- 阶段 ID: ${stage.id}
- 阶段名称: ${stage.title}
- 发生地点: ${stage.location}
- 参与角色 ID: ${stage.actorIds.join(', ')}
- 行动指示: ${stage.instruction}
- 必须发生的行动: ${stage.requiredBeats.map((b) => b.text).join('；') || '无'}
- 结束条件: ${stage.endCondition}
- 补充指示: ${instructions || '生动体现每位角色的鲜明性格，避免千人一面。'}

【允许引用的角色 ID】
${actorSummaries}

【会话 ID】
${convId}

【输出规范】
1. 只输出合法 JSON，严禁在 JSON 外输出任何解释。
2. 对话要自然流畅，有问有答，体现不同角色的性格差异与说话习惯。
3. 朋友圈帖子必须基于阶段内已发生的事实，评论时间在发帖之后。
4. 消息和帖子如有拍照/录像需求，可在 mediaSlots 中声明槽位（kind 为 'image' 或 'video'），并在 messages/posts 的 mediaClientIds 中引用其 clientId。
5. 必须输出合法的 JSON，格式如下：
\`\`\`json
{
  "schemaVersion": 1,
  "stageId": "${stage.id}",
  "summary": "本阶段简要纪要",
  "messages": [
    {
      "clientId": "m1",
      "conversationId": "${convId}",
      "speakerActorId": "${stage.actorIds[0] || 'actor_1'}",
      "text": "大家准备好了吗？",
      "mediaClientIds": [],
      "order": 10,
      "storyTimeLabel": "10:00"
    }
  ],
  "posts": [
    {
      "clientId": "p1",
      "authorActorId": "${stage.actorIds[0] || 'actor_1'}",
      "text": "美好的一天从这里开始！",
      "mediaClientIds": [],
      "sourceFactClientIds": ["f1"],
      "order": 20,
      "storyTimeLabel": "10:15"
    }
  ],
  "comments": [
    {
      "clientId": "c1",
      "postClientId": "p1",
      "authorActorId": "${stage.actorIds[1] || stage.actorIds[0] || 'actor_2'}",
      "text": "出发！",
      "order": 30
    }
  ],
  "facts": [
    {
      "clientId": "f1",
      "text": "成员已在营地完成集合",
      "status": "happened",
      "sourceRecordClientIds": ["m1"],
      "knownByActorIds": [${stage.actorIds.map((id) => `"${id}"`).join(', ')}]
    }
  ],
  "mediaSlots": []
}
\`\`\``;
}

export function buildRewritePrompt(
  content: ContentDocument,
  targetRecordIds: string[],
  reason: string
): string {
  const targetMessages = content.messages.filter((m) => targetRecordIds.includes(m.id));
  const targetPosts = content.posts.filter((p) => targetRecordIds.includes(p.id));

  return `你是一位专业编剧。请根据用户提出的修改原因，重新改写以下记录，保持与上下文人设和事实的一致性。

【修改原因】
${reason}

【待改写记录】
${JSON.stringify({ messages: targetMessages, posts: targetPosts }, null, 2)}

【输出要求】
仅输出包含改写后 records 的合法 JSON：
\`\`\`json
{
  "schemaVersion": 1,
  "rewrittenMessages": [
    {
      "id": "原消息ID",
      "text": "改写后的消息内容"
    }
  ],
  "rewrittenPosts": [
    {
      "id": "原动态ID",
      "text": "改写后的动态内容"
    }
  ]
}
\`\`\``;
}

export function parseAiJsonOutput<T>(rawText: string): T {
  let cleaned = rawText.trim();
  // Strip Markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`AI 输出无法解析为 JSON: ${(err as Error).message}\n原始输出前 300 字符: ${cleaned.slice(0, 300)}`);
  }
}
