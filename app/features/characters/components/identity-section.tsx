'use client';

import React from 'react';
import type { CharacterDraft } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { TagsInput } from '@/app/components/shared/tags-input';
import {
  StringListField,
  type CharacterFormValues,
} from './character-form';

export function IdentitySection({
  draft,
  tags,
  onChange,
  onTagsChange,
  control,
  register,
  displayNameError,
}: {
  draft: CharacterDraft;
  tags: string[];
  onChange: (patch: Partial<CharacterDraft>) => void;
  onTagsChange: (tags: string[]) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  displayNameError?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-[rgb(24_32_29/10%)]">
        <h3 className="font-serif text-2xl font-medium text-[#18201d]">身份与经历</h3>
        <p className="text-xs text-[#68716d] mt-1 leading-relaxed">
          先写清楚她是怎样的一个人，再写她为什么会成为现在的样子。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-xs font-semibold text-[#18201d]">
          <span>
            角色名称 <span className="text-[#c9674a]">*</span>
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
            <p id="character-display-name-error" role="alert" className="mt-1 text-[10px] text-[#c9674a]">
              {displayNameError}
            </p>
          )}
        </label>

        <label className="block text-xs font-semibold text-[#18201d]">
          <span>
            英文名 / 拼音
          </span>
          <Input
            value={draft.englishName}
            onChange={(e) => onChange({ englishName: e.target.value })}
            placeholder="Furina"
            className="mt-1.5"
          />
        </label>

        <label className="block text-xs font-semibold text-[#18201d]">
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

        <label className="block text-xs font-semibold text-[#18201d]">
          <span>所属作品</span>
          <Input
            value={draft.work}
            onChange={(e) => onChange({ work: e.target.value })}
            placeholder="例如：原神"
            className="mt-1.5"
          />
        </label>

        <label className="block text-xs font-semibold text-[#18201d]">
          <span>所属世界 / 舞台</span>
          <Input
            value={draft.world}
            onChange={(e) => onChange({ world: e.target.value })}
            placeholder="例如：提瓦特 / 枫丹"
            className="mt-1.5"
          />
        </label>

        <StringListField
          control={control}
          register={register}
          name="aliases"
          label="别名 / 称号"
          placeholder="例如：芙芙"
        />
      </div>

      <label className="block text-xs font-semibold text-[#18201d]">
        <span>一句话人物摘要</span>
        <Textarea
          rows={2}
          value={draft.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="枫丹前水神，聚光灯下华丽戏剧化，内心敏感孤单的戏剧家。"
          className="mt-1.5"
        />
      </label>

      <label className="block text-xs font-semibold text-[#18201d]">
        <span>身份与定位</span>
        <Textarea
          rows={4}
          value={draft.identity}
          onChange={(e) => onChange({ identity: e.target.value })}
          placeholder="她的社会身份、对外形象、扮演的职责与他人眼中的她。"
          className="mt-1.5"
        />
      </label>

      <label className="block text-xs font-semibold text-[#18201d]">
        <span>关键过往经历</span>
        <Textarea
          rows={6}
          value={draft.background}
          onChange={(e) => onChange({ background: e.target.value })}
          placeholder="经历过哪些决定性的事件？哪些记忆塑就了现在的她？"
          className="mt-1.5"
        />
      </label>

      <label className="block text-xs font-semibold text-[#18201d]">
        <span>当前处境与心境</span>
        <Textarea
          rows={3}
          value={draft.currentSituation}
          onChange={(e) => onChange({ currentSituation: e.target.value })}
          placeholder="故事起点时她正在面对什么？有哪些待解决的心事？"
          className="mt-1.5"
        />
      </label>

      <label className="block text-xs font-semibold text-[#18201d]">
        <span>
          标签分类（逗号分隔）
        </span>
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
