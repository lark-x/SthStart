'use client';
import { normalizeCreationProfile } from '@sthstart/contracts';

import React, { useState } from 'react';
import {
  Download,
  BookOpen,
  Film,
  Archive,
} from 'lucide-react';
import type { Activity } from '@sthstart/contracts';
import { exportActivityPackage } from '../api';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  creationProfile?: Record<string,unknown>;
}

export function ExportModal({ open, onOpenChange, activity, creationProfile }: ExportModalProps) {
  const [modeOverride, setMode] = useState<'full'|'project'|'reader'|null>(null);
  const profileFormat=normalizeCreationProfile((creationProfile?.values||{}) as Record<string,unknown>).exportFormat;
  const mode=modeOverride??(profileFormat==='hyperframes-project'?'full':profileFormat);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activity.title || 'activity'}-${mode}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出工程失败');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="导出离线包与可渲染工程"
      description="导出所有采用记录、真实媒体文件、离线阅读器以及自包含的 HyperFrames 渲染工程。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
            className="text-sm"
          >
            取消
          </Button>

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
      }
    >
      <div className="space-y-4 py-1">
        {errorMsg && (
          <Alert variant="danger" title="导出失败">
            {errorMsg}
          </Alert>
        )}

        <div className="space-y-2.5">
          <div
            onClick={() => setMode('full')}
            className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
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
              包含全部采用群聊/朋友圈文本、真实音视频媒体、HTML compositions 与 package.json 渲染脚本。解压后可直接在终端执行 <code className="text-sm bg-surface-muted px-1 rounded">npx hyperframes render</code> 渲染为最终 MP4 视频。
            </p>
          </div>

          <div
            onClick={() => setMode('project')}
            className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
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
          </div>

          <div
            onClick={() => setMode('reader')}
            className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
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
              轻量离线包，双击即可在任何浏览器中离线阅读完整活动图文记录与视频，不依赖后端服务或渲染工具链。
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
