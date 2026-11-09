'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Plus, Search, Upload, Sparkles, Loader2, SlidersHorizontal, CheckSquare, Check, User, Users, MoreHorizontal, ArrowRight } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Dialog } from '@/app/components/ui/dialog';
import { FloatingActionBar } from '@/app/components/ui/floating-action-bar';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterBatchImport } from './character-batch-import';
import { CharacterFilters, CharacterPagination, useCharacterBrowser } from './character-filters';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';
import { editCharacterOrganization, saveCharacterWork } from '../api';
import { useBatchMatchOfficialAvatars } from '../mutations';
import { CharacterAvatar } from './character-image-fallback';
import { characterFilterUrl } from '../filter-url';
import type { CharacterBrowseQuery, CharacterWork } from '@sthstart/contracts';
import { SharedAssetVault } from './shared-asset-vault';
import { LinsheCharacterVault } from './linshe-character-vault';
import { characterKeys } from '@/app/lib/query-keys';

export function CharacterLibrary({ initialFilter }: { initialFilter?: CharacterBrowseQuery | null } = {}) {
  const browser = useCharacterBrowser({}, true, { persist: true, initialFilter });
  const router = useRouter();
  const client = useQueryClient();
  const batchMatchMutation = useBatchMatchOfficialAvatars();
  const [assetsVisited, setAssetsVisited] = useState(false);
  const [viewTab, setViewTab] = useState<'characters' | 'shared-assets' | 'linshe'>('characters');
  const [importOpen, setImportOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [sharedAssetUploadOpen, setSharedAssetUploadOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [batchAvatarOpen, setBatchAvatarOpen] = useState(false);
  const [batchAvatarScope, setBatchAvatarScope] = useState<'missing' | 'selected' | 'all'>('missing');
  const [batchAvatarResult, setBatchAvatarResult] = useState<import('@sthstart/contracts').CharacterBatchAvatarResponse | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const pushCharacterPage = (next: CharacterBrowseQuery) => {
    if (typeof window === 'undefined') return;
    const href = characterFilterUrl(window.location.href, next);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href !== current) window.history.pushState(window.history.state, '', href);
  };
  const [fields, setFields] = useState(emptyOrganizationFields);
  const [replaceTags, setReplaceTags] = useState(false);
  const [replaceGroups, setReplaceGroups] = useState(false);
  const [work, setWork] = useState<CharacterWork>({ name: '', aliases: [], mediaType: '' });
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  // 立绘放大预览（§8.2）：卡片缩略图不拉成封面，需要查看时单独放大。
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const element = moreMenuRef.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
        element.open = false;
        element.querySelector('summary')?.focus();
      } else if (!element.contains(event.target as Node)) {
        element.open = false;
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, []);

  const refresh = () => { void client.invalidateQueries({ queryKey: characterKeys.all }); };
  const handleBatchAvatar = async () => {
    setBusy(true);
    setError('');
    setBatchAvatarResult(null);
    try {
      const ids = batchAvatarScope === 'selected' ? Object.keys(selected) : undefined;
      const onlyMissing = batchAvatarScope === 'missing';
      const result = await batchMatchMutation.mutateAsync({ ids, onlyMissing });
      setBatchAvatarResult(result);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const organize = async () => {
    setBusy(true); setError('');
    try {
      await editCharacterOrganization({ ids: Object.keys(selected), ...(fields.work.trim() ? { work: fields.work.trim() } : {}), tags: splitLabels(fields.tags), groups: splitLabels(fields.groups), ...(fields.interpretation.trim() ? { interpretation: fields.interpretation.trim() } : {}), fillEmpty: fields.fillEmpty, replaceTags, replaceGroups, ...(fields.originType ? { originType: fields.originType } : {}) });
      refresh(); setOrganizeOpen(false); setSelected({});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const toggleFavorite = async (id: string, favorite: boolean) => {
    setError('');
    try { await editCharacterOrganization({ ids: [id], favorite }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const saveWork = async () => {
    setBusy(true); setError('');
    try { await saveCharacterWork({ ...work, aliases: splitLabels(aliases) }); refresh(); setWorksOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="text-ink">
      <PageContainer className="space-y-4">
        <PageHeader compact
          title="角色资料库"
          navigation={
            <div className="flex max-w-full flex-nowrap overflow-x-auto items-center gap-1 bg-surface-sunken p-1 rounded-control w-fit border border-border-subtle/70" role="group" aria-label="角色资料视图">
              <button
                type="button"
                aria-pressed={viewTab === 'characters'}
                onClick={() => setViewTab('characters')}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-sm transition-colors cursor-pointer ${
                  viewTab === 'characters'
                    ? 'bg-surface text-ink font-semibold shadow-xs'
                    : 'text-muted hover:text-ink font-normal'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                <span>专属角色卡</span>
              </button>
              <button
                type="button"
                aria-pressed={viewTab === 'shared-assets'}
                onClick={() => { setAssetsVisited(true); setViewTab('shared-assets'); }}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-sm transition-colors cursor-pointer ${
                  viewTab === 'shared-assets'
                    ? 'bg-surface text-ink font-semibold shadow-xs'
                    : 'text-muted hover:text-ink font-normal'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>多角色公共资产库</span>
              </button>
              <button
                type="button"
                aria-pressed={viewTab === 'linshe'}
                onClick={() => setViewTab('linshe')}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-sm transition-colors cursor-pointer ${
                  viewTab === 'linshe'
                    ? 'bg-surface text-ink font-semibold shadow-xs'
                    : 'text-muted hover:text-ink font-normal'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-muted" />
                <span>邻舍角色</span>
              </button>
            </div>
          }
        />
        <section aria-label="角色资料内容" className="tpl-panel space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border-subtle pb-3" aria-label="当前资料视图操作">
            <div className="flex flex-wrap items-center gap-2">
              {viewTab === 'characters' && (
                <>
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-control bg-accent px-3.5 text-sm font-semibold text-fg-on-accent shadow-xs transition-colors hover:bg-accent-dark focus-visible:outline focus-visible:outline-accent"
                    href="/apps/characters/new"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>新建角色</span>
                  </Link>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportOpen(true)}
                    className="gap-1.5 text-sm font-medium"
                  >
                    <Search className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span>搜索 / 导入</span>
                  </Button>
                </>
              )}

              {viewTab === 'shared-assets' && (
                <Button
                  type="button"
                  size="sm"
                  variant="accent"
                  onClick={() => setSharedAssetUploadOpen(true)}
                  className="gap-1.5 text-sm font-semibold shadow-xs"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>上传公共资产</span>
                </Button>
              )}

              <details ref={moreMenuRef} className="relative">
                <summary
                  aria-label="更多角色操作"
                  className="flex h-9 cursor-pointer list-none items-center justify-center gap-1 rounded-control border border-border-default bg-surface px-2.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-accent"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </summary>
                <div
                  role="menu"
                  aria-label="更多角色操作"
                  className="absolute right-0 top-full z-30 mt-1.5 flex w-44 flex-col gap-0.5 rounded-control border border-border-subtle bg-surface p-1 shadow-floating"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
                    onClick={() => {
                      if (moreMenuRef.current) moreMenuRef.current.open = false;
                      setError('');
                      setBatchAvatarResult(null);
                      setBatchAvatarOpen(true);
                    }}
                  >
                    <Sparkles className="size-3.5 text-muted" aria-hidden="true" />
                    <span>批量获取头像</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover cursor-pointer"
                    onClick={() => {
                      if (moreMenuRef.current) moreMenuRef.current.open = false;
                      setError('');
                      setBatchOpen(true);
                    }}
                  >
                    <Upload className="size-3.5 text-muted" aria-hidden="true" />
                    <span>批量导入角色</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
                    onClick={() => {
                      if (moreMenuRef.current) moreMenuRef.current.open = false;
                      setError('');
                      setWorksOpen(true);
                    }}
                  >
                    <span className="size-3.5" aria-hidden="true" />
                    <span>作品与别名</span>
                  </button>
                </div>
              </details>
            </div>
          </div>

        {assetsVisited && (
          <div hidden={viewTab !== 'shared-assets'}>
            <SharedAssetVault
              active={viewTab === 'shared-assets'}
              uploadDialogOpen={sharedAssetUploadOpen}
              onUploadDialogOpenChange={setSharedAssetUploadOpen}
            />
          </div>
        )}
        {viewTab === 'linshe' && <LinsheCharacterVault />}
        <div hidden={viewTab !== 'characters'} className="space-y-4">
          {(error || browser.error) && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger-fg">
              <span>{error || (browser.error instanceof Error ? browser.error.message : '角色列表加载失败')}</span>
              {browser.error && (
                <Button size="sm" variant="outline" onClick={() => void browser.refetch()}>
                  重试
                </Button>
              )}
            </div>
          )}
          <CharacterFilters
            filter={browser.filter}
            onChange={browser.change}
            onReset={browser.reset}
            facets={browser.facets}
            actions={
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted tabular-nums">
                  共 {browser.data?.total ?? '—'} 位角色{browser.isFetching ? ' · 筛选中…' : ''}
                </span>
                <Button
                  size="sm"
                  variant={selectionMode ? 'secondary' : 'ghost'}
                  onClick={() => {
                    const nextMode = !selectionMode;
                    setSelectionMode(nextMode);
                    if (!nextMode) setSelected({});
                  }}
                  className="h-8 px-2 text-sm font-medium"
                >
                  <CheckSquare className="size-3.5 text-muted" aria-hidden="true" />
                  <span>{selectionMode ? '退出管理' : '批量管理'}</span>
                </Button>
              </div>
            }
          />

          {Object.keys(selected).length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer hover:text-ink">
                查看已选名单（跨页保留共 {Object.keys(selected).length} 位）
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(selected).map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-control border border-border-default bg-surface px-2 py-0.5 text-xs text-ink hover:border-accent/50"
                    onClick={() =>
                      setSelected((current) => {
                        const next = { ...current };
                        delete next[id];
                        return next;
                      })
                    }
                  >
                    <span>{name}</span>
                    <span className="text-muted hover:text-danger-fg">×</span>
                  </button>
                ))}
              </div>
            </details>
          )}

          <FloatingActionBar
            open={selectionMode || Object.keys(selected).length > 0}
            selectedCount={Object.keys(selected).length}
            unit="位角色"
            selectionActions={
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-xs text-muted hover:text-ink"
                onClick={() =>
                  setSelected((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      (browser.data?.items || []).map((c) => [c.id, c.displayName])
                    ),
                  }))
                }
              >
                全选本页
              </Button>
            }
            onClear={() => setSelected({})}
            onClose={() => {
              setSelectionMode(false);
              setSelected({});
            }}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-3 text-xs"
              disabled={!Object.keys(selected).length}
              onClick={() => {
                setError('');
                setBatchAvatarScope('selected');
                setBatchAvatarResult(null);
                setBatchAvatarOpen(true);
              }}
            >
              <Sparkles className="size-3.5 text-muted" aria-hidden="true" />
              <span>获取所选头像</span>
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="h-8 gap-1.5 px-3 text-xs"
              disabled={!Object.keys(selected).length}
              onClick={() => {
                setError('');
                setOrganizeOpen(true);
              }}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              <span>批量整理</span>
            </Button>
          </FloatingActionBar>

          {/* 角色卡片自适应多列网格 */}
          {browser.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <div key={n} className="flex items-center gap-3 p-3 rounded-panel border border-border-subtle bg-surface">
                  <Skeleton className="h-20 w-20 rounded-control flex-none" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-control flex-none" />
                </div>
              ))}
            </div>
          ) : browser.data?.total === 0 ? (
            <EmptyState
              icon={User}
              title="没有匹配的角色"
              description="可以清空筛选条件，或直接新建 / 导入新角色。"
              actions={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => browser.reset()}>
                    清空筛选
                  </Button>
                  <Link
                    href="/apps/characters/new"
                    className="inline-flex h-9 items-center gap-1.5 rounded-control bg-accent px-3.5 text-sm font-semibold text-fg-on-accent shadow-xs transition-colors hover:bg-accent-dark"
                  >
                    <Plus className="h-4 w-4" />
                    <span>新建角色</span>
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
              {browser.data?.items.map((character) => {
                const workName = (character.draft.work || '').trim().toLowerCase();
                const displayTags = (character.tags || [])
                  .filter((tag) => {
                    const t = tag.trim().toLowerCase();
                    return t && t !== workName && t !== character.displayName.trim().toLowerCase();
                  })
                  .slice(0, 3);

                return (
                  <li
                    key={character.id}
                    className="group relative flex items-center gap-3 rounded-panel border border-border-subtle bg-surface p-3 transition-colors hover:border-border-control"
                  >
                    {selectionMode && (
                      <input
                        aria-label={`选择 ${character.displayName}`}
                        type="checkbox"
                        checked={!!selected[character.id]}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (e.target.checked) next[character.id] = character.displayName;
                            else delete next[character.id];
                            return next;
                          })
                        }
                        className="size-4 rounded accent-accent shrink-0 cursor-pointer"
                      />
                    )}

                    <Link
                      href={`/apps/characters/${character.id}`}
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-control border border-border-subtle bg-surface-sunken flex items-center justify-center"
                    >
                      <CharacterAvatar
                        src={character.avatarUrl}
                        name={character.displayName}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    </Link>

                    <div className="flex flex-1 min-w-0 items-center justify-between gap-2">
                      <Link
                        href={`/apps/characters/${character.id}`}
                        className="min-w-0 flex-1 space-y-1 block"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm sm:text-base font-semibold text-ink transition-colors group-hover:text-accent">
                            {character.displayName}
                          </span>
                          {character.organization?.favorite && (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" aria-label="已收藏" />
                          )}
                        </div>
                        <p className="truncate text-xs text-muted">
                          {character.draft.work || '未设置作品'}
                        </p>
                        {displayTags.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            {displayTags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted border border-border-subtle/60"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </Link>

                      <div className="flex flex-col items-center justify-between self-stretch shrink-0 gap-1 pl-1">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-sunken hover:text-accent focus-visible:outline focus-visible:outline-accent cursor-pointer"
                          aria-label={`${character.organization?.favorite ? '取消收藏' : '收藏'} ${character.displayName}`}
                          aria-pressed={character.organization?.favorite || false}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void toggleFavorite(character.id, !character.organization?.favorite);
                          }}
                        >
                          <Star
                            className={`h-4 w-4 ${character.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`}
                          />
                        </button>

                        <Link
                          href={`/apps/characters/${character.id}`}
                          className="flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors group-hover:text-accent hover:bg-surface-sunken focus-visible:outline focus-visible:outline-accent"
                          aria-label={`查看 ${character.displayName}`}
                        >
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <CharacterPagination
            data={browser.data}
            onPage={(page) => {
              pushCharacterPage({ ...browser.filter, page });
              browser.change({ page });
            }}
            onPageSizeChange={(pageSize) => {
              pushCharacterPage({ ...browser.filter, page: 1, pageSize });
              browser.change({ pageSize, page: 1 });
            }}
            loading={browser.isFetching && browser.isPlaceholderData}
          />
        </div>

        {previewArtifact && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setPreviewArtifact(null);
            }}
            title={previewArtifact.name}
            description="原图按原始比例显示，缩略图才会裁剪。"
            footer={
              <Button size="sm" variant="outline" onClick={() => setPreviewArtifact(null)}>
                关闭
              </Button>
            }
          >
            <img
              src={previewArtifact.url}
              alt={`${previewArtifact.name} 的立绘`}
              className="mx-auto max-h-[65vh] w-auto rounded-control object-contain"
            />
          </Dialog>
        )}

        <CharacterImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          initialMode="online"
          onCommitted={(id) => {
            refresh();
            router.push(`/apps/characters/${id}`);
          }}
        />

        <CharacterBatchImport
          open={batchOpen}
          onOpenChange={setBatchOpen}
          onCommitted={refresh}
          works={browser.facets?.works || []}
        />

        <Dialog
          open={organizeOpen}
          onOpenChange={(v) => {
            if (!busy) setOrganizeOpen(v);
          }}
          title={`整理 ${Object.keys(selected).length} 位角色`}
          description="只修改角色库资料，已保存的活动快照保持原样。"
          footer={
            <Button disabled={busy} onClick={() => void organize()}>
              {busy ? '保存中…' : '保存整理结果'}
            </Button>
          }
        >
          <CharacterOrganizationFields
            value={fields}
            onChange={setFields}
            works={browser.facets?.works || []}
          />
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceTags}
                onChange={(e) => setReplaceTags(e.target.checked)}
                className="size-3.5 rounded accent-accent"
              />
              <span>改为替换全部标签（留空则清除）</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceGroups}
                onChange={(e) => setReplaceGroups(e.target.checked)}
                className="size-3.5 rounded accent-accent"
              />
              <span>改为替换全部分组（留空则清除）</span>
            </label>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
        </Dialog>

        <Dialog
          open={worksOpen}
          onOpenChange={(v) => {
            if (!busy) setWorksOpen(v);
          }}
          title="作品与别名"
          description="新增作品，或选择已有作品编辑别名与类型。别名可以用于搜索和筛选。"
          footer={
            <Button disabled={busy || !work.name.trim()} onClick={() => void saveWork()}>
              保存作品
            </Button>
          }
        >
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink">
              <span>选择已有作品</span>
              <select
                className="mt-1 h-10 w-full rounded-control border border-border-control bg-surface px-3 text-base sm:text-sm text-ink"
                value=""
                onChange={(e) => {
                  const next = browser.facets?.works.find((w) => w.name === e.target.value);
                  if (next) {
                    setWork(next);
                    setAliases(next.aliases.join('，'));
                  }
                }}
              >
                <option value="">选择作品，或在下方新建</option>
                {browser.facets?.works.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              <span>标准名称</span>
              <Input
                value={work.name}
                onChange={(e) => setWork({ ...work, name: e.target.value })}
                className="text-base sm:text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              <span>别名（逗号分隔）</span>
              <Input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className="text-base sm:text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              <span>作品类型</span>
              <select
                className="mt-1 h-10 w-full rounded-control border border-border-control bg-surface px-3 text-base sm:text-sm text-ink"
                value={work.mediaType}
                onChange={(e) => setWork({ ...work, mediaType: e.target.value })}
              >
                <option value="">未分类</option>
                {['游戏', '动画', '漫画', '小说', '影视', '其他'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </div>
        </Dialog>

        <Dialog
          open={batchAvatarOpen}
          onOpenChange={(v) => {
            if (!busy) {
              setBatchAvatarOpen(v);
              if (!v) setBatchAvatarResult(null);
            }
          }}
          title="批量获取官方头像"
          description="自动从官方素材库检索并下载角色的官方高清头像。"
          footer={
            batchAvatarResult ? (
              <Button
                onClick={() => {
                  setBatchAvatarOpen(false);
                  setBatchAvatarResult(null);
                }}
              >
                完成
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setBatchAvatarOpen(false)}>
                  取消
                </Button>
                <Button disabled={busy} onClick={() => void handleBatchAvatar()}>
                  {busy ? '正在匹配下载…' : '开始获取'}
                </Button>
              </div>
            )
          }
        >
          <div className="space-y-4 text-sm">
            {!batchAvatarResult ? (
              <>
                <p className="text-muted">
                  系统将根据角色名称（如原神等角色）在官方素材库中检索官方头像，下载并保存为角色头像资产。
                </p>
                <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3">
                  <span className="font-semibold text-ink">获取范围：</span>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="avatarScope"
                        value="missing"
                        checked={batchAvatarScope === 'missing'}
                        onChange={() => setBatchAvatarScope('missing')}
                        disabled={busy}
                        className="accent-accent"
                      />
                      <span>仅为<strong>缺失头像</strong>的角色获取 (推荐)</span>
                    </label>
                    {Object.keys(selected).length > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="avatarScope"
                          value="selected"
                          checked={batchAvatarScope === 'selected'}
                          onChange={() => setBatchAvatarScope('selected')}
                          disabled={busy}
                          className="accent-accent"
                        />
                        <span>仅为<strong>当前选中的 {Object.keys(selected).length} 位</strong>角色获取</span>
                      </label>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="avatarScope"
                        value="all"
                        checked={batchAvatarScope === 'all'}
                        onChange={() => setBatchAvatarScope('all')}
                        disabled={busy}
                        className="accent-accent"
                      />
                      <span>为<strong>全部角色</strong>重新匹配获取 (覆盖已有头像)</span>
                    </label>
                  </div>
                </div>
                {busy && (
                  <div className="flex items-center justify-center gap-2 py-4 text-muted">
                    <Loader2 className="size-4 animate-spin text-accent" />
                    <span>正在批量匹配与下载官方头像，请稍候…</span>
                  </div>
                )}
                {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
              </>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
                    <div className="text-2xl font-semibold text-success-fg">{batchAvatarResult.updated}</div>
                    <div className="text-xs text-muted">成功获取</div>
                  </div>
                  <div className="rounded-lg bg-surface-muted p-3 border border-border-default">
                    <div className="text-2xl font-semibold text-ink">{batchAvatarResult.skipped}</div>
                    <div className="text-xs text-muted">跳过/未匹配</div>
                  </div>
                  <div className="rounded-lg bg-rose-500/10 p-3 border border-rose-500/20">
                    <div className="text-2xl font-semibold text-danger-fg">{batchAvatarResult.failed}</div>
                    <div className="text-xs text-muted">失败</div>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-border-default bg-surface p-2 text-xs space-y-1">
                  {batchAvatarResult.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-surface-muted/50">
                      <span className="font-medium text-ink">{item.displayName}</span>
                      {item.success ? (
                        <span className="inline-flex items-center gap-1 text-success-fg font-medium">
                          <Check className="h-3 w-3" aria-hidden="true" />已更新
                        </span>
                      ) : (
                        <span className="text-muted">{item.error || '未匹配到'}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog>
        </section>
      </PageContainer>
    </div>
  );
}
