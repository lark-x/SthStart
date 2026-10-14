'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHARACTER_ASSET_CATEGORIES,
  SHARED_ASSET_CATEGORIES,
  type CharacterAssetCategory,
  type SharedAssetCategory,
} from '@sthstart/contracts';
import {
  RefreshCw,
  Send,
  Download,
  Users,
  User,
  Image as ImageIcon,
  Check,
  AlertCircle,
  ExternalLink,
  FolderDown,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { useToast } from '@/app/providers/ui-provider';
import {
  fetchLinsheBridgeStatus,
  syncCharacterWithLinshe,
  fetchLinsheGallery,
  importLinsheGalleryImage,
  fetchCharacters,
} from '@/app/features/characters/api';

interface LinsheBridgeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinsheBridgeDrawer({ open, onOpenChange }: LinsheBridgeDrawerProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'sync' | 'gallery'>('sync');

  // 转存弹窗状态
  const [importTargetItem, setImportTargetItem] = useState<{
    filename: string;
    url: string;
    date?: string;
    prompt?: string;
  } | null>(null);
  const [importTargetType, setImportTargetType] = useState<'character_asset' | 'shared_asset'>('character_asset');
  const [importCharacterId, setImportCharacterId] = useState('');
  const [importCharCategory, setImportCharCategory] = useState<CharacterAssetCategory>('cg');
  const [importSharedCategory, setImportSharedCategory] = useState<SharedAssetCategory>('group_photo');
  const [importSharedCharIds, setImportSharedCharIds] = useState<string[]>([]);
  const [importTitle, setImportTitle] = useState('');
  const [importTagsStr, setImportTagsStr] = useState('');
  const [importing, setImporting] = useState(false);

  // 同步操作中的角色状态
  const [syncingCharId, setSyncingCharId] = useState<string | null>(null);

  // 1. 获取邻舍互通网关状态
  const {
    data: bridgeStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['linshe-bridge', 'status'],
    queryFn: () => fetchLinsheBridgeStatus(),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  // 2. 获取邻舍生图相册
  const {
    data: galleryData,
    isLoading: galleryLoading,
    refetch: refetchGallery,
  } = useQuery({
    queryKey: ['linshe-bridge', 'gallery'],
    queryFn: () => fetchLinsheGallery(),
    enabled: open && activeTab === 'gallery',
  });

  // 3. 获取所有角色列表
  const { data: charactersData } = useQuery({
    queryKey: ['characters', 'all-profiles'],
    queryFn: () => fetchCharacters(),
    enabled: open,
    staleTime: 60_000,
  });

  const allCharacters = useMemo(() => charactersData?.items ?? [], [charactersData]);

  const characterRows = useMemo(() => {
    const linkedMap = new Map<string, {
      sthCharacterId: string;
      linsheCharacterId: string;
      displayName: string;
      sourceVersion: number;
      latestVersion: number;
      hasUpdate: boolean;
    }>();
    for (const item of bridgeStatus?.linkedCharacters || []) {
      linkedMap.set(item.sthCharacterId, item);
    }
    return allCharacters.map((c) => {
      const linked = linkedMap.get(c.id);
      return {
        sthCharacterId: c.id,
        sthName: c.displayName,
        linsheCharacterId: linked?.linsheCharacterId ?? null,
        status: linked ? (linked.hasUpdate ? 'update_available' : 'synced') : 'local_only',
        latestVersion: c.latestVersion,
      };
    });
  }, [allCharacters, bridgeStatus]);

  // 执行单角色推送到邻舍
  const handlePushCharacter = async (charId: string) => {
    setSyncingCharId(charId);
    try {
      const res = await syncCharacterWithLinshe({ characterId: charId, action: 'push_to_linshe' });
      if (res.ok) {
        toast.success(res.message || '角色与资产已成功推送至邻舍！');
      } else {
        toast.error('推送失败', res.message);
      }
      void refetchStatus();
    } catch (err: unknown) {
      toast.error('推送失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingCharId(null);
    }
  };

  // 执行单角色从邻舍拉取同步
  const handlePullCharacter = async (charId: string) => {
    setSyncingCharId(charId);
    try {
      const res = await syncCharacterWithLinshe({ characterId: charId, action: 'pull_from_linshe' });
      if (res.ok) {
        toast.success(res.message || '人设已从邻舍同步更新至 SthStart！');
      } else {
        toast.error('同步失败', res.message);
      }
      void refetchStatus();
    } catch (err: unknown) {
      toast.error('同步失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingCharId(null);
    }
  };

  // 打开相册图片转存弹窗
  const handleOpenImport = (item: { filename: string; url: string; date?: string; prompt?: string }) => {
    setImportTargetItem(item);
    setImportTitle(item.filename.replace(/\.[^/.]+$/, ''));
    setImportTagsStr('邻舍生图');
    if (allCharacters.length > 0 && !importCharacterId) {
      setImportCharacterId(allCharacters[0].id);
    }
  };

  // 提交相册转存
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importTargetItem) return;
    setImporting(true);
    try {
      const tags = importTagsStr
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      if (importTargetType === 'character_asset') {
        if (!importCharacterId) {
          toast.warning('请选择目标所属角色');
          setImporting(false);
          return;
        }
        await importLinsheGalleryImage({
          imageUrl: importTargetItem.url,
          target: 'character',
          characterId: importCharacterId,
          category: importCharCategory,
          title: importTitle.trim() || importTargetItem.filename,
          tags,
        });
        toast.success('已转存为角色资产');
      } else {
        await importLinsheGalleryImage({
          imageUrl: importTargetItem.url,
          target: 'shared',
          category: importSharedCategory,
          characterIds: importSharedCharIds,
          title: importTitle.trim() || importTargetItem.filename,
          tags,
        });
        toast.success('已转存为公共资产');
      }

      setImportTargetItem(null);
      void queryClient.invalidateQueries({ queryKey: ['character-assets'] });
      void queryClient.invalidateQueries({ queryKey: ['shared-assets'] });
    } catch (err: unknown) {
      toast.error('转存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="SthStart × 邻舍 数据互通工作台"
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        {/* 顶部服务状态卡片 */}
        <div className="rounded-xl border border-border-default bg-surface p-3.5 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                bridgeStatus?.linsheAvailable ? 'bg-emerald-500 ring-4 ring-emerald-500/20' : 'bg-rose-500 ring-4 ring-rose-500/20'
              }`}
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink">
                  {bridgeStatus?.linsheAvailable ? '邻舍引擎运行中 (v3.9.0 兼容)' : '邻舍引擎未连接'}
                </span>
                {bridgeStatus?.ready && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-medium">
                    网关就绪
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted mt-0.5">
                角色卡数: {bridgeStatus?.charactersCount ?? 0} · 公共资产数: {bridgeStatus?.sharedAssetsCount ?? 0}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchStatus();
              if (activeTab === 'gallery') void refetchGallery();
            }}
            className="text-xs h-7 px-2"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            <span>刷新</span>
          </Button>
        </div>

        {/* 导航栏：人设双向同步 vs 生图资产回流 */}
        <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-lg border border-border-default/60">
          <button
            type="button"
            onClick={() => setActiveTab('sync')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'sync'
                ? 'bg-surface text-accent shadow-xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>人设双向同步对照</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gallery')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'gallery'
                ? 'bg-surface text-accent shadow-xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>生图产物互通相册</span>
          </button>
        </div>

        {/* 标签 1：人设双向同步对照 */}
        {activeTab === 'sync' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted px-1">
              <span>SthStart 角色卡库对照</span>
              <span>共 {characterRows.length} 位</span>
            </div>

            {statusLoading ? (
              <div className="py-12 text-center text-xs text-muted">正在检测同步对照状态...</div>
            ) : characterRows.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted border border-dashed border-border-default rounded-xl">
                暂无角色数据
              </div>
            ) : (
              <div className="space-y-2">
                {characterRows.map((m) => {
                  const isSyncing = syncingCharId === m.sthCharacterId;
                  return (
                    <div
                      key={m.sthCharacterId}
                      className="p-3 rounded-xl border border-border-default bg-surface hover:border-border-default/80 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-semibold text-ink truncate">{m.sthName}</h4>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-medium ${
                              m.status === 'synced'
                                ? 'bg-emerald-50 text-emerald-700'
                                : m.status === 'update_available'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-surface-muted text-muted'
                            }`}
                          >
                            {m.status === 'synced'
                              ? '已在邻舍入驻'
                              : m.status === 'update_available'
                              ? '有新版本可同步'
                              : '仅 SthStart 本地'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted truncate mt-0.5">
                          {m.linsheCharacterId ? `邻舍 ID: ${m.linsheCharacterId}` : '尚未推送到邻舍'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handlePushCharacter(m.sthCharacterId)}
                          disabled={isSyncing}
                          className="text-[11px] h-7 px-2 gap-1 text-accent border-accent/40 hover:bg-accent/10"
                          title="将 SthStart 结构化人设与立绘推送到邻舍"
                        >
                          <Send className="h-3 w-3" />
                          <span>{isSyncing ? '同步中...' : '推送至邻舍'}</span>
                        </Button>
                        {m.linsheCharacterId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePullCharacter(m.sthCharacterId)}
                            disabled={isSyncing}
                            className="text-[11px] h-7 px-2 gap-1 text-muted hover:text-ink"
                            title="拉取邻舍中的最新人设正文更新回 SthStart"
                          >
                            <Download className="h-3 w-3" />
                            <span>拉取</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 标签 2：生图产物互通相册 */}
        {activeTab === 'gallery' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted px-1">
              <span>邻舍画图产物（自动扫描生图目录）</span>
              <span>共 {galleryData?.images?.length || 0} 张</span>
            </div>

            {galleryLoading ? (
              <div className="py-12 text-center text-xs text-muted">正在加载相册...</div>
            ) : !galleryData?.images || galleryData.images.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted border border-dashed border-border-default rounded-xl space-y-2">
                <ImageIcon className="mx-auto h-8 w-8 text-muted/40" />
                <p>邻舍生图目录中暂无图片或引擎离线</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {galleryData.images.map((item: { filename: string; url: string; date?: string; prompt?: string }) => (
                  <div
                    key={item.filename}
                    className="group relative aspect-square rounded-xl overflow-hidden border border-border-default bg-surface-muted flex flex-col justify-end"
                  >
                    <Image
                      src={item.url}
                      alt={item.filename}
                      fill
                      unoptimized
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end gap-1.5">
                      <p className="text-[10px] text-white/90 line-clamp-2 font-mono leading-tight">
                        {item.prompt || item.filename}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="accent"
                        onClick={() => handleOpenImport(item)}
                        className="w-full text-[11px] h-6 py-0 gap-1 shadow-xs"
                      >
                        <FolderDown className="h-3 w-3" />
                        <span>一键转存资产</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 转存资产选择弹窗 */}
      <Dialog
        open={Boolean(importTargetItem)}
        onOpenChange={(open) => !open && setImportTargetItem(null)}
        title="将邻舍产物转存为 SthStart 资产"
      >
        {importTargetItem && (
          <form onSubmit={handleImportSubmit} className="space-y-4 pt-2">
            <div className="flex items-center gap-3 p-2 bg-surface-muted rounded-xl border border-border-default/60">
              <div className="relative h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-surface">
                <Image
                  src={importTargetItem.url}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-semibold text-ink truncate">
                  {importTargetItem.filename}
                </h4>
                <p className="text-[11px] text-muted truncate mt-0.5">
                  {importTargetItem.date || '邻舍生成产物'}
                </p>
              </div>
            </div>

            {/* 转存去向 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">资产归宿类型</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setImportTargetType('character_asset')}
                  className={`p-2.5 rounded-lg border text-xs font-medium transition-all text-left flex items-center gap-2 ${
                    importTargetType === 'character_asset'
                      ? 'border-accent bg-accent/10 text-accent font-semibold'
                      : 'border-border-default bg-surface text-ink hover:bg-surface-muted'
                  }`}
                >
                  <User className="h-4 w-4" />
                  <div>
                    <div>角色专属资产</div>
                    <div className="text-[10px] text-muted font-normal">归属于单个角色的分类库</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setImportTargetType('shared_asset')}
                  className={`p-2.5 rounded-lg border text-xs font-medium transition-all text-left flex items-center gap-2 ${
                    importTargetType === 'shared_asset'
                      ? 'border-accent bg-accent/10 text-accent font-semibold'
                      : 'border-border-default bg-surface text-ink hover:bg-surface-muted'
                  }`}
                >
                  <Users className="h-4 w-4" />
                  <div>
                    <div>多角色公共资产</div>
                    <div className="text-[10px] text-muted font-normal">多人合影/背景/海报</div>
                  </div>
                </button>
              </div>
            </div>

            {/* 目标角色选择（专属资产） */}
            {importTargetType === 'character_asset' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink">所属角色</label>
                  <select
                    value={importCharacterId}
                    onChange={(e) => setImportCharacterId(e.target.value)}
                    required
                    className="w-full h-8 px-2.5 text-xs bg-surface border border-border-default rounded-md text-ink focus:outline-none focus:border-accent"
                  >
                    {allCharacters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink">资产细分分类</label>
                  <select
                    value={importCharCategory}
                    onChange={(e) => setImportCharCategory(e.target.value as CharacterAssetCategory)}
                    className="w-full h-8 px-2.5 text-xs bg-surface border border-border-default rounded-md text-ink focus:outline-none focus:border-accent"
                  >
                    {CHARACTER_ASSET_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label} ({cat.description})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 目标分类与角色多选（公共资产） */}
            {importTargetType === 'shared_asset' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink">公共资产分类</label>
                  <select
                    value={importSharedCategory}
                    onChange={(e) => setImportSharedCategory(e.target.value as SharedAssetCategory)}
                    className="w-full h-8 px-2.5 text-xs bg-surface border border-border-default rounded-md text-ink focus:outline-none focus:border-accent"
                  >
                    {SHARED_ASSET_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label} ({cat.description})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink">关联角色 (可选多选)</label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-surface-muted rounded-md border border-border-default/60">
                    {allCharacters.map((char) => {
                      const isSelected = importSharedCharIds.includes(char.id);
                      return (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setImportSharedCharIds(importSharedCharIds.filter((id) => id !== char.id));
                            } else {
                              setImportSharedCharIds([...importSharedCharIds, char.id]);
                            }
                          }}
                          className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                            isSelected
                              ? 'bg-accent text-white font-medium'
                              : 'bg-surface text-ink border border-border-default/50'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                          <span>{char.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 标题 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">资产标题</label>
              <Input
                type="text"
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder="填写资产名称"
                required
                className="text-xs h-8"
              />
            </div>

            {/* 标签 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">特征标签</label>
              <Input
                type="text"
                value={importTagsStr}
                onChange={(e) => setImportTagsStr(e.target.value)}
                placeholder="逗号或空格分隔"
                className="text-xs h-8"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImportTargetItem(null)}
                className="text-xs h-8"
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="accent"
                size="sm"
                disabled={importing}
                className="text-xs h-8"
              >
                {importing ? '转存中...' : '确认转存'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Dialog>
  );
}
