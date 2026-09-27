// Runtime mirror of activity-image-prompts.ts.
import { Type } from '@sinclair/typebox';

export const DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS = `Rewrite the activity image description as one concise English image prompt, using concrete visual tags and short natural-language phrases.
Order the information as: character count and identity; distinctive appearance and clothing; visible action and expression; shot size and camera composition; location, time and environment; small visual details.
Preserve every specified character, count, appearance detail, action, location, time and camera constraint. For multiple characters, keep each person's appearance and action clearly associated with that person. Do not invent characters, events or visual details absent from the source.
Do not add artist names, quality ratings, score tags or generic style labels: the selected style configuration and workflow add those separately. Do not include dialogue text in the image.
Return one English prompt line only, with no explanation or Markdown.`;

export const ActivityImagePromptPolicySchema = Type.Object({
  workflowId: Type.String(),
  workflowVersion: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  enabled: Type.Boolean(),
  instructions: Type.String(),
  positiveSuffix: Type.String(),
  negativePrompt: Type.String(),
  createdAt: Type.String(),
});

export const ActivityImagePromptOptimizerSchema = Type.Object({
  ready: Type.Boolean(),
  profileName: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
});

export const ActivityImagePromptPolicyResponseSchema = Type.Object({
  policy: Type.Union([ActivityImagePromptPolicySchema, Type.Null()]),
  optimizer: ActivityImagePromptOptimizerSchema,
});

export const SaveActivityImagePromptPolicyRequestSchema = Type.Object({
  workflowId: Type.String({ minLength: 1 }),
  workflowVersion: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  enabled: Type.Boolean(),
  instructions: Type.String({ maxLength: 20000 }),
  positiveSuffix: Type.String({ maxLength: 4000 }),
  negativePrompt: Type.String({ maxLength: 4000 }),
});
