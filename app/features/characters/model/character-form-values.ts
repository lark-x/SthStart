import type {
  CharacterBirthday,
  ActivityLora,
  CharacterDraftAny,
  CharacterDraftV2,
} from '@sthstart/contracts';
import { toCharacterRuntime } from '@sthstart/contracts';
import { cleanseHtmlText } from '../cleanse';

export type StringField = { value: string };

/**
 * 编辑器表单值：与 V2 草稿一一对应。
 *
 * 迁移后的角色无论来源是 V1 还是 V2，都通过 toCharacterRuntime 归一到这套字段；
 * 日常只维护人设正文、说话方式、基础外貌与默认穿着四块内容。
 */
export type CharacterFormValues = {
  displayName: string;
  englishName: string;
  originType: 'original' | 'ip';
  work: string;
  summary: string;
  personaText: string;
  speechText: string;
  behaviorRules: string;
  aliases: StringField[];
  dialogueExamples: StringField[];
  appearance: { baseText: string; defaultOutfitText: string };
  visualLoras: ActivityLora[];
  birthday: CharacterBirthday;
};

function toFields(values: string[] | undefined): StringField[] {
  return (values ?? []).map((value) => ({ value: cleanseHtmlText(value) }));
}

function fromFields(values: StringField[] | undefined): string[] {
  return (values ?? [])
    .map((item) => cleanseHtmlText(item.value.trim()))
    .filter(Boolean);
}

export function characterDraftToFormValues(draft: CharacterDraftAny): CharacterFormValues {
  const runtime = toCharacterRuntime(draft);
  return {
    displayName: cleanseHtmlText(runtime.displayName),
    englishName: cleanseHtmlText(runtime.englishName),
    originType: runtime.originType,
    work: cleanseHtmlText(runtime.work),
    summary: cleanseHtmlText(runtime.summary),
    personaText: cleanseHtmlText(runtime.personaText),
    speechText: cleanseHtmlText(runtime.speechText),
    behaviorRules: cleanseHtmlText(runtime.behaviorRules),
    aliases: toFields([...runtime.aliases]),
    dialogueExamples: toFields([...runtime.dialogueExamples]),
    appearance: {
      baseText: cleanseHtmlText(runtime.appearance.baseText),
      defaultOutfitText: cleanseHtmlText(runtime.appearance.defaultOutfitText),
    },
    visualLoras: 'visualLoras' in draft ? [...(draft.visualLoras ?? [])] : [],
    birthday: ('birthday' in draft && draft.birthday) ? draft.birthday : { status: 'unset', calendar: 'unknown' },
  };
}

/** 表单 → V2 草稿。保存永远提交 V2，避免同一角色存在两套可编辑结构。 */
export function characterFormValuesToDraft(values: CharacterFormValues): CharacterDraftV2 {
  return {
    schemaVersion: 2,
    displayName: cleanseHtmlText(values.displayName),
    englishName: cleanseHtmlText(values.englishName),
    originType: values.originType,
    work: cleanseHtmlText(values.work),
    summary: cleanseHtmlText(values.summary),
    personaText: cleanseHtmlText(values.personaText),
    speechText: cleanseHtmlText(values.speechText),
    dialogueExamples: fromFields(values.dialogueExamples),
    behaviorRules: cleanseHtmlText(values.behaviorRules),
    aliases: fromFields(values.aliases),
    appearance: {
      baseText: cleanseHtmlText(values.appearance.baseText),
      defaultOutfitText: cleanseHtmlText(values.appearance.defaultOutfitText),
    },
    visualLoras: values.visualLoras,
    birthday: values.birthday || { status: 'unset', calendar: 'unknown' },
  };
}
