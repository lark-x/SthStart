'use client';

import React from 'react';
import Image from 'next/image';
import { Upload } from 'lucide-react';
import type { CharacterDraft } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { StringListField, type CharacterFormValues } from './character-form';

export function AppearanceSection({
  draft,
  avatarUrl,
  canUpload,
  onUploadClick,
  onChange,
  control,
  register,
}: {
  draft: CharacterDraft;
  avatarUrl?: string | null;
  canUpload: boolean;
  onUploadClick: () => void;
  onChange: (patch: Partial<CharacterDraft>) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
}) {
  const updateAppearance = (patch: Partial<CharacterDraft['appearance']>) => {
    onChange({ appearance: { ...draft.appearance, ...patch } });
  };

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-[rgb(24_32_29/10%)]">
        <h3 className="font-serif text-2xl font-medium text-[#18201d]">外观与素材</h3>
        <p className="text-xs text-[#68716d] mt-1 leading-relaxed">
          稳定的外貌锚点会被邻舍用于对话意象与图像生成；情境服装与动作仍由应用生成。
        </p>
      </div>

      <div className="flex items-center gap-4 p-4 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8]">
        <div className="relative h-16 w-16 rounded-full overflow-hidden bg-[#777865] flex items-center justify-center text-white font-serif text-2xl flex-shrink-0">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill unoptimized className="object-cover" />
          ) : (
            <span>{draft.displayName.slice(0, 1) || '角'}</span>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-[#18201d]">角色头像与视觉锚点</h4>
          <p className="text-xs text-[#68716d] mt-0.5">
            {canUpload ? '支持上传高清 PNG/JPG/WebP 头像' : '先保存角色草稿后再上传头像'}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canUpload}
            onClick={onUploadClick}
            className="mt-2"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>上传头像图片</span>
          </Button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[#18201d] mb-1.5">
          整体外貌综合描述
        </label>
        <Textarea
          rows={5}
          value={draft.appearance.description}
          onChange={(e) => updateAppearance({ description: e.target.value })}
          placeholder="身材娇小、步态轻盈。双瞳呈深浅不一的水蓝色异色眸，身着枫丹风格的深蓝色礼服，头戴斜戴的高顶礼帽。"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[#18201d] mb-1.5">发型与发色</label>
          <Textarea
            rows={3}
            value={draft.appearance.hair}
            onChange={(e) => updateAppearance({ hair: e.target.value })}
            placeholder="银白微泛水蓝光泽的及腰长发，带有卷曲双马尾发束。"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#18201d] mb-1.5">眼睛特征</label>
          <Textarea
            rows={3}
            value={draft.appearance.eyes}
            onChange={(e) => updateAppearance({ eyes: e.target.value })}
            placeholder="异色水蓝色瞳孔，眼底带有雨滴花纹水滴状高光。"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#18201d] mb-1.5">体态与身材</label>
          <Textarea
            rows={3}
            value={draft.appearance.build}
            onChange={(e) => updateAppearance({ build: e.target.value })}
            placeholder="娇小纤瘦，体态轻盈优雅，手部白皙纤细。"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StringListField
          control={control}
          register={register}
          name="appearance.outfits"
          label="常用服装风格"
          placeholder="例如：深蓝色法式燕尾礼服"
        />
        <StringListField
          control={control}
          register={register}
          name="appearance.accessories"
          label="标志性饰品"
          placeholder="例如：水滴形蓝宝石胸针"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-[#18201d] mb-1.5">
          额外系统运行规则 / 负面提示词约束
        </label>
        <Textarea
          rows={4}
          value={draft.extraRules}
          onChange={(e) => onChange({ extraRules: e.target.value })}
          placeholder="在生图时避免现代机械元素；对话时保持角色台词首位，不直接输出动作括号代码等。"
        />
      </div>
    </div>
  );
}
