'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Plus, Download, Upload, Sparkles, SlidersHorizontal, User, Users, Tags, LayoutGrid, CircleUser, GitFork, CheckSquare, Images } from 'lucide-react';
import { Menu } from '@mantine/core';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Dialog } from '@/app/components/ui/dialog';
import { FloatingActionBar } from '@/app/components/ui/floating-action-bar';
import { useOverlayPortalTarget } from '@/app/components/ui/overlay-policy';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { CollectionLayout, CollectionViewToggle, useCollectionView } from '@/app/components/shared/page-archetypes';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterBatchImport } from './character-batch-import';
import { CharacterFilters } from './character-filters';
import { CharacterPagination } from './character-pagination';
import { hasCharacterFilters } from '../model/filter-chips';
import { useCharacterBrowser } from '../hooks/use-character-browser';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';
import { editCharacterOrganization, saveCharacterWork } from '../api';
import { CharacterAvatar } from './character-image-fallback';
import { characterFilterUrl } from '../filter-url';
import { stripMachineCharacterIndex, type CharacterBrowseQuery, type CharacterWork } from '@sthstart/contracts';
import { SharedAssetVault } from './shared-asset-vault';
import { LinsheCharacterVault } from './linshe-character-vault';
import { CharacterUpstreamDialog } from './character-upstream-dialog';
import { CharacterForkDialog } from './character-fork-dialog';
import { CharacterBatchAssetsDialog, CharacterBatchEnrichRpDialog, CharacterBatchImportLocalDialog } from './character-batch-dialogs';
import { characterKeys } from '../query-keys';
import { useToast } from '@/app/providers/ui-provider';

const DISPLAY_MODES = ['card', 'avatar'] as const;

export function CharacterLibrary({ initialFilter }: { initialFilter?: CharacterBrowseQuery | null } = {}) {
  const browser = useCharacterBrowser({ collapseDerivatives: true }, true, { persist: true, initialFilter });
  const hasFilters = hasCharacterFilters(browser.filter);
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [assetsVisited, setAssetsVisited] = useState(false);
  const [viewTab, setViewTab] = useState<'characters' | 'shared-assets' | 'linshe'>('characters');
  const { view: displayMode, setView: updateDisplayMode } = useCollectionView({
    allowed: DISPLAY_MODES,
    fallback: 'card',
    itemCount: browser.data?.items.length,
    sparseView: 'card',
  });
  const [upstreamOpen, setUpstreamOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [forkTarget, setForkTarget] = useState<{ id: string; displayName: string; work: string } | null>(null);

  const [batchOpen, setBatchOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [sharedAssetUploadOpen, setSharedAssetUploadOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [batchAvatarOpen, setBatchAvatarOpen] = useState(false);
  const [batchAvatarScope, setBatchAvatarScope] = useState<'missing' | 'selected' | 'all'>('missing');
  const [batchEnrichRpOpen, setBatchEnrichRpOpen] = useState(false);
  const [batchEnrichRpScope, setBatchEnrichRpScope] = useState<'incomplete' | 'selected' | 'all'>('incomplete');
  const [batchImportLocalOpen, setBatchImportLocalOpen] = useState(false);
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
  const [work, setWork] = useState<CharacterWork>({ name: '', aliases: [], mediaType: '', workNature: 'canon', parentWork: null });
  const [aliases, setAliases] = useState('');
  const [editingWorkName, setEditingWorkName] = useState('');
  const newWork = () => { setEditingWorkName(''); setWork({ name: '', aliases: [], mediaType: '', workNature: 'canon', parentWork: null }); setAliases(''); setError(''); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuPortalTarget = useOverlayPortalTarget();
  // 立绘放大预览（§8.2）：卡片缩略图不拉成封面，需要查看时单独放大。
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; url: string } | null>(null);

  const refresh = () => { void client.invalidateQueries({ queryKey: characterKeys.all }); };
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
    if (busy) return;
    setBusy(true); setError('');
    try {
      const saved = await saveCharacterWork({ ...work, aliases: splitLabels(aliases) }) as CharacterWork;
      setWork(saved);
      setAliases(saved.aliases.join('，'));
      setEditingWorkName(saved.name);
      await client.invalidateQueries({ queryKey: characterKeys.all });
      toast.success(editingWorkName ? '作品修改已保存' : '作品已创建', saved.name);
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="text-ink">
      <CollectionLayout
        title="角色库"
        itemCount={viewTab === 'characters' ? browser.data?.items.length : undefined}
        navigation={
          <PageTabs
            variant="local" ariaLabel="角色资料视图" value={viewTab}
            tabs={[
              { id: 'characters', label: <><User className="size-3.5" aria-hidden="true" />角色卡</>, panelId: 'character-cards' },
              { id: 'shared-assets', label: <><Users className="size-3.5" aria-hidden="true" />公共资产</>, panelId: 'character-shared-assets' },
              { id: 'linshe', label: <><Sparkles className="size-3.5" aria-hidden="true" />邻舍角色</>, panelId: 'character-linshe' },
            ]}
            onChange={value => {
              if (value === 'shared-assets') setAssetsVisited(true);
              if (value === 'characters' || value === 'shared-assets' || value === 'linshe') setViewTab(value);
            }}
          />
        }
        primaryAction={viewTab === 'shared-assets'
          ? { id: 'upload-shared-asset', label: '上传公共资产', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => setSharedAssetUploadOpen(true) }
          : viewTab === 'characters'
            ? { id: 'new-character', label: '新建角色', icon: <Plus className="h-4 w-4" aria-hidden="true" />, href: '/apps/characters/new' }
            : undefined}
        secondaryActions={viewTab === 'characters'
          ? [{ id: 'import-character', label: '导入', icon: <Download className="h-4 w-4" aria-hidden="true" />, onSelect: () => setImportOpen(true) }]
          : []}
        overflowLabel="更多角色操作"
        overflowActions={[
          ...(viewTab === 'characters' ? [
            { id: 'rp-card', label: 'RP 卡生成', icon: <Sparkles className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => setUpstreamOpen(true) },
            {
              id: 'selection-mode',
              label: selectionMode ? '退出批量管理' : '批量管理',
              icon: <CheckSquare className="size-3.5 text-muted" aria-hidden="true" />,
              onSelect: () => {
                const nextMode = !selectionMode;
                setSelectionMode(nextMode);
                if (!nextMode) setSelected({});
              },
            },
          ] : []),
          { id: 'batch-avatar', label: '批量获取形象与皮肤', icon: <Images className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => { setError(''); setBatchAvatarScope('missing'); setBatchAvatarOpen(true); } },
          { id: 'batch-enrich', label: '批量补全角色卡', icon: <Sparkles className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => { setError(''); setBatchEnrichRpScope('incomplete'); setBatchEnrichRpOpen(true); } },
          { id: 'import-local', label: '导入本地精选人设库', icon: <Users className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => { setError(''); setBatchImportLocalOpen(true); } },
          { id: 'batch-import', label: '批量导入角色', icon: <Upload className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => { setError(''); setBatchOpen(true); } },
          { id: 'works', label: '作品与别名', icon: <Tags className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => { setError(''); newWork(); setWorksOpen(true); } },
        ]}
      >
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
            summary={browser.isFetching ? <span role="status">筛选中…</span> : undefined}
            leftSlot={
              <CollectionViewToggle
                label="展示模式"
                value={displayMode}
                onChange={updateDisplayMode}
                options={[
                  { value: 'card', label: '卡片', icon: <LayoutGrid className="size-3.5" aria-hidden="true" /> },
                  { value: 'avatar', label: '头像', icon: <CircleUser className="size-3.5" aria-hidden="true" /> },
                ]}
              />
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
                    className="!h-6 !min-h-6 gap-1 rounded-control !border-border-default !bg-surface !px-2 py-0 text-xs font-normal !text-ink hover:!border-accent/50"
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
                setBatchAvatarOpen(true);
              }}
            >
              <Images className="size-3.5 text-muted" aria-hidden="true" />
              <span>获取形象与皮肤</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-3 text-xs"
              disabled={!Object.keys(selected).length}
              onClick={() => {
                setError('');
                setBatchEnrichRpScope('selected');
                setBatchEnrichRpOpen(true);
              }}
            >
              <Sparkles className="size-3.5 text-muted" aria-hidden="true" />
              <span>补全角色卡</span>
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
                  <Skeleton className="h-14 w-14 rounded-xl flex-none" />
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
                      className={`!absolute top-1.5 right-1.5 z-10 !h-11 !min-h-11 !w-11 sm:!h-7 sm:!min-h-7 sm:!w-7 text-muted transition-opacity hover:!bg-surface-sunken hover:!text-accent ${
                        character.organization?.favorite ? 'opacity-100' : 'opacity-70 hover:opacity-100 focus-visible:opacity-100'
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
                          seed={character.id}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          fallbackClassName="text-xl"
                        />
                      </div>
                      <span className="w-full truncate text-xs font-medium text-ink group-hover:text-accent">
                        {character.displayName}
                      </span>
                    </Link>
                    {(character.derivativeCount ?? 0) > 0 && (
                      <Menu position="bottom" withinPortal portalProps={menuPortalTarget ? { target: menuPortalTarget } : undefined}>
                        <Menu.Target>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--selection-border)] bg-[var(--selection-bg)] px-2 py-0.5 text-sm font-medium text-[var(--selection-fg)] hover:opacity-90 cursor-pointer"
                          >
                            <GitFork className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>同人 ×{character.derivativeCount}</span>
                          </button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {(character.familyMembers || []).map((member) => (
                            <Menu.Item
                              key={member.id}
                              onClick={() => router.push(`/apps/characters/${member.id}`)}
                            >
                              {member.originType === 'ip' ? '原作' : member.originType === 'derivative' ? '同人' : '原创'} · {member.work || member.displayName}
                            </Menu.Item>
                          ))}
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<GitFork className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() =>
                              setForkTarget({
                                id: character.id,
                                displayName: character.displayName,
                                work: character.draft.work || '',
                              })
                            }
                          >
                            复制到同人作品…
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3.5" data-collection-items>
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
                          seed={character.id}
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
                            <span className="truncate text-[length:var(--text-card-title)] font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
                              {character.displayName}
                            </span>
                            {character.draft.originType === 'derivative' && (
                              <span className="inline-flex shrink-0 items-center rounded border border-[var(--selection-border)] bg-[var(--selection-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--selection-fg)]">
                                同人
                              </span>
                            )}
                            <span className="inline-flex max-w-[7.5rem] shrink-0 items-center truncate text-xs text-muted">
                              {character.draft.work || '未分类'}
                            </span>
                          </div>
                          <p className="line-clamp-1 text-xs leading-relaxed text-muted">
                            {summaryLine}
                          </p>
                        </Link>

                        {(character.derivativeCount ?? 0) > 0 && (
                          <Menu position="bottom-end" withinPortal portalProps={menuPortalTarget ? { target: menuPortalTarget } : undefined}>
                            <Menu.Target>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--selection-border)] bg-[var(--selection-bg)] px-2 py-0.5 text-sm font-medium text-[var(--selection-fg)] hover:opacity-90 cursor-pointer"
                              >
                                <GitFork className="h-2.5 w-2.5" aria-hidden="true" />
                                <span>同人 ×{character.derivativeCount}</span>
                              </button>
                            </Menu.Target>
                            <Menu.Dropdown>
                              {(character.familyMembers || []).map((member) => (
                                <Menu.Item
                                  key={member.id}
                                  onClick={() => router.push(`/apps/characters/${member.id}`)}
                                >
                                  {member.originType === 'ip' ? '原作' : member.originType === 'derivative' ? '同人' : '原创'} · {member.work || member.displayName}
                                </Menu.Item>
                              ))}
                              <Menu.Divider />
                              <Menu.Item
                                leftSection={<GitFork className="h-3.5 w-3.5" aria-hidden="true" />}
                                onClick={() =>
                                  setForkTarget({
                                    id: character.id,
                                    displayName: character.displayName,
                                    work: character.draft.work || '',
                                  })
                                }
                              >
                                复制到同人作品…
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        )}

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
          title="作品目录"
          description="填写名称与作品属性即可创建，同人作品再选择母原作。"
          footer={
            <Button disabled={busy || !work.name.trim()} onClick={() => void saveWork()}>
              {editingWorkName ? '保存作品修改' : '新建作品'}
            </Button>
          }
        >
          <div className="space-y-3">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={newWork}>新建作品 · 清空表单</Button>
            <label className="block text-sm font-medium text-ink">
              <span>选择已有作品</span>
              <Select
                className="mt-1 h-10 min-h-10 text-base sm:text-sm"
                value={editingWorkName}
                disabled={busy}
                onChange={(e) => {
                  if (!e.target.value) { newWork(); return; }
                  const next = browser.facets?.works.find((w) => w.name === e.target.value);
                  if (next) {
                    setEditingWorkName(next.name);
                    setWork(next);
                    setAliases(next.aliases.join('，'));
                  }
                }}
              >
                <option value="">选择作品，或在下方新建</option>
                {editingWorkName && !browser.facets?.works.some((item) => item.name === editingWorkName) && (
                  <option value={editingWorkName}>{editingWorkName}</option>
                )}
                {browser.facets?.works.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm font-medium text-ink">
              <span>标准名称</span>
              <Input
                value={work.name}
                disabled={busy}
                readOnly={Boolean(editingWorkName)}
                onChange={(e) => setWork({ ...work, name: e.target.value })}
                className="text-base sm:text-sm"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium text-ink">
              <span>作品属性</span>
              <Select
                className="h-10 min-h-10 text-base sm:text-sm"
                value={work.workNature || 'canon'}
                disabled={busy}
                onChange={(e) =>
                  setWork({
                    ...work,
                    workNature: e.target.value as CharacterWork['workNature'],
                    ...(e.target.value !== 'derivative' ? { parentWork: null } : {}),
                  })
                }
              >
                <option value="canon">原作（IP 正典）</option>
                <option value="derivative">同人（基于原作衍生）</option>
                <option value="original">原创</option>
              </Select>
            </label>
            {work.workNature === 'derivative' && (
              <label className="block space-y-1 text-sm font-medium text-ink">
                <span>母原作</span>
                <Select disabled={busy} value={work.parentWork || ''} onChange={event => setWork({ ...work, parentWork: event.target.value || null })}>
                  <option value="">选择已登记的母原作</option>
                  {(browser.facets?.works || []).filter(item => item.name !== work.name && item.workNature !== 'derivative').map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                </Select>
              </label>
            )}
            <details>
              <summary className="cursor-pointer py-2 text-sm font-medium text-ink">更多信息（可选）</summary>
              <div className="space-y-3 pt-2">
                <label className="block space-y-1 text-sm font-medium text-ink">
                  <span>别名（逗号分隔）</span>
                  <Input disabled={busy} value={aliases} onChange={(e) => setAliases(e.target.value)} className="text-base sm:text-sm" />
                </label>
            <label className="block space-y-1 text-sm font-medium text-ink">
              <span>作品类型</span>
              <Select
                className="h-10 min-h-10 text-base sm:text-sm"
                value={work.mediaType}
                disabled={busy}
                onChange={(e) => setWork({ ...work, mediaType: e.target.value })}
              >
                <option value="">未分类</option>
                {['游戏', '动画', '漫画', '小说', '影视', '其他'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </label>
              </div>
            </details>
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </div>
        </Dialog>

        <CharacterBatchAssetsDialog
          open={batchAvatarOpen}
          onOpenChange={setBatchAvatarOpen}
          initialScope={batchAvatarScope}
          selectedIds={Object.keys(selected)}
          onCompleted={refresh}
        />

        <CharacterBatchEnrichRpDialog
          open={batchEnrichRpOpen}
          onOpenChange={setBatchEnrichRpOpen}
          initialScope={batchEnrichRpScope}
          selectedIds={Object.keys(selected)}
          onCompleted={refresh}
        />
        <CharacterBatchImportLocalDialog
          open={batchImportLocalOpen}
          onOpenChange={setBatchImportLocalOpen}
          onCompleted={refresh}
        />
        <CharacterUpstreamDialog
          open={upstreamOpen}
          onOpenChange={setUpstreamOpen}
          onApplied={(newId) => {
            refresh();
            router.push(`/apps/characters/${newId}`);
          }}
        />

        {forkTarget && (
          <CharacterForkDialog
            open
            onOpenChange={(open) => {
              if (!open) setForkTarget(null);
            }}
            characterId={forkTarget.id}
            displayName={forkTarget.displayName}
            sourceWork={forkTarget.work}
            works={browser.facets?.works || []}
            onForked={(newId) => {
              refresh();
              router.push(`/apps/characters/${newId}`);
            }}
          />
        )}
        </section>
      </CollectionLayout>
    </div>
  );
}
