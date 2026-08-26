import type {
  CharacterAppearance,
  CharacterDraft,
  CharacterSpeech,
} from '@sthstart/contracts';
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

export type CharacterArrayName =
  | 'aliases'
  | 'personality'
  | 'motivations'
  | 'beliefs'
  | 'secrets'
  | 'likes'
  | 'dislikes'
  | 'fears'
  | 'boundaries'
  | 'speech.catchphrases'
  | 'speech.examples'
  | 'appearance.outfits'
  | 'appearance.accessories';

export type CharacterFormValues = Omit<
  CharacterDraft,
  | 'aliases'
  | 'personality'
  | 'motivations'
  | 'beliefs'
  | 'secrets'
  | 'likes'
  | 'dislikes'
  | 'fears'
  | 'boundaries'
  | 'speech'
  | 'appearance'
> & {
  aliases: StringField[];
  personality: StringField[];
  motivations: StringField[];
  beliefs: StringField[];
  secrets: StringField[];
  likes: StringField[];
  dislikes: StringField[];
  fears: StringField[];
  boundaries: StringField[];
  speech: Omit<CharacterSpeech, 'catchphrases' | 'examples'> & {
    catchphrases: StringField[];
    examples: StringField[];
  };
  appearance: Omit<CharacterAppearance, 'outfits' | 'accessories'> & {
    outfits: StringField[];
    accessories: StringField[];
  };
};

function toFields(values: string[] | undefined): StringField[] {
  return (values ?? []).map((value) => ({ value }));
}

function fromFields(values: StringField[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.value.trim())
    .filter(Boolean);
}

export function characterDraftToFormValues(draft: CharacterDraft): CharacterFormValues {
  return {
    displayName: draft.displayName,
    englishName: draft.englishName,
    originType: draft.originType,
    work: draft.work,
    world: draft.world,
    summary: draft.summary,
    identity: draft.identity,
    background: draft.background,
    currentSituation: draft.currentSituation,
    extraRules: draft.extraRules,
    legacyPrompt: draft.legacyPrompt,
    aliases: toFields(draft.aliases),
    personality: toFields(draft.personality),
    motivations: toFields(draft.motivations),
    beliefs: toFields(draft.beliefs),
    secrets: toFields(draft.secrets),
    likes: toFields(draft.likes),
    dislikes: toFields(draft.dislikes),
    fears: toFields(draft.fears),
    boundaries: toFields(draft.boundaries),
    speech: {
      tone: draft.speech.tone,
      habits: draft.speech.habits,
      catchphrases: toFields(draft.speech.catchphrases),
      examples: toFields(draft.speech.examples),
    },
    appearance: {
      description: draft.appearance.description,
      hair: draft.appearance.hair,
      eyes: draft.appearance.eyes,
      build: draft.appearance.build,
      outfits: toFields(draft.appearance.outfits),
      accessories: toFields(draft.appearance.accessories),
    },
  };
}

export function characterFormValuesToDraft(values: CharacterFormValues): CharacterDraft {
  return {
    displayName: values.displayName,
    englishName: values.englishName,
    originType: values.originType,
    work: values.work,
    world: values.world,
    summary: values.summary,
    identity: values.identity,
    background: values.background,
    currentSituation: values.currentSituation,
    extraRules: values.extraRules,
    legacyPrompt: values.legacyPrompt,
    aliases: fromFields(values.aliases),
    personality: fromFields(values.personality),
    motivations: fromFields(values.motivations),
    beliefs: fromFields(values.beliefs),
    secrets: fromFields(values.secrets),
    likes: fromFields(values.likes),
    dislikes: fromFields(values.dislikes),
    fears: fromFields(values.fears),
    boundaries: fromFields(values.boundaries),
    speech: {
      tone: values.speech.tone,
      habits: values.speech.habits,
      catchphrases: fromFields(values.speech.catchphrases),
      examples: fromFields(values.speech.examples),
    },
    appearance: {
      description: values.appearance.description,
      hair: values.appearance.hair,
      eyes: values.appearance.eyes,
      build: values.appearance.build,
      outfits: fromFields(values.appearance.outfits),
      accessories: fromFields(values.appearance.accessories),
    },
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
        <label className="text-xs font-semibold text-[#18201d]">{label}</label>
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
          <p className="rounded border border-dashed border-[rgb(24_32_29/16%)] px-3 py-2 text-xs text-[#68716d]">
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
