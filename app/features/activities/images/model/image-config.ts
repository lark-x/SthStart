import type { ImageConfigDocument, SlotImageConfig } from '@sthstart/contracts';

/** 读取某个镜头的配置；没有时返回只含 slotId 的继承占位。 */
export function findSlotConfig(
  document: ImageConfigDocument | null | undefined,
  slotId: string | undefined,
): SlotImageConfig {
  if (!document || !slotId) return { slotId: slotId || '' };
  return document.slotConfigs.find((config) => config.slotId === slotId) || { slotId };
}

/** 只更新目标镜头，保留其它镜头配置和文档里的全局字段。 */
export function upsertSlotConfig(
  document: ImageConfigDocument,
  slotId: string,
  patch: Partial<SlotImageConfig>,
): ImageConfigDocument {
  const existing = document.slotConfigs || [];
  const index = existing.findIndex((config) => config.slotId === slotId);
  const slotConfigs = index >= 0
    ? existing.map((config, itemIndex) => itemIndex === index ? { ...config, ...patch } : config)
    : [...existing, { slotId, ...patch }];
  return { ...document, slotConfigs };
}
