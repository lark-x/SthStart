import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CreativeOutputRejectedError } from './runtime.js';

const strict = { additionalProperties: false };
const words = (maxLength: number) => Type.String({ maxLength });
export const CreativeVideoPlanSchema = Type.Object({
  kind: Type.Literal('video-plan'), title: Type.String({ minLength: 1, maxLength: 200 }),
  brief: Type.String({ minLength: 1, maxLength: 12000 }),
  shots: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 160 }),
    durationSeconds: Type.Number({ minimum: 0.5, maximum: 120 }),
    description: Type.String({ minLength: 1, maxLength: 8000 }), dialogue: words(8000),
    visualPrompt: Type.String({ minLength: 1, maxLength: 12000 }), camera: Type.String({ minLength: 1, maxLength: 2000 }),
    referenceArtifactIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 10, uniqueItems: true }),
  }, strict), { minItems: 1, maxItems: 30 }),
  totalDurationSeconds: Type.Number({ minimum: 0.5, maximum: 1800 }),
  requiresHumanApproval: Type.Literal(true), executionStatus: Type.Literal('planning_only'),
}, strict);
export type CreativeVideoPlan = Static<typeof CreativeVideoPlanSchema>;

export function validateCreativeVideoPlan(value: unknown): CreativeVideoPlan {
  if (!Value.Check(CreativeVideoPlanSchema, value)) throw new CreativeOutputRejectedError('视频方案需包含完整分镜、时长、镜头、台词及视觉描述。');
  const duration = value.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  if (Math.abs(duration - value.totalDurationSeconds) > 0.01 || new Set(value.shots.map(shot => shot.id)).size !== value.shots.length) {
    throw new CreativeOutputRejectedError('视频方案的镜头编号必须唯一，总时长必须与各镜头之和一致。');
  }
  return value;
}
