'use client';

import React, { useState, useMemo, useRef } from 'react';
import {
  CHARACTER_ASSET_CATEGORIES,
  type CharacterAssetCategory,
  type CharacterAssetDetail,
} from '@sthstart/contracts';
import {
  Upload,
  Plus,
  Trash2,
  Check,
  Edit2,
  Tag,
  Send,
  Eye,
  X,
  ExternalLink,
  Shirt,
} from 'lucide-react';
import { CharacterAssetImage } from './character-image-fallback';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Dialog } from '@/app/components/ui/dialog';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { useToast } from '@/app/providers/ui-provider';
import {
  fetchCharacterAssets,
  uploadCharacterAsset,
  updateCharacterAsset,
  deleteCharacterAsset,
  syncCharacterWithLinshe,
} from '../api';
import { useQuery } from '@tanstack/react-query';

interface CharacterAssetTabProps {
  characterId: string;
  avatarAssetId?: string | null;
  portraitAssetId?: string | null;
  displayName: string;
  onRefreshCharacter?: () => void;
  variantName?: string;
  onSelectVariantImage?: (asset: CharacterAssetDetail, kind: 'avatar' | 'portrait') => void;
}

export function CharacterAssetTab({
  characterId,
  avatarAssetId,
  portraitAssetId,
  displayName,
  onRefreshCharacter,
  variantName,
  onSelectVariantImage,
}: CharacterAssetTabProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 状态筛选
  const [selectedCategory, setSelectedCategory] = useState<CharacterAssetCategory | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // 模态弹窗状态
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<CharacterAssetDetail | null>(null);
  const [editingAsset, setEditingAsset] = useState<CharacterAssetDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CharacterAssetDetail | null>(null);

  // 上传表单状态
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState<CharacterAssetCategory>('concept');
  const [uploadTagsStr, setUploadTagsStr] = useState('');
  const [uploadSetAsActive, setUploadSetAsActive] = useState<'avatar' | 'portrait' | 'none'>('none');
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  // 编辑表单状态
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<CharacterAssetCategory>('concept');
  const [editTagsStr, setEditTagsStr] = useState('');
  const [editOutfitDesc, setEditOutfitDesc] = useState('');
  const [editLoreStory, setEditLoreStory] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // 同步状态
  const [syncingLinshe, setSyncingLinshe] = useState(false);

  // 获取资产列表
  const { data: assetData, isLoading, refetch } = useQuery({
    queryKey: ['character-assets', characterId],
    queryFn: () => fetchCharacterAssets(characterId),
    enabled: Boolean(characterId),
  });

  const assets = useMemo(() => assetData?.items ?? [], [assetData]);

  // 统计各分类数量
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: assets.length };
    for (const cat of CHARACTER_ASSET_CATEGORIES) {
      counts[cat.id] = 0;
    }
    for (const a of assets) {
      counts[a.category] = (counts[a.category] || 0) + 1;
    }
    return counts;
  }, [assets]);

  // 提取所有标签
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      for (const t of a.tags || []) {
        if (t) set.add(t);
      }
    }
    return Array.from(set);
  }, [assets]);

  // 过滤后的资产
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (selectedCategory !== 'all' && a.category !== selectedCategory) return false;
      if (selectedTag && (!a.tags || !a.tags.includes(selectedTag))) return false;
      return true;
    });
  }, [assets, selectedCategory, selectedTag]);

  // 操作：设为头像/立绘
  const handleSetActive = async (asset: CharacterAssetDetail, type: 'avatar' | 'portrait') => {
    if (onSelectVariantImage) { onSelectVariantImage(asset, type); return; }
    try {
      await updateCharacterAsset(characterId, asset.id, { setAsActive: type });
      toast.success(`已将此资产设为当前生效${type === 'avatar' ? '头像' : '立绘'}`);
      void refetch();
      onRefreshCharacter?.();
    } catch (err: unknown) {
      toast.error('设置失败', err instanceof Error ? err.message : String(err));
    }
  };

  // 操作：删除资产
  const handleDelete = async (asset: CharacterAssetDetail) => {
    try {
      await deleteCharacterAsset(characterId, asset.id);
      toast.success('资产已删除');
      void refetch();
      onRefreshCharacter?.();
    } catch (err: unknown) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  // 操作：提交上传
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.warning('请选择要上传的图片文件');
      return;
    }
    setUploadSubmitting(true);
    try {
      const tags = uploadTagsStr
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await uploadCharacterAsset(
        characterId,
        uploadFile,
        uploadCategory === 'avatar' ? 'avatar' : uploadCategory === 'portrait' ? 'portrait' : 'reference',
        !variantName && uploadSetAsActive !== 'none',
        {
          category: uploadCategory,
          title: uploadTitle.trim() || uploadFile.name,
          tags,
        }
      );
      toast.success('资产上传成功');
      setUploadModalOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadTagsStr('');
      setUploadSetAsActive('none');
      void refetch();
      onRefreshCharacter?.();
    } catch (err: unknown) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadSubmitting(false);
    }
  };

  // 操作：提交编辑
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    setEditSubmitting(true);
    try {
      const tags = editTagsStr
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await updateCharacterAsset(characterId, editingAsset.id, {
        title: editTitle.trim(),
        category: editCategory,
        tags,
        userNote: editOutfitDesc.trim(),
        authorNote: editLoreStory.trim(),
        metadata: {
          ...(editingAsset.metadata || {}),
          outfitDescription: editOutfitDesc.trim(),
          loreStory: editLoreStory.trim(),
        },
      });
      toast.success('资产信息已更新');
      setEditingAsset(null);
      void refetch();
      onRefreshCharacter?.();
    } catch (err: unknown) {
      toast.error('更新失败', err instanceof Error ? err.message : String(err));
    } finally {
      setEditSubmitting(false);
    }
  };

  // 操作：推送到邻舍
  const handlePushToLinshe = async () => {
    setSyncingLinshe(true);
    try {
      const res = await syncCharacterWithLinshe({ characterId, action: 'push_to_linshe' });
      if (res.ok) {
        toast.success(res.message || '成功推送到邻舍');
      } else {
        toast.error('推送失败', res.message);
      }
    } catch (err: unknown) {
      toast.error('推送失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingLinshe(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* 顶部工具栏：分类筛选与主操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface p-4 rounded-xl border border-border-default/60 shadow-2xs">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <span>{displayName} 的资产库</span>
            <span className="text-xs font-normal text-muted">共 {assets.length} 件资产</span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {variantName ? `共享资产库。下方选图仅用于「${variantName}」，保存档案后生效。` : '主档案资产库。普通换装归入皮肤，服装描述与故事可独立于图片保留。'}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePushToLinshe}
            disabled={syncingLinshe}
            className="text-xs h-8 gap-1.5"
            title="将该角色最新发布人设与资产推送同步至邻舍"
          >
            <Send className={`h-3.5 w-3.5 ${syncingLinshe ? 'animate-spin' : ''}`} />
            <span>{syncingLinshe ? '推送中...' : '推送到邻舍'}</span>
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => setUploadModalOpen(true)}
            className="text-xs h-8 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加新资产</span>
          </Button>
        </div>
      </div>

      {/* 7 大分类筛选标签条 */}
      <div role="group" aria-label="资产分类筛选" className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <Button
          type="button"
          size="sm"
          variant={selectedCategory === 'all' ? 'accent' : 'secondary'}
          aria-pressed={selectedCategory === 'all'}
          onClick={() => setSelectedCategory('all')}
          className={`h-auto min-h-8 shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${selectedCategory === 'all' ? '' : 'bg-surface-muted text-muted shadow-none'}`}
        >
          <span>全部</span>
          <span className="opacity-75 text-xs">({categoryCounts.all || 0})</span>
        </Button>
        {CHARACTER_ASSET_CATEGORIES.map((cat) => (
          <Button
            key={cat.id}
            type="button"
            size="sm"
            variant={selectedCategory === cat.id ? 'accent' : 'secondary'}
            aria-pressed={selectedCategory === cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`h-auto min-h-8 shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${selectedCategory === cat.id ? '' : 'bg-surface-muted text-muted shadow-none'}`}
          >
            <span>{cat.label}</span>
            <span className="opacity-75 text-xs">({categoryCounts[cat.id] || 0})</span>
          </Button>
        ))}
      </div>

      {/* 标签过滤条 */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-muted flex items-center gap-1 text-xs">
            <Tag className="h-3 w-3" /> 标签:
          </span>
          {selectedTag && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setSelectedTag(null)}
              className="h-auto min-h-6 gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
              aria-label={`清除标签筛选：${selectedTag}`}
            >
              <span aria-hidden="true">{selectedTag}</span>
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
          {allTags
            .filter((t) => t !== selectedTag)
            .slice(0, 15)
            .map((tag) => (
              <Button
                key={tag}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedTag(tag)}
                className="h-auto min-h-6 rounded-md px-2 py-0.5 text-xs font-normal text-muted hover:text-ink"
              >
                #{tag}
              </Button>
            ))}
        </div>
      )}

      {/* 资产卡片网格 */}
      {isLoading ? (
        <div className="py-16 text-center text-muted text-xs">正在读取资产库...</div>
      ) : filteredAssets.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-border-default/80 rounded-xl bg-surface/50">
          <p className="text-xs text-muted">当前分类下尚无资产</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUploadModalOpen(true)}
            className="mt-3 text-xs gap-1"
          >
            <Upload className="h-3.5 w-3.5" /> 上传第一张资产
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
          {filteredAssets.map((asset) => {
            const isAvatar = asset.id === avatarAssetId;
            const isPortrait = asset.id === portraitAssetId;
            const catMeta = CHARACTER_ASSET_CATEGORIES.find((c) => c.id === asset.category);

            return (
              <Card
                key={asset.id}
                className="group relative flex flex-col overflow-hidden !p-0"
              >
                {/* 缩略图区域 */}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`预览资产：${asset.title || '未命名资产'}`}
                  onClick={() => setPreviewAsset(asset)}
                  className="relative block aspect-square h-auto min-h-0 w-full overflow-hidden rounded-none border-0 bg-surface-muted/50 p-0 text-left"
                >
                  {asset.url ? <CharacterAssetImage
                    src={asset.url}
                    alt={asset.title || '角色资产'}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-200"
                  /> : <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-muted"><Shirt className="h-8 w-8" aria-hidden="true" /><span className="text-sm">皮肤文字档案</span><span className="text-xs">图片尚未获取</span></span>}
                  {/* 角标状态徽标 */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
                    {isAvatar && (
                      <Badge variant="accent" className="gap-0.5">
                        <Check className="h-2.5 w-2.5" aria-hidden="true" /> 当前头像
                      </Badge>
                    )}
                    {isPortrait && (
                      <Badge variant="accent" className="gap-0.5">
                        <Check className="h-2.5 w-2.5" aria-hidden="true" /> 当前立绘
                      </Badge>
                    )}
                  </div>

                  {/* 分类徽标 */}
                  <div className="absolute bottom-2 left-2">
                    <Badge>
                      {catMeta?.label || '其它'}
                    </Badge>
                  </div>

                  {/* 悬停放大镜 */}
                  <div className="pointer-events-none absolute inset-0 bg-surface/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="h-5 w-5 text-ink" aria-hidden="true" />
                  </div>
                </Button>

                {/* 资产信息 */}
                <div className="p-2.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-ink line-clamp-1" title={asset.title}>
                      {asset.title || '未命名资产'}
                    </h4>
                    {(Boolean(asset.metadata?.outfitDescription) || Boolean(asset.metadata?.loreStory) || asset.userNote || asset.authorNote) && (
                      <p className="mt-1 text-xs text-muted line-clamp-2 leading-snug">
                        {String(asset.metadata?.outfitDescription || asset.userNote || asset.metadata?.loreStory || asset.authorNote)}
                      </p>
                    )}
                    {/* 标签列表 */}
                    {asset.tags && asset.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {asset.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.2 rounded text-xs bg-surface-muted text-muted"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 悬浮/常驻操作栏 */}
                  <div className="mt-2.5 pt-2 border-t border-border-default/40 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      {asset.url && !isAvatar && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSetActive(asset, 'avatar')}
                          className="h-auto min-h-6 rounded px-1.5 py-0.5 text-sm font-normal text-muted hover:text-accent"
                          title="设为当前生效头像"
                        >
                          {variantName ? '用于形态头像' : '设头像'}
                        </Button>
                      )}
                      {asset.url && !isPortrait && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSetActive(asset, 'portrait')}
                          className="h-auto min-h-6 rounded px-1.5 py-0.5 text-sm font-normal text-muted hover:text-accent"
                          title="设为当前生效立绘"
                        >
                          {variantName ? '用于形态立绘' : '设立绘'}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        icon={Edit2}
                        label="编辑资产信息"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingAsset(asset);
                          setEditTitle(asset.title || '');
                          setEditCategory(asset.category);
                          setEditTagsStr((asset.tags || []).join(', '));
                          setEditOutfitDesc(String(asset.metadata?.outfitDescription || asset.userNote || ''));
                          setEditLoreStory(String(asset.metadata?.loreStory || asset.authorNote || ''));
                        }}
                        className="size-7 min-h-7 rounded text-muted"
                        iconClassName="h-3 w-3"
                        title="编辑资产信息"
                      />
                      <IconButton
                        icon={Trash2}
                        label="删除资产"
                        size="sm"
                        variant="danger-ghost"
                        onClick={() => setPendingDelete(asset)}
                        className="size-7 min-h-7 rounded text-muted hover:text-danger-fg"
                        iconClassName="h-3 w-3"
                        title="删除资产"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 上传资产弹窗 */}
      <Dialog
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        title={`添加资产 · ${displayName}`}
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs pt-1">
          <div>
            <label htmlFor="character-asset-upload-file" className="block font-semibold text-ink mb-1.5">选择图片文件</label>
            <input
              id="character-asset-upload-file"
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setUploadFile(f);
                  if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ''));
                }
              }}
              className="block w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-accent file:text-fg-on-accent hover:file:bg-accent/90 cursor-pointer"
              required
            />
          </div>

          <div>
            <label htmlFor="character-asset-upload-title" className="block font-semibold text-ink mb-1">资产名称 / 标题</label>
            <Input
              id="character-asset-upload-title"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="例如：夏日祭浴衣立绘、害羞表情差分"
              className="h-8 text-xs"
            />
          </div>

          <div>
            <label htmlFor="character-asset-upload-category" className="block font-semibold text-ink mb-1">资产分类</label>
            <Select
              id="character-asset-upload-category"
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as CharacterAssetCategory)}
              className="h-8 min-h-8 text-xs"
            >
              {CHARACTER_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="character-asset-upload-tags" className="block font-semibold text-ink mb-1">标签 (用逗号或空格分隔)</label>
            <Input
              id="character-asset-upload-tags"
              value={uploadTagsStr}
              onChange={(e) => setUploadTagsStr(e.target.value)}
              placeholder="例如：浴衣, 微笑, 2026夏日活动"
              className="h-8 text-xs"
            />
          </div>

          {!variantName && <div>
            <span id="character-asset-upload-active-label" className="mb-1 block font-semibold text-ink">设为当前生效角色形象</span>
            {/* 单选语义保留原生 name/radio：Mantine Checkbox 是复选框，不替代互斥选择。 */}
            <div role="radiogroup" aria-labelledby="character-asset-upload-active-label" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted">
              {([
                ['none', '仅存入资产库'],
                ['avatar', '设为当前头像'],
                ['portrait', '设为当前立绘'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    name="activeType"
                    value={value}
                    checked={uploadSetAsActive === value}
                    onChange={() => setUploadSetAsActive(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>}

          <div className="flex justify-end gap-2 pt-3 border-t border-border-default/60">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUploadModalOpen(false)}
              className="text-xs h-8"
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={uploadSubmitting}
              className="text-xs h-8"
            >
              {uploadSubmitting ? '上传中...' : '确认上传'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 编辑资产弹窗 */}
      <Dialog
        open={Boolean(editingAsset)}
        onOpenChange={(open) => !open && setEditingAsset(null)}
        title="编辑资产信息"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 text-xs pt-1">
          <div>
            <label htmlFor="character-asset-edit-title" className="block font-semibold text-ink mb-1">资产名称 / 标题</label>
            <Input
              id="character-asset-edit-title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="请输入标题"
              className="h-8 text-xs"
              required
            />
          </div>

          <div>
            <label htmlFor="character-asset-edit-category" className="block font-semibold text-ink mb-1">资产分类</label>
            <Select
              id="character-asset-edit-category"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as CharacterAssetCategory)}
              className="h-8 min-h-8 text-xs"
            >
              {CHARACTER_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="character-asset-edit-tags" className="block font-semibold text-ink mb-1">标签 (用逗号或空格分隔)</label>
            <Input
              id="character-asset-edit-tags"
              value={editTagsStr}
              onChange={(e) => setEditTagsStr(e.target.value)}
              placeholder="例如：战斗态, 破损服装"
              className="h-8 text-xs"
            />
          </div>

          <div>
            <label htmlFor="character-asset-edit-outfit" className="block font-semibold text-ink mb-1">服装描述（多皮肤 / 生图参考）</label>
            <textarea
              id="character-asset-edit-outfit"
              rows={2}
              value={editOutfitDesc}
              onChange={(e) => setEditOutfitDesc(e.target.value)}
              placeholder="描述该皮肤或图片的服装剪裁、配色与配饰…"
              className="w-full rounded-control border border-border-control bg-surface-input p-2 text-xs text-ink"
            />
          </div>

          <div>
            <label htmlFor="character-asset-edit-lore" className="block font-semibold text-ink mb-1">背景故事 / 出处说明</label>
            <textarea
              id="character-asset-edit-lore"
              rows={2}
              value={editLoreStory}
              onChange={(e) => setEditLoreStory(e.target.value)}
              placeholder="记录该皮肤的背景来历或剧情意义…"
              className="w-full rounded-control border border-border-control bg-surface-input p-2 text-xs text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-default/60">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingAsset(null)}
              className="text-xs h-8"
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={editSubmitting}
              className="text-xs h-8"
            >
              {editSubmitting ? '保存中...' : '保存更改'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 大图预览弹窗 */}
      <Dialog
        open={Boolean(previewAsset)}
        onOpenChange={(open) => !open && setPreviewAsset(null)}
        title={previewAsset?.title || '资产大图预览'}
      >
        {previewAsset && (
          <div className="flex flex-col items-center gap-3">
            {previewAsset.url ? <div className="relative max-h-[70vh] w-full flex items-center justify-center bg-surface-sunken rounded-lg overflow-hidden p-2">
              <img
                src={previewAsset.url}
                alt={previewAsset.title || ''}
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div> : <p className="text-sm text-muted">图片尚未获取，服装描述与故事已保存在此皮肤档案中。</p>}
            {(previewAsset.metadata?.outfitDescription || previewAsset.userNote) && <section className="w-full space-y-1"><h3 className="text-sm font-semibold text-ink">服装描述</h3><p className="whitespace-pre-wrap text-base leading-relaxed">{String(previewAsset.metadata?.outfitDescription || previewAsset.userNote)}</p></section>}
            {(previewAsset.metadata?.loreStory || previewAsset.authorNote) && <section className="w-full space-y-1"><h3 className="text-sm font-semibold text-ink">背景故事 / 出处说明</h3><p className="whitespace-pre-wrap text-base leading-relaxed">{String(previewAsset.metadata?.loreStory || previewAsset.authorNote)}</p></section>}
            {Boolean(previewAsset.metadata?.imageWarning) && <p className="w-full text-sm text-muted">{String(previewAsset.metadata?.imageWarning)}</p>}
            <div className="w-full flex items-center justify-between text-xs text-muted">
              <span>分类: {CHARACTER_ASSET_CATEGORIES.find((c) => c.id === previewAsset.category)?.label}</span>
              {previewAsset.url && <a
                href={previewAsset.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline flex items-center gap-1"
              >
                查看原图 <ExternalLink className="h-3 w-3" />
              </a>}
            </div>
          </div>
        )}
      </Dialog>

      {/* 删除确认：替代 window.confirm，保留对象名称与不可恢复后果说明 */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除这张资产？"
        description={`「${pendingDelete?.title || '未命名'}」将从 ${displayName} 的资产库中移除，此操作不可恢复。`}
        confirmLabel="删除资产"
        danger
        onConfirm={async () => {
          if (!pendingDelete) return;
          await handleDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
