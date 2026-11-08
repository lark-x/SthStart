'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heart,
  Phone,
  PhoneCall,
  MapPin,
  Clock,
  BookOpen,
  RefreshCw,
  Search,
  ExternalLink,
  Sparkles,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Camera,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { useToast } from '@/app/providers/ui-provider';
import { adminFetch } from '@/app/lib/admin-fetch';

export interface LinsheCharacter {
  id: number | string;
  name: string;
  display_name: string;
  avatar_path?: string | null;
  avatarUrl?: string | null;
  current_activity?: string;
  _location?: string;
  _behavior?: string;
  _description?: string;
  is_sleeping: boolean;
  is_temp_woken: boolean;
  was_door_woken: number;
  wake_attempts: number;
  reply_delay: number;
  pinned: boolean;
  tags?: string[];
  sthLink?: {
    id: string;
    displayName: string;
    latestVersion: number | null;
  } | null;
}

export function LinsheCharacterVault() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filterState, setFilterState] = useState<'all' | 'awake' | 'sleeping'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [shakingCardId, setShakingCardId] = useState<number | string | null>(null);

  // 1. 获取邻舍角色与运行态
  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery<{ characters: LinsheCharacter[] }>({
    queryKey: ['linshe-characters'],
    queryFn: async () => {
      const res = await adminFetch('linshe-bridge/characters');
      if (!res.ok) {
        throw new Error(`无法获取邻舍角色 (HTTP ${res.status})`);
      }
      return res.json();
    },
    refetchInterval: 15_000, // 15秒自动轮询同步邻舍作息
  });

  const rawCharacters = useMemo(() => data?.characters ?? [], [data]);

  // 2. 切换置顶
  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: number | string; pinned: boolean }) => {
      const res = await adminFetch('linshe-bridge/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: id, pinned }),
      });
      if (!res.ok) throw new Error('置顶操作失败');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.setQueryData<{ characters: LinsheCharacter[] }>(['linshe-characters'], (old) => {
        if (!old) return old;
        return {
          characters: old.characters.map((c) =>
            c.id === vars.id ? { ...c, pinned: vars.pinned } : c
          ),
        };
      });
      toast.success(vars.pinned ? '已将角色置顶' : '已取消置顶');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : '切换置顶失败');
    },
  });

  // 3. 电话叫醒
  const wakeMutation = useMutation({
    mutationFn: async ({ id, mode }: { id: number | string; mode?: 'phone' | 'door' }) => {
      const res = await adminFetch('linshe-bridge/wake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: id, mode: mode || 'phone' }),
      });
      return (await res.json()) as { success?: boolean; message?: string };
    },
    onSuccess: (data, vars) => {
      if (data?.success) {
        toast.success('成功唤醒角色！');
      } else {
        toast.info(data?.message || '角色还在熟睡中...');
      }
      refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : '叫醒请求失败');
    },
  });

  // 筛选与排序（置顶优先，其次字母）
  const characters = useMemo(() => {
    let list = [...rawCharacters];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.display_name?.toLowerCase().includes(q) ||
          c.name?.toLowerCase().includes(q) ||
          c._location?.toLowerCase().includes(q) ||
          c._behavior?.toLowerCase().includes(q)
      );
    }

    if (filterState === 'awake') {
      list = list.filter((c) => !c.is_sleeping || c.is_temp_woken);
    } else if (filterState === 'sleeping') {
      list = list.filter((c) => c.is_sleeping && !c.is_temp_woken);
    }

    return list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN');
    });
  }, [rawCharacters, searchQuery, filterState]);

  const handleWake = (char: LinsheCharacter) => {
    setShakingCardId(char.id);
    setTimeout(() => setShakingCardId(null), 1200);
    const mode = char.was_door_woken || char.wake_attempts >= 3 ? 'door' : 'phone';
    wakeMutation.mutate({ id: char.id, mode });
  };

  return (
    <div className="space-y-4">
      {/* 顶部控制栏与说明 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-surface/90 border border-border-default/80 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <span>邻舍实时生态角色卡</span>
              <span className="px-1.5 py-0.2 rounded-full bg-accent/10 text-[10px] text-accent font-medium">
                1:1 独立复刻
              </span>
            </h3>
            <p className="text-[11px] text-muted">
              与「邻舍」日程、作息和梦乡状态完全打通，支持叫醒与置顶交互。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="text-xs h-8 flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            <span>{isRefetching ? '刷新中...' : '刷新状态'}</span>
          </Button>

          <a
            href="http://127.0.0.1:5173"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface text-xs font-medium text-ink hover:text-accent border border-border-default shadow-2xs transition-colors"
          >
            <span>打开邻舍门户</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* 过滤药丸与搜索栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-surface-muted rounded-xl border border-border-default/60">
          <button
            type="button"
            onClick={() => setFilterState('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterState === 'all'
                ? 'bg-surface text-accent shadow-xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
          >
            全部角色 ({rawCharacters.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterState('awake')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterState === 'awake'
                ? 'bg-surface text-accent shadow-xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
          >
            醒着 ({rawCharacters.filter((c) => !c.is_sleeping || c.is_temp_woken).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterState('sleeping')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterState === 'sleeping'
                ? 'bg-surface text-accent shadow-xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
          >
            梦乡中 ({rawCharacters.filter((c) => c.is_sleeping && !c.is_temp_woken).length})
          </button>
        </div>

        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索邻舍角色名字/地点/行为..."
            className="h-8 pl-8 pr-3 text-xs bg-surface border border-border-default rounded-lg text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent w-full"
          />
        </div>
      </div>

      {/* 角色卡片列表 */}
      {isLoading ? (
        <div className="py-24 text-center text-xs text-muted flex flex-col items-center justify-center gap-2">
          <div className="h-6 w-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span>正在连接邻舍服务并读取角色状态...</span>
        </div>
      ) : error ? (
        <div className="p-12 text-center text-muted bg-surface/40 rounded-2xl border border-dashed border-border-default space-y-2">
          <AlertCircle className="mx-auto h-8 w-8 text-amber-500/80" />
          <p className="text-sm font-medium text-ink">无法连接到邻舍服务 (端口 3099)</p>
          <p className="text-xs text-muted max-w-md mx-auto">
            请确认邻舍服务已通过 `npm run dev:linshe` 正常启动并在后台运行。
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="text-xs mt-2">
            重试连接
          </Button>
        </div>
      ) : characters.length === 0 ? (
        <div className="p-16 text-center text-muted bg-surface/40 rounded-2xl border border-dashed border-border-default space-y-2">
          <p className="text-sm font-medium text-ink">暂无符合条件的邻舍角色</p>
          <p className="text-xs text-muted">可在「专属角色卡」中点击推送到邻舍进行招募入驻。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {characters.map((char) => {
            const isSleeping = char.is_sleeping && !char.is_temp_woken;
            const isDrowsy = char.is_sleeping && char.is_temp_woken;
            const isBusy = !char.is_sleeping && char.reply_delay > 0;

            const statusBadge = isSleeping
              ? { label: '在梦乡', bg: 'bg-[#9580cc]/15 text-[#7c6db8]' }
              : isDrowsy
              ? { label: '迷迷糊糊', bg: 'bg-[#8ca0be]/15 text-[#6d84a8]' }
              : isBusy
              ? { label: '正忙', bg: 'bg-accent/15 text-[#c06858]' }
              : { label: '在线', bg: 'bg-emerald-500/15 text-emerald-700' };

            const tagList = Array.isArray(char.tags) ? char.tags.slice(0, 2) : [];
            const isShaking = shakingCardId === char.id;

            return (
              <div
                key={char.id}
                className={`group relative flex flex-col rounded-[18px] transition-all duration-200 ${
                  isSleeping ? 'opacity-85' : ''
                }`}
              >
                {/* 主卡片体 (Card Inner) */}
                <div className="relative flex flex-col gap-3 p-4 rounded-[18px] bg-surface border border-border-default shadow-xs hover:border-accent/40 hover:shadow-md transition-all">
                  {/* 左上角置顶红心按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      pinMutation.mutate({ id: char.id, pinned: !char.pinned });
                    }}
                    title={char.pinned ? '取消置顶' : '置顶角色'}
                    className={`absolute top-2.5 left-2.5 z-10 h-6 w-6 rounded-full flex items-center justify-center transition-all ${
                      char.pinned
                        ? 'opacity-100 text-rose-500 bg-rose-50'
                        : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted hover:bg-surface-muted hover:text-rose-500'
                    }`}
                  >
                    <Heart
                      className={`h-3.5 w-3.5 transition-transform active:scale-125 ${
                        char.pinned ? 'fill-current' : ''
                      }`}
                    />
                  </button>

                  {/* 右上角叫醒电话按钮（睡眠时显示） */}
                  {isSleeping && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWake(char);
                      }}
                      title="电话叫醒"
                      className={`absolute top-2.5 right-2.5 z-10 h-7 w-7 rounded-full bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center transition-all ${
                        isShaking ? 'animate-bounce' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* 顶部：头像 + 名字 + 状态徽章 */}
                  <div className="flex items-center gap-3 pl-4">
                    <div className="relative h-11 w-11 rounded-full overflow-hidden bg-gradient-to-tr from-accent/80 to-accent flex items-center justify-center shadow-xs flex-shrink-0">
                      {char.avatarUrl ? (
                        <img
                          src={char.avatarUrl}
                          alt={char.display_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-white text-base font-bold font-sans">
                          {char.display_name.charAt(0)}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-ink truncate max-w-[110px]" title={char.display_name}>
                          {char.display_name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge.bg}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>

                      {/* 标签 */}
                      {!isSleeping && tagList.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          {tagList.map((tag, idx) => (
                            <span
                              key={tag}
                              className={`text-[9.5px] font-medium px-1.5 py-0.2 rounded-full ${
                                idx === 0
                                  ? 'bg-emerald-500/10 text-emerald-700'
                                  : 'bg-amber-500/10 text-amber-700'
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 中部：地点 + 行为 */}
                  <div className="space-y-1.5 pt-1 text-xs text-muted">
                    <div className="flex items-center gap-2 truncate">
                      <MapPin className="h-3.5 w-3.5 text-muted/60 flex-shrink-0" />
                      <span className="truncate">{char._location || '未知地点'}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <Clock className="h-3.5 w-3.5 text-muted/60 flex-shrink-0" />
                      <span className="truncate text-ink/90 font-medium">{char._behavior || '自由行动'}</span>
                    </div>
                  </div>

                  {/* 底部日记小注 */}
                  {char._description && (
                    <div className="pt-2 border-t border-border-default/40 text-[11px] text-muted/80 line-clamp-1 italic">
                      {char._description}
                    </div>
                  )}

                  {/* SthStart 本地人设绑定标识 */}
                  <div className="pt-1.5 flex items-center justify-between text-[10.5px]">
                    {char.sthLink ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>已关联本地档案 (v{char.sthLink.latestVersion || 1})</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <LinkIcon className="h-3 w-3" />
                        <span>未绑定本地人设</span>
                      </span>
                    )}

                    <a
                      href={`http://127.0.0.1:5173`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline flex items-center gap-0.5"
                    >
                      <span>进邻舍互动</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>

                {/* 底部滑出的日记本入口 (Card Diary Bar) */}
                <div
                  className="mt-1 h-7 rounded-b-xl bg-surface-muted/80 hover:bg-accent/10 border border-border-default/60 border-t-0 flex items-center justify-center gap-1.5 text-xs text-accent font-medium cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                  onClick={() => {
                    toast.info(`即将跳转到邻舍查看【${char.display_name}】的日记本`);
                    window.open(`http://127.0.0.1:5173`, '_blank');
                  }}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>翻开日记本</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
