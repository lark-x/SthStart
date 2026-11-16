'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import Image from 'next/image';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Layers,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import type { CharacterAssetDetail, CharacterVariant } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { AnchoredPopover } from '@/app/components/ui/anchored-popover';
import { CharacterVisualPreview } from './character-image-fallback';

type AssetKind = 'avatar' | 'portrait';

/** 左栏：角色卡预览、素材操作菜单、形象资产列表与衍生形态。 */
export function CharacterEditorSidebar({
  characterId,
  displayName,
  avatarUrl,
  portraitUrl,
  assets,
  assetsLoaded,
  variants,
  activeVariantId,
  onSelectVariant,
  onRemoveVariant,
  onAddVariant,
  onOpenAssets,
  onUploadAsset,
  isUploading,
  onOpenMultiSource,
  onOpenUrlImport,
  onTriggerAiAvatar,
  avatarTaskId,
  hasAvatarResult,
}: {
  characterId?: string;
  displayName: string;
  avatarUrl?: string;
  portraitUrl?: string;
  assets: CharacterAssetDetail[];
  assetsLoaded: boolean;
  variants: CharacterVariant[];
  activeVariantId: string | null;
  onSelectVariant: (id: string | null) => void;
  onRemoveVariant: (id: string) => void;
  onAddVariant: () => void;
  onOpenAssets: () => void;
  onUploadAsset: (event: ChangeEvent<HTMLInputElement>, kind: AssetKind) => void;
  onSetActiveAsset?: (assetId: string, kind: AssetKind) => void;
  isUploading: boolean;
  isSettingActive?: boolean;
  onOpenMultiSource: () => void;
  onOpenUrlImport: () => void;
  onOpenImport?: () => void;
  onExportTavern?: () => void;
  onTriggerAiAvatar: () => void;
  avatarTaskId: string | null;
  hasAvatarResult: boolean;
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const portraitInputRef = useRef<HTMLInputElement>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [mobileVisualExpanded, setMobileVisualExpanded] = useState(false);

  const currentVariant = variants.find((variant) => variant.id === activeVariantId) || null;

  return (
    <div
      className="order-2 space-y-4 lg:order-1 lg:sticky"
      style={{ top: 'calc(var(--shell-sticky-top) + 1rem)' }}
    >
      {/* 移动端紧凑可展开条目：在小屏上收纳预览，不挡主表单首屏 */}
      <div className="lg:hidden rounded-panel border border-border-subtle bg-surface p-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setMobileVisualExpanded((value) => !value)}
          style={{ '--button-justify': 'space-between' } as React.CSSProperties}
          className="h-auto min-h-11 w-full px-0 py-0 text-left"
          aria-expanded={mobileVisualExpanded}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="relative h-8 w-8 flex-none overflow-hidden rounded-control border border-border-subtle bg-surface-sunken">
                {avatarUrl ? (
                  <Image src={avatarUrl} alt="" fill unoptimized className="object-cover" />
                ) : portraitUrl ? (
                  <Image src={portraitUrl} alt="" fill unoptimized className="object-cover" />
                ) : (
                  <User className="h-4 w-4 m-auto text-muted" />
                )}
              </span>
              <span className="block min-w-0">
                <span className="block truncate text-xs font-semibold text-ink">视觉预览与资产形态</span>
                <span className="block text-[11px] text-muted">
                  {currentVariant ? `形态：${currentVariant.name}` : '主档案'} · {assetsLoaded ? `${assets.length} 个资产` : '暂无资产'}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-muted">
              <span>{mobileVisualExpanded ? '收起' : '展开'}</span>
              {mobileVisualExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            </span>
          </span>
        </Button>
      </div>

      <div className={`space-y-5 ${mobileVisualExpanded ? 'block' : 'hidden lg:block'}`}>
        {/* 角色卡牌预览 */}
        <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              视觉预览
            </span>
            <span className="inline-flex items-center rounded-full border border-[var(--selection-border)] bg-[var(--selection-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--selection-fg)]">
              {currentVariant ? `形态: ${currentVariant.name}` : '主档案形态'}
            </span>
          </div>

          {/* 立绘与头像展示区 */}
          <CharacterVisualPreview portraitUrl={portraitUrl} avatarUrl={avatarUrl} displayName={displayName} />

          {/* 精简双操作：更换图片(下拉) + AI 生图 */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <AnchoredPopover
              title="更换或获取图片"
              open={uploadMenuOpen}
              onOpenChange={setUploadMenuOpen}
              side="top"
              align="start"
              className="w-48"
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!characterId || isUploading}
                  className="min-h-9 w-full justify-center gap-1.5 px-2.5 text-xs"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span>更换图片</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
                </Button>
              }
            >
              <div className="space-y-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-popover-focus="true"
                  disabled={!characterId}
                  onClick={() => {
                    setUploadMenuOpen(false);
                    onOpenMultiSource();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  <span>多源探测立绘与皮肤</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setUploadMenuOpen(false);
                    portraitInputRef.current?.click();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <Camera className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>上传立绘大图</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setUploadMenuOpen(false);
                    avatarInputRef.current?.click();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <User className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>上传头像图标</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!characterId}
                  onClick={() => {
                    setUploadMenuOpen(false);
                    onOpenUrlImport();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <Globe className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>从图片链接导入</span>
                </Button>
              </div>
            </AnchoredPopover>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onTriggerAiAvatar}
              disabled={!characterId}
              className="min-h-9 w-full justify-center gap-1.5 px-2.5 text-xs hover:border-accent hover:text-accent"
              title="基于外观与服装特征生成头像"
            >
              <Palette className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              <span>{avatarTaskId ? '生成中...' : hasAvatarResult ? '预览新图' : 'AI 生图'}</span>
            </Button>
          </div>

          <div className="border-t border-hairline pt-2.5 flex items-center justify-between text-xs">
            <span className="text-muted">图片与多皮肤 ({assets.length})</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenAssets}
              className="h-auto min-h-7 gap-1 px-1.5 py-0.5 text-xs font-medium text-accent"
            >
              <span>管理全部</span>
              <span aria-hidden="true">&rarr;</span>
            </Button>
          </div>

          {/* 隐藏的本地图片选择器 */}
          <input
            ref={avatarInputRef}
            type="file"
            aria-label="上传头像图标"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => onUploadAsset(event, 'avatar')}
          />
          <input
            ref={portraitInputRef}
            type="file"
            aria-label="上传立绘大图"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => onUploadAsset(event, 'portrait')}
          />
        </div>

        {/* 仅当存在衍生形态（装甲 / SP / 阶段形态）时展开，单形态角色不占左栏空间 */}
        {variants.length > 0 && (
          <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-accent" />
                <span>衍生形态 ({variants.length})</span>
              </h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onAddVariant}
                className="h-6 px-1.5 text-xs text-accent hover:bg-accent/10"
              >
                <Plus className="h-3 w-3 mr-0.5" />
                <span>新增</span>
              </Button>
            </div>

            <div className="space-y-1">
              <Button
                type="button"
                size="sm"
                variant={activeVariantId === null ? 'secondary' : 'ghost'}
                aria-pressed={activeVariantId === null}
                onClick={() => onSelectVariant(null)}
                className="ui-choice h-auto min-h-9 w-full rounded-lg px-2.5 py-1.5 text-xs font-medium"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span>默认主档案</span>
                  {activeVariantId === null && <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />}
                </span>
              </Button>

              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className={`flex items-center justify-between gap-1 rounded-lg pr-1 text-xs transition-colors ${
                    activeVariantId === variant.id
                      ? 'border border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)]'
                      : 'bg-surface-sunken text-ink'
                  }`}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-pressed={activeVariantId === variant.id}
                    style={{ '--button-justify': 'flex-start' } as React.CSSProperties}
                    onClick={() => onSelectVariant(variant.id)}
                    className={`ui-choice h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs text-left ${activeVariantId === variant.id ? 'font-medium' : 'font-normal'}`}
                  >
                    <span className="min-w-0 truncate">{variant.name}</span>
                  </Button>
                  <IconButton
                    icon={Trash2}
                    label={`删除形态「${variant.name}」`}
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveVariant(variant.id)}
                    className="size-7 min-h-7 shrink-0 rounded text-muted hover:text-danger"
                    iconClassName="h-3 w-3"
                    title={`删除形态「${variant.name}」`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
