'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface Work { id: string; title: string; description: string; locale: string; sourceName: string; nodeCount: number }
interface StoryNode { id: string; parentId: string | null; kind: string; title: string; sortOrder: number; summary: string }
interface Scene { id: string; title: string; summary: string; sortOrder: number; utterances: Array<{ id: string; kind: string; speaker: string | null; text: string; condition: string | null }> }
interface Reading { node: { id: string; workId: string; title: string; summary: string }; scenes: Scene[] }
interface Connector { id: string; name: string; kind: string; status: string; message: string; capabilities: string[] }
interface RemoteResult { fileName: string; pathHash: string; totalLines: number; hits: Array<{ line: number; snippet: string }>; tags: Record<string, string>; sourceTier: 'primary' | 'secondary' }
interface RemoteDocument { fileName: string; pathHash: string; totalLines: number; content: string; lineRange: string; remainingCharacters: number }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/narrative${url}`, { cache: 'no-store', ...init, headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers });
  const body = await response.json() as T & { message?: string; error?: string; details?: string[] };
  if (!response.ok) throw new Error(body.details?.join('；') ?? body.message ?? body.error ?? '请求失败');
  return body;
}

const sample = JSON.stringify({
  schemaVersion: 1,
  source: { id: 'local-demo', name: '本地示例', kind: 'json', version: '1' },
  work: { externalId: 'first-work', title: '第一部作品', description: '从一条完整任务链开始。', locale: 'zh-CN' },
  release: { externalId: 'v1', label: '第一版' },
  nodes: [{ externalId: 'chapter-1', kind: 'chapter', title: '序章', order: 1 }, { externalId: 'quest-1', parentExternalId: 'chapter-1', kind: 'quest', title: '雨夜来信', order: 1 }],
  scenes: [{ externalId: 'station', nodeExternalId: 'quest-1', title: '末班车站', order: 1 }],
  utterances: [{ externalId: 'line-1', sceneExternalId: 'station', order: 1, kind: 'narration', text: '雨落在空无一人的站台。' }, { externalId: 'line-2', sceneExternalId: 'station', order: 2, kind: 'dialogue', speaker: '林', text: '这封信，为什么偏偏在今天寄到？' }],
  entities: [{ externalId: 'lin', type: 'character', name: '林', aliases: [], description: '在雨夜收到来信的人。' }],
}, null, 2);

export function NarrativeClient() {
  const [works, setWorks] = useState<Work[]>([]); const [workId, setWorkId] = useState('');
  const [nodes, setNodes] = useState<StoryNode[]>([]); const [nodeId, setNodeId] = useState(''); const [reading, setReading] = useState<Reading | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]); const [mode, setMode] = useState<'read' | 'import'>('read');
  const [importText, setImportText] = useState(sample); const [preview, setPreview] = useState<{ id: string; report: { incoming: Record<string, number>; existing: Record<string, number>; workExists: boolean; note: string } } | null>(null);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<Array<{ kind: string; refId: string; title: string; excerpt: string }>>([]);
  const [mcpWorld, setMcpWorld] = useState<'gi' | 'hsr' | 'bh3'>('gi'); const [mcpQuery, setMcpQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<RemoteResult[]>([]); const [remoteDocument, setRemoteDocument] = useState<RemoteDocument | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function loadWorks() { const body = await api<{ items: Work[] }>('/works'); setWorks(body.items); setWorkId((current) => current || body.items[0]?.id || ''); }

  useEffect(() => { Promise.all([api<{ items: Work[] }>('/works'), api<{ items: Connector[] }>('/connectors')]).then(([workBody, connectorBody]) => { setWorks(workBody.items); setWorkId(workBody.items[0]?.id ?? ''); setConnectors(connectorBody.items); }).catch((cause: unknown) => setError(String(cause))); }, []);
  useEffect(() => { if (!workId) return; api<{ items: StoryNode[] }>(`/works/${workId}/tree`).then((body) => { setNodes(body.items); setNodeId((current) => body.items.some((item) => item.id === current) ? current : body.items.find((item) => item.kind !== 'chapter')?.id ?? body.items[0]?.id ?? ''); }).catch((cause: unknown) => setError(String(cause))); }, [workId]);
  useEffect(() => { if (!nodeId) return; api<Reading>(`/nodes/${nodeId}/read`).then(setReading).catch((cause: unknown) => setError(String(cause))); }, [nodeId]);
  useEffect(() => { const timer = setTimeout(() => { if (!query.trim()) { setResults([]); return; } api<{ items: typeof results }>(`/search?q=${encodeURIComponent(query)}${workId ? `&workId=${workId}` : ''}`).then((body) => setResults(body.items)).catch(() => setResults([])); }, 260); return () => clearTimeout(timer); }, [query, workId]);

  const depth = useMemo(() => { const byId = new Map(nodes.map((node) => [node.id, node])); return (node: StoryNode) => { let value = 0; let parent = node.parentId; while (parent && value < 8) { value += 1; parent = byId.get(parent)?.parentId ?? null; } return value; }; }, [nodes]);
  async function makePreview() { setBusy(true); setError(''); try { setPreview(await api('/imports/preview', { method: 'POST', body: JSON.stringify(JSON.parse(importText)) })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  async function commit() { if (!preview) return; setBusy(true); setError(''); try { const result = await api<{ workId: string }>(`/imports/${preview.id}/commit`, { method: 'POST' }); setPreview(null); await loadWorks(); setWorkId(result.workId); setMode('read'); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  function readFile(file?: File) { if (!file) return; file.text().then((text) => { setImportText(text); setPreview(null); }); }
  async function saveToNotebook(utteranceId: string) { try { const result = await api<{ href: string }>(`/utterances/${utteranceId}/to-note`, { method: 'POST' }); window.location.assign(result.href); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  async function searchRemote() { if (!mcpQuery.trim()) return; setBusy(true); setError(''); setRemoteDocument(null); try { const body = await api<{ items: RemoteResult[] }>('/connectors/akasha-mcp/search', { method: 'POST', body: JSON.stringify({ world: mcpWorld, keyword: mcpQuery.trim(), maxResults: 10 }) }); setRemoteResults(body.items); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  async function readRemote(result: RemoteResult) { setBusy(true); setError(''); try { setRemoteDocument(await api('/connectors/akasha-mcp/read', { method: 'POST', body: JSON.stringify({ world: mcpWorld, pathHash: result.pathHash, limit: 80 }) })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  async function previewRemoteImport(result: RemoteResult) { setBusy(true); setError(''); try { setPreview(await api('/connectors/akasha-mcp/imports/preview', { method: 'POST', body: JSON.stringify({ world: mcpWorld, pathHash: result.pathHash, title: result.fileName }) })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }

  return <main className="narrative-shell">
    <header className="narrative-header"><Link href="/" className="narrative-brand"><span>叙</span><strong>叙事档案</strong></Link><div><button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>阅读</button><button className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}>数据源与导入</button></div></header>
    {error && <div className="narrative-alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {mode === 'import' ? <section className="narrative-import">
      <div className="import-heading"><div><p className="eyebrow">SOURCE CONNECTORS</p><h1>把来源变成可追溯的档案。</h1></div><p>MCP 和文件只是数据来源。确认差异后，剧情会保存成本地版本，不依赖来源持续在线。</p></div>
      <div className="connector-grid">{connectors.map((connector) => <article key={connector.id}><div><strong>{connector.name}</strong><span className={`connector-status status-${connector.status}`}>{connector.status === 'ready' ? '可用' : '待配置'}</span></div><p>{connector.message}</p><small>{connector.capabilities.length ? connector.capabilities.join(' · ') : '尚未取得工具协议'}</small></article>)}</div>
      <section className="mcp-research"><div className="mcp-research-heading"><div><p className="eyebrow">ONLINE RESEARCH · MANUAL ONLY</p><h2>虚空终端检索</h2></div><p>这里不会自动请求或同步。只有点击搜索、读取或收藏时才访问 MCP。</p></div>
        <div className="mcp-search-bar"><select aria-label="检索作品" value={mcpWorld} onChange={(event) => setMcpWorld(event.target.value as typeof mcpWorld)}><option value="gi">原神</option><option value="hsr">崩坏：星穹铁道</option><option value="bh3">崩坏3</option></select><input value={mcpQuery} onChange={(event) => setMcpQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchRemote(); }} placeholder="输入角色、任务、地点或台词关键词"/><button disabled={busy || !mcpQuery.trim()} onClick={() => void searchRemote()}>{busy ? '请求中…' : '主动搜索'}</button></div>
        {remoteResults.length > 0 && <div className="remote-results">{remoteResults.map((result) => <article key={result.pathHash}><div><span className={`source-tier tier-${result.sourceTier}`}>{result.sourceTier === 'primary' ? '原始资料' : '二级整理'}</span><small>{result.totalLines} 行 · {result.pathHash}</small></div><h3>{result.fileName}</h3><p>{result.hits[0]?.snippet || '没有返回命中摘要。'}</p><div><button disabled={busy} onClick={() => void readRemote(result)}>读取原文</button><button disabled={busy} onClick={() => void previewRemoteImport(result)}>收藏并预览差异</button></div></article>)}</div>}
        {remoteDocument && <article className="remote-document"><div><strong>{remoteDocument.fileName}</strong><small>{remoteDocument.lineRange} / 共 {remoteDocument.totalLines} 行</small></div><pre>{remoteDocument.content}</pre>{remoteDocument.remainingCharacters > 0 && <p>当前仅为前 80 行预览；收藏时会自动分页读取完整文档。</p>}</article>}
      </section>
      <div className="import-workbench"><div className="import-toolbar"><label>选择 JSON 文件<input type="file" accept="application/json,.json" onChange={(event) => readFile(event.target.files?.[0])}/></label><button disabled={busy} onClick={makePreview}>{busy ? '校验中…' : '校验并预览'}</button></div><textarea aria-label="规范化 JSON" value={importText} onChange={(event) => { setImportText(event.target.value); setPreview(null); }} spellCheck={false}/>
        {preview && <div className="import-preview"><div><strong>{preview.report.workExists ? '增量更新预览' : '新作品导入预览'}</strong><p>{preview.report.note}</p></div><dl>{Object.entries(preview.report.incoming).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}<small>现有 {preview.report.existing[key]}</small></dd></div>)}</dl><button disabled={busy} onClick={commit}>{busy ? '写入中…' : '确认写入本地档案'}</button></div>}
      </div>
    </section> : <div className="narrative-workspace">
      <aside className="narrative-tree"><div className="work-picker"><label>当前作品</label><select value={workId} onChange={(event) => setWorkId(event.target.value)}><option value="">尚未导入作品</option>{works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}</select></div><nav>{nodes.map((node) => <button className={node.id === nodeId ? 'active' : ''} style={{ paddingLeft: 16 + depth(node) * 16 }} key={node.id} onClick={() => setNodeId(node.id)}><small>{node.kind}</small><span>{node.title}</span></button>)}</nav><button className="tree-import" onClick={() => setMode('import')}>＋ 导入一条任务链</button></aside>
      <article className="narrative-reader">{reading ? <><header><p className="eyebrow">CONTINUOUS READING</p><h1>{reading.node.title}</h1>{reading.node.summary && <p>{reading.node.summary}</p>}</header>{reading.scenes.map((scene, index) => <section className="story-scene" key={scene.id}><div className="scene-heading"><span>{String(index + 1).padStart(2, '0')}</span><div><small>SCENE</small><h2>{scene.title || `场景 ${index + 1}`}</h2></div></div>{scene.summary && <p className="scene-summary">{scene.summary}</p>}<div className="utterance-list">{scene.utterances.map((line) => <div className={`utterance utterance-${line.kind}`} key={line.id}>{line.speaker && <strong>{line.speaker}</strong>}<p>{line.text}</p>{line.condition && <small>条件：{line.condition}</small>}<button className="quote-to-note" onClick={() => void saveToNotebook(line.id)}>存入创作笔记</button></div>)}</div></section>)}</> : <div className="narrative-empty"><span>⌁</span><h1>档案仍是空的</h1><p>从一份规范化 JSON 或数据源连接器导入完整任务链。</p><button onClick={() => setMode('import')}>打开导入工作台</button></div>}</article>
      <aside className="narrative-inspector"><label className="archive-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前作品原文"/></label>{query ? <div className="search-results"><small>SEARCH RESULTS · {results.length}</small>{results.map((result) => <button key={`${result.kind}-${result.refId}`}><strong>{result.title || result.kind}</strong><span>{result.excerpt.replace(/<\/?mark>/g, '')}</span></button>)}</div> : <><p className="eyebrow">CONTEXT</p><h2>研究侧栏</h2><p>实体、事件和已确认结论将在这里随当前场景联动。首个切片先确保原文结构与出处稳定。</p><div className="context-rule"><span>原始资料</span><strong>只读</strong></div><div className="context-rule"><span>AI 提取</span><strong>需确认</strong></div><div className="context-rule"><span>笔记引用</span><strong>保留快照</strong></div></>}</aside>
    </div>}
  </main>;
}
