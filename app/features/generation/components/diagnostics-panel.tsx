'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import type { MediaDiagnostics } from '../types';

export function DiagnosticsPanel({ diagnostics }: { diagnostics: MediaDiagnostics | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>媒体诊断</CardTitle><CardDescription>视频预处理只在系统实际检测到 ffmpeg 和 ffprobe 时启用；这里不会自动安装或修改系统。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {diagnostics ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-[var(--radius-control)] border border-border-subtle bg-surface p-3">
                <strong className="text-sm">ffmpeg</strong>
                <span className={`mt-1 block text-sm ${diagnostics.video.ffmpeg.available ? 'text-success-fg' : 'text-fg-subtle'}`}>{diagnostics.video.ffmpeg.available ? `可用${diagnostics.video.ffmpeg.version ? ` · ${diagnostics.video.ffmpeg.version}` : ''}` : diagnostics.video.ffmpeg.error === 'not_found' ? '未安装' : '不可用'}</span>
              </div>
              <div className="rounded-[var(--radius-control)] border border-border-subtle bg-surface p-3">
                <strong className="text-sm">ffprobe</strong>
                <span className={`mt-1 block text-sm ${diagnostics.video.ffprobe.available ? 'text-success-fg' : 'text-fg-subtle'}`}>{diagnostics.video.ffprobe.available ? `可用${diagnostics.video.ffprobe.version ? ` · ${diagnostics.video.ffprobe.version}` : ''}` : diagnostics.video.ffprobe.error === 'not_found' ? '未安装' : '不可用'}</span>
              </div>
            </div>
            {diagnostics.video.installHint && <p className="rounded bg-accent-dark/8 p-3 text-sm leading-5 text-danger-fg">{diagnostics.video.installHint}</p>}
            <div className="rounded-[var(--radius-control)] border border-border-subtle bg-surface p-3 text-sm">
              <strong>H3</strong>
              <span className={`ml-2 ${diagnostics.h3.ready ? 'text-success-fg' : 'text-fg-subtle'}`}>{diagnostics.h3.ready ? '真实 Worker 已就绪' : diagnostics.h3.enabled ? `实验状态：${diagnostics.h3.reason}` : '默认关闭'}</span>
              <p className="mt-1 text-sm text-muted">当前探测到的能力上限：{diagnostics.h3.constraints.maxWidth}×{diagnostics.h3.constraints.maxHeight}、{diagnostics.h3.constraints.maxDurationSeconds} 秒、并发 {diagnostics.h3.constraints.concurrencyLimit}；具体值由工作流声明和服务配置共同决定，当前没有公共生成入口。 <a href="https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE" target="_blank" rel="noreferrer" className="underline underline-offset-2">启用前阅读 H3 Community License</a>，确认所在地区、用途和再分发符合许可要求。</p>
            </div>
          </>
        ) : <p className="text-sm text-fg-subtle">正在读取诊断状态…</p>}
      </CardContent>
    </Card>
  );
}
