'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import type {
  CharacterBrowseQuery,
  CharacterProfile,
} from '@sthstart/contracts';
import { Card } from '@/app/components/ui/card';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { Alert } from '@/app/components/ui/alert';
import { CharacterAvatar } from './character-image-fallback';
import { CharacterFilters } from './character-filters';
import { CharacterPagination } from './character-pagination';
import { useCharacterBrowser } from '../hooks/use-character-browser';
import { editCharacterOrganization, fetchCharacterDetail } from '../api';
import { characterKeys } from '../query-keys';
import {
  characterStageLabel,
  resolveCharacterSelection,
  type CharacterBrowserSelection,
} from '../model/character-selection';

export type { CharacterBrowserSelection } from '../model/character-selection';

interface PickerProps {
  active?: boolean;
  initialFilter?: CharacterBrowseQuery;
  selected: Record<string, CharacterBrowserSelection>;
  onSelectionChange: (
    selection: CharacterBrowserSelection,
    selected: boolean
  ) => void;
  disabled?: boolean;
  maxSelected?: number;
  existingIds?: readonly string[];
  allowExisting?: boolean;
}

function FamilyChoice({
  root,
  selected,
  onSelectionChange,
  disabled,
  maxSelected,
  existingIds = [],
  allowExisting,
}: Omit<PickerProps, 'active' | 'initialFilter'> & { root: CharacterProfile }) {
  const [memberId, setMemberId] = useState(root.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const member = useQuery({
    queryKey: characterKeys.detail(memberId),
    queryFn: () => fetchCharacterDetail(memberId),
    enabled: memberId !== root.id,
    staleTime: 15_000,
  });
  const profile = memberId === root.id ? root : member.data;
  const selection = selected[memberId];
  const added = existingIds.includes(memberId);
  const unavailable =
    disabled ||
    busy ||
    (!selection &&
      maxSelected != null &&
      Object.keys(selected).length >= maxSelected) ||
    (added && !allowExisting);
  const original = profile?.draft.originType === 'original';
  const noStage = original && !profile?.latestVersion;
  const toggle = async () => {
    if (!profile || unavailable) return;
    if (selection) {
      onSelectionChange(selection, false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSelectionChange(await resolveCharacterSelection(profile), true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色快照读取失败');
    } finally {
      setBusy(false);
    }
  };
  const favorite = async () => {
    if (!profile) return;
    setError('');
    try {
      await editCharacterOrganization({
        ids: [profile.id],
        favorite: !profile.organization?.favorite,
      });
      await client.invalidateQueries({ queryKey: characterKeys.all });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '收藏失败');
    }
  };
  const choices = root.familyMembers?.length
    ? root.familyMembers
    : [
        {
          id: root.id,
          displayName: root.displayName,
          work: root.draft.work,
          originType: root.draft.originType,
        },
      ];
  const members = choices.some((item) => item.id === root.id)
    ? choices
    : [
        {
          id: root.id,
          displayName: root.displayName,
          work: root.draft.work,
          originType: root.draft.originType,
        },
        ...choices,
      ];
  return (
    <Card
      className="min-w-0 space-y-3 p-3"
      data-character-family={root.familyRootId || root.id}
    >
      {members.length > 1 && (
        <label className="block space-y-1 text-sm text-muted">
          <span>同源角色 · 切换原作与同人</span>
          <Select
            aria-label={`切换 ${root.displayName} 的同源成员`}
            value={memberId}
            disabled={disabled || busy}
            onChange={(event) => {
              setMemberId(event.target.value);
              setError('');
            }}
          >
            {members.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} · {item.work || '未设作品'} ·{' '}
                {item.originType === 'ip'
                  ? '原作'
                  : item.originType === 'derivative'
                    ? '同人'
                    : '原创'}
              </option>
            ))}
          </Select>
        </label>
      )}
      {!profile ? (
        <p role="status" className="text-sm text-muted">
          {member.isError ? '同源成员读取失败' : '正在读取同源成员…'}
        </p>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative size-10 shrink-0 overflow-hidden rounded-control">
              <CharacterAvatar
                src={profile.avatarUrl}
                name={profile.displayName}
                seed={profile.id}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {profile.displayName}
              </p>
              <p className="truncate text-xs text-muted">
                {profile.draft.work || '未设作品'} ·{' '}
                {original
                  ? '原创'
                  : profile.draft.originType === 'ip'
                    ? '原作'
                    : '同人'}
                {added ? ' · 已加入' : ''}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`${profile.organization?.favorite ? '取消收藏' : '收藏'} ${profile.displayName}`}
              aria-pressed={Boolean(profile.organization?.favorite)}
              onClick={() => void favorite()}
              disabled={disabled}
            >
              <Star
                className={`size-4 ${profile.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`}
                aria-hidden="true"
              />
            </Button>
          </div>
          <p className="line-clamp-2 text-xs text-muted">
            {profile.draft.summary || '暂无角色概述'}
          </p>
          {noStage ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                先为原创角色保存一个阶段，再用于创作。
              </p>
              <Link
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={`/apps/characters/${profile.id}`}
              >
                前往保存阶段
              </Link>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={selection ? 'secondary' : 'outline'}
              aria-pressed={Boolean(selection)}
              disabled={unavailable}
              onClick={() => void toggle()}
            >
              {busy
                ? '正在读取快照…'
                : selection
                  ? '已选择 · 点击移除'
                  : added && !allowExisting
                    ? '已加入'
                    : '选择角色'}
            </Button>
          )}
          {selection && (
            <div className="space-y-2 border-t border-border-subtle pt-3">
              {original && (
                <label className="block space-y-1 text-sm">
                  <span>采用阶段</span>
                  <Select
                    aria-label={`选择 ${profile.displayName} 的阶段`}
                    value={selection.version.version}
                    disabled={disabled}
                    onChange={(event) => {
                      const version = selection.versions.find(
                        (item) => item.version === Number(event.target.value)
                      );
                      if (version)
                        onSelectionChange(
                          {
                            ...selection,
                            version,
                            variantId: undefined,
                            costumeAssetId: undefined,
                          },
                          true
                        );
                    }}
                  >
                    {selection.versions.map((version) => (
                      <option key={version.version} value={version.version}>
                        {characterStageLabel(version)}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {!!selection.version.variants?.length && (
                <label className="block space-y-1 text-sm">
                  <span>角色形态</span>
                  <Select
                    aria-label={`选择 ${profile.displayName} 的形态`}
                    value={selection.variantId || ''}
                    disabled={disabled}
                    onChange={(event) =>
                      onSelectionChange(
                        {
                          ...selection,
                          variantId: event.target.value || undefined,
                        },
                        true
                      )
                    }
                  >
                    <option value="">主档案</option>
                    {selection.version.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {!!selection.version.assets?.some(
                (asset) => asset.category === 'costume'
              ) && (
                <label className="block space-y-1 text-sm">
                  <span>服装</span>
                  <Select
                    aria-label={`选择 ${profile.displayName} 的服装`}
                    value={selection.costumeAssetId || ''}
                    disabled={disabled}
                    onChange={(event) =>
                      onSelectionChange(
                        {
                          ...selection,
                          costumeAssetId: event.target.value || undefined,
                        },
                        true
                      )
                    }
                  >
                    <option value="">默认服装</option>
                    {selection.version.assets
                      .filter((asset) => asset.category === 'costume')
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.title || '服装'}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
            </div>
          )}
        </>
      )}
      {(error || member.isError) && (
        <Alert variant="danger" title="角色读取失败">
          {error || member.error?.message}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void member.refetch()}
          >
            重试
          </Button>
        </Alert>
      )}
    </Card>
  );
}

/** Library browsing and all cast entry points use the same filters and family semantics. */
export function CharacterBrowserPicker({
  active = true,
  initialFilter,
  ...props
}: PickerProps) {
  const browser = useCharacterBrowser({ collapseDerivatives: true }, active, {
    initialFilter,
  });
  return (
    <div className="min-w-0 space-y-3">
      <CharacterFilters
        filter={browser.filter}
        onChange={browser.change}
        onReset={browser.reset}
        facets={browser.facets}
      />
      {!!Object.keys(props.selected).length && (
        <div
          role="group"
          aria-label="已选角色"
          className="flex min-w-0 flex-wrap gap-2"
        >
          {Object.values(props.selected).map((choice) => (
            <Button
              key={choice.profile.id}
              type="button"
              size="sm"
              variant="secondary"
              className="max-w-full whitespace-normal text-left [&_.mantine-Button-label]:whitespace-normal"
              disabled={props.disabled}
              onClick={() => props.onSelectionChange(choice, false)}
              aria-label={`移除已选 ${choice.profile.displayName}`}
            >
              {choice.profile.displayName}
              {choice.profile.draft.originType === 'original'
                ? ` · ${characterStageLabel(choice.version)}`
                : ''}
              {choice.variantId
                ? ` · ${choice.version.variants?.find((item) => item.id === choice.variantId)?.name || ''}`
                : ''}
              {choice.costumeAssetId
                ? ` · ${choice.version.assets?.find((item) => item.id === choice.costumeAssetId)?.title || ''}`
                : ''}{' '}
              ×
            </Button>
          ))}
        </div>
      )}
      {browser.isError && (
        <Alert variant="danger" title="角色库读取失败">
          {browser.error.message}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void browser.refetch()}
          >
            重试
          </Button>
        </Alert>
      )}
      {(browser.isFetching || browser.isSearchPending) && (
        <p role="status" className="text-sm text-muted">
          正在更新角色列表…
        </p>
      )}
      {!browser.isLoading &&
        !browser.isError &&
        !browser.data?.items.length && (
          <p role="status" className="py-4 text-sm text-muted">
            没有匹配的角色，请调整作品或搜索条件。
          </p>
        )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {browser.data?.items
          .filter((item) => !item.archived)
          .map((root) => (
            <FamilyChoice
              key={root.id}
              root={root}
              {...props}
              disabled={
                props.disabled || browser.isFetching || browser.isSearchPending
              }
            />
          ))}
      </div>
      <CharacterPagination
        data={browser.data}
        loading={browser.isFetching || browser.isSearchPending}
        onPage={(page) => browser.change({ page })}
        onPageSizeChange={(pageSize) => browser.change({ pageSize, page: 1 })}
      />
      <p className="text-xs text-muted">
        原创采用你保存的阶段；原作与同人自动使用最新快照。形态和服装会随选择用于后续创作。
      </p>
    </div>
  );
}
