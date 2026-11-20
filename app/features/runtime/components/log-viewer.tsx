'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Pause, Play, Trash2, Copy, Download, Search } from 'lucide-react';
import type { LogEvent, LogLevel, LogPolicy } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Alert } from '@/app/components/ui/alert';

export function LogViewer({
  logs,
  paused,
  connected,
  onTogglePause,
  onClear,
  policy,
  onUpdatePolicy,
}: {
  logs: LogEvent[];
  paused: boolean;
  connected: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  policy?: LogPolicy;
  onUpdatePolicy?: (policy: Partial<LogPolicy>) => Promise<void>;
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.serviceId) set.add(log.serviceId);
    }
    return Array.from(set);
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (serviceFilter !== 'all' && log.serviceId !== serviceFilter) return false;
      if (q) {
        return (
          log.message.toLowerCase().includes(q) ||
          log.serviceId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, filterQuery, levelFilter, serviceFilter]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const handleCopy = () => {
    const text = filteredLogs.map((l) => `[${l.timestamp}] [${l.serviceId}] [${l.level}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleDownload = () => {
    const text = filteredLogs.map((l) => `[${l.timestamp}] [${l.serviceId}] [${l.level}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sthstart-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-panel border border-border-default bg-[var(--console-bg)] text-[var(--console-fg)] overflow-hidden shadow-lg">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-[var(--console-line)] bg-[var(--console-bar)]">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connected ? 'bg-success' : 'bg-danger'
              }`}
              title={connected ? 'SSE 实时已连接' : '未连接'}
            />
            <span className="text-sm font-mono text-[var(--console-accent)] mr-2">
              {connected ? 'LIVE STREAM' : 'DISCONNECTED'}
            </span>

            <Select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              aria-label="日志级别筛选"
              className="w-36"
            >
              <option value="all">所有日志级别</option>
              <option value="error">ERROR</option>
              <option value="warn">WARN</option>
              <option value="info">INFO</option>
              <option value="debug">DEBUG</option>
            </Select>

            <Select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              aria-label="服务筛选"
              className="w-40"
            >
              <option value="all">所有服务</option>
              {services.map((s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ))}
            </Select>

            {policy && onUpdatePolicy && (
              <Select
                value={policy.globalLevel}
                aria-label="全局日志级别"
                onChange={(event) => {
                  void onUpdatePolicy({ globalLevel: event.target.value as LogLevel });
                }}
                className="w-32"
              >
                <option value="off">OFF</option>
                <option value="error">ERROR 起</option>
                <option value="warn">WARN 起</option>
                <option value="info">INFO 起</option>
                <option value="debug">DEBUG 起</option>
                <option value="trace">TRACE 起</option>
              </Select>
            )}

            <div className="relative">
              <Input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="搜索日志内容…"
                aria-label="搜索日志内容"
                className="w-44 pl-7 sm:w-60"
              />
              <Search className="h-3.5 w-3.5 absolute left-2 top-3 text-muted" aria-hidden="true" />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onTogglePause}
              title={paused ? '恢复实时滚动' : '暂停接收新输出'}
            >
              {paused ? (
                <>
                  <Play className="h-3.5 w-3.5 fill-current text-success" />
                  <span>恢复</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current text-warning" />
                  <span>暂停</span>
                </>
              )}
            </Button>

            <Button
              type="button"
              size="sm"
              variant={autoScroll ? 'outline' : 'ghost'}
              onClick={() => setAutoScroll((value) => !value)}
              aria-pressed={autoScroll}
              title={autoScroll ? '关闭自动滚动' : '开启自动滚动'}
            >
              自动滚动
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleCopy}
              title="复制当前过滤日志"
              aria-label="复制当前过滤日志"
            >
              <Copy className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleDownload}
              title="下载日志文件"
              aria-label="下载日志文件"
            >
              <Download className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="danger-ghost"
              onClick={onClear}
              title="清空控制台"
              aria-label="清空控制台"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Console Box：深色表面，滑块必须用浅色，否则自动隐藏后即使显形也在深底上看不见。 */}
        <div
          ref={logContainerRef}
          data-visual-dynamic="true"
          data-autohide-scroll
          data-scroll-dark
          className="h-130 overflow-y-auto p-3 font-mono text-sm leading-relaxed space-y-1 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--console-muted)] text-sm">
              暂无符合条件的日志记录
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isError = log.level === 'error';
              const isWarn = log.level === 'warn';
              const isDebug = log.level === 'debug' || log.level === 'trace';

              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-2.5 py-0.5 px-1.5 rounded hover:bg-surface-raised/5 ${
                    isError
                      ? 'text-[var(--console-danger)] bg-danger/10'
                      : isWarn
                      ? 'text-[var(--console-warning)] bg-warning/10'
                      : isDebug
                      ? 'text-[var(--console-muted)]'
                      : 'text-[var(--console-fg)]'
                  }`}
                >
                  <time className="text-[var(--console-muted)] text-sm flex-shrink-0 pt-0.5">
                    {log.timestamp.slice(11, 19)}
                  </time>
                  <span className="font-semibold text-[var(--console-accent)] flex-shrink-0 text-sm w-24 truncate">
                    [{log.serviceId}]
                  </span>
                  <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
      {!connected && <Alert variant="warning" title="实时日志连接已中断">历史记录仍保留；可切换分区或刷新页面重新连接。筛选与复制下载仍可使用。</Alert>}
    </div>
  );
}
