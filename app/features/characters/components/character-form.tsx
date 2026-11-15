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
import type { CharacterFormValues } from '../model/character-form-values';

export {
  characterDraftToFormValues,
  characterFormValuesToDraft,
  type CharacterFormValues,
  type StringField,
} from '../model/character-form-values';

export type CharacterArrayName = 'aliases' | 'dialogueExamples';

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
        <label className="text-xs font-medium text-fg-subtle">{label}</label>
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
          <p className="rounded-control border border-dashed border-border-subtle px-3 py-2 text-xs text-muted">
            暂无条目，点击“添加”开始填写。
          </p>
        )}
        {fields.map((field, index) => {
          const fieldName = `${name}.${index}.value` as FieldPath<CharacterFormValues>;
          return (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                {...register(fieldName)}
                aria-label={`${label} ${index + 1}`}
                placeholder={placeholder}
                className="text-base sm:text-sm"
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
