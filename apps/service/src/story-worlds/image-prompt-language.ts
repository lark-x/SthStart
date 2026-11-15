/**
 * 故事配图的提示词语言适配。
 *
 * Anima 一类模型以英文标签/自然语言训练，中文长描述会退化成黑白草图或错误结构。
 * 工作流在 editorConfig 声明 promptLanguage:'en' 时，提交前用应用已配置的文本模型
 * 把服务端组装的中文描述改写成英文，并按提示词哈希缓存，重试不重复计费。
 */
import { createHash } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../providers.js';
import { collectAiCallRedactionSecrets, createAiCallRecord, updateAiCallRecord } from '../ai-call-trace.js';
import { StoryWorldError } from './store.js';

export interface EnglishImagePromptInput {
  database: ServiceDatabase;
  secrets: SecretStore;
  appId: string;
  prompt: string;
  negativePrompt: string;
  workflowId: string | null;
  workflowVersion: number | null;
  /** 活动画风提供的画师串与质量词；为空时由模型自行选择中性二次元画风。 */
  styleHints?: string;
  fetcher?: typeof fetch;
}

export interface EnglishImagePromptResult { prompt: string; negativePrompt: string; cached: boolean; }

const SYSTEM_PROMPT = [
  'You rewrite a storyboard description into a single English image prompt for an anime illustration model.',
  'Render it as a modern Japanese anime illustration: anime screencap, cel shading, flat colors, clean lineart, expressive eyes.',
  'Never render it as a photograph, 3D render, oil painting or western cartoon.',
  'Preserve every stated fact exactly: the number of people, which named person does what, clothing colors, props, object states such as unlit, location and time of day.',
  'Describe the body pose and hand action of each person concretely so their interactions read clearly.',
  'Show each person from a three-quarter front angle with the face visible unless the source explicitly states otherwise; never turn the characters backs to the viewer.',
  'Translate props by what the reader would recognize: a 黄铜灯 is a brass lantern with a glass globe and a wire guard, never an oil kettle, magic lamp or teapot.',
  'Keep the described action large enough to read: use a medium shot when people are interacting with an object, and reserve wide shots for scenes without a central action.',
  'Output exactly two lines and nothing else:',
  'PROMPT: <one English paragraph, at most 120 words, no quotes>',
  'NEGATIVE: <short comma-separated English exclusions>',
  'Invent no new characters, props, artists or quality-tag spam. Do not translate a stated fact into a different one.',
].join(' ');

function normalizeLine(value: string) { return value.replace(/\s+/g, ' ').trim(); }

export function parseEnglishPromptRewrite(content: string): { prompt: string; negativePrompt: string } {
  const promptMatch = content.match(/PROMPT:\s*([\s\S]*?)(?:\n\s*NEGATIVE:|$)/i);
  const negativeMatch = content.match(/NEGATIVE:\s*([\s\S]*)/i);
  const firstLine = content.split('\n')[0] ?? '';
  const prompt = normalizeLine(promptMatch?.[1] ?? (/NEGATIVE:/i.test(firstLine) ? '' : firstLine));
  const negativePrompt = normalizeLine(negativeMatch?.[1] ?? '');
  if (!prompt || prompt.length > 2000) throw new StoryWorldError('story_image_prompt_language_invalid', 502, '文本模型未返回有效的英文提示词，未提交图片任务。');
  if (negativePrompt.length > 800) throw new StoryWorldError('story_image_prompt_language_invalid', 502, '文本模型返回的英文负向提示词过长，未提交图片任务。');
  return { prompt, negativePrompt };
}

export async function ensureEnglishImagePrompt(input: EnglishImagePromptInput): Promise<EnglishImagePromptResult> {
  const styleHints = (input.styleHints ?? '').replace(/\s+/g, ' ').trim();
  // v2：画风锚点从“anime illustration”收紧到“anime screencap / cel shading”，
  // 旧缓存不能再复用，否则同一段描述仍会拿到偏写实的改写结果。
  const cacheKey = `story-image-en-v2:${createHash('sha256').update(`${input.prompt}\n${input.negativePrompt}\n${styleHints}`).digest('hex').slice(0, 40)}`;
  const prior = input.database.connection.prepare(`SELECT status,response_text FROM ai_call_records
    WHERE application_id=? AND feature='story-image-prompt-en' AND object_id=? ORDER BY requested_at DESC LIMIT 1`).get(input.appId, cacheKey) as { status: string; response_text: string | null } | undefined;
  if (prior?.status === 'succeeded' && prior.response_text) {
    const saved = JSON.parse(prior.response_text) as { prompt?: unknown; negativePrompt?: unknown };
    if (typeof saved.prompt === 'string' && saved.prompt.trim()) {
      return { prompt: saved.prompt, negativePrompt: typeof saved.negativePrompt === 'string' ? saved.negativePrompt : input.negativePrompt, cached: true };
    }
  }
  if (prior && prior.status !== 'failed' && prior.status !== 'succeeded') {
    throw new StoryWorldError('story_image_prompt_language_pending', 409, '英文提示词改写尚未完成或结果未知，请稍后刷新再试。');
  }
  const profile = await resolveAssignedLlmProfile(input.database, input.secrets, input.appId, 'text');
  if (!profile?.model) throw new StoryWorldError('story_image_prompt_language_unavailable', 503, '当前应用未配置文本模型，无法把场景描述改写为英文提示词。');
  const callId = createAiCallRecord(input.database, { applicationId: input.appId, feature: 'story-image-prompt-en',
    businessEvent: 'story.image.prompt.english', objectType: 'story-image-prompt', objectId: cacheKey, callType: 'llm',
    workflowId: input.workflowId, workflowVersion: input.workflowVersion, provider: profile.name, models: [profile.model],
    positivePrompt: input.prompt, negativePrompt: input.negativePrompt,
    parameters: { temperature: 0.2, maxTokens: 700, language: 'en' },
    requestSnapshot: { prompt: input.prompt, negativePrompt: input.negativePrompt, styleHints, workflowId: input.workflowId, workflowVersion: input.workflowVersion },
    redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }) });
  const secrets = collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody });
  try {
    updateAiCallRecord(input.database, callId, { status: 'submitted', redactionSecrets: secrets });
    const response = await (input.fetcher ?? fetch)(`${profile.baseUrl}/chat/completions`, { method: 'POST',
      headers: { ...upstreamHeaders(profile.secret), ...profile.headers }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: profile.model, temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: styleHints ? `${input.prompt}\n\nSTYLE (already decided, do not contradict): ${styleHints}` : input.prompt }] }) });
    if (!response.ok) throw new StoryWorldError('story_image_prompt_language_failed', 502, `英文提示词模型返回 HTTP ${response.status}，未提交图片任务。`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new StoryWorldError('story_image_prompt_language_failed', 502, '英文提示词模型没有返回内容，未提交图片任务。');
    const parsed = parseEnglishPromptRewrite(content);
    updateAiCallRecord(input.database, callId, { status: 'succeeded', responseText: JSON.stringify(parsed), redactionSecrets: secrets });
    return { ...parsed, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAiCallRecord(input.database, callId, { status: 'failed', errorCode: 'story_image_prompt_language_failed', errorMessage: message.slice(0, 300), redactionSecrets: secrets });
    throw error;
  }
}
