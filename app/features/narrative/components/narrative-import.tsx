'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type {
  NarrativeConnector,
  NarrativeRemoteDocument,
  NarrativeRemoteResult,
} from '@sthstart/contracts';
import {
  previewNarrativeImport,
  commitNarrativeImport,
  searchRemoteMcp,
  readRemoteMcp,
  previewRemoteMcpImport,
  type ImportPreviewReport,
} from '../api';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useToast } from '@/app/providers/ui-provider';
import { PageContainer } from '@/app/components/shared/page-layout';

const sampleJson = JSON.stringify(
  {
    schemaVersion: 1,
    source: { id: 'local-demo', name: '本地示例', kind: 'json', version: '1' },
    work: { externalId: 'first-work', title: '第一部作品', description: '从一条完整任务链开始。', locale: 'zh-CN' },
    release: { externalId: 'v1', label: '第一版' },
    nodes: [
      { externalId: 'chapter-1', kind: 'chapter', title: '序章', order: 1 },
      { externalId: 'quest-1', parentExternalId: 'chapter-1', kind: 'quest', title: '雨夜来信', order: 1 },
    ],
    scenes: [{ externalId: 'station', nodeExternalId: 'quest-1', title: '末班车站', order: 1 }],
    utterances: [
      { externalId: 'line-1', sceneExternalId: 'station', order: 1, kind: 'narration', text: '雨落在空无一人的站台。' },
      { externalId: 'line-2', sceneExternalId: 'station', order: 2, kind: 'dialogue', speaker: '林', text: '这封信，为什么偏偏在今天寄到？' },
    ],
    entities: [{ externalId: 'lin', type: 'character', name: '林', aliases: [], description: '在雨夜收到来信的人。' }],
  },
  null,
  2
);

export function NarrativeImport({
  connectors,
  onImportComplete,
}: {
  connectors: NarrativeConnector[];
  onImportComplete: (workId: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [jsonText, setJsonText] = useState(sampleJson);
  const [preview, setPreview] = useState<ImportPreviewReport | null>(null);
  const [busy, setBusy] = useState(false);

  const [world, setWorld] = useState<'gi' | 'hsr' | 'bh3'>('gi');
  const [mcpQuery, setMcpQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<NarrativeRemoteResult[]>([]);
  const [remoteDoc, setRemoteDoc] = useState<NarrativeRemoteDocument | null>(null);

  const handleValidateJson = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(jsonText);
      const res = await previewNarrativeImport(parsed);
      setPreview(res);
      toast.success('JSON 校验成功');
    } catch (e) {
      toast.error('校验失败', e instanceof Error ? e.message : 'JSON 格式错误');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const res = await commitNarrativeImport(preview.id);
      // 批次已落库，立刻清掉预览避免二次提交命中 batch_not_pending。
      setPreview(null);
      toast.success('已成功写入本地叙事档案');
      await onImportComplete(res.workId);
    } catch (e) {
      toast.error('写入失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSearchRemote = async () => {
    if (busy) return;
    if (!mcpQuery.trim()) return;
    setBusy(true);
    try {
      const res = await searchRemoteMcp({
        world,
        keyword: mcpQuery.trim(),
        maxResults: 10,
      });
      setRemoteResults(res.items);
      setRemoteDoc(null);
      toast.info(`检索到 ${res.items.length} 个结果`);
    } catch (e) {
      toast.error('检索失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReadRemote = async (res: NarrativeRemoteResult) => {
    setBusy(true);
    try {
      const doc = await readRemoteMcp({
        world,
        pathHash: res.pathHash,
        limit: 80,
      });
      setRemoteDoc(doc);
    } catch (e) {
      toast.error('读取原文失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewRemote = async (res: NarrativeRemoteResult) => {
    setBusy(true);
    try {
      const prev = await previewRemoteMcpImport({
        world,
        pathHash: res.pathHash,
        title: res.fileName,
      });
      setPreview(prev);
      toast.success('已拉取并生成导入差异预览');
    } catch (e) {
      toast.error('导入预览失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageContainer className="space-y-6 py-6">
      <div className="max-w-2xl">
        <h2 className="tpl-section-title">把来源变成可追溯的本地档案</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          MCP 与文件均为上游数据来源。确认差异后，剧情将永久固化为本地版本，不依赖外部服务器持续在线。
        </p>
      </div>

      {/*
       * Connectors 由查询异步填充，初始为空数组。
       * data-testid 供视觉回归等待“连接器已就绪”，避免截到半加载画面。
       */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="narrative-connectors">
        {connectors.map((c) => (
          <div
            key={c.id}
            className="p-5 rounded-[var(--radius-panel)] bg-surface-muted border border-border-default space-y-2"
          >
            <div className="flex items-center justify-between">
              <strong className="text-sm font-semibold text-ink">{c.name}</strong>
              <span
                className={`text-sm font-semibold ${
                  c.status === 'ready' ? 'text-success-fg' : 'text-warning-fg'
                }`}
              >
                {c.status === 'ready' ? '就绪可用' : '待配置'}
              </span>
            </div>
            <p className="text-sm text-muted leading-relaxed">{c.message}</p>
            <small className="block text-xs text-fg-subtle">
              {c.capabilities.join(' · ') || '未声明能力'}
            </small>
          </div>
        ))}
      </div>

      {/* Akasha MCP Research Section */}
      <div className="p-6 rounded-[var(--radius-panel)] bg-surface-muted border border-border-default space-y-4">
        <div>
          <h3 className="tpl-section-title">虚空终端检索</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            不会自动触发网络请求。仅在点击搜索、读取或收藏时按需访问 MCP。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Select
            value={world}
            onChange={(e) => {
              // pathHash 按世界隔离；切换世界必须清空旧结果，否则会用
              // 旧世界的 pathHash 配新世界的 world 读取或导入错误数据。
              setWorld(e.target.value as typeof world);
              setRemoteResults([]);
              setRemoteDoc(null);
            }}
            className="sm:w-44 bg-surface text-sm h-10"
          >
            <option value="gi">原神 (Genshin)</option>
            <option value="hsr">星穹铁道 (HSR)</option>
            <option value="bh3">崩坏3 (Honkai 3)</option>
          </Select>

          <Input
            aria-label="虚空终端检索关键词"
            value={mcpQuery}
            onChange={(e) => setMcpQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchRemote()}
            placeholder="输入角色、任务、地点或剧情台词关键词…"
            className="flex-1 bg-surface text-sm"
          />

          <Button
            variant="primary"
            disabled={busy || !mcpQuery.trim()}
            loading={busy}
            onClick={handleSearchRemote}
          >
            <Search className="h-3.5 w-3.5" />
            <span>检索</span>
          </Button>
        </div>

        {/* Remote Results */}
        {remoteResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {remoteResults.map((r) => (
              <div
                key={r.pathHash}
                className="space-y-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface p-4"
              >
                <div className="flex items-center justify-between text-sm">
                  <span
                    className={`px-2 py-0.5 rounded font-semibold ${
                      r.sourceTier === 'primary'
                        ? 'bg-success-bg text-success-fg'
                        : 'bg-warning-bg text-warning-fg'
                    }`}
                  >
                    {r.sourceTier === 'primary' ? '原始任务资料' : '二级整理'}
                  </span>
                  <span className="text-muted">{r.totalLines} 行</span>
                </div>

                <h4 className="text-lg font-medium text-ink truncate">
                  {r.fileName}
                </h4>
                <p className="text-sm text-muted line-clamp-2">
                  {r.hits[0]?.snippet || '无命中摘要'}
                </p>

                <div className="flex gap-2 border-t border-border-subtle pt-2">
                  <Button size="sm" variant="outline" onClick={() => handleReadRemote(r)}>
                    读取原文
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => handlePreviewRemote(r)}>
                    预览并导入
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {remoteDoc && (
          <div className="space-y-2 rounded-[var(--radius-control)] bg-surface-dark p-4 text-[#dae2de]">
            <div className="flex justify-between text-sm">
              <strong>{remoteDoc.fileName}</strong>
              <span>
                {remoteDoc.lineRange} / 共 {remoteDoc.totalLines} 行
              </span>
            </div>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-black/25 p-3 font-mono text-sm">
              {remoteDoc.content}
            </pre>
          </div>
        )}
      </div>

      {/* JSON Import Workbench */}
      {/* 专用深色代码面板（§8.9）：仅 JSON 原文查看使用深色，正文与表单沿用全站主题。 */}
      <div className="space-y-4 rounded-[var(--radius-panel)] bg-surface-dark p-5 text-[#dae2de]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            规范化剧情 JSON 工作台
          </span>
          <Button variant="accent" size="sm" onClick={handleValidateJson} loading={busy}>
            校验并预览
          </Button>
        </div>

        <Textarea
          aria-label="规范化剧情 JSON"
          rows={12}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setPreview(null);
          }}
          className="w-full rounded bg-black/25 p-4 font-mono text-sm leading-relaxed text-[#dae2de] border border-white/10 outline-none"
          spellCheck={false}
        />

        {preview && (
          <div className="flex flex-col items-start justify-between gap-4 rounded bg-surface p-4 text-ink sm:flex-row sm:items-center">
            <div>
              <strong className="text-lg block">
                {preview.report.workExists ? '增量更新现有作品' : '全新作品导入'}
              </strong>
              <p className="text-sm text-muted mt-0.5">{preview.report.note}</p>
            </div>

            <Button variant="primary" size="md" onClick={handleCommit} loading={busy}>
              确认写入本地档案
            </Button>
          </div>
        )}
      </div>
      </PageContainer>
    </div>
  );
}
