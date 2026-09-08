'use client';

import React from 'react';
import Image from 'next/image';
import { Sparkles, Upload, ScanSearch } from 'lucide-react';
import type { CharacterDraft } from '@sthstart/contracts';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { StringListField, type CharacterFormValues } from './character-form';

export function AppearanceSection({
  draft,
  simple = false,
  avatarUrl,
  canUpload,
  onUploadClick,
  onGenerateAvatar,
  generatingAvatar,
  onChange,
  control,
  register,
  references,
  onUploadReference,
  referencePurpose,
  onReferencePurposeChange,
  onExtractReference,
  extractingReference,
  appearanceCandidate,
  selectedCandidateFields,
  onCandidateFieldsChange,
  onApplyAppearanceCandidate,
}: {
  draft: CharacterDraft;
  simple?: boolean;
  avatarUrl?: string | null;
  canUpload: boolean;
  onUploadClick: () => void;
  onGenerateAvatar: () => void;
  generatingAvatar: boolean;
  onChange: (patch: Partial<CharacterDraft>) => void;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  references: Array<{ id: string; url: string; authorNote?: string; purposes?: string[] }>;
  onUploadReference: () => void;
  referencePurpose: 'identity' | 'outfit' | 'pose' | 'style' | 'init_image';
  onReferencePurposeChange: (purpose: 'identity' | 'outfit' | 'pose' | 'style' | 'init_image') => void;
  onExtractReference: (referenceId: string) => void;
  extractingReference?: string | null;
  appearanceCandidate?: { id: string; extraction: Record<string, unknown> } | null;
  selectedCandidateFields: string[];
  onCandidateFieldsChange: (fieldPaths: string[]) => void;
  onApplyAppearanceCandidate: (candidate: { id: string; extraction: Record<string, unknown> }, fieldPaths: string[]) => void;
}) {
  const updateAppearance = (patch: Partial<CharacterDraft['appearance']>) => {
    onChange({ appearance: { ...draft.appearance, ...patch } });
  };

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-[rgb(24_32_29/10%)]">
        <h3 className="font-serif text-2xl font-medium text-ink">外观与素材</h3>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          {simple ? '先记录稳定辨识特征和常用造型；发色、眼睛等细项可在详细模式中展开。' : '稳定的外貌锚点会被邻舍用于对话意象与图像生成；情境服装与动作仍由应用生成。'}
        </p>
      </div>

      <div className="flex items-center gap-4 p-4 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface">
        <div className="relative h-16 w-16 rounded-full overflow-hidden bg-[#777865] flex items-center justify-center text-white font-serif text-2xl flex-shrink-0">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill unoptimized className="object-cover" />
          ) : (
            <span>{draft.displayName.slice(0, 1) || '角'}</span>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-ink">角色头像与视觉锚点</h4>
          <p className="text-sm text-muted mt-0.5">
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
          <Button
            type="button"
            size="sm"
            variant="accent"
            disabled={!canUpload}
            loading={generatingAvatar}
            onClick={onGenerateAvatar}
            className="mt-2 ml-2"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>AI 生成头像</span>
          </Button>
        </div>
      </div>

      <div className="rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface p-4 space-y-3">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div><h4 className="text-sm font-semibold text-ink">外观参考图</h4><p className="text-sm text-muted mt-0.5">参考图只提供可观察证据；AI 提取结果会先作为候选，不会自动覆盖人设。</p></div>
          <div className="flex items-center gap-2">
            <Select aria-label="参考图用途" value={referencePurpose} onChange={(event) => onReferencePurposeChange(event.target.value as typeof referencePurpose)} className="h-8 w-28 text-xs">
              <option value="identity">人物辨识</option><option value="outfit">服装</option><option value="pose">姿态</option><option value="style">风格</option><option value="init_image">图生图起始</option>
            </Select>
            <Button type="button" size="sm" variant="outline" disabled={!canUpload} onClick={onUploadReference}><Upload className="h-3.5 w-3.5" />上传参考图</Button>
          </div>
        </div>
        {references.length ? <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{references.map((reference) => <div key={reference.id} className="space-y-1"><div className="relative aspect-square overflow-hidden rounded bg-stone-200"><Image src={reference.url} alt="" fill unoptimized className="object-cover" /></div><Button type="button" size="sm" variant="outline" className="w-full px-1 text-xs" onClick={() => onExtractReference(reference.id)} disabled={Boolean(extractingReference)}>{extractingReference === reference.id ? '提取中…' : <><ScanSearch className="h-3 w-3" />提取外观</>}</Button></div>)}</div> : <p className="text-sm text-muted">尚未添加外观参考图。</p>}
        {appearanceCandidate && <div className="rounded border border-accent/25 bg-accent/5 p-3 text-sm"><p className="font-semibold text-accent-dark">已生成视觉候选</p><div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">{([['/appearance/description', '整体外观', 'description'], ['/appearance/hair', '发型发色', 'hair'], ['/appearance/eyes', '眼睛', 'eyes'], ['/appearance/build', '体态', 'build'], ['/appearance/accessories', '配饰', 'accessories'], ['/appearance/outfits', '观察到的服装', 'observedOutfit']] as const).map(([fieldPath, label, key]) => <label key={fieldPath} className="flex items-center gap-1.5"><input type="checkbox" checked={selectedCandidateFields.includes(fieldPath)} disabled={!appearanceCandidate.extraction[key]} onChange={(event) => onCandidateFieldsChange(event.target.checked ? [...selectedCandidateFields, fieldPath] : selectedCandidateFields.filter((item) => item !== fieldPath))} />{label}</label>)}</div><pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted">{JSON.stringify(appearanceCandidate.extraction, null, 2)}</pre><Button type="button" size="sm" variant="accent" className="mt-2" disabled={!selectedCandidateFields.length} onClick={() => onApplyAppearanceCandidate(appearanceCandidate, selectedCandidateFields)}>确认应用已选字段</Button></div>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          整体外貌综合描述
        </label>
        <Textarea
          aria-label="整体外貌综合描述"
          rows={5}
          value={draft.appearance.description}
          onChange={(e) => updateAppearance({ description: e.target.value })}
          placeholder="身材娇小、步态轻盈。双瞳呈深浅不一的水蓝色异色眸，身着枫丹风格的深蓝色礼服，头戴斜戴的高顶礼帽。"
        />
      </div>

      {simple && <StringListField
        control={control}
        register={register}
        name="appearance.stableFeatures"
        label="稳定辨识特征"
        placeholder="例如：异色瞳、标志性帽饰"
      />}

      {!simple && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold text-ink mb-1.5">发型与发色</label>
          <Textarea
            aria-label="发型与发色"
            rows={3}
            value={draft.appearance.hair}
            onChange={(e) => updateAppearance({ hair: e.target.value })}
            placeholder="银白微泛水蓝光泽的及腰长发，带有卷曲双马尾发束。"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink mb-1.5">眼睛特征</label>
          <Textarea
            aria-label="眼睛特征"
            rows={3}
            value={draft.appearance.eyes}
            onChange={(e) => updateAppearance({ eyes: e.target.value })}
            placeholder="异色水蓝色瞳孔，眼底带有雨滴花纹水滴状高光。"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink mb-1.5">体态与身材</label>
          <Textarea
            aria-label="体态与身材"
            rows={3}
            value={draft.appearance.build}
            onChange={(e) => updateAppearance({ build: e.target.value })}
            placeholder="娇小纤瘦，体态轻盈优雅，手部白皙纤细。"
          />
        </div>
      </div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StringListField
          control={control}
          register={register}
          name="appearance.outfits"
          label="常用服装风格"
          placeholder="例如：深蓝色法式燕尾礼服"
        />
        {!simple && <StringListField
          control={control}
          register={register}
          name="appearance.accessories"
          label="标志性饰品"
          placeholder="例如：水滴形蓝宝石胸针"
        />}
      </div>

      {draft.appearance.outfits.length > 0 && <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">默认造型</label>
        <Select
          aria-label="默认造型"
          value={draft.appearance.defaultOutfitId ?? ''}
          onChange={(event) => updateAppearance({ defaultOutfitId: event.target.value || null })}
        >
          <option value="">自动使用第一项</option>
          {draft.appearance.outfits.map((outfit) => <option key={outfit} value={outfit}>{outfit}</option>)}
        </Select>
        <p className="mt-1 text-xs text-muted">本场活动仍可覆盖服装；发布版本会冻结这里的选择。</p>
      </div>}

      {!simple && <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          额外系统运行规则 / 负面提示词约束
        </label>
        <Textarea
          aria-label="额外系统运行规则 / 负面提示词约束"
          rows={4}
          value={draft.extraRules}
          onChange={(e) => onChange({ extraRules: e.target.value })}
          placeholder="在生图时避免现代机械元素；对话时保持角色台词首位，不直接输出动作括号代码等。"
        />
      </div>}
    </div>
  );
}
