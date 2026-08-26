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
    if (!preview) return;
    setBusy(true);
    try {
      const res = await commitNarrativeImport(preview.id);
      toast.success('已成功写入本地叙事档案');
      await onImportComplete(res.workId);
    } catch (e) {
      toast.error('写入失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSearchRemote = async () => {
    if (!mcpQuery.trim()) return;
    setBusy(true);
    try {
      const res = await searchRemoteMcp({
        world,
        keyword: mcpQuery.trim(),
        maxResults: 10,
      });
      setRemoteResults(res.items);
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
    <div className="flex-1 bg-[#ece8df] p-6 sm:p-12 space-y-8 overflow-y-auto">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a6a35]">
          SOURCE CONNECTORS
        </span>
        <h2 className="font-serif text-3xl sm:text-4xl font-medium text-[#202631] mt-1">
          把来源变成可追溯的本地档案
        </h2>
        <p className="text-xs text-[#6e737a] leading-relaxed max-w-2xl mt-1">
          MCP 与文件均为上游数据来源。确认差异后，剧情将永久固化为本地版本，不依赖外部服务器持续在线。
        </p>
      </div>

      {/* Connectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {connectors.map((c) => (
          <div
            key={c.id}
            className="p-5 rounded-[4px_18px_4px_4px] bg-[#f8f4ec] border border-[rgb(32_38_49/14%)] space-y-2"
          >
            <div className="flex items-center justify-between">
              <strong className="text-sm font-semibold text-[#202631]">{c.name}</strong>
              <span
                className={`text-[11px] font-semibold ${
                  c.status === 'ready' ? 'text-[#487157]' : 'text-[#a06736]'
                }`}
              >
                {c.status === 'ready' ? '就绪可用' : '待配置'}
              </span>
            </div>
            <p className="text-xs text-[#6e737a] leading-relaxed">{c.message}</p>
            <small className="text-[10px] text-[#8a6a35] block">
              {c.capabilities.join(' · ') || '未声明能力'}
            </small>
          </div>
        ))}
      </div>

      {/* Akasha MCP Research Section */}
      <div className="p-6 rounded-[4px_22px_4px_4px] bg-[#f8f4ec] border border-[rgb(32_38_49/16%)] space-y-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a6a35]">
            ONLINE RESEARCH · MANUAL ONLY
          </span>
          <h3 className="font-serif text-2xl font-medium text-[#202631] mt-0.5">虚空终端检索</h3>
          <p className="text-xs text-[#74787e] leading-relaxed">
            不会自动触发网络请求。仅在点击搜索、读取或收藏时按需访问 MCP。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Select
            value={world}
            onChange={(e) => setWorld(e.target.value as typeof world)}
            className="sm:w-44 bg-[#fffdf7] text-xs h-10"
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
            className="flex-1 bg-[#fffdf7] text-xs"
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
                className="p-4 rounded border border-[rgb(32_38_49/12%)] bg-[#fffdf7] space-y-2"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span
                    className={`px-2 py-0.5 rounded font-semibold ${
                      r.sourceTier === 'primary'
                        ? 'bg-[#dce9df] text-[#487157]'
                        : 'bg-[#eee0c9] text-[#906733]'
                    }`}
                  >
                    {r.sourceTier === 'primary' ? '原始任务资料' : '二级整理'}
                  </span>
                  <span className="text-[#68716d]">{r.totalLines} 行</span>
                </div>

                <h4 className="font-serif text-lg font-medium text-[#202631] truncate">
                  {r.fileName}
                </h4>
                <p className="text-xs text-[#6d7278] line-clamp-2">
                  {r.hits[0]?.snippet || '无命中摘要'}
                </p>

                <div className="flex gap-2 pt-2 border-t border-[rgb(32_38_49/8%)]">
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
          <div className="p-4 rounded bg-[#202631] text-[#e8e2d7] space-y-2">
            <div className="flex justify-between text-xs">
              <strong>{remoteDoc.fileName}</strong>
              <span>
                {remoteDoc.lineRange} / 共 {remoteDoc.totalLines} 行
              </span>
            </div>
            <pre className="p-3 bg-[#171c24] rounded font-mono text-xs max-h-60 overflow-y-auto whitespace-pre-wrap">
              {remoteDoc.content}
            </pre>
          </div>
        )}
      </div>

      {/* JSON Import Workbench */}
      <div className="p-6 rounded-[4px_22px_4px_4px] bg-[#202631] text-[#e7e1d5] space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#c49a54]">
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
          className="w-full rounded bg-[#171c24] p-4 text-xs font-mono text-[#d6deca] border border-white/10 outline-none leading-relaxed"
          spellCheck={false}
        />

        {preview && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded bg-[#f8f4ec] text-[#202631]">
            <div>
              <strong className="font-serif text-lg block">
                {preview.report.workExists ? '增量更新现有作品' : '全新作品导入'}
              </strong>
              <p className="text-xs text-[#73777c] mt-0.5">{preview.report.note}</p>
            </div>

            <Button variant="primary" size="md" onClick={handleCommit} loading={busy}>
              确认写入本地档案
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
