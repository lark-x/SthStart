import { Type, type Static } from '@sinclair/typebox';

/**
 * 阶段 4C：三类图片历史响应共用的可选操作元数据（计划 §13.1）。
 *
 * 单独放在无依赖的叶子模块，避免与 ai-calls / activity-comic / activity-image-hires
 * 之间形成循环引用。旧行不回填；字段缺失时界面按 render 显示。
 */

const id = () => Type.String({ minLength: 1, maxLength: 160 });
const nullableId = () => Type.Union([id(), Type.Null()]);

export const ImageOperationMetadataSchema = Type.Object({
  operation: Type.Union([Type.Literal('render'), Type.Literal('hires')]),
  parentArtifactId: nullableId(),
  studioJobId: nullableId(),
}, { additionalProperties: false });
export type ImageOperationMetadata = Static<typeof ImageOperationMetadataSchema>;
