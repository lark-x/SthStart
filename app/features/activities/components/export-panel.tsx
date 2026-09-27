'use client';
import { normalizeCreationProfile } from '@sthstart/contracts';

import React, { useState } from 'react';
import {
  Download,
  BookOpen,
  Film,
  Archive,
} from 'lucide-react';
import type { Activity, ContentRevision, MediaRevision, PlaybackRevision } from '@sthstart/contracts';
import { exportActivityPackage } from '../api';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';

interface ExportPanelProps {
  activity: Activity;
  creationProfile?: Record<string, unknown>;
  contentRevision?: ContentRevision | null;
  mediaRevision?: MediaRevision | null;
  playbackRevision?: PlaybackRevision | null;
}

/**
 * 导出面板。
 *
 * 原本是页头「更多操作」里的弹层，改为工作室的第四个 tab：
 * 导出是链路末端的一步，与「内容 → 素材 → 回放 → 导出」同层，
 * 放在折叠菜单里等于把最后一步藏起来。
 */
export function ExportPanel({ activity, creationProfile, contentRevision, mediaRevision, playbackRevision }: ExportPanelProps) {
  const [modeOverride, setMode] = useState<'full' | 'project' | 'reader' | null>(null);
  const profileFormat = normalizeCreationProfile((creationProfile?.values || {}) as Record<string, unknown>).exportFormat;
  const mode = modeOverride ?? (profileFormat === 'hyperframes-project' ? 'full' : profileFormat);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const currentContentRevisionId = contentRevision?.id || activity.currentContentRevisionId || '';
  const currentMediaRevision = mediaRevision?.contentRevisionId === currentContentRevisionId ? mediaRevision : null;
  const hasSelectedMedia = Boolean(currentMediaRevision?.slotBindings.some((binding) => binding.assets.length > 0));
  const currentPlaybackMatches = Boolean(
    playbackRevision
      && playbackRevision.id === activity.currentPlaybackRevisionId
      && playbackRevision.contentRevisionId === currentContentRevisionId
      && playbackRevision.mediaRevisionId === (currentMediaRevision?.id || 'none'),
  );

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMsg(null);

    try {
      const blob = await exportActivityPackage(activity.id, {
        mode,
        contentRevisionId: activity.currentContentRevisionId || undefined,
        mediaRevisionId: activity.currentMediaRevisionId || undefined,
        playbackRevisionId: activity.currentPlaybackRevisionId || undefined,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activity.title || 'activity'}-${mode}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出工程失败');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-ink">导出离线包与可渲染工程</h2>
        <p className="text-sm text-muted">
          导出当前内容版本、对应媒体与回放时间线。没有可用回放时，服务会按当前版本重新编排，不会打包过期时间线。
        </p>
      </div>

      <section aria-label="导出版本状态" className="grid gap-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-3 text-xs sm:grid-cols-3">
        <div className="min-w-0">
          <p className="font-semibold text-muted">内容版本</p>
          <p className="mt-1 truncate font-mono text-ink" title={currentContentRevisionId}>{currentContentRevisionId || '尚未提交'}</p>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-muted">媒体版本</p>
          <p className="mt-1 text-ink">{currentMediaRevision ? (hasSelectedMedia ? '已选用媒体' : '无已选用媒体') : '无匹配媒体版本'}</p>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-muted">回放版本</p>
          <p className="mt-1 text-ink">{currentPlaybackMatches ? '与当前内容和媒体匹配' : '未匹配，导出时自动重编排'}</p>
        </div>
      </section>

      {errorMsg && (
        <Alert variant="danger" title="导出失败">
          {errorMsg}
        </Alert>
      )}

      <div className="space-y-2.5">
        <button
          type="button"
          aria-pressed={mode === 'full'}
          onClick={() => setMode('full')}
          className={`w-full p-3.5 rounded-[var(--radius-control)] border text-left transition-all cursor-pointer ${
            mode === 'full'
              ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
              : 'border-border-subtle hover:border-accent/40 bg-surface'
          }`}
        >
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">
              视频制作工程 (HyperFrames Project)
            </span>
          </div>
          <p className="text-sm text-muted mt-1 pl-6 leading-relaxed">
            包含活动文本、可用媒体、HTML compositions 与渲染脚本。ZIP 是可继续处理的视频工程，不是已渲染的 MP4；解压后需在本机安装并运行 HyperFrames 才能渲染成片。
          </p>
        </button>

        <button
          type="button"
          aria-pressed={mode === 'project'}
          onClick={() => setMode('project')}
          className={`w-full p-3.5 rounded-[var(--radius-control)] border text-left transition-all cursor-pointer ${
            mode === 'project'
              ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
              : 'border-border-subtle hover:border-accent/40 bg-surface'
          }`}
        >
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">
              可继续编辑的工作工程 (Project Archive)
            </span>
          </div>
          <p className="text-sm text-muted mt-1 pl-6 leading-relaxed">
            包含活动完整数据、阶段与记录、锁定策略、角色快照、媒体文件与配方溯源关系。支持在任何环境通过「导入工程」继续编辑创作。
          </p>
        </button>

        <button
          type="button"
          aria-pressed={mode === 'reader'}
          onClick={() => setMode('reader')}
          className={`w-full p-3.5 rounded-[var(--radius-control)] border text-left transition-all cursor-pointer ${
            mode === 'reader'
              ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
              : 'border-border-subtle hover:border-accent/40 bg-surface'
          }`}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">
              阅读分享包 (Reader HTML)
            </span>
          </div>
          <p className="text-sm text-muted mt-1 pl-6 leading-relaxed">
            轻量离线包，双击即可在浏览器中阅读当前活动图文与已选媒体，不包含预先渲染的视频成片。
          </p>
        </button>
      </div>

      <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
        <Button
          type="button"
          size="sm"
          disabled={isExporting}
          onClick={handleExport}
          className="text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5 shadow-xs"
        >
          {isExporting ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {isExporting ? '打包流式压缩中…' : '开始打包并下载 ZIP'}
        </Button>
      </div>
    </div>
  );
}

