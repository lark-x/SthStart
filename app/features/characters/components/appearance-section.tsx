'use client';

import React from 'react';
import Image from 'next/image';
import { Sparkles, Upload, ScanSearch } from 'lucide-react';
import { previewAppearanceCandidateApplication, type CharacterAppearanceExtraction, type CharacterDraftV2 } from '@sthstart/contracts';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';

export function AppearanceSection({
  draft,
  avatarUrl,
  canUpload,
  onUploadClick,
  onGenerateAvatar,
  generatingAvatar,
  onChange,
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
  draft: CharacterDraftV2;
  avatarUrl?: string | null;
  canUpload: boolean;
  onUploadClick: () => void;
  onGenerateAvatar: () => void;
  generatingAvatar: boolean;
  onChange: (patch: Partial<CharacterDraftV2>) => void;
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
  const updateAppearance = (patch: Partial<CharacterDraftV2['appearance']>) => {
    onChange({ appearance: { ...draft.appearance, ...patch } });
  };

  // 采用候选前先给出「当前 → 采用后」的具体文本，让用户看到会写入什么（规划 4.3）。
  const candidatePreview = appearanceCandidate
    ? previewAppearanceCandidateApplication(
        draft.appearance,
        appearanceCandidate.extraction as Partial<CharacterAppearanceExtraction>,
        selectedCandidateFields,
      )
    : null;

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-border-subtle">
        <h3 className="text-xl font-medium text-ink">外观与素材</h3>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          基础外貌只写不随场合变化的部分：发色发型、瞳色、体态与辨识特征。
          服装与它会一起变化的配饰写在默认穿着里，本场活动仍可覆盖。
        </p>
      </div>

      <div className="flex items-center gap-4 p-4 rounded-[var(--radius-panel)] border border-border-subtle bg-surface">
        <div className="relative h-16 w-16 rounded-full overflow-hidden bg-[#777865] flex items-center justify-center text-white text-2xl flex-shrink-0">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill unoptimized className="object-cover" />
          ) : (
            <span>{draft.displayName.slice(0, 1) || '角'}</span>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-ink">角色头像</h4>
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

      <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4 space-y-3">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div><h4 className="text-sm font-semibold text-ink">外观参考图</h4><p className="text-sm text-muted mt-0.5">参考图只提供可观察证据；AI 提取结果会先作为候选，不会自动覆盖人设。</p></div>
          <div className="flex items-center gap-2">
            <Select aria-label="参考图用途" value={referencePurpose} onChange={(event) => onReferencePurposeChange(event.target.value as typeof referencePurpose)} className="h-8 w-28 text-xs">
              <option value="identity">人物辨识</option><option value="outfit">服装</option><option value="pose">姿态</option><option value="style">风格</option><option value="init_image">图生图起始</option>
            </Select>
            <Button type="button" size="sm" variant="outline" disabled={!canUpload} onClick={onUploadReference}><Upload className="h-3.5 w-3.5" />上传参考图</Button>
          </div>
        </div>
        {references.length ? <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{references.map((reference) => <div key={reference.id} className="space-y-1"><div className="relative aspect-square overflow-hidden rounded bg-surface-hover"><Image src={reference.url} alt="" fill unoptimized className="object-cover" /></div><Button type="button" size="sm" variant="outline" className="w-full px-1 text-xs" onClick={() => onExtractReference(reference.id)} disabled={Boolean(extractingReference)}>{extractingReference === reference.id ? '提取中…' : <><ScanSearch className="h-3 w-3" />提取外观</>}</Button></div>)}</div> : <p className="text-sm text-muted">尚未添加外观参考图。</p>}
        {appearanceCandidate && (
          <div className="rounded border border-accent/25 bg-accent/5 p-3 text-sm">
            <p className="font-semibold text-accent-dark">已生成视觉候选</p>
            <p className="mt-1 text-xs text-muted">勾选要采用的细项；未勾选的部分会保留原有正文。</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
              {(([['/appearance/description', '整体外貌', 'description'], ['/appearance/hair', '发型发色', 'hair'], ['/appearance/eyes', '眼睛', 'eyes'], ['/appearance/build', '体态', 'build'], ['/appearance/accessories', '配饰', 'accessories'], ['/appearance/outfits', '观察到的服装', 'observedOutfit']]) as const).map(([fieldPath, label, key]) => (
                <label key={fieldPath} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedCandidateFields.includes(fieldPath)}
                    disabled={!appearanceCandidate.extraction[key]}
                    onChange={(event) => onCandidateFieldsChange(event.target.checked ? [...selectedCandidateFields, fieldPath] : selectedCandidateFields.filter((item) => item !== fieldPath))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {candidatePreview && (
              <div className="mt-2 space-y-2 text-xs">
                {([
                  ['基础外貌', draft.appearance.baseText, candidatePreview.baseText, candidatePreview.baseChanged],
                  ['默认穿着', draft.appearance.defaultOutfitText, candidatePreview.defaultOutfitText, candidatePreview.outfitChanged],
                ] as const).map(([label, before, after, changed]) => (
                  <div key={label} className="rounded border border-border-subtle bg-surface p-2">
                    <p className="font-semibold text-ink">
                      {label}
                      <span className={changed ? 'ml-1 font-normal text-accent-dark' : 'ml-1 font-normal text-muted'}>
                        {changed ? '将变更' : '不变'}
                      </span>
                    </p>
                    <p className="mt-1 text-muted"><span className="text-muted">当前：</span>{before.trim() || '（空）'}</p>
                    <p className="mt-1 text-muted"><span className="text-muted">采用后：</span>{after.trim() || '（空）'}</p>
                  </div>
                ))}
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">查看识图原始结果</summary>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted">{JSON.stringify(appearanceCandidate.extraction, null, 2)}</pre>
            </details>
            <Button type="button" size="sm" variant="accent" className="mt-2" disabled={!selectedCandidateFields.length} onClick={() => onApplyAppearanceCandidate(appearanceCandidate, selectedCandidateFields)}>确认应用已选字段</Button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          基础外貌
        </label>
        <Textarea
          aria-label="基础外貌"
          rows={6}
          value={draft.appearance.baseText}
          onChange={(e) => updateAppearance({ baseText: e.target.value })}
          placeholder={'银白微泛水蓝光泽的及腰长发，带卷曲双马尾。\n异色水蓝色瞳孔，眼底有水滴状高光。\n身材娇小纤瘦，步态轻盈。\n稳定辨识特征：异色瞳。'}
        />
        <p className="mt-1 text-xs text-muted">
          这里不要写服装。每行一个部位即可，图像生成会把它和「默认穿着」拼在一起。
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          默认穿着
        </label>
        <Textarea
          aria-label="默认穿着"
          rows={4}
          value={draft.appearance.defaultOutfitText}
          onChange={(e) => updateAppearance({ defaultOutfitText: e.target.value })}
          placeholder="深蓝色法式燕尾礼服，金色肩章，胸前佩水滴形蓝宝石胸针，斜戴高顶礼帽。"
        />
        <p className="mt-1 text-xs text-muted">
          本场活动可以覆盖这套穿着；留空表示未指定，不会自动推断。
        </p>
      </div>
    </div>
  );
}
