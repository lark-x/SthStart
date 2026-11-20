'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import type { CoverEntityType, EntityCover } from '@sthstart/contracts';
import { COVER_IMAGE_CONTENT_TYPES } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { EmptyState } from '@/app/components/ui/empty-state';
import { EntityImage, type EntityArtRatio, type EntityArtTone } from '@/app/components/ui/entity-art';
import { Input } from '@/app/components/ui/input';
import { Skeleton } from '@/app/components/ui/skeleton';
import { fetchMediaLibrary } from '@/app/features/media-library/api';
import { coverImageUrl, setEntityCover, uploadCoverImage } from '../api';
import { coverKeys } from '../query-keys';

const PAGE_SIZE = 24;

export interface CoverFieldProps {
  entityType: CoverEntityType;
  entityId: string;
  title: string;
  coverArtifactId: string | null | undefined;
  tone?: EntityArtTone;
  ratio?: EntityArtRatio;
  /** 封面写入成功后调用；所属模块在这里失效自己的查询。 */
  onChanged?: (cover: EntityCover) => void;
  /** 只读时只显示封面，不显示操作。 */
  readOnly?: boolean;
  className?: string;
}

/** 实体封面：显示当前封面（或生成式占位），提供设置、更换与移除。 */
export function CoverField({
  entityType, entityId, title, coverArtifactId, tone, ratio = 'cover', onChanged, readOnly = false, className,
}: CoverFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // 写入成功后先显示新封面；所属查询刷新出新值后，回到以服务端数据为准。
  const base = coverArtifactId ?? null;
  const [override, setOverride] = useState<{ base: string | null; value: string | null } | null>(null);
  const current = override && override.base === base ? override.value : base;
  const mutation = useMutation({
    mutationFn: (artifactId: string | null) => setEntityCover(entityType, entityId, artifactId),
    onSuccess: (cover) => {
      setOverride({ base, value: cover.coverArtifactId });
      onChanged?.(cover);
    },
  });
  const apply = async (artifactId: string | null) => {
    await mutation.mutateAsync(artifactId);
    setPickerOpen(false);
  };

  return (
    <section className={className ? `cover-field ${className}` : 'cover-field'} aria-label={`${title}的封面`} data-has-cover={current ? 'true' : 'false'}>
      <EntityImage
        seed={entityId}
        title={title}
        tone={tone}
        ratio={ratio}
        src={coverImageUrl(current)}
        alt={current ? `${title}的封面` : ''}
      />
      {!readOnly && (
        <div className="cover-field-actions">
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)} disabled={mutation.isPending}>
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            <span>{current ? '更换封面' : '设置封面'}</span>
          </Button>
          {current && (
            <Button size="sm" variant="ghost" onClick={() => void apply(null).catch(() => undefined)} loading={mutation.isPending && mutation.variables === null}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>移除封面</span>
            </Button>
          )}
        </div>
      )}
      {mutation.isError && !pickerOpen && (
        <Alert variant="danger" className="cover-field-error">
          {mutation.error instanceof Error ? mutation.error.message : '封面保存失败，请重试。'}
        </Alert>
      )}
      <CoverPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => { setPickerOpen(open); if (!open) mutation.reset(); }}
        currentArtifactId={current}
        onPick={apply}
        saving={mutation.isPending}
        saveError={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : '封面保存失败，请重试。') : null}
      />
    </section>
  );
}

export interface PendingCoverFieldProps {
  /** 生成式占位的种子；实体尚未创建，可用表单内稳定的临时值。 */
  seed: string;
  title: string;
  value: string | null;
  onChange: (artifactId: string | null) => void;
  tone?: EntityArtTone;
  ratio?: EntityArtRatio;
  disabled?: boolean;
  className?: string;
}

/**
 * 新建流程里的封面：实体还没有 ID，先选好图片（媒体库或本地上传），创建成功后再用
 * applyPendingCover 写入。只暂存媒体 ID，与 CoverField 共用同一个选择浮层。
 */
export function PendingCoverField({
  seed, title, value, onChange, tone, ratio = 'cover', disabled = false, className,
}: PendingCoverFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <section className={className ? `cover-field ${className}` : 'cover-field'} aria-label={`${title || '新作品'}的封面`} data-has-cover={value ? 'true' : 'false'}>
      <EntityImage seed={seed} title={title || '新'} tone={tone} ratio={ratio} src={coverImageUrl(value)} alt={value ? `${title}的封面` : ''} />
      <div className="cover-field-actions">
        <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)} disabled={disabled}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          <span>{value ? '更换封面' : '设置封面'}</span>
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>移除封面</span>
          </Button>
        )}
      </div>
      <CoverPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentArtifactId={value}
        onPick={async (artifactId) => { onChange(artifactId); setPickerOpen(false); }}
        saving={false}
        saveError={null}
      />
    </section>
  );
}

/**
 * 新建成功后写入暂存的封面。封面不是创建的前置条件：写入失败时实体照常创建，
 * 返回错误信息由调用方提示，用户之后可在详情里重新设置。
 */
export async function applyPendingCover(entityType: CoverEntityType, entityId: string, artifactId: string | null): Promise<string | null> {
  if (!artifactId) return null;
  try {
    await setEntityCover(entityType, entityId, artifactId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '封面没有保存成功，可以稍后在详情里重新设置。';
  }
}

function CoverPickerDialog({
  open, onOpenChange, currentArtifactId, onPick, saving, saveError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentArtifactId: string | null;
  onPick: (artifactId: string) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="选择封面" description="从媒体库选一张图片，或上传本地图片。封面只引用媒体，不会复制文件。" size="lg">
      {open ? <CoverPickerBody currentArtifactId={currentArtifactId} onPick={onPick} saving={saving} saveError={saveError} /> : null}
    </Dialog>
  );
}

function CoverPickerBody({
  currentArtifactId, onPick, saving, saveError,
}: {
  currentArtifactId: string | null;
  onPick: (artifactId: string) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const media = useQuery({
    queryKey: coverKeys.mediaPicker(debounced, offset),
    queryFn: ({ signal }) => fetchMediaLibrary({ q: debounced || undefined, mediaKind: 'image', status: 'ready', limit: PAGE_SIZE, offset }, { signal }),
    placeholderData: keepPreviousData,
  });
  const items = (media.data?.items ?? []).filter((item) => COVER_IMAGE_CONTENT_TYPES.includes((item.contentType ?? '').split(';')[0]));
  const total = media.data?.total ?? 0;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadCoverImage(file);
      await onPick(uploaded.artifactId);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '封面上传失败，请重试。');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="cover-picker space-y-4" aria-busy={saving || uploading}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-ink">搜索媒体库</label>
          <Input
            id={searchId}
            leftIcon={<Search className="h-4 w-4 text-muted" />}
            value={query}
            placeholder="按文件名或来源搜索"
            onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={COVER_IMAGE_CONTENT_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void upload(event.target.files?.[0])}
          data-testid="cover-upload-input"
        />
        <Button variant="primary" onClick={() => fileRef.current?.click()} loading={uploading} disabled={saving}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          <span>上传本地图片</span>
        </Button>
      </div>

      {(uploadError || saveError) && <Alert variant="danger">{uploadError ?? saveError}</Alert>}
      {media.isError && (
        <Alert variant="danger" title="媒体库加载失败">
          <Button size="sm" variant="outline" onClick={() => void media.refetch()}>重试</Button>
        </Alert>
      )}

      {media.isLoading ? (
        <ul className="cover-picker-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <li key={index}><Skeleton className="aspect-[16/10] w-full rounded-[var(--radius-panel)]" /></li>)}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title={debounced ? '没有匹配的图片' : '媒体库里还没有图片'}
          description={debounced ? '换个关键词，或直接上传一张本地图片。' : '上传一张本地图片作为封面，它也会出现在媒体库里。'}
        />
      ) : (
        <ul className="cover-picker-grid" aria-label="可用作封面的图片">
          {items.map((item) => {
            const selected = item.id === currentArtifactId;
            const name = item.originalName ?? '未命名图片';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="cover-picker-item"
                  aria-pressed={selected}
                  aria-label={`使用「${name}」作为封面`}
                  disabled={saving || uploading}
                  onClick={() => void onPick(item.id).catch(() => undefined)}
                >
                  <EntityImage seed={item.id} title={name} ratio="cover" src={item.thumbnailUrl ?? item.fileUrl} alt="" />
                  <span className="cover-picker-name">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(offset > 0 || offset + PAGE_SIZE < total) && (
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>上一页</Button>
          <span className="text-xs text-muted tabular-nums">{Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <Button size="sm" variant="ghost" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((value) => value + PAGE_SIZE)}>下一页</Button>
        </div>
      )}
    </div>
  );
}
