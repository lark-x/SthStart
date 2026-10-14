'use client';

import React, { useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SHARED_ASSET_CATEGORIES,
  type SharedAssetCategory,
  type SharedAssetItem,
} from '@sthstart/contracts';
import {
  Upload,
  Plus,
  Trash2,
  Edit2,
  Eye,
  Search,
  Filter,
  Users,
  Tag,
  FolderKanban,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { useToast } from '@/app/providers/ui-provider';
import {
  fetchSharedAssets,
  createSharedAsset,
  updateSharedAsset,
  deleteSharedAsset,
  fetchCharacters,
} from '../api';

export function SharedAssetVault() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 筛选与搜索状态
  const [selectedCategory, setSelectedCategory] = useState<SharedAssetCategory | 'all'>('all');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 模态弹窗状态
  const [previewAsset, setPreviewAsset] = useState<SharedAssetItem | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<SharedAssetItem | null>(null);

  // 上传表单状态
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState<SharedAssetCategory>('group_photo');
  const [uploadCharacterIds, setUploadCharacterIds] = useState<string[]>([]);
  const [uploadTagsStr, setUploadTagsStr] = useState('');
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  // 编辑表单状态
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<SharedAssetCategory>('group_photo');
  const [editCharacterIds, setEditCharacterIds] = useState<string[]>([]);
  const [editTagsStr, setEditTagsStr] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // 1. 查询所有可用角色（供多选绑定与筛选）
  const { data: charactersData } = useQuery({
    queryKey: ['characters', 'all-profiles'],
    queryFn: () => fetchCharacters(),
    staleTime: 60_000,
  });
  const allCharacters = useMemo(() => charactersData?.items ?? [], [charactersData]);
  const characterMap = useMemo(() => {
    const map = new Map<string, { displayName: string; avatarUrl?: string | null }>();
    for (const c of allCharacters) {
      map.set(c.id, { displayName: c.displayName, avatarUrl: c.avatarUrl });
    }
    return map;
  }, [allCharacters]);

  // 2. 查询公共资产列表
  const { data: assetData, isLoading, refetch } = useQuery({
    queryKey: [
      'shared-assets',
      selectedCategory,
      selectedCharacterId,
      selectedTag,
      searchQuery,
    ],
    queryFn: () =>
      fetchSharedAssets({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        characterId: selectedCharacterId || undefined,
        tag: selectedTag || undefined,
        search: searchQuery.trim() || undefined,
      }),
  });

  const assets = useMemo(() => assetData?.items ?? [], [assetData]);

  // 统计各分类数量
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: assets.length };
    for (const cat of SHARED_ASSET_CATEGORIES) {
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

  // 处理文件选中
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    if (!uploadTitle) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setUploadTitle(nameWithoutExt);
    }
    const reader = new FileReader();
    reader.onload = () => setUploadPreviewUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  // 提交上传
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.warning('请选择需要上传的资产图片');
      return;
    }
    setUploadSubmitting(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(uploadFile);
      });

      const tags = uploadTagsStr
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      await createSharedAsset({
        dataUrl,
        filename: uploadFile.name,
        category: uploadCategory,
        title: uploadTitle.trim() || uploadFile.name,
        characterIds: uploadCharacterIds,
        tags,
      });

      toast.success('公共资产上传成功');
      setUploadDialogOpen(false);
      setUploadFile(null);
      setUploadPreviewUrl(null);
      setUploadTitle('');
      setUploadCharacterIds([]);
      setUploadTagsStr('');
      void refetch();
    } catch (err) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadSubmitting(false);
    }
  };

  // 提交编辑保存
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    setEditSubmitting(true);
    try {
      const tags = editTagsStr
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      await updateSharedAsset(editingAsset.id, {
        title: editTitle.trim() || editingAsset.title,
        category: editCategory,
        characterIds: editCharacterIds,
        tags,
      });

      toast.success('资产信息已更新');
      setEditingAsset(null);
      void refetch();
    } catch (err) {
      toast.error('更新失败', err instanceof Error ? err.message : String(err));
    } finally {
      setEditSubmitting(false);
    }
  };

  // 删除资产
  const handleDelete = async (asset: SharedAssetItem) => {
    if (!confirm(`确定要删除公共资产 "${asset.title}" 吗？此操作不可恢复。`)) return;
    try {
      await deleteSharedAsset(asset.id);
      toast.success('资产已删除');
      void refetch();
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部控制栏：分类胶囊、统计、上传入口 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <span>多角色公共资产库</span>
          </h2>
          <p className="text-xs text-muted mt-0.5">
            收纳多人合影、世界观背景、主视觉海报与道具圣遗物，支持与多个角色双向关联。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => setUploadDialogOpen(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>上传公共资产</span>
          </Button>
        </div>
      </div>

      {/* 分类过滤器胶囊 */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-surface-muted rounded-xl border border-border-default/60">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            selectedCategory === 'all'
              ? 'bg-surface text-accent shadow-xs font-semibold'
              : 'text-muted hover:text-ink'
          }`}
        >
          全部分类 ({categoryCounts.all ?? 0})
        </button>
        {SHARED_ASSET_CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                selectedCategory === cat.id
                  ? 'bg-surface text-accent shadow-xs font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
              title={cat.description}
            >
              <span>{cat.label}</span>
              <span className="text-[10px] text-muted/70 px-1 py-0.2 rounded-full bg-border-default/20">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 搜索与多维关联过滤行 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 关键字搜索 */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索资产标题或标签..."
            className="h-8 pl-8 pr-3 text-xs bg-surface border border-border-default rounded-lg text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 关联角色快速过滤 */}
        <div className="flex items-center gap-1 text-xs text-muted">
          <Users className="h-3.5 w-3.5" />
          <select
            value={selectedCharacterId}
            onChange={(e) => setSelectedCharacterId(e.target.value)}
            className="h-8 px-2 text-xs bg-surface border border-border-default rounded-lg text-ink focus:outline-none focus:border-accent"
          >
            <option value="">全部关联角色</option>
            {allCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>

        {/* 标签快筛 */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            <span className="text-[11px] text-muted flex items-center gap-0.5 ml-2">
              <Tag className="h-3 w-3" />
              <span>标签:</span>
            </span>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  selectedTag === tag
                    ? 'bg-accent text-white font-medium'
                    : 'bg-surface-muted text-muted hover:text-ink'
                }`}
              >
                #{tag}
              </button>
            ))}
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="text-[11px] text-accent hover:underline ml-1"
              >
                清除
              </button>
            )}
          </div>
        )}
      </div>

      {/* 资产卡片网格列表 */}
      {isLoading ? (
        <div className="py-20 text-center text-xs text-muted">加载资产库中...</div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default p-16 text-center text-muted space-y-3 bg-surface/40">
          <FolderKanban className="mx-auto h-10 w-10 text-muted/40" />
          <p className="text-sm font-medium text-ink">暂无符合条件的公共资产</p>
          <p className="text-xs text-muted max-w-sm mx-auto">
            可上传多人合照、剧情名场面背景、主视觉海报或世界观概念图，与角色卡库相互关联。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUploadDialogOpen(true)}
            className="text-xs mt-2"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            <span>上传首张公共资产</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {assets.map((asset) => {
            const catMeta = SHARED_ASSET_CATEGORIES.find((c) => c.id === asset.category);
            return (
              <div
                key={asset.id}
                className="group relative rounded-xl border border-border-default/80 bg-surface overflow-hidden shadow-xs hover:border-accent/40 hover:shadow-md transition-all flex flex-col"
              >
                {/* 预览大图容器 */}
                <div
                  className="relative aspect-video w-full overflow-hidden bg-surface-muted cursor-pointer"
                  onClick={() => setPreviewAsset(asset)}
                >
                  <Image
                    src={asset.url}
                    alt={asset.title}
                    fill
                    unoptimized
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* 分类徽章 */}
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-surface/85 backdrop-blur-md text-[10px] font-medium text-ink shadow-xs border border-border-default/40">
                    {catMeta?.label || asset.category}
                  </div>

                  {/* 悬停放大镜 */}
                  <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="h-5 w-5 text-white/90" />
                  </div>
                </div>

                {/* 资产描述与关联信息 */}
                <div className="p-2.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-ink line-clamp-1" title={asset.title}>
                      {asset.title || '未命名资产'}
                    </h4>

                    {/* 参与角色头像与名称胶囊 */}
                    {asset.characterIds && asset.characterIds.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {asset.characterIds.slice(0, 3).map((charId) => {
                          const char = characterMap.get(charId);
                          return (
                            <span
                              key={charId}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 text-[10px] text-accent font-medium"
                              title={char?.displayName || charId}
                            >
                              {char?.avatarUrl && (
                                <span className="relative h-3 w-3 rounded-full overflow-hidden">
                                  <Image
                                    src={char.avatarUrl}
                                    alt=""
                                    fill
                                    unoptimized
                                    className="object-cover"
                                  />
                                </span>
                              )}
                              <span className="truncate max-w-[50px]">
                                {char?.displayName || '未知角色'}
                              </span>
                            </span>
                          );
                        })}
                        {asset.characterIds.length > 3 && (
                          <span className="text-[10px] text-muted font-medium">
                            +{asset.characterIds.length - 3}
                          </span>
                        )}
                      </div>
                    )}

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

                  {/* 操作行 */}
                  <div className="mt-2.5 pt-2 border-t border-border-default/40 flex items-center justify-between text-xs">
                    <span className="text-[10px] text-muted">
                      {new Date(asset.createdAt).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAsset(asset);
                          setEditTitle(asset.title || '');
                          setEditCategory(asset.category);
                          setEditCharacterIds(asset.characterIds || []);
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

      {/* 上传公共资产弹窗 */}
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => !open && setUploadDialogOpen(false)}
        title="上传多角色公共资产"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4 pt-2">
          {/* 文件选择区 */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="group border-2 border-dashed border-border-default hover:border-accent rounded-xl p-4 text-center cursor-pointer transition-colors bg-surface-muted/40"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
            {uploadPreviewUrl ? (
              <div className="relative aspect-video w-full max-h-48 rounded-lg overflow-hidden mx-auto bg-surface">
                <Image
                  src={uploadPreviewUrl}
                  alt="上传预览"
                  fill
                  unoptimized
                  className="object-contain"
                />
              </div>
            ) : (
              <div className="space-y-1.5 py-4">
                <Upload className="mx-auto h-7 w-7 text-muted group-hover:text-accent transition-colors" />
                <p className="text-xs font-medium text-ink">点击或拖拽图片文件至此</p>
                <p className="text-[11px] text-muted">支持 PNG, JPG, WebP 格式</p>
              </div>
            )}
          </div>

          {/* 资产标题 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">资产标题</label>
            <Input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="例如：枫丹茶会合照、水下遗迹全景"
              required
              className="text-xs h-8"
            />
          </div>

          {/* 分类选择 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">资产分类</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as SharedAssetCategory)}
              className="w-full h-8 px-2.5 text-xs bg-surface border border-border-default rounded-md text-ink focus:outline-none focus:border-accent"
            >
              {SHARED_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </select>
          </div>

          {/* 关联角色多选 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center justify-between">
              <span>参与/关联角色 ({uploadCharacterIds.length})</span>
              <span className="text-[11px] text-muted">点击标签添加或移除</span>
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-surface-muted rounded-md border border-border-default/60">
              {allCharacters.map((char) => {
                const isSelected = uploadCharacterIds.includes(char.id);
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setUploadCharacterIds(uploadCharacterIds.filter((id) => id !== char.id));
                      } else {
                        setUploadCharacterIds([...uploadCharacterIds, char.id]);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-accent text-white font-medium'
                        : 'bg-surface text-ink hover:border-accent/40 border border-border-default/50'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                    <span>{char.displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 标签 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">特征标签</label>
            <Input
              type="text"
              value={uploadTagsStr}
              onChange={(e) => setUploadTagsStr(e.target.value)}
              placeholder="逗号或空格分隔，例如：多人同框, 聚会, 枫丹"
              className="text-xs h-8"
            />
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUploadDialogOpen(false)}
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

      {/* 编辑公共资产弹窗 */}
      <Dialog
        open={Boolean(editingAsset)}
        onOpenChange={(open) => !open && setEditingAsset(null)}
        title="编辑公共资产信息"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
          {/* 标题 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">资产标题</label>
            <Input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
              className="text-xs h-8"
            />
          </div>

          {/* 分类 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">资产分类</label>
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as SharedAssetCategory)}
              className="w-full h-8 px-2.5 text-xs bg-surface border border-border-default rounded-md text-ink focus:outline-none focus:border-accent"
            >
              {SHARED_ASSET_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} ({cat.description})
                </option>
              ))}
            </select>
          </div>

          {/* 参与角色 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center justify-between">
              <span>参与/关联角色 ({editCharacterIds.length})</span>
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-surface-muted rounded-md border border-border-default/60">
              {allCharacters.map((char) => {
                const isSelected = editCharacterIds.includes(char.id);
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setEditCharacterIds(editCharacterIds.filter((id) => id !== char.id));
                      } else {
                        setEditCharacterIds([...editCharacterIds, char.id]);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-accent text-white font-medium'
                        : 'bg-surface text-ink hover:border-accent/40 border border-border-default/50'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                    <span>{char.displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 标签 */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">特征标签</label>
            <Input
              type="text"
              value={editTagsStr}
              onChange={(e) => setEditTagsStr(e.target.value)}
              placeholder="逗号或空格分隔"
              className="text-xs h-8"
            />
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
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
          <div className="space-y-3 pt-2">
            <div className="relative aspect-video w-full max-h-[70vh] rounded-xl overflow-hidden bg-black/5 border border-border-default flex items-center justify-center">
              <Image
                src={previewAsset.url}
                alt={previewAsset.title}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted pt-1">
              <span>分类: {previewAsset.category}</span>
              <a
                href={previewAsset.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline font-medium"
              >
                <span>在新标签页打开原图</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
