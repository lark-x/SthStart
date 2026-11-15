'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import Image from 'next/image';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FolderInput,
  Globe,
  Layers,
  MoreHorizontal,
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
import { CharacterAssetImage, CharacterVisualPreview } from './character-image-fallback';

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
  onSetActiveAsset,
  isUploading,
  isSettingActive,
  onOpenMultiSource,
  onOpenUrlImport,
  onOpenImport,
  onExportTavern,
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
  onSetActiveAsset: (assetId: string, kind: AssetKind) => void;
  isUploading: boolean;
  isSettingActive: boolean;
  onOpenMultiSource: () => void;
  onOpenUrlImport: () => void;
  onOpenImport: () => void;
  onExportTavern: () => void;
  onTriggerAiAvatar: () => void;
  avatarTaskId: string | null;
  hasAvatarResult: boolean;
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const portraitInputRef = useRef<HTMLInputElement>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState<'all' | 'avatar' | 'portrait'>('all');
  const [mobileVisualExpanded, setMobileVisualExpanded] = useState(false);

  const currentVariant = variants.find((variant) => variant.id === activeVariantId) || null;
  const filteredAssets = assets.filter((item) => {
    if (assetFilter === 'all') return true;
    return item.kind === assetFilter;
  });

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

          {/* 快捷视觉操作双列按钮 */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onOpenMultiSource}
              disabled={!characterId}
              className="min-h-9 w-full justify-center gap-1.5 px-2.5 text-xs hover:border-accent hover:text-accent"
              title="自动探测 Enka CDN、Fandom Wiki 等官方资源库"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              <span>多源获取</span>
            </Button>

            <AnchoredPopover
              title="上传本地图片"
              open={uploadMenuOpen}
              onOpenChange={setUploadMenuOpen}
              side="top"
              align="start"
              className="w-40"
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!characterId || isUploading}
                  className="min-h-9 w-full justify-center gap-1.5 px-2.5 text-xs"
                  title="上传本地图片"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span>本地上传</span>
                </Button>
              }
            >
              <div className="space-y-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-popover-focus="true"
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
              <Palette className="h-3.5 w-3.5 shrink-0 text-tone-violet-fg" aria-hidden="true" />
              <span>{avatarTaskId ? '生成中...' : hasAvatarResult ? '预览新图' : 'AI 生图'}</span>
            </Button>

            <AnchoredPopover
              title="更多导入导出操作"
              open={moreMenuOpen}
              onOpenChange={setMoreMenuOpen}
              side="top"
              align="end"
              className="w-44"
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-9 w-full justify-center gap-1.5 px-2.5 text-xs"
                  title="更多导入导出操作"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span>更多操作</span>
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
                    setMoreMenuOpen(false);
                    onOpenUrlImport();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <Globe className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>从图片链接导入</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenImport();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <FolderInput className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>导入酒馆角色卡</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!characterId}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onExportTavern();
                  }}
                  className="h-auto min-h-9 w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs font-normal"
                >
                  <Download className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>导出酒馆卡 (JSON)</span>
                </Button>
              </div>
            </AnchoredPopover>
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

        {/* 形象资产库 */}
        <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-accent" />
              <span>形象资产库</span>
            </h4>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenAssets}
              className="h-auto min-h-9 gap-1 px-1.5 py-0.5 text-xs font-medium text-accent"
              title="展开全量 7 大细分分类资产库"
            >
              <span>管理资产 ({assets.length})</span>
              <span aria-hidden="true">&rarr;</span>
            </Button>
          </div>

          {assets.length === 0 ? (
            <p className="text-xs text-muted">暂无图像资产 · 可通过上方获取或上传</p>
          ) : (
            <>
              {/* 分类切换 */}
              <div role="group" aria-label="资产类型筛选" className="flex items-center gap-1 rounded-lg bg-surface-sunken p-0.5 text-xs">
                {(['all', 'portrait', 'avatar'] as const).map((tab) => (
                  <Button
                    key={tab}
                    type="button"
                    size="sm"
                    variant={assetFilter === tab ? 'secondary' : 'ghost'}
                    aria-pressed={assetFilter === tab}
                    onClick={() => setAssetFilter(tab)}
                    className="ui-choice h-auto min-h-8 flex-1 px-2 py-1 text-xs font-medium"
                  >
                    {tab === 'all' ? '全部' : tab === 'portrait' ? '立绘' : '头像'}
                  </Button>
                ))}
              </div>

              {/* 资产列表 */}
              {filteredAssets.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted border border-dashed border-border-subtle rounded-lg">
                  暂无此类资产
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                  {filteredAssets.map((asset) => {
                    const isCurrentAvatar = avatarUrl === asset.url;
                    const isCurrentPortrait = portraitUrl === asset.url;
                    return (
                      <div
                        key={asset.id}
                        className={`group relative aspect-square rounded-lg overflow-hidden border bg-surface-sunken transition-all ${
                          isCurrentAvatar || isCurrentPortrait
                            ? 'border-accent ring-1 ring-accent'
                            : 'border-border-subtle hover:border-border-subtle'
                        }`}
                      >
                        <CharacterAssetImage src={asset.url} alt="资产缩略图" fill className="object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                          {!isCurrentAvatar && (
                            /* 9px 缩略图浮层微按钮：显式覆盖共享 Button 的触控最小高度，避免撑破约 80px 的方形缩略图。 */
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-auto min-h-0 w-full rounded px-1 py-0.5 text-[9px] font-medium sm:min-h-0"
                              onClick={() => onSetActiveAsset(asset.id, 'avatar')}
                              disabled={isSettingActive}
                            >
                              设为头像
                            </Button>
                          )}
                          {!isCurrentPortrait && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-auto min-h-0 w-full rounded px-1 py-0.5 text-[9px] font-medium sm:min-h-0"
                              onClick={() => onSetActiveAsset(asset.id, 'portrait')}
                              disabled={isSettingActive}
                            >
                              设为立绘
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* 衍生形态管理 */}
        <div className="rounded-panel border border-border-subtle bg-surface p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-accent" />
              <span>衍生形态</span>
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
      </div>
    </div>
  );
}
