import type {
  CharacterBirthday,
  CharacterDraftAny,
  CharacterDraftV2,
} from '@sthstart/contracts';
import { toCharacterRuntime } from '@sthstart/contracts';
import type {
  Control,
  FieldArrayPath,
  FieldPath,
  UseFormRegister,
} from 'react-hook-form';
import { useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';

export type StringField = { value: string };

export type CharacterArrayName = 'aliases' | 'dialogueExamples';

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
  birthday: CharacterBirthday;
};

function toFields(values: string[] | undefined): StringField[] {
  return (values ?? []).map((value) => ({ value }));
}

function fromFields(values: StringField[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.value.trim())
    .filter(Boolean);
}

export function characterDraftToFormValues(draft: CharacterDraftAny): CharacterFormValues {
  const runtime = toCharacterRuntime(draft);
  return {
    displayName: runtime.displayName,
    englishName: runtime.englishName,
    originType: runtime.originType,
    work: runtime.work,
    summary: runtime.summary,
    personaText: runtime.personaText,
    speechText: runtime.speechText,
    behaviorRules: runtime.behaviorRules,
    aliases: toFields([...runtime.aliases]),
    dialogueExamples: toFields([...runtime.dialogueExamples]),
    appearance: {
      baseText: runtime.appearance.baseText,
      defaultOutfitText: runtime.appearance.defaultOutfitText,
    },
    birthday: ('birthday' in draft && draft.birthday) ? draft.birthday : { status: 'unset', calendar: 'unknown' },
  };
}

/** 表单 → V2 草稿。保存永远提交 V2，避免同一角色存在两套可编辑结构。 */
export function characterFormValuesToDraft(values: CharacterFormValues): CharacterDraftV2 {
  return {
    schemaVersion: 2,
    displayName: values.displayName,
    englishName: values.englishName,
    originType: values.originType,
    work: values.work,
    summary: values.summary,
    personaText: values.personaText,
    speechText: values.speechText,
    dialogueExamples: fromFields(values.dialogueExamples),
    behaviorRules: values.behaviorRules,
    aliases: fromFields(values.aliases),
    appearance: {
      baseText: values.appearance.baseText,
      defaultOutfitText: values.appearance.defaultOutfitText,
    },
    birthday: values.birthday || { status: 'unset', calendar: 'unknown' },
  };
}

export function StringListField({
  control,
  register,
  name,
  label,
  placeholder,
  className,
}: {
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  name: CharacterArrayName;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: name as FieldArrayPath<CharacterFormValues>,
  });

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-sm font-semibold text-ink">{label}</label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => append({ value: '' } as never)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>添加</span>
        </Button>
      </div>

      <div className="space-y-2">
        {fields.length === 0 && (
          <p className="rounded border border-dashed border-border-default px-3 py-2 text-sm text-muted">
            暂无条目，点击“添加”开始填写。
          </p>
        )}
        {fields.map((field, index) => {
          const fieldName = `${name}.${index}.value` as FieldPath<CharacterFormValues>;
          return (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                {...register(fieldName)}
                defaultValue={field.value}
                aria-label={`${label} ${index + 1}`}
                placeholder={placeholder}
              />
              <IconButton
                type="button"
                icon={Trash2}
                label={`删除${label}第 ${index + 1} 项`}
                variant="danger-ghost"
                onClick={() => remove(index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
