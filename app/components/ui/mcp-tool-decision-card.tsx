'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Terminal,
  Check,
  X,
  Clock,
  ChevronDown,
  Code2,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/app/lib/cn';
import { Button } from '@/app/components/ui/button';

export type ToolExecutionStatus = 'pending_approval' | 'running' | 'success' | 'error';

export interface McpToolCallData {
  id: string;
  toolName: string;
  serverName?: string;
  inputParams: Record<string, unknown>;
  resultOutput?: string;
  errorMessage?: string;
  executionDurationMs?: number;
}

export interface McpToolDecisionCardProps {
  toolCall: McpToolCallData;
  status?: ToolExecutionStatus;
  onVerdict?: (
    verdict: 'allow_once' | 'always_allow' | 'deny',
    params: Record<string, unknown>,
  ) => void;
  className?: string;
}

/**
 * ==============================================================================
 * McpToolDecisionCard.tsx
 *
 * 逆向吸收自 Claude Design System (CDS) 工具决策卡片模型：
 * 1. 严格的三态授权生命周期 (pending_approval -> running -> success/error)；
 * 2. 三阶决议按钮阵列 (单次批准 / 始终信任 / 拒绝执行)；
 * 3. 动态 Payload JSON 审查与只读展示；
 * 4. 严格贯彻 Zero-Emoji 准则与单闭合边框原则。
 * ==============================================================================
 */
export const McpToolDecisionCard: React.FC<McpToolDecisionCardProps> = ({
  toolCall,
  status: controlledStatus,
  onVerdict,
  className = '',
}) => {
  const [internalStatus, setInternalStatus] = useState<ToolExecutionStatus>('pending_approval');
  const [isJsonExpanded, setIsJsonExpanded] = useState(true);
  const [isResultExpanded, setIsResultExpanded] = useState(false);

  const status = controlledStatus ?? internalStatus;

  const handleAction = (verdict: 'allow_once' | 'always_allow' | 'deny') => {
    if (controlledStatus === undefined) {
      if (verdict === 'deny') {
        setInternalStatus('error');
      } else {
        setInternalStatus('running');
      }
    }
    onVerdict?.(verdict, toolCall.inputParams);
  };

  const isPending = status === 'pending_approval';
  const isRunning = status === 'running';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  return (
    <div
      role="region"
      aria-label={`MCP 决策卡片: ${toolCall.toolName}`}
      className={cn(
        'relative w-full rounded-panel border overflow-hidden transition-all duration-200 text-xs font-sans',
        isPending && 'border-accent/40 bg-surface shadow-sm',
        isRunning && 'border-border-default bg-surface',
        isSuccess && 'border-emerald-500/30 bg-surface',
        isError && 'border-red-500/30 bg-surface',
        className,
      )}
    >
      {/* 状态与标题顶栏 */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface-sunken/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="size-3.5 text-accent shrink-0" />
          <span className="font-semibold text-ink truncate font-mono">
            {toolCall.serverName ? `${toolCall.serverName} / ` : ''}
            {toolCall.toolName}
          </span>
          {toolCall.executionDurationMs !== undefined && (
            <span className="text-[11px] text-muted font-mono flex items-center gap-0.5">
              <Clock className="size-2.5" />
              {toolCall.executionDurationMs}ms
            </span>
          )}
        </div>

        {/* 状态指示 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              <ShieldCheck className="size-3" />
              <span>待授权</span>
            </span>
          )}
          {isRunning && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
              <Loader2 className="size-3 animate-spin" />
              <span>执行中</span>
            </span>
          )}
          {isSuccess && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              <span>调用成功</span>
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
              <AlertCircle className="size-3" />
              <span>调用拒绝/失败</span>
            </span>
          )}
        </div>
      </div>

      {/* 入参 Payload 审查区 */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-1 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <Code2 className="size-3" />
            <span>输入参数 (Payload)</span>
          </span>
          <button
            type="button"
            onClick={() => setIsJsonExpanded((prev) => !prev)}
            className="flex items-center gap-0.5 text-muted hover:text-ink transition-colors"
          >
            <span>{isJsonExpanded ? '收起' : '展开'}</span>
            <ChevronDown
              className={cn('size-3 transition-transform', isJsonExpanded && 'rotate-180')}
            />
          </button>
        </div>

        {isJsonExpanded && (
          <pre className="max-h-48 overflow-auto rounded-control bg-surface-muted p-2.5 font-mono text-[11px] leading-relaxed text-ink border border-border-subtle/50">
            {JSON.stringify(toolCall.inputParams, null, 2)}
          </pre>
        )}

        {/* 结果/错误折叠区 */}
        {(toolCall.resultOutput || toolCall.errorMessage) && (
          <div className="mt-2.5 border-t border-border-subtle/60 pt-2">
            <div className="flex items-center justify-between text-[11px] text-muted mb-1">
              <span>{toolCall.errorMessage ? '错误信息' : '输出结果'}</span>
              <button
                type="button"
                onClick={() => setIsResultExpanded((prev) => !prev)}
                className="flex items-center gap-0.5 hover:text-ink transition-colors"
              >
                <span>{isResultExpanded ? '收起' : '展开'}</span>
                <ChevronDown
                  className={cn('size-3 transition-transform', isResultExpanded && 'rotate-180')}
                />
              </button>
            </div>
            {isResultExpanded && (
              <pre
                className={cn(
                  'max-h-48 overflow-auto rounded-control p-2.5 font-mono text-[11px] leading-relaxed border',
                  toolCall.errorMessage
                    ? 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
                    : 'border-border-subtle/50 bg-surface-muted text-ink',
                )}
              >
                {toolCall.errorMessage || toolCall.resultOutput}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* 待决议动作阵列 (符合单闭合边框原则) */}
      {isPending && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-surface-sunken/30 px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAction('deny')}
            className="h-7 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
          >
            <X className="size-3 mr-1" />
            拒绝执行
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('always_allow')}
            className="h-7 text-xs text-ink hover:text-accent border-border-control/60"
          >
            始终信任本类操作
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => handleAction('allow_once')}
            className="h-7 text-xs gap-1"
          >
            <Check className="size-3" />
            批准单次执行
          </Button>
        </div>
      )}
    </div>
  );
};

export default McpToolDecisionCard;
