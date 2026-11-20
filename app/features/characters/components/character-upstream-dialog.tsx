'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search, Sparkles, User, Layers, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import type {
  CharacterUpstreamAssetCandidate,
  CharacterUpstreamResearchPreview,
  CharacterUpstreamSkinProposal,
  CharacterUpstreamApplyResponse,
} from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { useToast } from '@/app/providers/ui-provider';
import { createCharacter } from '../api';
import { useApplyCharacterUpstream, useUpstreamResearchCharacter } from '../mutations';

interface CharacterUpstreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId?: string;
  initialName?: string;
  initialWork?: string;
  draftRevision?: number;
  onApplied: (characterId: string) => void;
}

export function CharacterUpstreamDialog({
  open,
  onOpenChange,
  characterId,
  initialName = '',
  initialWork = '',
  draftRevision,
  onApplied,
}: CharacterUpstreamDialogProps) {
  const toast = useToast();
  const researchMutation = useUpstreamResearchCharacter();
  const applyMutation = useApplyCharacterUpstream();

  const [query, setQuery] = useState(initialName);
  const [work, setWork] = useState(initialWork);
  const [preview, setPreview] = useState<CharacterUpstreamResearchPreview | null>(null);
  const [proposals, setProposals] = useState<CharacterUpstreamSkinProposal[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [activeAvatarId, setActiveAvatarId] = useState<string | null>(null);
  const [activePortraitId, setActivePortraitId] = useState<string | null>(null);
  const [applyFields, setApplyFields] = useState({
    summary: true,
    personaText: true,
    speechText: true,
    dialogueExamples: true,
    behaviorRules: true,
    appearance: true,
    tags: true,
  });
  const [applying, setApplying] = useState(false);
  const [appliedResult, setAppliedResult] = useState<CharacterUpstreamApplyResponse | null>(null);
  const [applyError, setApplyError] = useState('');
  const [hasTarget, setHasTarget] = useState(Boolean(characterId));
  const target = useRef<{ id: string; revision?: number } | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setQuery(initialName);
    setWork(initialWork);
    setPreview(null);
    setProposals([]);
    setSelectedAssetIds(new Set());
    setActiveAvatarId(null);
    setActivePortraitId(null);
    setAppliedResult(null);
    setApplyError('');
    target.current = characterId ? { id: characterId, revision: draftRevision } : null;
    setHasTarget(Boolean(characterId));
  }, [open, initialName, initialWork, characterId, draftRevision]);

  const runResearch = async () => {
    if (applying || appliedResult) return;
    const trimmed = query.trim();
    if (!trimmed) {
      toast.warning('请先输入要检索的角色名称');
      return;
    }
    try {
      const result = await researchMutation.mutateAsync({
        query: trimmed,
        work: work.trim() || undefined,
        characterId,
        includeSkins: true,
        includeVariants: true,
        includeVoiceLines: true,
      });
      setPreview(result);
      setProposals(result.skinsAndVariants);

      const recommendedAssets = result.assets.filter((a) => a.recommended || a.kind === 'avatar' || a.kind === 'portrait');
      const nextSelected = new Set((recommendedAssets.length ? recommendedAssets : result.assets.slice(0, 6)).map((a) => a.id));
      setSelectedAssetIds(nextSelected);

      const firstAvatar = result.assets.find((a) => a.kind === 'avatar' && a.category === 'avatar')
        || result.assets.find((a) => a.kind === 'avatar');
      const firstPortrait = result.assets.find((a) => a.kind === 'portrait' && a.category === 'portrait')
        || result.assets.find((a) => a.kind === 'portrait');
      setActiveAvatarId(firstAvatar?.id ?? null);
      setActivePortraitId(firstPortrait?.id ?? null);
    } catch (err) {
      toast.error('上游采集失败', err instanceof Error ? err.message : String(err));
    }
  };

  const toggleProposal = (id: string) => {
    setProposals((prev) => prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)));
  };

  const toggleClassification = (id: string) => {
    setProposals((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextClass = item.classification === 'variant' ? 'skin' : 'variant';
        return {
          ...item,
          classification: nextClass,
          ...(nextClass === 'variant' && !item.variantKind ? { variantKind: 'stage' as const } : {}),
        };
      }),
    );
  };

  const updateProposalField = (id: string, field: 'outfitDescription' | 'loreStory', value: string) => {
    setProposals((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const toggleAsset = (asset: CharacterUpstreamAssetCandidate) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };

  const handleApply = async () => {
    if (!preview || applying || appliedResult) return;
    setApplying(true);
    setApplyError('');
    try {
      let targetId = target.current?.id || characterId;
      let expectedRevision = target.current?.revision ?? draftRevision;
      if (!targetId) {
        const created = await createCharacter({
          displayName: preview.draft.displayName || query.trim(),
          draft: preview.draft,
          tags: preview.tags,
        });
        targetId = created.id;
        expectedRevision = created.draftRevision;
        // Preserve the created ID even if the following import fails.
        target.current = { id: targetId, revision: expectedRevision };
        setHasTarget(true);
      }

      const selectedVariants = proposals.filter((p) => p.selected && p.classification === 'variant');
      const selectedSkins = proposals.filter((p) => p.selected && p.classification === 'skin');
      const selectedAssets = preview.assets
        .filter((a) => selectedAssetIds.has(a.id))
        .map((a) => ({
          kind: a.kind,
          category: a.category,
          title: a.title,
          url: a.url,
          source: a.source,
          setAsActive: a.id === activeAvatarId || a.id === activePortraitId,
          registerReference: a.category === 'costume' || a.category === 'portrait' || a.kind === 'reference',
          ...(a.skinName ? { skinName: a.skinName } : {}),
        }));

      const res = await applyMutation.mutateAsync({
        id: targetId,
        payload: {
          ...(expectedRevision != null ? { expectedDraftRevision: expectedRevision } : {}),
          applyTextFields: applyFields,
          draft: preview.draft,
          tags: preview.tags,
          selectedVariants,
          selectedSkins,
          selectedAssets,
          sources: preview.sources,
        },
      });

      target.current = { id: targetId, revision: res.profile.draftRevision };
      setAppliedResult(res);
      if (res.warnings.length) toast.warning('档案已保存，部分内容需要检查', '请查看向导中的导入结果与原因。');
      else toast.success('角色档案与所选内容已保存');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setApplyError(message);
      toast.error('应用上游档案失败', message);
    } finally {
      setApplying(false);
    }
  };

  const isBusy = researchMutation.isPending || applying || applyMutation.isPending;
  const closeDialog = () => {
    if (isBusy) return;
    onOpenChange(false);
    if (target.current && (!characterId || appliedResult)) onApplied(target.current.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) closeDialog(); }}
      title={characterId ? `从上游重构 RP 卡 · ${initialName || '当前角色'}` : '从上游采集 RP 角色卡'}
      description="汇聚可用的角色资料、皮肤图片与剧情文本。确认采集范围和缺失项后，再写入角色档案。"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <span className="text-xs text-muted">
            {preview ? preview.evidenceSummary : '输入角色名与作品后点击开始采集'}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant={appliedResult ? 'accent' : 'ghost'} size="sm" disabled={isBusy} onClick={closeDialog}>
              {appliedResult ? '完成并查看角色' : '关闭'}
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              disabled={!preview || isBusy || Boolean(appliedResult)}
              loading={applying || applyMutation.isPending}
              onClick={() => void handleApply()}
            >
              {!(applying || applyMutation.isPending) && <Check className="h-3.5 w-3.5 mr-1" />}
              <span>{appliedResult ? '本次内容已保存' : hasTarget ? '确认合并到角色档案' : '创建角色并保存所选内容'}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {applyError && <Alert variant="danger" title="本次应用未完成">{applyError}{hasTarget && <p className="mt-1">已保留同一角色档案，继续操作会使用该档案。关闭向导可查看当前保存内容。</p>}</Alert>}
        {appliedResult && <Alert variant={appliedResult.warnings.length ? 'warning' : 'success'} title={appliedResult.warnings.length ? '已保存档案，部分内容未导入' : '本次所选内容已保存'}>
          <p>图片 {appliedResult.importedAssetCount} 张 · 形态 {appliedResult.createdVariantCount} 个 · 皮肤 {appliedResult.createdSkinCount} 套</p>
          {appliedResult.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{appliedResult.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <p className="mt-2">已保留导入结果。请查看缺失原因后，到角色档案补充对应内容。</p>
        </Alert>}
        {/* 检索输入条 */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            aria-label="采集角色名称"
            disabled={isBusy || Boolean(appliedResult)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="角色名称（如：琴、丹恒·饮月、琪亚娜）"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') void runResearch();
            }}
          />
          <Input
            aria-label="采集所属作品"
            disabled={isBusy || Boolean(appliedResult)}
            value={work}
            onChange={(e) => setWork(e.target.value)}
            placeholder="所属作品（如：原神、星穹铁道、崩坏三）"
            className="sm:w-52"
            onKeyDown={(e) => {
              if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') void runResearch();
            }}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={researchMutation.isPending}
            disabled={isBusy || Boolean(appliedResult)}
            onClick={() => void runResearch()}
            className="h-9 px-4 shrink-0"
          >
            {!researchMutation.isPending && <Search className="h-3.5 w-3.5 mr-1" />}
            <span>开始采集</span>
          </Button>
        </div>

        {researchMutation.isPending && (
          <div className="rounded-panel border border-border-subtle bg-surface-sunken/50 p-8 text-center space-y-2">
            <Sparkles className="h-6 w-6 mx-auto text-accent animate-pulse" />
            <p className="text-sm font-medium text-ink">正在采集角色档案、原生语音、皮肤立绘并提炼 RP 设定…</p>
            <p className="text-xs text-muted">为避免触发百科限流，采集会自动平滑节流，通常耗时 3~15 秒。</p>
          </div>
        )}

        {preview && !researchMutation.isPending && (
          <fieldset disabled={Boolean(appliedResult) || applying} className="min-w-0 space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {preview.warnings.length > 0 && (
              <div className="rounded-panel border border-border-subtle bg-surface-sunken px-3 py-2 text-xs text-muted flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-accent mt-0.5" />
                <div className="space-y-0.5">
                  {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              </div>
            )}

            {/* 1. RP 文本设定预览与字段应用开关 */}
            <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                  <User className="h-4 w-4 text-accent" />
                  <span>RP 故事推演文本预览</span>
                </h4>
                <div className="flex flex-wrap gap-3 text-xs">
                  {([
                    ['summary', '一句话概括'],
                    ['personaText', '人设背景'],
                    ['speechText', '说话方式'],
                    ['dialogueExamples', '示例对话'],
                    ['behaviorRules', '认知边界'],
                    ['appearance', '外貌着装'],
                  ] as const).map(([key, label]) => (
                    <Checkbox
                      key={key}
                      label={label}
                      checked={applyFields[key]}
                      onChange={(e) => setApplyFields((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-control bg-surface-sunken/50 p-3 space-y-1">
                  <div className="font-semibold text-ink">说话方式（决定对话沉浸感）</div>
                  <p className="text-muted leading-relaxed whitespace-pre-wrap">{preview.draft.speechText || '暂无'}</p>
                </div>
                <div className="rounded-control bg-surface-sunken/50 p-3 space-y-1">
                  <div className="font-semibold text-ink">稳定外貌与默认服装（生图/视频基准）</div>
                  <p className="text-muted leading-relaxed">
                    {preview.draft.appearance.baseText}
                    {preview.draft.appearance.defaultOutfitText ? `\n默认着装：${preview.draft.appearance.defaultOutfitText}` : ''}
                  </p>
                </div>
              </div>

              {preview.draft.dialogueExamples.length > 0 && (
                <div className="rounded-control bg-surface-sunken/40 p-3 space-y-1.5 text-xs">
                  <div className="font-semibold text-ink">防复读情境对话范例（{preview.draft.dialogueExamples.length} 组）</div>
                  <div className="space-y-1.5 text-muted">
                    {preview.draft.dialogueExamples.slice(0, 3).map((ex, i) => (
                      <p key={i} className="whitespace-pre-wrap border-l-2 border-accent/40 pl-2.5">{ex}</p>
                    ))}
                  </div>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-muted hover:text-ink">
                  展开完整人设正文预览（{preview.draft.personaText.length} 字）
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink bg-surface-sunken/40 rounded-control p-3 leading-relaxed">
                  {preview.draft.personaText}
                </pre>
              </details>
            </div>

            {/* 2. 衍生形态 (装甲/SP) vs 普通多皮肤 */}
            {proposals.length > 0 && (
              <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-accent" />
                    <span>衍生形态（装甲 / SP）与多皮肤（均附服装描述与背景故事）</span>
                  </h4>
                  <span className="text-xs text-muted">可随时切换归类</span>
                </div>

                <div className="space-y-3">
                  {proposals.map((item) => (
                    <div key={item.id} className="rounded-control border border-hairline bg-surface-sunken/40 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            label={item.name}
                            checked={item.selected}
                            onChange={() => toggleProposal(item.id)}
                          />
                          <Badge variant={item.classification === 'variant' ? 'accent' : 'default'}>
                            {item.classification === 'variant' ? '衍生形态（装甲/SP）' : '多皮肤（换装）'}
                          </Badge>
                          <span className="text-xs text-muted">{item.source}</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleClassification(item.id)}
                          className="h-7 px-2 text-xs"
                        >
                          转为{item.classification === 'variant' ? '多皮肤' : '衍生形态'}
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="block space-y-1 text-xs">
                          <span className="text-muted">服装描述</span>
                          <Textarea
                            rows={2}
                            value={item.outfitDescription}
                            onChange={(e) => updateProposalField(item.id, 'outfitDescription', e.target.value)}
                            className="text-xs bg-surface"
                          />
                        </label>
                        <label className="block space-y-1 text-xs">
                          <span className="text-muted">背景故事</span>
                          <Textarea
                            rows={2}
                            value={item.loreStory}
                            onChange={(e) => updateProposalField(item.id, 'loreStory', e.target.value)}
                            className="text-xs bg-surface"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 立绘、头像与参考图选集 */}
            {preview.assets.length > 0 && (
              <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <ImageIcon className="h-4 w-4 text-accent" />
                    <span>立绘、头像与图片资产（已选 {selectedAssetIds.size} 张）</span>
                  </h4>
                  <span className="text-xs text-muted">勾选图片将在确认时下载保存到本地资产库</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {preview.assets.map((asset) => {
                    const checked = selectedAssetIds.has(asset.id);
                    const isPrimaryAvatar = asset.id === activeAvatarId;
                    const isPrimaryPortrait = asset.id === activePortraitId;
                    return (
                      <div
                        key={asset.id}
                        className={`rounded-control border p-2 space-y-1.5 transition-colors ${
                          checked ? 'border-accent bg-surface-raised' : 'border-hairline bg-surface-sunken/40 opacity-75'
                        }`}
                      >
                        <div className="aspect-square rounded-control overflow-hidden bg-surface-sunken flex items-center justify-center relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.previewUrl || asset.url}
                            alt={asset.title}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <div className="space-y-1">
                          <Checkbox
                            label={asset.title}
                            checked={checked}
                            onChange={() => toggleAsset(asset)}
                          />
                          <div className="flex items-center justify-between gap-1 text-[11px] text-muted">
                            <span className="truncate">{asset.source}</span>
                            {checked && asset.kind === 'avatar' && (
                              <button
                                type="button"
                                onClick={() => setActiveAvatarId(asset.id)}
                                className={`shrink-0 underline cursor-pointer ${isPrimaryAvatar ? 'text-accent font-semibold' : ''}`}
                              >
                                {isPrimaryAvatar ? '主头像' : '设为主头像'}
                              </button>
                            )}
                            {checked && asset.kind === 'portrait' && (
                              <button
                                type="button"
                                onClick={() => setActivePortraitId(asset.id)}
                                className={`shrink-0 underline cursor-pointer ${isPrimaryPortrait ? 'text-accent font-semibold' : ''}`}
                              >
                                {isPrimaryPortrait ? '主立绘' : '设为主立绘'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
