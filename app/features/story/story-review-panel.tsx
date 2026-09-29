'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, FileClock, KeyRound, Plus, X } from 'lucide-react';
import type { StoryCharacter, StoryDocument, StoryEntry, StoryProposal, StoryProposalKind } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Drawer } from '@/app/components/ui/drawer';
import { StoryMarkdown } from './story-markdown';
import { storyApi } from './api';

type EntryRow = { kind: 'document'; item: StoryDocument } | { kind: 'character'; item: StoryCharacter };
type PanelTab = 'proposals' | 'revisions' | 'dsh' | 'archive';
const kindName: Record<StoryProposalKind | 'character', string> = {
  outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色',
};
const titleOf = (entry: StoryEntry) => 'name' in entry ? entry.name : entry.title;

function lineDiff(before: string, after: string) {
  const left = before.split('\n'); const right = after.split('\n');
  if (left.length > 300 || right.length > 300) return null;
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    rows[i]![j] = left[i] === right[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
  }
  const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
  let i = 0; let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ type: 'same', text: left[i]! });
      i++; j++;
    } else if (j < right.length && (i === left.length || rows[i]![j + 1]! >= rows[i + 1]![j]!)) {
      result.push({ type: 'add', text: right[j]! });
      j++;
    } else {
      result.push({ type: 'remove', text: left[i]! });
      i++;
    }
  }
  return result;
}

function ReadOnlyArchive({ projectId }: { projectId: string }) {
  const sessions = useQuery({ queryKey: ['story', projectId, 'archive-sessions'], queryFn: () => storyApi.listSessions(projectId) });
  const [sessionId, setSessionId] = useState('');
  const selected = sessions.data?.items.find((item) => item.id === sessionId) ?? sessions.data?.items[0];
  const messages = useQuery({ queryKey: ['story', projectId, 'archive-messages', selected?.id],
    queryFn: () => storyApi.listMessages(projectId, selected!.id), enabled: Boolean(selected) });
  return <section className="space-y-3">
    <p className="rounded-[var(--radius-control)] bg-surface-muted p-3 text-sm text-muted">这是 SthStart 旧版内置会话的只读归档，不是 DSH 原生会话；不能继续发送、压缩或补看当时的工具轨迹。</p>
    {sessions.isLoading && <p className="text-sm text-muted">正在读取归档…</p>}
    <label className="block text-sm">旧会话<select className="mt-1 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 py-2" value={selected?.id ?? ''} onChange={(event) => setSessionId(event.target.value)}>
      {(sessions.data?.items ?? []).map((session) => <option key={session.id} value={session.id}>{session.title} · {new Date(session.updatedAt).toLocaleString('zh-CN')}</option>)}
    </select></label>
    <div className="max-h-[60dvh] space-y-3 overflow-y-auto pr-1">
      {messages.data?.items.map((message) => <article key={message.id} className="rounded-[var(--radius-panel)] border border-border-default p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted"><b>{message.role === 'user' ? '用户' : 'AI'}</b><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></div>
        <StoryMarkdown source={message.content} />
      </article>)}
      {selected && messages.data?.items.length === 0 && <p className="text-sm text-muted">此会话没有可显示的消息。</p>}
    </div>
  </section>;
}

export function StoryReviewPanel({ open, onOpenChange, projectId, entries, activeEntry, flushEditor, onRefreshEntry, tab, onTabChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string; entries: EntryRow[];
  activeEntry: StoryEntry | null; flushEditor: () => Promise<boolean>; onRefreshEntry: () => Promise<void>;
  tab: PanelTab; onTabChange: (tab: PanelTab) => void;
}) {
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const proposals = useQuery({ queryKey: ['story', projectId, 'proposals'], queryFn: () => storyApi.listProposals(projectId), enabled: open, refetchInterval: open ? 20_000 : false });
  const kind = activeEntry ? ('name' in activeEntry ? 'character' : activeEntry.kind) : null;
  const revisions = useQuery({ queryKey: ['story', projectId, 'revisions', kind, activeEntry?.id],
    queryFn: () => storyApi.listRevisions(projectId, kind!, activeEntry!.id), enabled: open && tab === 'revisions' && Boolean(activeEntry && kind) });
  const bridge = useQuery({ queryKey: ['story', projectId, 'bridge-status'], queryFn: () => storyApi.bridgeStatus(projectId), enabled: open, refetchInterval: open ? 15_000 : false });
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  const localPortal = typeof window !== 'undefined' ? `${window.location.protocol}//127.0.0.1:${window.location.port || '9320'}` : 'http://127.0.0.1:9320';

  const invalidate = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['story', projectId, 'proposals'] }),
    client.invalidateQueries({ queryKey: ['story', projectId, 'documents'] }),
    client.invalidateQueries({ queryKey: ['story', projectId, 'characters'] }),
    client.invalidateQueries({ queryKey: ['story', projectId, 'project'] }),
  ]);

  const decide = async (proposal: StoryProposal, decision: 'accepted' | 'rejected') => {
    if (!await flushEditor()) { setNotice('当前正文尚未成功保存。先解决保存状态，再审阅提案。'); return; }
    if (decision === 'accepted' && !window.confirm(`确认接受提案并写入正式${kindName[proposal.kind]}资料？这会创建新的不可变版本。`)) return;
    try {
      await storyApi.decideProposal(projectId, proposal.id, decision);
      await invalidate();
      await onRefreshEntry();
      setNotice(decision === 'accepted' ? '提案已接受，正式资料与版本记录已更新。' : '提案已拒绝；正式资料未修改。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '提案处理失败。正式资料未做本地猜测性更新。'); }
  };

  const restore = async (revisionId: string) => {
    if (!activeEntry || !kind) return;
    if (!await flushEditor()) { setNotice('当前正文尚未保存，不能恢复旧版本。'); return; }
    if (!window.confirm('恢复会将历史内容另存为一个新版本，不会改写版本历史。继续？')) return;
    try {
      await storyApi.restoreRevision(projectId, kind, activeEntry.id, revisionId, activeEntry.revision);
      await onRefreshEntry();
      await client.invalidateQueries({ queryKey: ['story', projectId, 'revisions', kind, activeEntry.id] });
      setNotice('已恢复为新版本。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '版本恢复失败。'); }
  };

  const generateGrant = async () => {
    setGrantBusy(true); setNotice('');
    try {
      const result = await storyApi.createBridgeGrant(projectId);
      setOneTimeToken(result.token);
      await client.invalidateQueries({ queryKey: ['story', projectId, 'bridge-status'] });
      setNotice('一次性 Token 只显示在此处；请立即复制并粘贴到本机启动器的安全输入提示中。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '生成桥接凭据失败。'); }
    finally { setGrantBusy(false); }
  };
  const revokeGrant = async () => {
    if (!window.confirm('撤销后当前 DSH 启动器的桥接会立即失效。确定撤销？')) return;
    try { await storyApi.revokeBridgeGrant(projectId); setOneTimeToken(''); await client.invalidateQueries({ queryKey: ['story', projectId, 'bridge-status'] }); setNotice('项目桥接已撤销。'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : '撤销失败。'); }
  };

  return <Drawer open={open} onOpenChange={onOpenChange} title="审阅与项目连接" description="正式资料仍只由本工作台保存或在接受提案后更新。">
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-surface-muted p-1 sm:grid-cols-4">
      {([['proposals', '提案'], ['revisions', '版本'], ['dsh', 'DSH 连接'], ['archive', '旧会话']] as const).map(([key, label]) => <button key={key} onClick={() => onTabChange(key)} className={`rounded-[var(--radius-control)] px-2 py-2 text-sm ${tab === key ? 'bg-surface font-semibold text-accent shadow-sm' : 'text-muted hover:bg-surface-hover'}`}>{label}</button>)}
    </div>
    {notice && <div role="status" className="mb-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-border-default bg-surface-muted p-3 text-sm"><span className="min-w-0 flex-1">{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X className="size-4" /></button></div>}

    {tab === 'proposals' && <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">待审阅提案</h3><span className="text-xs text-muted">{proposals.data?.items.filter((item) => item.status === 'pending').length ?? 0} 项待审</span></div>
      {proposals.isLoading && <p className="text-sm text-muted">正在读取提案…</p>}
      {proposals.data?.items.length === 0 && <p className="rounded-[var(--radius-panel)] border border-dashed border-border-default p-6 text-center text-sm text-muted">暂无提案。DSH 只能提交建议，接受后才会改动正式资料。</p>}
      {proposals.data?.items.map((proposal) => {
        const targetRow = entries.find((entry) => entry.item.id === proposal.targetId);
        const target = targetRow ? targetRow.item : null;
        const current = target ? ('name' in target ? target.notes : target.body) : '';
        const stale = proposal.operation === 'update' && (!target || target.revision !== proposal.baseRevision);
        const diff = target ? lineDiff(current, proposal.proposedBody) : null;
        return <article key={proposal.id} className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">{proposal.operation === 'create' ? '新建' : '更新'} · {kindName[proposal.kind]}</span><span className="text-xs text-muted">{proposal.origin === 'native_dsh' ? 'DSH 原生会话' : proposal.origin === 'legacy' ? '旧版内置会话' : '未知来源'}</span><span className="ml-auto text-xs text-muted">{new Date(proposal.createdAt).toLocaleString('zh-CN')}</span></div>
          <h4 className="mt-3 font-semibold">{proposal.proposedTitle}</h4>
          <p className="mt-1 text-sm text-muted">{proposal.operation === 'create' ? '将创建新的正式资料。' : `目标：${target ? titleOf(target) : '条目不存在'} · 基于 v${proposal.baseRevision ?? '—'}${target ? ` / 当前 v${target.revision}` : ''}`}</p>
          {stale && proposal.status === 'pending' && <p role="alert" className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">基准版本已变化或目标已删除。此提案保持待审，不能覆盖当前正式内容。</p>}
          <p className="mt-2 whitespace-pre-wrap text-sm">理由：{proposal.reason || '未提供'}</p>
          <details className="mt-3 rounded-[var(--radius-control)] border border-border-default p-3">
            <summary className="cursor-pointer text-sm font-medium">查看逐行差异与完整预览</summary>
            {proposal.operation === 'update' && target && <div className="mt-3">
              {diff ? <pre className="max-h-72 overflow-auto rounded bg-surface-muted p-3 font-mono text-xs leading-5">{diff.map((line, index) => <div key={`${index}-${line.type}`} className={line.type === 'add' ? 'bg-emerald-100 text-emerald-900' : line.type === 'remove' ? 'bg-rose-100 text-rose-900' : 'text-muted'}>{line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}{line.text || ' '}</div>)}</pre> : <p className="text-xs text-muted">条目超过 300 行，出于浏览器性能考虑请使用下面的完整对照预览。</p>}
            </div>}
            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
              {proposal.operation === 'update' && target && <div className="min-w-0 rounded border border-border-default p-3"><b className="text-xs text-muted">当前正式内容</b><h5 className="my-2 font-semibold">{titleOf(target)}</h5><div className="max-h-72 overflow-y-auto"><StoryMarkdown source={current} /></div></div>}
              <div className="min-w-0 rounded border border-accent/30 bg-accent/5 p-3"><b className="text-xs text-accent">提议内容 · 尚未写入正式资料</b><h5 className="my-2 font-semibold">{proposal.proposedTitle}</h5><div className="max-h-72 overflow-y-auto"><StoryMarkdown source={proposal.proposedBody} /></div></div>
            </div>
          </details>
          {proposal.status === 'pending' ? <div className="mt-3 flex gap-2"><Button size="sm" disabled={stale} onClick={() => void decide(proposal, 'accepted')}><Check className="size-4" /> 接受并保存</Button><Button size="sm" variant="outline" onClick={() => void decide(proposal, 'rejected')}>拒绝</Button></div>
            : <p className="mt-3 text-sm text-muted">已{proposal.status === 'accepted' ? '接受' : '拒绝'} · {proposal.decidedAt ? new Date(proposal.decidedAt).toLocaleString('zh-CN') : ''}</p>}
        </article>;
      })}
    </section>}

    {tab === 'revisions' && <section className="space-y-3">
      <h3 className="font-semibold">{activeEntry ? `${titleOf(activeEntry)} · 修订历史` : '修订历史'}</h3>
      {!activeEntry && <p className="text-sm text-muted">先在资料树中选择一条正式资料。</p>}
      {revisions.data?.items.map((revision) => {
        const snapshotTitle = revision.snapshot.kind === 'character' ? revision.snapshot.name : revision.snapshot.title;
        const snapshotBody = revision.snapshot.kind === 'character' ? revision.snapshot.notes : revision.snapshot.body;
        const sourceName = revision.source === 'baseline' ? '迁移时当前内容' : revision.source === 'manual' ? '手动保存' : revision.source === 'proposal' ? '接受提案' : '恢复历史版本';
        return <article key={revision.id} className="rounded-[var(--radius-panel)] border border-border-default p-3">
          <div className="flex items-center gap-2"><FileClock className="size-4 text-accent" /><b>v{revision.revision}</b><span className="text-xs text-muted">{sourceName} · {new Date(revision.createdAt).toLocaleString('zh-CN')}</span></div>
          <details className="mt-2"><summary className="cursor-pointer text-sm">查看此版本</summary><h4 className="mt-2 font-semibold">{snapshotTitle}</h4><div className="max-h-56 overflow-y-auto"><StoryMarkdown source={snapshotBody} /></div></details>
          {activeEntry && revision.revision !== activeEntry.revision && <Button size="sm" variant="outline" className="mt-3" onClick={() => void restore(revision.id)}>恢复为新版本</Button>}
        </article>;
      })}
    </section>}

    {tab === 'dsh' && <section className="space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">原生 DSH Web</h3><p className="mt-1 text-sm text-muted">对话、流式 Markdown、模型选择与轨迹由 DSH 原生页面提供。</p></div><span className={`rounded-full px-2 py-1 text-xs ${bridge.data?.running ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-muted text-muted'}`}>{bridge.data?.running ? '运行中' : bridge.data?.paired ? '已配对 · 离线' : '未配对'}</span></div>
        {isLocalHost ? <a className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border-default px-3 py-2 text-sm font-medium hover:bg-surface-hover" href="http://127.0.0.1:3081" target="_blank" rel="noreferrer noopener">打开本机 DSH <ExternalLink className="size-4" /></a>
          : <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">DSH 只运行在启动器所在电脑。本页面来自局域网地址，不能提供当前设备可用的 DSH 链接。</p>}
        <p className="mt-3 text-xs text-muted">桥接：{bridge.data?.paired ? `已配对 · 最近使用 ${bridge.data.lastUsedAt ? new Date(bridge.data.lastUsedAt).toLocaleString('zh-CN') : '暂无'}` : '尚未配对'}{bridge.data?.lastHeartbeatAt ? ` · 心跳 ${new Date(bridge.data.lastHeartbeatAt).toLocaleTimeString('zh-CN')}` : ''}</p>
      </div>
      <div className="rounded-[var(--radius-panel)] border border-border-default p-4">
        <div className="flex items-center gap-2"><KeyRound className="size-4 text-accent" /><h3 className="font-semibold">项目配对与启动</h3></div>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm"><li>在本页生成一次性 Token，并复制。</li><li>在本机 PowerShell 执行下方启动命令；首次配对加入 <code>-Pair</code>。</li><li>启动器提示输入时粘贴 Token。Token 会使用当前 Windows 用户 DPAPI 加密保存，不出现在启动参数中。</li><li>DSH 首次启动后，在 DSH 自己的设置页配置模型与密钥。此配置不写入 SthStart。</li><li>完成配对后，可在“控制中心 → 剧情 DSH”一键启动并查看心跳状态。</li></ol>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs">{`Set-ExecutionPolicy -Scope Process Bypass; & ${"'F:\\Project\\SthStart\\scripts\\story-dsh\\start.ps1'"} -ProjectId '${projectId.replaceAll("'", "''")}' -PortalUrl '${localPortal.replaceAll("'", "''")}' -Pair`}</pre>
        <p className="mt-2 text-xs text-muted">以后启动可去掉 <code>-Pair</code>。端口 3081 已占用时启动器会停止并提示，不会终止占用进程；每个项目使用独立工作目录。项目间切换前先退出当前 DSH。</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={grantBusy} onClick={() => void generateGrant()}><Plus className="size-4" />{bridge.data?.paired ? '重新生成 Token' : '生成一次性 Token'}</Button>{bridge.data?.paired && <Button size="sm" variant="outline" onClick={() => void revokeGrant()}>撤销桥接</Button>}</div>
        {oneTimeToken && <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3"><label className="block text-xs font-semibold text-amber-950">一次性 Token（关闭页面或重新生成后不再显示）<Input readOnly value={oneTimeToken} className="mt-2 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} /></label><Button size="sm" variant="outline" className="mt-2" onClick={() => void navigator.clipboard.writeText(oneTimeToken).then(() => setNotice('Token 已复制。')).catch(() => setNotice('浏览器未授权剪贴板，请在上方文本框中手动复制。'))}><Copy className="size-4" />复制 Token</Button><p className="mt-2 text-xs text-amber-950">不要发给其他人或贴入对话；此 Token 只能访问当前项目的只读资料与提案接口。</p></div>}
        <details className="mt-4 rounded-[var(--radius-control)] border border-border-default p-3"><summary className="cursor-pointer text-sm font-medium">桥接权限与备份边界</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted"><li>DSH 可读取正式资料、搜索、提交待审提案与查看提案状态；不能直接保存正式资料。</li><li>撤销或重新生成会立即使旧凭据失效；服务重启后 DSH 显示离线，需由启动器重新发送心跳。</li><li>同一 Windows 用户下这不是操作系统级隔离。DSH 项目工作目录和模型凭据不包含在普通 SthStart 备份中，需单独安全备份。</li></ul></details>
      </div>
    </section>}

    {tab === 'archive' && <ReadOnlyArchive projectId={projectId} />}
  </Drawer>;
}
