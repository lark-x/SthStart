'use client';

import type { ComponentType } from 'react';
import type {
  Activity,
  ActorSnapshot,
  ContentDocument,
  ContentRevision,
  MediaRevision,
  PlaybackRevision,
} from '@sthstart/contracts';
import { LazyPanel, createRetryableLoader } from '@/app/components/shared/lazy-panel';

/**
 * 制作工作台的按需加载边界。
 * 草稿控制器留在 StudioShell，本层只替换工作台内容；重试不会卸载编辑会话。
 */
function LazyWorkstation<P extends object>({
  label,
  loader,
  props,
}: {
  label: string;
  loader: () => Promise<{ default: ComponentType<P> }>;
  props: P;
}) {
  return <LazyPanel label={label} loader={loader} componentProps={props} />;
}

const loadMediaWorkstation = createRetryableLoader(() => import('../components/media-workstation'), module => ({ default: module.MediaWorkstation }));
const loadComicWorkstation = createRetryableLoader(() => import('../comic/comic-workstation'), module => ({ default: module.ComicWorkstation }));
const loadPlaybackWorkstation = createRetryableLoader(() => import('../components/playback-workstation'), module => ({ default: module.PlaybackWorkstation }));
const loadExportPanel = createRetryableLoader(() => import('../components/export-panel'), module => ({ default: module.ExportPanel }));

export interface LazyMediaWorkstationProps {
  activity: Activity;
  document: ContentDocument;
  currentMediaRevision?: MediaRevision | null;
  actors: ActorSnapshot[];
  onUpdateDocument: (document: ContentDocument) => void;
  disabled?: boolean;
  registerFlush?(flush: (() => Promise<boolean>) | null): void;
}

export function LazyMediaWorkstation(props: LazyMediaWorkstationProps) {
  return <LazyWorkstation label="素材制作" loader={loadMediaWorkstation} props={props} />;
}

export interface LazyComicWorkstationProps {
  activity: Activity;
  content: ContentDocument;
  actors: ActorSnapshot[];
  onBack(): void;
  onEdit?(): void;
  readingOnly?: boolean;
  embedded?: boolean;
  registerFlush?(callback: (() => Promise<boolean>) | null): void;
}

export function LazyComicWorkstation(props: LazyComicWorkstationProps) {
  return <LazyWorkstation label="漫画工坊" loader={loadComicWorkstation} props={props} />;
}

export interface LazyPlaybackWorkstationProps {
  activity: Activity;
  document: ContentDocument;
  currentPlaybackRevision?: PlaybackRevision | null;
  mediaRevision?: MediaRevision | null;
  actors: ActorSnapshot[];
  disabled?: boolean;
  hideModeSwitcher?: boolean;
}

export function LazyPlaybackWorkstation(props: LazyPlaybackWorkstationProps) {
  return <LazyWorkstation label="连贯试演" loader={loadPlaybackWorkstation} props={props} />;
}

export interface LazyExportPanelProps {
  activity: Activity;
  creationProfile?: Record<string, unknown>;
  contentRevision?: ContentRevision | null;
  mediaRevision?: MediaRevision | null;
  playbackRevision?: PlaybackRevision | null;
}

export function LazyExportPanel(props: LazyExportPanelProps) {
  return <LazyWorkstation label="导出交付" loader={loadExportPanel} props={props} />;
}
