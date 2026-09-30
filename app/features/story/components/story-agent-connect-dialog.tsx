'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  FileCheck,
  Code2,
} from 'lucide-react';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { storyApi } from '../api';

interface StoryAgentConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
  onOpenProposals?: () => void;
  pendingProposalsCount?: number;
}

export function StoryAgentConnectDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
  onOpenProposals,
  pendingProposalsCount = 0,
}: StoryAgentConnectDialogProps) {
  const queryClient = useQueryClient();
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string>('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const bridge = useQuery({
    queryKey: ['story', projectId, 'bridge-status'],
    queryFn: () => storyApi.bridgeStatus(projectId),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const portalUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://127.0.0.1:4173';

  const handleGenerateToken = async () => {
    setGrantBusy(true);
    setNotice('');
    try {
      const res = await storyApi.createBridgeGrant(projectId);
      setCreatedToken(res.token);
      await queryClient.invalidateQueries({ queryKey: ['story', projectId, 'bridge-status'] });
      setNotice('已生成新的安全 Bridge 访问令牌。请妥善保存并配置到 Agent 中。');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '生成令牌失败。');
    } finally {
      setGrantBusy(false);
    }
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  const activeToken = createdToken || (bridge.data?.paired ? '••••••••••••••••••••••••••••••••' : '');

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        'sthstart-story': {
          command: 'node',
          args: [
            '--import',
            'tsx/esm',
            'apps/service/src/story/native-mcp-server.ts',
          ],
          cwd: '${workspaceFolder}',
          env: {
            STHSTART_STORY_PORTAL_URL: portalUrl,
            STHSTART_STORY_PROJECT_ID: projectId,
            STHSTART_STORY_BRIDGE_TOKEN: createdToken || '在此填入 Bridge Token',
          },
        },
      },
    },
    null,
    2
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI 协作与 MCP 基础设施向导"
      description="本项目已全面升级为 Model Context Protocol (MCP) 标准接入架构。外部 Agent 可安全读取资料并提交修订提案。"
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-muted">
            {pendingProposalsCount > 0 ? (
              <span className="text-amber-500 font-medium">
                有 {pendingProposalsCount} 条待审提案等待处理
              </span>
            ) : (
              '暂无待审提案'
            )}
          </div>
          <div className="flex items-center gap-2">
            {onOpenProposals && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onOpenProposals();
                }}
              >
                <FileCheck className="size-4" />
                查看待审提案
              </Button>
            )}
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {notice && (
          <div className="rounded-[var(--radius-control)] bg-accent/10 border border-accent/20 px-3 py-2 text-xs text-accent">
            {notice}
          </div>
        )}

        {/* 状态总览卡片 */}
        <div className="rounded-[var(--radius-panel)] border border-border-default bg-surface-muted p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-accent" />
              <h3 className="text-sm font-semibold">Story Bridge 运行状态</h3>
            </div>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                bridge.data?.paired
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : 'bg-zinc-500/10 text-muted border border-border-default'
              }`}
            >
              {bridge.data?.paired ? '已配对就绪' : '待配置令牌'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted">项目名称：</span>
              <span className="font-medium text-foreground">{projectTitle}</span>
            </div>
            <div>
              <span className="text-muted">项目 ID：</span>
              <code className="font-mono text-muted-foreground">{projectId}</code>
            </div>
            <div>
              <span className="text-muted">网关地址：</span>
              <code className="font-mono text-muted-foreground">{portalUrl}</code>
            </div>
            <div>
              <span className="text-muted">最近活动：</span>
              <span className="text-muted-foreground">
                {bridge.data?.lastUsedAt
                  ? new Date(bridge.data.lastUsedAt).toLocaleString('zh-CN')
                  : '尚未连接'}
              </span>
            </div>
          </div>

          {/* 令牌操作 */}
          <div className="pt-2 border-t border-border-default/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted" />
              <span className="text-xs text-muted">访问令牌：</span>
              <code className="font-mono text-xs bg-surface px-2 py-1 rounded border border-border-default max-w-[180px] sm:max-w-xs truncate">
                {activeToken || '暂无可用令牌'}
              </code>
            </div>
            <div className="flex items-center gap-2">
              {createdToken && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(createdToken, 'token')}
                >
                  {copiedType === 'token' ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  复制令牌
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={grantBusy}
                onClick={handleGenerateToken}
              >
                <RefreshCw className={`size-3.5 ${grantBusy ? 'animate-spin' : ''}`} />
                {bridge.data?.paired ? '重新生成令牌' : '生成访问令牌'}
              </Button>
            </div>
          </div>
        </div>

        {/* Antigravity / Cursor / Claude 配置卡片 */}
        <div className="rounded-[var(--radius-panel)] border border-border-default p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="size-4 text-accent" />
              <h3 className="text-sm font-semibold">Agent 客户端配置 (mcpServers)</h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(mcpConfigJson, 'json')}
            >
              {copiedType === 'json' ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
              复制 MCP 配置 JSON
            </Button>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            将以下配置粘贴至您的智能体配置中（例如 Antigravity 的 MCP 设置、Cursor 的 <code>.cursor/mcp.json</code> 或 Claude Desktop 的 <code>claude_desktop_config.json</code>）：
          </p>
          <pre className="p-3 rounded-[var(--radius-control)] bg-zinc-950 text-zinc-100 font-mono text-xs overflow-x-auto leading-5 border border-zinc-800">
            {mcpConfigJson}
          </pre>
        </div>

        {/* 开放能力与安全工具一览 */}
        <div className="rounded-[var(--radius-panel)] border border-border-default p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">支持的原生 MCP 工具集 (安全沙箱)</h3>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            所有 AI 智能体通过该 MCP 仅具备只读与提议权限，严禁绕过人类审核直接修改正式小说正文：
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-accent">get_project</code>
              <p className="text-muted mt-0.5">读取小说项目的标题、摘要和当前版本号。</p>
            </div>
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-accent">list_entries</code>
              <p className="text-muted mt-0.5">列出大纲、世界观、分镜、章节及出场角色。</p>
            </div>
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-accent">read_entry</code>
              <p className="text-muted mt-0.5">按需分块读取特定章节或世界观的正式文本。</p>
            </div>
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-accent">search_entries</code>
              <p className="text-muted mt-0.5">在设定与正文中进行模糊语义检索。</p>
            </div>
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-emerald-500">submit_proposal</code>
              <p className="text-muted mt-0.5">向作者提交修改草稿或新建章节提案供人类审核。</p>
            </div>
            <div className="p-2 rounded border border-border-default bg-surface">
              <code className="font-semibold text-accent">get_proposal_status</code>
              <p className="text-muted mt-0.5">查询作者对某项提案的审核结果（采纳/驳回）。</p>
            </div>
          </div>
        </div>

        {/* 可视化调试 Inspector 提示 */}
        <div className="rounded-[var(--radius-panel)] bg-surface-muted p-3 text-xs text-muted flex items-start gap-2.5">
          <Terminal className="size-4 shrink-0 text-accent mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">如何使用 MCP Inspector 进行交互式调试？</p>
            <p>
              在项目根目录下执行 <code>npm run mcp:inspect</code>，系统将自动拉起官方可视化调试面板，您可以在浏览器网页中亲身体验并调用每个 MCP 工具。
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
