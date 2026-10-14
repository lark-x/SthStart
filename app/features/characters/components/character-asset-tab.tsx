'use client';

import React, { useState, useMemo, useRef } from 'react';
import Image from 'next/image';
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
  Sparkles,
  RefreshCw,
  Send,
  Eye,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { useToast } from '@/app/providers/ui-provider';
import {
  fetchCharacterAssets,
  uploadCharacterAsset,
  updateCharacterAsset,
  deleteCharacterAsset,
  syncCharacterWithLinshe,
} from '../api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface CharacterAssetTabProps {
  characterId: string;
  avatarAssetId?: string | null;
  portraitAssetId?: string | null;
  displayName: string;
  onRefreshCharacter?: () => void;
}

export function CharacterAssetTab({
  characterId,
  avatarAssetId,
  portraitAssetId,
  displayName,
  onRefreshCharacter,
}: CharacterAssetTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 状态筛选
  const [selectedCategory, setSelectedCategory] = useState<CharacterAssetCategory | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // 模态弹窗状态
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<CharacterAssetDetail | null>(null);
  const [editingAsset, setEditingAsset] = useState<CharacterAssetDetail | null>(null);

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
    if (!confirm(`确定要删除资产「${asset.title || '未命名'}」吗？`)) return;
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
        uploadSetAsActive !== 'none',
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
      });
      toast.success('资产信息已更新');
      setEditingAsset(null);
      void refetch();
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
            分类容纳角色的多形态头像、全身立绘、差分表情、私服穿着、剧情CG及设定草图。
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
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
            selectedCategory === 'all'
              ? 'bg-accent text-white shadow-2xs'
              : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
          }`}
        >
          <span>全部</span>
          <span className="opacity-75 text-[10px]">({categoryCounts.all || 0})</span>
        </button>
        {CHARACTER_ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
              selectedCategory === cat.id
                ? 'bg-accent text-white shadow-2xs'
                : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
            }`}
          >
            <span>{cat.label}</span>
            <span className="opacity-75 text-[10px]">({categoryCounts[cat.id] || 0})</span>
          </button>
        ))}
      </div>

      {/* 标签过滤条 */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-muted flex items-center gap-1 text-[11px]">
            <Tag className="h-3 w-3" /> 标签:
          </span>
          {selectedTag && (
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/15 text-accent text-[11px] font-medium"
            >
              <span>{selectedTag}</span>
              <X className="h-3 w-3" />
            </button>
          )}
          {allTags
            .filter((t) => t !== selectedTag)
            .slice(0, 15)
            .map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className="px-2 py-0.5 rounded-md bg-surface border border-border-default/60 text-muted hover:text-ink text-[11px] transition-colors"
              >
                #{tag}
              </button>
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
              <div
                key={asset.id}
                className="group relative flex flex-col bg-surface border border-border-default/70 rounded-xl overflow-hidden shadow-2xs hover:shadow-xs hover:border-accent/40 transition-all"
              >
                {/* 缩略图区域 */}
                <div
                  className="relative aspect-square w-full bg-surface-muted/50 overflow-hidden cursor-pointer"
                  onClick={() => setPreviewAsset(asset)}
                >
                  <img
                    src={asset.url}
                    alt={asset.title || '角色资产'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  {/* 角标状态徽标 */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
                    {isAvatar && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500 text-white shadow-2xs flex items-center gap-0.5">
                        <Check className="h-2.5 w-2.5" /> 当前头像
                      </span>
                    )}
                    {isPortrait && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500 text-white shadow-2xs flex items-center gap-0.5">
                        <Check className="h-2.5 w-2.5" /> 当前立绘
                      </span>
                    )}
                  </div>

                  {/* 分类徽标 */}
                  <div className="absolute bottom-2 left-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 backdrop-blur-xs text-white/90">
                      {catMeta?.label || '其它'}
                    </span>
                  </div>

                  {/* 悬停放大镜 */}
                  <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="h-5 w-5 text-white/90" />
                  </div>
                </div>

                {/* 资产信息 */}
                <div className="p-2.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-ink line-clamp-1" title={asset.title}>
                      {asset.title || '未命名资产'}
                    </h4>
                    {/* 标签列表 */}
                    {asset.tags && asset.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {asset.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.2 rounded text-[10px] bg-surface-muted text-muted"
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
                      {!isAvatar && (
                        <button
                          type="button"
                          onClick={() => handleSetActive(asset, 'avatar')}
                          className="px-1.5 py-0.5 rounded text-[10px] text-muted hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          title="设为当前生效头像"
                        >
                          设头像
                        </button>
                      )}
                      {!isPortrait && (
                        <button
                          type="button"
                          onClick={() => handleSetActive(asset, 'portrait')}
                          className="px-1.5 py-0.5 rounded text-[10px] text-muted hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          title="设为当前生效立绘"
                        >
                          设立绘
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAsset(asset);
                          setEditTitle(asset.title || '');
                          setEditCategory(asset.category);
                          setEditTagsStr((asset.tags || []).join(', '));
                        }}
                        className="p-1 rounded text-muted hover:text-ink hover:bg-surface-muted transition-colors"
                        title="编辑资产信息"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(asset)}
                        className="p-1 rounded text-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="删除资产"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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
            <label className="block font-semibold text-ink mb-1.5">选择图片文件</label>
            <input
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
              className="block w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-accent file:text-white hover:file:bg-accent/90 cursor-pointer"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">资产名称 / 标题</label>
            <Input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="例如：夏日祭浴衣立绘、害羞表情差分"
              className="h-8 text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">资产分类</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as CharacterAssetCategory)}
              className="w-full h-8 px-2.5 rounded-md border border-border-default bg-surface text-ink text-xs focus:ring-1 focus:ring-accent focus:outline-hidden"
            >
              {CHARACTER_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">标签 (用逗号或空格分隔)</label>
            <Input
              value={uploadTagsStr}
              onChange={(e) => setUploadTagsStr(e.target.value)}
              placeholder="例如：浴衣, 微笑, 2026夏日活动"
              className="h-8 text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">设为当前生效角色形象</label>
            <div className="flex items-center gap-4 text-muted">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="activeType"
                  value="none"
                  checked={uploadSetAsActive === 'none'}
                  onChange={() => setUploadSetAsActive('none')}
                />
                <span>仅存入资产库</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="activeType"
                  value="avatar"
                  checked={uploadSetAsActive === 'avatar'}
                  onChange={() => setUploadSetAsActive('avatar')}
                />
                <span>设为当前头像</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="activeType"
                  value="portrait"
                  checked={uploadSetAsActive === 'portrait'}
                  onChange={() => setUploadSetAsActive('portrait')}
                />
                <span>设为当前立绘</span>
              </label>
            </div>
          </div>

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
            <label className="block font-semibold text-ink mb-1">资产名称 / 标题</label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="请输入标题"
              className="h-8 text-xs"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">资产分类</label>
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as CharacterAssetCategory)}
              className="w-full h-8 px-2.5 rounded-md border border-border-default bg-surface text-ink text-xs focus:ring-1 focus:ring-accent focus:outline-hidden"
            >
              {CHARACTER_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-ink mb-1">标签 (用逗号或空格分隔)</label>
            <Input
              value={editTagsStr}
              onChange={(e) => setEditTagsStr(e.target.value)}
              placeholder="例如：战斗态, 破损服装"
              className="h-8 text-xs"
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
            <div className="relative max-h-[70vh] w-full flex items-center justify-center bg-black/5 rounded-lg overflow-hidden p-2">
              <img
                src={previewAsset.url}
                alt={previewAsset.title || ''}
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>
            <div className="w-full flex items-center justify-between text-xs text-muted">
              <span>分类: {CHARACTER_ASSET_CATEGORIES.find((c) => c.id === previewAsset.category)?.label}</span>
              <a
                href={previewAsset.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline flex items-center gap-1"
              >
                查看原图 <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
