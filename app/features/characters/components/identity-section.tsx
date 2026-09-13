'use client';

import React from 'react';
import type { CharacterDraftV2 } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { TagsInput } from '@/app/components/shared/tags-input';
import {
  StringListField,
  type CharacterFormValues,
} from './character-form';
import { BirthdayField } from './birthday-field';

const PERSONA_PLACEHOLDER = [
  '### 身份',
  '她的社会身份、对外形象与职责。',
  '',
  '### 关键经历',
  '哪些事塑就了现在的她。',
  '',
  '### 性格',
  '- 表层的语气与处世方式',
  '- 话语与行动的反差',
  '',
  '### 好恶',
  '- 喜欢：…',
  '- 不喜欢：…',
  '- 害怕：…',
  '',
  '### 内心隐情',
  '不轻易主动说出的事。',
].join('\n');

export function IdentitySection({
  draft,
  tags,
  onChange,
  onTagsChange,
  control,
  register,
  displayNameError,
}: {
  draft: CharacterDraftV2;
  tags: string[];
  onChange: (patch: Partial<CharacterDraftV2>) => void;
  onTagsChange: (tags: string[]) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  displayNameError?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-border-subtle">
        <h3 className="text-xl font-medium text-ink">身份与人设</h3>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          先填名字和一段人设正文即可保存。身份、经历、性格、好恶与内心的矛盾都可以写进正文，
          用「### 小标题」分段即可，不必拆成许多字段。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-sm font-semibold text-ink">
          <span>
            角色名称 <span className="text-danger">*</span>
          </span>
          <Input
            value={draft.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder="例如：芙宁娜"
            required
            error={displayNameError}
            aria-describedby={displayNameError ? 'character-display-name-error' : undefined}
            className="mt-1.5"
          />
          {displayNameError && (
            <p id="character-display-name-error" role="alert" className="mt-1 text-sm text-danger">
              {displayNameError}
            </p>
          )}
        </label>

        <label className="block text-sm font-semibold text-ink">
          <span>英文名 / 拼音</span>
          <Input
            value={draft.englishName}
            onChange={(e) => onChange({ englishName: e.target.value })}
            placeholder="Furina"
            className="mt-1.5"
          />
        </label>

        <label className="block text-sm font-semibold text-ink">
          <span>来源类型</span>
          <Select
            value={draft.originType}
            onChange={(e) => onChange({ originType: e.target.value as 'original' | 'ip' })}
            className="mt-1.5"
          >
            <option value="original">原创角色</option>
            <option value="ip">已有作品角色 (IP)</option>
          </Select>
        </label>

        <label className="block text-sm font-semibold text-ink">
          <span>所属作品</span>
          <Input
            value={draft.work}
            onChange={(e) => onChange({ work: e.target.value })}
            placeholder="例如：原神"
            className="mt-1.5"
          />
        </label>

        <div className="sm:col-span-2">
          <BirthdayField
            value={draft.birthday}
            onChange={(birthday) => onChange({ birthday })}
          />
        </div>

        <StringListField
          control={control}
          register={register}
          name="aliases"
          label="别名 / 称号"
          placeholder="例如：芙芙"
        />
      </div>

      <label className="block text-sm font-semibold text-ink">
        <span>一句话人物摘要（列表与卡片显示用，可留空）</span>
        <Textarea
          rows={2}
          value={draft.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="枫丹前水神，聚光灯下华丽戏剧化，内心敏感孤单的戏剧家。"
          className="mt-1.5"
        />
      </label>

      <label className="block text-sm font-semibold text-ink">
        <span>人设正文</span>
        <Textarea
          rows={18}
          value={draft.personaText}
          onChange={(e) => onChange({ personaText: e.target.value })}
          placeholder={PERSONA_PLACEHOLDER}
          className="mt-1.5"
        />
      </label>

      <label className="block text-sm font-semibold text-ink">
        <span>标签分类（逗号分隔）</span>
        <TagsInput
          value={tags}
          onChange={onTagsChange}
          placeholder="原神，枫丹，水神，戏剧"
          className="mt-1.5"
        />
      </label>
    </div>
  );
}
