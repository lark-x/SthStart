'use client';

import React from 'react';
import type { CharacterDraftV2 } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Textarea } from '@/app/components/ui/textarea';
import { StringListField, type CharacterFormValues } from './character-form';

export function PersonalitySection({
  draft,
  onChange,
  control,
  register,
}: {
  draft: CharacterDraftV2;
  onChange: (patch: Partial<CharacterDraftV2>) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
}) {
  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-border-subtle">
        <h3 className="text-xl font-medium text-ink">说话方式与行为约束</h3>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          这里只放角色的「声音」和必须遵守的边界。性格、动机与好恶请写在人设正文里，
          避免同一件事在两个地方各写一遍。
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          说话方式
        </label>
        <Textarea
          rows={5}
          aria-label="说话方式"
          value={draft.speechText}
          onChange={(e) => onChange({ speechText: e.target.value })}
          placeholder={'语气：优雅、舞台戏剧腔，善用反问与咏叹调；私下语速变缓。\n表达习惯：激动时习惯整理帽子。\n常用表达：哼，这正是本神预料之中的！'}
        />
        <p className="mt-1 text-xs text-muted">
          可以按「语气 / 表达习惯 / 常用表达」分行写；不要每句都重复口头禅。
        </p>
      </div>

      <StringListField
        control={control}
        register={register}
        name="dialogueExamples"
        label="对话示例"
        placeholder="例如：正如诸位所见，这场戏剧正按剧本前进！"
      />
      <p className="text-xs text-muted -mt-3">
        每一条是一段完整示例，可以包含多轮对话。
      </p>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          行为约束（可选）
        </label>
        <Textarea
          rows={4}
          aria-label="行为约束"
          value={draft.behaviorRules}
          onChange={(e) => onChange({ behaviorRules: e.target.value })}
          placeholder={'- 不代替其他参与者做决定\n- 绝不在审判庭上退缩'}
        />
        <p className="mt-1 text-xs text-muted">
          只写角色创作层面的边界。这里的内容不会覆盖应用的输出格式与任务规则。
        </p>
      </div>
    </div>
  );
}
