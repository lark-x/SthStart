'use client';

import React from 'react';
import type { CharacterDraft } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Textarea } from '@/app/components/ui/textarea';
import { StringListField, type CharacterFormValues } from './character-form';

export function PersonalitySection({
  draft,
  onChange,
  control,
  register,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
}) {
  const updateSpeech = (speechPatch: Partial<CharacterDraft['speech']>) => {
    onChange({ speech: { ...draft.speech, ...speechPatch } });
  };

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-[rgb(24_32_29/10%)]">
        <h3 className="font-serif text-2xl font-medium text-[#18201d]">性格与表达</h3>
        <p className="text-xs text-[#68716d] mt-1 leading-relaxed">
          列表项支持每行一条，让性格、驱动力和语言习惯可以被其他应用灵活拆分使用。
        </p>
      </div>

      <StringListField
        control={control}
        register={register}
        name="personality"
        label="性格特点"
        placeholder="例如：表面浮夸自大"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StringListField
          control={control}
          register={register}
          name="motivations"
          label="核心动机"
          placeholder="例如：拯救枫丹的人民"
        />
        <StringListField
          control={control}
          register={register}
          name="beliefs"
          label="信念与价值观"
          placeholder="例如：戏剧必须演到谢幕"
        />
        <StringListField
          control={control}
          register={register}
          name="secrets"
          label="隐秘秘密"
          placeholder="例如：不具备真正神明的力量"
        />
        <StringListField
          control={control}
          register={register}
          name="boundaries"
          label="边界与禁忌"
          placeholder="例如：绝不在审判庭上退缩"
        />
      </div>

      <div className="pt-2 border-t border-[rgb(24_32_29/10%)] space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#68716d]">
          对白风格与表达模式
        </h4>

        <div>
          <label className="block text-xs font-semibold text-[#18201d] mb-1.5">说话语气与用词风格</label>
          <Textarea
            rows={3}
            value={draft.speech.tone}
            onChange={(e) => updateSpeech({ tone: e.target.value })}
            placeholder="优雅、舞台戏剧腔、善用反问与咏叹调；私下语速变缓，声音稍带轻柔与踌躇。"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#18201d] mb-1.5">表达习惯与反差细节</label>
          <Textarea
            rows={3}
            value={draft.speech.habits}
            onChange={(e) => updateSpeech({ habits: e.target.value })}
            placeholder="激动时习惯整理帽子，陷入困境时会下意识寻找甜品或茶杯掩饰。"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StringListField
            control={control}
            register={register}
            name="speech.catchphrases"
            label="口头禅"
            placeholder="例如：哼，这正是本神预料之中的！"
          />
          <StringListField
            control={control}
            register={register}
            name="speech.examples"
            label="示例对白"
            placeholder="例如：正如诸位所见，这场戏剧正按剧本前进！"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StringListField
            control={control}
            register={register}
            name="likes"
            label="喜好"
            placeholder="例如：精致红茶"
          />
          <StringListField
            control={control}
            register={register}
            name="dislikes"
            label="厌恶"
            placeholder="例如：无趣的应酬"
          />
          <StringListField
            control={control}
            register={register}
            name="fears"
            label="恐惧"
            placeholder="例如：被所有人抛弃"
          />
        </div>
      </div>
    </div>
  );
}
