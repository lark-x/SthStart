'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Download,
  Copy,
  ImageOff,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { useToast } from '@/app/providers/ui-provider';
import { useCharacters } from '@/app/features/characters/queries';
import {
  fetchSharedAssets,
  createSharedAsset,
  updateSharedAsset,
  deleteSharedAsset,
  } from '../api';

function SharedAssetCardImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);



  if (!src || failedSrc === src) {
    return (
      <div className="w-full aspect-[4/3] bg-surface-sunken flex flex-col items-center justify-center p-3 text-center select-none border-b border-border-subtle/60 overflow-hidden">
        <div className="w-8 h-8 rounded-control bg-surface border border-border-subtle flex items-center justify-center text-muted mb-1 shadow-2xs">
          <ImageOff className="h-4 w-4 stroke-[1.5]" aria-hidden="true" />
        </div>
        <p className="text-xs text-muted">图片暂不可用</p>
        <span className="mt-1 text-xs text-muted">打开详情可重试</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || title || '公共资产'}
      onError={() => setFailedSrc(src)}
      loading="lazy"
      className="w-full aspect-[4/3] object-cover motion-safe:group-hover:scale-[1.02] transition-transform motion-reduce:transition-none duration-150 block bg-surface-muted"
    />
  );
}

export interface SharedAssetVaultProps {
  active?: boolean;
  uploadDialogOpen?: boolean;
  onUploadDialogOpenChange?: (open: boolean) => void;
}

export function SharedAssetVault({
  active = true,
  uploadDialogOpen: externalUploadOpen,
  onUploadDialogOpenChange,
}: SharedAssetVaultProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 筛选与搜索状态
  const [selectedCategory, setSelectedCategory] = useState<SharedAssetCategory | 'all'>('all');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // 模态弹窗状态
  const [previewAsset, setPreviewAsset] = useState<SharedAssetItem | null>(null);
  const [previewFailedSrc, setPreviewFailedSrc] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [internalUploadOpen, setInternalUploadOpen] = useState(false);
  const uploadDialogOpen = externalUploadOpen !== undefined ? externalUploadOpen : internalUploadOpen;
  const setUploadDialogOpen = (open: boolean) => {
    if (onUploadDialogOpenChange) {
      onUploadDialogOpenChange(open);
    } else {
      setInternalUploadOpen(open);
    }
  };
  const [editingAsset, setEditingAsset] = useState<SharedAssetItem | null>(null);

  // 上传表单状态
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!uploadPreviewUrl?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(uploadPreviewUrl);
  }, [uploadPreviewUrl]);
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
  const { data: charactersData, error: charactersError } = useCharacters({ enabled: active });
  const allCharacters = useMemo(() => charactersData?.items ?? [], [charactersData]);
  const characterMap = useMemo(() => {
    const map = new Map<string, { displayName: string; avatarUrl?: string | null }>();
    for (const c of allCharacters) {
      map.set(c.id, { displayName: c.displayName, avatarUrl: c.avatarUrl });
    }
    return map;
  }, [allCharacters]);

  // 2. 查询公共资产列表
  const { data: assetData, isLoading, error: assetsError, refetch } = useQuery({
    enabled: active,
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

  const hasFilters = selectedCategory !== 'all' || Boolean(selectedCharacterId || selectedTag || searchQuery.trim());
  const hasAdvancedFilters = Boolean(selectedCharacterId || selectedTag);
  const resetFilters = () => { setSelectedCategory('all'); setSelectedCharacterId(''); setSelectedTag(null); setSearchQuery(''); };

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
    setUploadPreviewUrl(URL.createObjectURL(file));
    if (!uploadTitle) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setUploadTitle(nameWithoutExt);
    }
    e.target.value = ''; // 允许再次选择同名文件。
  };

  // 提交上传
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadSubmitting) return;
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
    if (!editingAsset || editSubmitting) return;
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
    <div className="space-y-4">
      {/* 资产统计与移动端辅助上传 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted">
          <span>共收录 {assets.length} 件公共资产</span>
          {hasFilters && <span className="ml-1 text-ink font-medium">（已应用筛选）</span>}
        </div>
        <div className={onUploadDialogOpenChange ? 'hidden' : 'flex items-center gap-2 sm:hidden'}>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => setUploadDialogOpen(true)}
            className="flex items-center gap-1 text-xs h-7 px-2"
          >
            <Plus className="h-3 w-3" />
            <span>上传</span>
          </Button>
        </div>
      </div>

      {/* 分类快捷标签栏 */}
      <div className="flex flex-nowrap overflow-x-auto items-center gap-1 p-1 bg-surface-sunken rounded-control border border-border-subtle" role="group" aria-label="公共资产分类">
        <button
          type="button"

          aria-pressed={selectedCategory === 'all'}
          onClick={() => setSelectedCategory('all')}
          className={`shrink-0 whitespace-nowrap min-h-10 px-3 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-xs sm:text-sm font-medium transition-colors ${
            selectedCategory === 'all'
              ? 'bg-surface text-ink font-semibold shadow-xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          全部分类
        </button>
        {SHARED_ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"

            aria-pressed={selectedCategory === cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`shrink-0 whitespace-nowrap min-h-10 px-3 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 ${
              selectedCategory === cat.id
                ? 'bg-surface text-ink font-semibold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
            title={cat.description}
          >
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* 搜索与高级过滤栏 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* 关键字搜索 */}
          <div className="relative min-w-0 flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              type="search"
              aria-label="搜索公共资产标题或标签"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资产标题或标签..."
              className="h-8 pl-8 pr-3 text-xs bg-surface border border-border-subtle rounded-control text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent w-full"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="清除资产搜索"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* 高级筛选折叠切换按钮：手机首屏收起，大幅减少垂直堆叠 */}
          <Button
            type="button"
            size="sm"
            variant={hasAdvancedFilters ? 'accent' : 'outline'}
            onClick={() => setShowAdvancedFilters((v) => !v)}
            className="h-8 px-2.5 text-xs flex items-center gap-1.5"
            aria-expanded={showAdvancedFilters}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>高级筛选</span>
            {hasAdvancedFilters && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--fg-on-accent)]/20 px-1 text-[10px] font-semibold">
                {(selectedCharacterId ? 1 : 0) + (selectedTag ? 1 : 0)}
              </span>
            )}
          </Button>

          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 text-xs text-muted hover:text-ink">
              重置
            </Button>
          )}
        </div>

        {/* 折叠的高级筛选区 (角色与标签)：手机默认收起 */}
        {(showAdvancedFilters || hasAdvancedFilters) && (
          <div className="flex flex-wrap items-center gap-2 pt-1 pb-1 animate-in fade-in duration-150">
            {/* 关联角色快速过滤 */}
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <select
                aria-label="按关联角色筛选公共资产"
                value={selectedCharacterId}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border-subtle rounded-control text-ink focus:outline-none focus:border-accent"
              >
                <option value="">全部关联角色</option>
                {allCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* 标签快筛：横向流动排版，禁止中文垂直单字折行 */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full scrollbar-none">
                <span className="text-xs text-muted flex items-center gap-1 shrink-0 whitespace-nowrap ml-1">
                  <Tag className="h-3 w-3" />
                  <span>标签:</span>
                </span>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selectedTag === tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-control text-xs transition-colors ${
                      selectedTag === tag
                        ? 'bg-accent text-fg-on-accent font-medium shadow-xs'
                        : 'bg-surface-sunken text-muted hover:text-ink hover:bg-surface-hover'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
                {selectedTag && (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className="text-xs text-accent hover:underline ml-1 whitespace-nowrap shrink-0"
                  >
                    清除标签
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted" role="status">
        <span>当前结果 {assets.length} 项</span>
        {hasFilters && <Button size="sm" variant="ghost" onClick={resetFilters}>清除全部筛选</Button>}
      </div>
      {charactersError && <p role="alert" className="text-sm text-danger-fg">关联角色暂时加载失败，已选角色仍保留。</p>}
      {assetsError && <div role="alert" className="space-y-2 text-sm text-danger-fg"><p>公共资产加载失败：{assetsError.message}</p><Button variant="outline" size="sm" onClick={() => void refetch()}>重新加载</Button></div>}
      {/* 资产瀑布流 (Masonry) 列表 */}
      {isLoading ? (
        <div className="py-20 text-center text-xs text-muted flex flex-col items-center justify-center gap-2">
          <div className="h-6 w-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span>正在加载公共资源库...</span>
        </div>
      ) : assetsError && assets.length === 0 ? null : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default p-6 sm:p-12 text-center text-muted space-y-3 bg-surface/40">
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
        <div className="columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 [column-fill:_balance]">
          {assets.map((asset) => {
            const catMeta = SHARED_ASSET_CATEGORIES.find((c) => c.id === asset.category);
            return (
              <div
                key={asset.id}
              className="break-inside-avoid mb-4 group relative rounded-panel border border-border-subtle bg-surface/90 hover:border-accent/40 transition-colors motion-reduce:transition-none overflow-hidden flex flex-col"
              >
                {/* 瀑布流自适应图片容器 */}
                <button type="button" aria-label={`预览${asset.title || '公共资产'}`}
                  className="relative w-full overflow-hidden bg-surface-sunken cursor-pointer focus-visible:outline focus-visible:outline-accent"
                  onClick={() => setPreviewAsset(asset)}
                >
                <SharedAssetCardImage
                    src={asset.url}
                    alt={asset.title}
                  title={asset.title}
                  />

                  {/* 悬停微渐变遮罩与放大图标 */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center pointer-events-none">
                    <span className="p-2 rounded-full bg-white/20 backdrop-blur-md text-white shadow-md">
                      <Eye className="h-5 w-5" />
                    </span>
                  </div>

                  {/* 分类徽章 */}
                  <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-surface/90 backdrop-blur-md text-xs font-semibold text-ink shadow-sm border border-border-default/60">
                    {catMeta?.label || asset.category}
                  </div>
                </button>

                {/* 资产描述与关联信息 */}
                <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    <button type="button"
                      className="text-xs font-semibold text-ink line-clamp-1 group-hover:text-accent transition-colors cursor-pointer"
                      title={asset.title}
                      onClick={() => setPreviewAsset(asset)}
                    >
                      {asset.title || '未命名资产'}
                    </button>

                    {/* 参与角色头像与名称胶囊 */}
                    {asset.characterIds && asset.characterIds.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {asset.characterIds.slice(0, 3).map((charId) => {
                          const char = characterMap.get(charId);
                          return (
                            <span
                              key={charId}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-xs text-accent font-medium border border-accent/20"
                              title={char?.displayName || charId}
                            >
                              {char?.avatarUrl && (
                                <img
                                  src={char.avatarUrl}
                                  alt=""
                                  className="h-3.5 w-3.5 rounded-full object-cover"
                                />
                              )}
                              <span className="truncate max-w-[64px]">
                                {char?.displayName || '未知角色'}
                              </span>
                            </span>
                          );
                        })}
                        {asset.characterIds.length > 3 && (
                          <span className="text-xs text-muted font-medium px-1.5 py-0.5 rounded-full bg-surface-muted">
                            +{asset.characterIds.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 标签列表 */}
                    {asset.tags && asset.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {asset.tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.2 rounded text-xs bg-surface-muted text-muted font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 操作行 */}
                  <div className="pt-2 border-t border-border-default/50 flex items-center justify-between text-xs">
                    <span className="text-xs text-muted font-mono">
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
                        className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-muted transition-colors"
                        title="编辑资产信息"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(asset)}
                        className="p-1.5 rounded-md text-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="删除资产"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
        open={active && uploadDialogOpen}
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadPreviewUrl}
                  alt="上传预览"
                  className="size-full object-contain"
                />
              </div>
            ) : (
              <div className="space-y-1.5 py-4">
                <Upload className="mx-auto h-7 w-7 text-muted group-hover:text-accent transition-colors" />
                <p className="text-xs font-medium text-ink">点击或拖拽图片文件至此</p>
                <p className="text-xs text-muted">支持 PNG, JPG, WebP 格式</p>
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
              className="text-sm h-9"
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
              <span className="text-xs text-muted">点击标签添加或移除</span>
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-surface-muted rounded-md border border-border-default/60">
              {allCharacters.map((char) => {
                const isSelected = uploadCharacterIds.includes(char.id);
                return (
                  <button
                    key={char.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected) {
                        setUploadCharacterIds(uploadCharacterIds.filter((id) => id !== char.id));
                      } else {
                        setUploadCharacterIds([...uploadCharacterIds, char.id]);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-surface-sunken text-ink font-semibold'
                        : 'bg-transparent text-muted hover:bg-surface-hover'
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
              className="text-sm h-9"
            />
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadSubmitting}
              onClick={() => setUploadDialogOpen(false)}
              className="text-sm h-9"
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={uploadSubmitting}
              className="text-sm h-9"
            >
              {uploadSubmitting ? '上传中...' : '确认上传'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 编辑公共资产弹窗 */}
      <Dialog
        open={active && Boolean(editingAsset)}
        onOpenChange={(open) => !open && !editSubmitting && setEditingAsset(null)}
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
              className="text-sm h-9"
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
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected) {
                        setEditCharacterIds(editCharacterIds.filter((id) => id !== char.id));
                      } else {
                        setEditCharacterIds([...editCharacterIds, char.id]);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-surface-sunken text-ink font-semibold'
                        : 'bg-transparent text-muted hover:bg-surface-hover'
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
              className="text-sm h-9"
            />
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={editSubmitting}
              onClick={() => setEditingAsset(null)}
              className="text-sm h-9"
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={editSubmitting}
              className="text-sm h-9"
            >
              {editSubmitting ? '保存中...' : '保存更改'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 高清大图预览弹窗 */}
      <Dialog
        open={active && Boolean(previewAsset)}
        onOpenChange={(open) => !open && setPreviewAsset(null)}
        title={previewAsset?.title || '公共资产大图预览'}
      >
        {previewAsset && (
          <div className="space-y-4 pt-1">
            {/* 自然长宽比图片展示 */}
            <div className="relative w-full min-h-[240px] max-h-[72vh] rounded-panel overflow-hidden bg-surface-sunken border border-border-subtle flex items-center justify-center p-2">
              {previewFailedSrc !== previewAsset.url ? (
                <img
                  src={previewRetry ? `${previewAsset.url}${previewAsset.url.includes('?') ? '&' : '?'}retry=${previewRetry}` : previewAsset.url}
                  alt={previewAsset.title}
                  onError={() => setPreviewFailedSrc(previewAsset.url)}
                  className="max-h-[68vh] w-auto max-w-full object-contain rounded-[calc(var(--radius-panel)-4px)] shadow-xs"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-12 h-12 rounded-control bg-surface border border-border-subtle flex items-center justify-center text-muted mb-3 shadow-2xs">
                    <ImageOff className="h-6 w-6 stroke-[1.5]" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-semibold text-ink">{previewAsset.title || '公共资产'}</p>
                  <p className="text-xs text-muted mt-1 max-w-sm">图片暂不可用，可重试加载或编辑资产更新图片。</p>
                  <button
                    type="button"
                    onClick={() => { setPreviewRetry(value => value + 1); setPreviewFailedSrc(null); }}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-surface border border-border-subtle text-ink font-medium text-xs hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <span>重试加载</span>
                  </button>
                </div>
              )}
            </div>

            {/* 工具条与元数据 */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-border-subtle">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-control bg-surface-sunken text-ink font-medium text-xs border border-border-subtle">
                  {SHARED_ASSET_CATEGORIES.find((c) => c.id === previewAsset.category)?.label || previewAsset.category}
                </span>
                {previewAsset.characterIds && previewAsset.characterIds.length > 0 && (
                  <div className="flex items-center gap-1">
                    {previewAsset.characterIds.map((cid) => {
                      const c = characterMap.get(cid);
                      return (
                        <span
                          key={cid}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-accent/10 text-accent font-medium text-xs"
                        >
                          {c?.avatarUrl && (
                            <img src={c.avatarUrl} alt="" className="h-3 w-3 rounded-full object-cover" />
                          )}
                          <span>{c?.displayName || '角色'}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 动作按钮组 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(previewAsset.url).then(() => toast.success('已复制图片链接到剪贴板')).catch(() => toast.error('复制失败，请手动复制图片链接'));
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border border-border-subtle text-muted hover:text-ink hover:bg-surface-sunken transition-colors text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制链接</span>
                </button>
                {previewFailedSrc === previewAsset.url ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border border-border-subtle bg-surface-muted text-muted font-medium text-xs opacity-60 cursor-not-allowed"
                    title="资源文件不可用，无法下载"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>原图不可用</span>
                  </button>
                ) : (
                  <a
                    href={previewAsset.url}
                    download={`${previewAsset.title || 'asset'}.png`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control bg-accent text-fg-on-accent font-medium hover:bg-accent-dark transition-colors text-xs shadow-xs"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>保存原图</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
