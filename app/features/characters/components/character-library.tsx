'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Plus, Search, Upload, Sparkles, Loader2, SlidersHorizontal, CheckSquare, Check, User, Users, MoreHorizontal, Tags, LayoutGrid, CircleUser } from 'lucide-react';
import { Menu } from '@mantine/core';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Dialog } from '@/app/components/ui/dialog';
import { FloatingActionBar } from '@/app/components/ui/floating-action-bar';
import { useOverlayPortalTarget } from '@/app/components/ui/overlay-policy';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterBatchImport } from './character-batch-import';
import { CharacterFilters } from './character-filters';
import { CharacterPagination } from './character-pagination';
import { hasCharacterFilters } from '../model/filter-chips';
import { useCharacterBrowser } from '../hooks/use-character-browser';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';
import { editCharacterOrganization, saveCharacterWork } from '../api';
import { useBatchMatchOfficialAvatars } from '../mutations';
import { CharacterAvatar } from './character-image-fallback';
import { characterFilterUrl } from '../filter-url';
import { stripMachineCharacterIndex, type CharacterBrowseQuery, type CharacterWork } from '@sthstart/contracts';
import { SharedAssetVault } from './shared-asset-vault';
import { LinsheCharacterVault } from './linshe-character-vault';
import { CharacterUpstreamDialog } from './character-upstream-dialog';
import { characterKeys } from '../query-keys';

const DISPLAY_MODE_STORAGE_KEY = 'sthstart:character-display-mode';

function subscribeDisplayMode(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('sthstart:character-display-mode', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('sthstart:character-display-mode', callback);
  };
}

function readDisplayMode(): 'avatar' | 'card' {
  try {
    return window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === 'avatar' ? 'avatar' : 'card';
  } catch {
    return 'card';
  }
}

export function CharacterLibrary({ initialFilter }: { initialFilter?: CharacterBrowseQuery | null } = {}) {
  const browser = useCharacterBrowser({}, true, { persist: true, initialFilter });
  const hasFilters = hasCharacterFilters(browser.filter);
  const router = useRouter();
  const client = useQueryClient();
  const batchMatchMutation = useBatchMatchOfficialAvatars();
  const [assetsVisited, setAssetsVisited] = useState(false);
  const [viewTab, setViewTab] = useState<'characters' | 'shared-assets' | 'linshe'>('characters');
  const displayMode = useSyncExternalStore(subscribeDisplayMode, readDisplayMode, () => 'card' as const);
  const [upstreamOpen, setUpstreamOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const updateDisplayMode = (mode: 'avatar' | 'card') => {
    try {
      window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
      window.dispatchEvent(new Event('sthstart:character-display-mode'));
    } catch {}
  };
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
  const menuPortalTarget = useOverlayPortalTarget();
  // 立绘放大预览（§8.2）：卡片缩略图不拉成封面，需要查看时单独放大。
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; url: string } | null>(null);

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
            <PageTabs
              variant="local" ariaLabel="角色资料视图" value={viewTab}
              tabs={[
                { id: 'characters', label: <><User className="size-3.5" aria-hidden="true" />专属角色卡</>, panelId: 'character-cards' },
                { id: 'shared-assets', label: <><Users className="size-3.5" aria-hidden="true" />多角色公共资产库</>, panelId: 'character-shared-assets' },
                { id: 'linshe', label: <><Sparkles className="size-3.5" aria-hidden="true" />邻舍角色</>, panelId: 'character-linshe' },
              ]}
              onChange={value => {
                if (value === 'shared-assets') setAssetsVisited(true);
                if (value === 'characters' || value === 'shared-assets' || value === 'linshe') setViewTab(value);
              }}
            />
          }
          actions={<div className="flex flex-wrap items-center gap-2">
              {viewTab === 'characters' && (
                <>
                  <Link
                    className={buttonVariants({ size: 'sm', variant: 'primary' })}
                    href="/apps/characters/new"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>新建角色</span>
                  </Link>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setUpstreamOpen(true)}
                    className="gap-1.5 text-sm font-medium"
                  >
                    <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span>上游生成 RP 卡</span>
                  </Button>

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

              <Menu
                position="bottom-end"
                withinPortal
                portalProps={menuPortalTarget ? { target: menuPortalTarget } : undefined}
                closeOnItemClick
                returnFocus
                transitionProps={{ duration: 140, transition: 'pop-top-right' }}
                shadow="md"
                radius="md"
              >
                <Menu.Target>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="更多角色操作"
                    className="h-9 min-h-0 px-2.5 text-muted hover:text-ink"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown aria-label="更多角色操作" className="ui-row-menu w-44">
                  <Menu.Item
                    leftSection={<Sparkles className="size-3.5 text-muted" aria-hidden="true" />}
                    onClick={() => {
                      setError('');
                      setBatchAvatarResult(null);
                      setBatchAvatarOpen(true);
                    }}
                  >
                    批量获取头像
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<Upload className="size-3.5 text-muted" aria-hidden="true" />}
                    onClick={() => {
                      setError('');
                      setBatchOpen(true);
                    }}
                  >
                    批量导入角色
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<Tags className="size-3.5 text-muted" aria-hidden="true" />}
                    onClick={() => {
                      setError('');
                      setWorksOpen(true);
                    }}
                  >
                    作品与别名
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
          </div>}
        />
        <section aria-label="角色资料内容" className="space-y-4">

          <div id="character-shared-assets" role="tabpanel" aria-label="多角色公共资产库" hidden={viewTab !== 'shared-assets'}>
            {assetsVisited && <SharedAssetVault
              active={viewTab === 'shared-assets'}
              uploadDialogOpen={sharedAssetUploadOpen}
              onUploadDialogOpenChange={setSharedAssetUploadOpen}
            />}
          </div>
        <div id="character-linshe" role="tabpanel" aria-label="邻舍角色" hidden={viewTab !== 'linshe'}>
          {viewTab === 'linshe' && <LinsheCharacterVault />}
        </div>
        <div id="character-cards" role="tabpanel" aria-label="专属角色卡" hidden={viewTab !== 'characters'} className="space-y-4">
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
            leftSlot={
              <div role="group" aria-label="展示模式" className="inline-flex shrink-0 items-center rounded-control border border-hairline bg-surface-sunken p-0.5 text-xs">
                <Button
                  type="button"
                  size="sm"
                  variant={displayMode === 'avatar' ? 'secondary' : 'ghost'}
                  aria-pressed={displayMode === 'avatar'}
                  onClick={() => updateDisplayMode('avatar')}
                  className="h-7 min-h-7 gap-1 px-2 text-xs"
                >
                  <CircleUser className="size-3.5" aria-hidden="true" />
                  <span>只看头像</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={displayMode === 'card' ? 'secondary' : 'ghost'}
                  aria-pressed={displayMode === 'card'}
                  onClick={() => updateDisplayMode('card')}
                  className="h-7 min-h-7 gap-1 px-2 text-xs"
                >
                  <LayoutGrid className="size-3.5" aria-hidden="true" />
                  <span>信息卡片</span>
                </Button>
              </div>
            }
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
                  <Button
                    key={id}
                    variant="outline"
                    size="sm"
                    className="!h-[22px] !min-h-[22px] gap-1 rounded-control !border-border-default !bg-surface !px-2 py-0 text-xs font-normal !text-ink hover:!border-accent/50"
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
                  </Button>
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

          {/* 角色名片多列画廊网格 */}
          {browser.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <div key={n} className="flex items-center gap-3.5 rounded-panel border border-border-subtle bg-surface p-3.5">
                  <Skeleton className="h-[76px] w-[76px] rounded-xl flex-none" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-control flex-none" />
                </div>
              ))}
            </div>
          ) : browser.data?.total === 0 ? (
            <EmptyState
              icon={User}
              title={hasFilters ? '没有匹配的角色' : '角色库还没有角色'}
              description={hasFilters ? '试试其他关键词，或清空筛选查看全部角色。' : '从上方新建角色，或通过「搜索 / 导入」添加已有角色。'}
              actions={hasFilters && (
                  <Button variant="outline" size="sm" onClick={() => browser.reset()}>
                    清空筛选
                  </Button>
              )}
            />
          ) : displayMode === 'avatar' ? (
            <ul className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {browser.data?.items.map((character) => (
                <li key={character.id}>
                  <article
                    data-character-card="true"
                    className="group relative flex flex-col items-center gap-2 rounded-panel border border-transparent bg-surface p-3 text-center shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:border-border-default hover:shadow-[var(--elev-sm),0_0_0_1px_var(--hairline)] motion-reduce:transform-none"
                  >
                    {selectionMode && (
                      <div className="absolute top-2 left-2 z-10">
                        <Checkbox
                          aria-label={`选择 ${character.displayName}`}
                          checked={!!selected[character.id]}
                          onChange={(e) =>
                            setSelected((current) => {
                              const next = { ...current };
                              if (e.target.checked) next[character.id] = character.displayName;
                              else delete next[character.id];
                              return next;
                            })
                          }
                        />
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`!absolute top-1.5 right-1.5 z-10 !h-7 !min-h-7 !w-7 text-muted transition-opacity hover:!bg-surface-sunken hover:!text-accent ${
                        character.organization?.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      }`}
                      aria-label={`${character.organization?.favorite ? '取消收藏' : '收藏'} ${character.displayName}`}
                      aria-pressed={character.organization?.favorite || false}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void toggleFavorite(character.id, !character.organization?.favorite);
                      }}
                    >
                      <Star className={`h-3.5 w-3.5 ${character.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`} />
                    </Button>

                    <Link
                      href={`/apps/characters/${character.id}`}
                      className="flex w-full flex-col items-center gap-2 min-w-0"
                    >
                      <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken">
                        <CharacterAvatar
                          src={character.avatarUrl}
                          name={character.displayName}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          fallbackClassName="text-xl"
                        />
                      </div>
                      <span className="w-full truncate text-xs font-medium text-ink group-hover:text-accent">
                        {character.displayName}
                      </span>
                    </Link>
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
              {browser.data?.items.map((character) => {
                const draftPersonaSnippet =
                  'personaText' in character.draft && character.draft.personaText
                    ? stripMachineCharacterIndex(character.draft.personaText)
                    : 'identity' in character.draft && character.draft.identity
                    ? stripMachineCharacterIndex(character.draft.identity)
                    : '';
                const rawSnippet =
                  character.draft.summary?.trim() ||
                  (draftPersonaSnippet
                    ? draftPersonaSnippet
                        .replace(/^#{1,6}\s*/gm, '')
                        .replace(/\n+/g, ' ')
                        .trim()
                    : '');
                const summaryLine = rawSnippet
                  ? rawSnippet.slice(0, 56)
                  : '暂无角色概述';

                return (
                  <li key={character.id}>
                    <article
                      data-character-card="true"
                      className="group relative flex items-center gap-3 rounded-panel border border-transparent bg-surface p-3.5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:border-border-default hover:shadow-[var(--elev-sm),0_0_0_1px_var(--hairline)] motion-reduce:transform-none"
                    >
                      {selectionMode && (
                        <Checkbox
                          aria-label={`选择 ${character.displayName}`}
                          checked={!!selected[character.id]}
                          onChange={(e) =>
                            setSelected((current) => {
                              const next = { ...current };
                              if (e.target.checked) next[character.id] = character.displayName;
                              else delete next[character.id];
                              return next;
                            })
                          }
                          className="mt-0 shrink-0"
                        />
                      )}

                      <Link
                        href={`/apps/characters/${character.id}`}
                        className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken"
                      >
                        <CharacterAvatar
                          src={character.avatarUrl}
                          name={character.displayName}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          fallbackClassName="text-xl"
                        />
                      </Link>

                      <div className="flex flex-1 min-w-0 items-center justify-between gap-2">
                        <Link
                          href={`/apps/characters/${character.id}`}
                          className="min-w-0 flex-1 space-y-1 block"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-[15px] font-[600] tracking-[-0.01em] text-ink transition-colors group-hover:text-accent">
                              {character.displayName}
                            </span>
                            <span className="inline-flex max-w-[7.5rem] shrink-0 items-center truncate text-xs text-muted">
                              {character.draft.work || '未分类'}
                            </span>
                          </div>
                          <p className="line-clamp-1 text-xs leading-relaxed text-muted">
                            {summaryLine}
                          </p>
                        </Link>

                        <Button
                          variant="ghost"
                          size="icon"
                          className={`!h-8 !min-h-8 !w-8 shrink-0 text-muted transition-opacity hover:!bg-surface-sunken hover:!text-accent ${
                            character.organization?.favorite ? 'opacity-100' : 'opacity-45 group-hover:opacity-100 focus-visible:opacity-100'
                          }`}
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
                        </Button>
                      </div>
                    </article>
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
            <Checkbox
              label="改为替换全部标签（留空则清除）"
              checked={replaceTags}
              onChange={(e) => setReplaceTags(e.target.checked)}
            />
            <Checkbox
              label="改为替换全部分组（留空则清除）"
              checked={replaceGroups}
              onChange={(e) => setReplaceGroups(e.target.checked)}
            />
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
              <Select
                className="mt-1 h-10 min-h-10 text-base sm:text-sm"
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
              </Select>
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
              <Select
                className="mt-1 h-10 min-h-10 text-base sm:text-sm"
                value={work.mediaType}
                onChange={(e) => setWork({ ...work, mediaType: e.target.value })}
              >
                <option value="">未分类</option>
                {['游戏', '动画', '漫画', '小说', '影视', '其他'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
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
        <CharacterUpstreamDialog
          open={upstreamOpen}
          onOpenChange={setUpstreamOpen}
          onApplied={(newId) => {
            refresh();
            router.push(`/apps/characters/${newId}`);
          }}
        />
        </section>
      </PageContainer>
    </div>
  );
}
