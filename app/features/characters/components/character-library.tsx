'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Plus, Search, Upload, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterBatchImport } from './character-batch-import';
import { CharacterFilters, CharacterPagination, useCharacterBrowser } from './character-filters';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';
import { editCharacterOrganization, saveCharacterWork } from '../api';
import { useBatchMatchOfficialAvatars } from '../mutations';
import { isCharacterDraftV2 } from '@sthstart/contracts';
import type { CharacterBrowseQuery, CharacterWork } from '@sthstart/contracts';

export function CharacterLibrary({ initialFilter }: { initialFilter?: CharacterBrowseQuery | null } = {}) {
  const browser = useCharacterBrowser({}, true, { persist: true, initialFilter });
  const router = useRouter();
  const client = useQueryClient();
  const batchMatchMutation = useBatchMatchOfficialAvatars();
  const [importOpen, setImportOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [batchAvatarOpen, setBatchAvatarOpen] = useState(false);
  const [batchAvatarScope, setBatchAvatarScope] = useState<'missing' | 'selected' | 'all'>('missing');
  const [batchAvatarResult, setBatchAvatarResult] = useState<import('@sthstart/contracts').CharacterBatchAvatarResponse | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [fields, setFields] = useState(emptyOrganizationFields);
  const [replaceTags, setReplaceTags] = useState(false);
  const [replaceGroups, setReplaceGroups] = useState(false);
  const [work, setWork] = useState<CharacterWork>({ name: '', aliases: [], mediaType: '' });
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 立绘放大预览（§8.2）：卡片缩略图不拉成封面，需要查看时单独放大。
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; url: string } | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: ['characters'] }); };
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
  return <div className="bg-paper py-6 text-ink"><PageContainer className="space-y-4">
    <PageHeader
      title="角色资料库"
      description="按作品与标签找角色，为下一场活动挑选参与者。"
      actions={<div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setError(''); setBatchAvatarResult(null); setBatchAvatarOpen(true); }}>
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          <span>批量获取头像</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>搜索 / 导入</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setError(''); setWorksOpen(true); }}>
          作品与别名
        </Button>
        <Link
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
          href="/apps/characters/new"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>新建角色</span>
        </Link>
      </div>}
    />
    {(error || browser.error) && <p role="alert" className="text-sm text-accent-dark">{error || String(browser.error)}</p>}
    <CharacterFilters filter={browser.filter} onChange={browser.change} onReset={browser.reset} facets={browser.facets} actions={<><span className="text-sm text-muted">{selectionMode ? `已选 ${Object.keys(selected).length} 位` : `共 ${browser.data?.total ?? '—'} 位角色`}{browser.isFetching ? ' · 筛选中…' : ''}</span>{selectionMode ? <><Button size="sm" variant="ghost" onClick={() => setSelected(current => ({ ...current, ...Object.fromEntries((browser.data?.items || []).map(c => [c.id, c.displayName])) }))}>选择本页</Button><Button size="sm" variant="ghost" onClick={() => setSelected({})}>取消选择</Button><Button size="sm" variant="outline" disabled={!Object.keys(selected).length} onClick={() => { setError(''); setBatchAvatarScope('selected'); setBatchAvatarResult(null); setBatchAvatarOpen(true); }}><Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />获取所选头像</Button><Button size="sm" variant="outline" disabled={!Object.keys(selected).length} onClick={() => { setError(''); setOrganizeOpen(true); }}>批量整理</Button><Button size="sm" variant="ghost" onClick={() => { setSelectionMode(false); setSelected({}); }}>退出</Button></> : <><Button size="sm" variant="ghost" onClick={() => { setError(''); setBatchOpen(true); }}><Upload className="h-4 w-4" aria-hidden="true" />批量导入</Button><Button size="sm" variant="ghost" onClick={() => setSelectionMode(true)}>批量管理</Button></>}</>} />

    {Object.keys(selected).length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted">查看跨页已选名单</summary><div className="mt-2 flex flex-wrap gap-2">{Object.entries(selected).map(([id, name]) => <button key={id} type="button" className="rounded bg-accent/10 px-2 py-1" onClick={() => setSelected(current => { const next = { ...current }; delete next[id]; return next; })}>{name} ×</button>)}</div></details>}
    {/* 角色卡牌网格：精简展示（仅头像、角色名、所属作品） */}
    {browser.isLoading ? (
      <p className="py-12 text-center text-muted">正在加载角色…</p>
    ) : (
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))]">
        {browser.data?.items.map((character) => (
          <article
            key={character.id}
            className="character-profile-card group relative flex min-h-[94px] items-center justify-between rounded-[var(--radius-panel)] bg-surface p-4 transition-all"
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
                className="mr-2"
              />
            )}

            <Link href={`/apps/characters/${character.id}`} className="flex flex-1 items-center gap-3 min-w-0">
              <div
                className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-default/60 bg-surface-muted text-xl font-bold shadow-inner"
                style={
                  character.avatarUrl
                    ? undefined
                    : {
                        backgroundColor: [
                          'var(--info-bg)',
                          'var(--success-bg)',
                          'var(--warning-bg)',
                          'var(--danger-bg)',
                        ][
                          Array.from(character.id).reduce(
                            (sum, letter) => sum + letter.charCodeAt(0),
                            0
                          ) % 4
                        ],
                      }
                }
              >
                {character.avatarUrl ? (
                  <Image
                    src={character.avatarUrl}
                    alt=""
                    fill
                    unoptimized
                    className="object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  character.displayName.slice(0, 1)
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-ink group-hover:text-accent">
                  {character.displayName}
                </h3>
                <p className="mt-0.5 truncate text-xs text-fg-subtle">
                  {character.draft.work || '未设置作品'}
                </p>
              </div>
            </Link>

            <button
              type="button"
              className="ml-2 text-muted transition-colors hover:text-accent p-1"
              aria-label={`${character.organization?.favorite ? '取消收藏' : '收藏'} ${character.displayName}`}
              aria-pressed={character.organization?.favorite || false}
              onClick={() => void toggleFavorite(character.id, !character.organization?.favorite)}
            >
              <Star
                className={`h-4 w-4 ${character.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`}
              />
            </button>
          </article>
        ))}
      </div>
    )}
    {!browser.isLoading && browser.data?.total === 0 && <p className="py-12 text-center text-muted">没有匹配的角色，可以清空筛选或导入新角色。</p>}
    <CharacterPagination data={browser.data} onPage={page => browser.change({ page })} />
    {previewArtifact && <Dialog open onOpenChange={open => { if (!open) setPreviewArtifact(null); }} title={previewArtifact.name} description="原图按原始比例显示，缩略图才会裁剪。" footer={<Button size="sm" variant="outline" onClick={() => setPreviewArtifact(null)}>关闭</Button>}><img src={previewArtifact.url} alt={`${previewArtifact.name} 的立绘`} className="mx-auto max-h-[65vh] w-auto rounded-[var(--radius-control)] object-contain" /></Dialog>}
  <CharacterImportDialog open={importOpen} onOpenChange={setImportOpen} initialMode="online" onCommitted={id => { refresh(); router.push(`/apps/characters/${id}`); }} />
  <CharacterBatchImport open={batchOpen} onOpenChange={setBatchOpen} onCommitted={refresh} works={browser.facets?.works || []} />
  <Dialog open={organizeOpen} onOpenChange={v => { if (!busy) setOrganizeOpen(v); }} title={`整理 ${Object.keys(selected).length} 位角色`} description="只修改角色库资料，已保存的活动快照保持原样。" footer={<Button disabled={busy} onClick={() => void organize()}>{busy ? '保存中…' : '保存整理结果'}</Button>}><CharacterOrganizationFields value={fields} onChange={setFields} works={browser.facets?.works || []} /><div className="mt-3 space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={replaceTags} onChange={e => setReplaceTags(e.target.checked)} />改为替换全部标签（留空则清除）</label><label className="flex items-center gap-2"><input type="checkbox" checked={replaceGroups} onChange={e => setReplaceGroups(e.target.checked)} />改为替换全部分组（留空则清除）</label></div>{error && <p role="alert" className="mt-3 text-sm text-accent-dark">{error}</p>}</Dialog>
  <Dialog open={worksOpen} onOpenChange={v => { if (!busy) setWorksOpen(v); }} title="作品与别名" description="新增作品，或选择已有作品编辑别名与类型。别名可以用于搜索和筛选。" footer={<Button disabled={busy || !work.name.trim()} onClick={() => void saveWork()}>保存作品</Button>}><div className="space-y-3"><label className="block text-sm">选择已有作品<select className="mt-1 w-full rounded border p-2" value="" onChange={e => { const next = browser.facets?.works.find(w => w.name === e.target.value); if (next) { setWork(next); setAliases(next.aliases.join('，')); } }}><option value="">选择作品，或在下方新建</option>{browser.facets?.works.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}</select></label><label className="block text-sm">标准名称<Input value={work.name} onChange={e => setWork({ ...work, name: e.target.value })} /></label><label className="block text-sm">别名（逗号分隔）<Input value={aliases} onChange={e => setAliases(e.target.value)} /></label><label className="block text-sm">作品类型<select className="mt-1 w-full rounded border p-2" value={work.mediaType} onChange={e => setWork({ ...work, mediaType: e.target.value })}><option value="">未分类</option>{['游戏', '动画', '漫画', '小说', '影视', '其他'].map(t => <option key={t}>{t}</option>)}</select></label>{error && <p role="alert" className="text-sm text-accent-dark">{error}</p>}</div></Dialog>
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
          {error && <p role="alert" className="text-sm text-accent-dark">{error}</p>}
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
              <div className="text-2xl font-bold text-emerald-600">{batchAvatarResult.updated}</div>
              <div className="text-xs text-muted">成功获取</div>
            </div>
            <div className="rounded-lg bg-surface-muted p-3 border border-border-default">
              <div className="text-2xl font-bold text-ink">{batchAvatarResult.skipped}</div>
              <div className="text-xs text-muted">跳过/未匹配</div>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-3 border border-rose-500/20">
              <div className="text-2xl font-bold text-rose-600">{batchAvatarResult.failed}</div>
              <div className="text-xs text-muted">失败</div>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-border-default bg-surface p-2 text-xs space-y-1">
            {batchAvatarResult.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-surface-muted/50">
                <span className="font-medium text-ink">{item.displayName}</span>
                {item.success ? (
                  <span className="text-emerald-600 font-medium">✓ 已更新</span>
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
  </PageContainer>
  </div>;
}
