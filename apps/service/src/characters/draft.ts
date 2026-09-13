import {
  EMPTY_CHARACTER_DRAFT,
  EMPTY_CHARACTER_DRAFT_V2,
  characterV1View,
  isCharacterDraftV2,
  migrateCharacterDraftToV2,
  normalizeCharacterDraft as normalizeV1Draft,
  normalizeCharacterDraftV2,
  type CharacterDraft,
  type CharacterDraftV2,
} from '@sthstart/contracts';
import { EMPTY_BIRTHDAY, normalizeBirthday } from './birthday.js';

/**
 * 角色草稿的两种存储形态：
 * - V1：细分字段（仅兼容读取与迁移来源）；
 * - V2：人设正文 / 说话方式 / 基础外貌 / 默认穿着（新写入的唯一形态）。
 */
export type CharacterDraftAny = CharacterDraft | CharacterDraftV2;

export const EMPTY_DRAFT: CharacterDraft = { ...EMPTY_CHARACTER_DRAFT, birthday: { ...EMPTY_BIRTHDAY } };
export const EMPTY_DRAFT_V2: CharacterDraftV2 = { ...EMPTY_CHARACTER_DRAFT_V2, birthday: { ...EMPTY_BIRTHDAY } };

export function text(value: unknown, max = 20_000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function list(value: unknown, maxItems = 30) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, 1_000)).filter(Boolean))].slice(0, maxItems) : [];
}

export function isV2Draft(value: unknown): value is CharacterDraftV2 {
  return isCharacterDraftV2(value);
}

/**
 * 只读的 V1 兼容视图，供仍按细分字段读取的旧路径使用。
 * 不要用它回写草稿：任何写入都必须落在 V2 上。
 */
export function toV1View(draft: CharacterDraftAny): CharacterDraft {
  return characterV1View(draft);
}

/**
 * 把外部提交的草稿统一为权威存储形态。
 *
 * - V2 载荷：归一化后直接存储；
 * - V1 载荷：按迁移规则无损组合为 V2（文字全部保留，只重新分配字段结构）。
 *
 * 所有写入都落在 V2 上，避免同一角色存在两套可编辑结构。
 */
export function toAuthorityDraft(raw: unknown): CharacterDraftV2 {
  if (isCharacterDraftV2(raw)) return normalizeCharacterDraft(raw) as CharacterDraftV2;
  return migrateCharacterDraftToV2(raw).draft;
}

/**
 * 权威解析草稿 JSON。
 *
 * 保留输入所属的结构版本，不擅自升级 V1 或降级 V2——静默转换会让未迁移数据在
 * 读取路径上被改写。调用方若要 V2 形态，使用 migrateCharacterDraftToV2；若要统一
 * 运行时视图，使用 @sthstart/contracts 的 toCharacterRuntime。
 */
export function normalizeCharacterDraft(raw: unknown): CharacterDraftAny {
  if (isCharacterDraftV2(raw)) {
    const draft = normalizeCharacterDraftV2(raw);
    return { ...draft, birthday: normalizeBirthday(draft.birthday) };
  }
  const draft = normalizeV1Draft(raw);
  return { ...draft, birthday: normalizeBirthday(draft.birthday) };
}
