'use client';

import { useState } from 'react';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { FormField } from '@/app/components/ui/form-field';
import { Pagination } from '@/app/components/ui/pagination';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { useActivityPage } from '@/app/features/activities/use-activity-page';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { CharacterPagination } from '@/app/features/characters/public-ui';
import { publishedCharacterInput } from '@/app/features/projects/published-character';
import { projectsApi } from '@/app/features/projects/api';
import { storyApi } from '@/app/features/story/api';
import type { ProjectOverview } from '@sthstart/contracts';

export type ProjectSourceMode = 'character' | 'activity' | null;

/** Project-owned source adoption. Both branches keep the existing API calls and page sizes. */
export function ProjectAddSourceDialog({
  mode,
  projectId,
  overview,
  onClose,
  onAdded,
}: {
  mode: ProjectSourceMode;
  projectId: string;
  overview: Pick<ProjectOverview, 'characters' | 'productions'>;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const open = mode !== null;
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const library = useCharacterBrowser({}, mode === 'character');
  const [activityFilter, setActivityFilter] = useState({ q: '', page: 1, pageSize: 20 });
  const activities = useActivityPage({ ...activityFilter, independent: true }, mode === 'activity');

  const reset = () => {
    setSelected('');
    setError('');
  };

  const addCharacter = async () => {
    const character = library.data?.items.find((item) => item.id === selected);
    if (!character?.latestVersion) throw new Error('请先在角色库发布角色版本。');
    if (overview.characters.some((existing) =>
      existing.sourceCharacterId === character.id && existing.sourceVersion === character.latestVersion)) {
      throw new Error('这个角色版本已经加入项目。');
    }
    await storyApi.createCharacter(projectId, await publishedCharacterInput(character));
  };

  const addActivity = async () => {
    await projectsApi.add(projectId, { kind: 'activity', id: selected });
  };

  const confirm = async () => {
    if (!mode || !selected || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'character') await addCharacter();
      else await addActivity();
      onClose();
      reset();
      onAdded(mode === 'character' ? '角色已加入项目。' : '制作已关联到项目。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入失败');
    } finally {
      setBusy(false);
    }
  };

  const unavailable = mode === 'character'
    ? library.isFetching || library.isSearchPending
    : activities.isFetching || activities.isError;

  return (
    <ResponsiveEditOverlay
      open={open}
      onOpenChange={(next) => { if (!next && !busy) { onClose(); reset(); } }}
      title={mode === 'character' ? '从角色库加入' : '关联已有制作'}
      description={mode === 'character'
        ? '只采用已发布版本。角色名相同也按来源 ID 区分。'
        : '章节制作版本自动属于其来源项目；这里关联独立创建的互动制作。'}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => { onClose(); reset(); }}>取消</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!selected || unavailable}
            onClick={() => void confirm()}
          >
            确认加入
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === 'character' ? (
          <>
            <FormField label="搜索已发布角色">
              <Input
                placeholder="搜索角色名称"
                value={library.filter.q ?? ''}
                onChange={(event) => { setSelected(''); library.change({ q: event.target.value }); }}
              />
            </FormField>
            {library.isLoading && <AsyncState status="loading" rows={2} />}
            {library.isError && (
              <AsyncState
                status="error"
                title="角色读取失败"
                description={library.error.message}
                onRetry={() => void library.refetch()}
              />
            )}
            {(library.isPlaceholderData || library.isSearchPending) && (
              <p role="status" className="text-sm text-muted">正在更新角色列表…</p>
            )}
            <FormField label="角色版本">
              <Select
                className="w-full"
                value={selected}
                disabled={library.isFetching || library.isSearchPending}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">选择已发布角色</option>
                {(library.data?.items ?? [])
                  .filter((character) => !character.archived)
                  .map((character) => (
                    <option key={character.id} value={character.id} disabled={!character.latestVersion}>
                      {character.displayName} · {character.latestVersion ? 'v' + character.latestVersion : '尚未发布'}
                    </option>
                  ))}
              </Select>
            </FormField>
            {library.isSuccess && !library.isPlaceholderData && !library.isSearchPending
              && !library.data.items.length && (
                <p role="status" className="text-sm text-muted">没有匹配的角色，可换一个关键词。</p>
              )}
            <CharacterPagination
              data={library.data}
              loading={library.isFetching || library.isSearchPending}
              onPage={(page) => { setSelected(''); library.change({ page }); }}
              onPageSizeChange={(pageSize) => { setSelected(''); library.change({ pageSize }); }}
            />
          </>
        ) : (
          <>
            <FormField label="搜索独立制作">
              <Input
                placeholder="搜索全部独立制作"
                value={activityFilter.q}
                onChange={(event) => {
                  setSelected('');
                  setActivityFilter({ ...activityFilter, q: event.target.value, page: 1 });
                }}
              />
            </FormField>
            {activities.isLoading && <AsyncState status="loading" rows={2} />}
            {activities.isError && (
              <AsyncState
                status="error"
                title="制作读取失败"
                onRetry={() => void activities.refetch()}
              />
            )}
            {activities.isFetching && !activities.isLoading && (
              <p role="status" className="text-sm text-muted">正在更新制作列表…</p>
            )}
            <FormField label="独立制作">
              <Select
                disabled={activities.isFetching || activities.isError}
                className="w-full"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{activities.isFetching ? '正在更新…' : '选择独立制作'}</option>
                {(activities.data?.items ?? [])
                  .filter((activity) => activity.type !== 'publication')
                  .map((activity) => {
                    const linked = overview.productions.some((item) => item.id === activity.id);
                    return (
                      <option key={activity.id} value={activity.id} disabled={linked}>
                        {activity.title}{linked ? ' · 已关联' : ''}
                      </option>
                    );
                  })}
              </Select>
            </FormField>
            <Pagination
              compact
              total={activities.data?.total ?? 0}
              page={activities.data?.page ?? activityFilter.page}
              pageSize={activityFilter.pageSize}
              loading={activities.isFetching}
              onPageChange={(page) => { setSelected(''); setActivityFilter({ ...activityFilter, page }); }}
              onPageSizeChange={(pageSize) => { setSelected(''); setActivityFilter({ ...activityFilter, page: 1, pageSize }); }}
            />
          </>
        )}
        {error && <Alert variant="danger" title="无法加入">{error}</Alert>}
      </div>
    </ResponsiveEditOverlay>
  );
}
