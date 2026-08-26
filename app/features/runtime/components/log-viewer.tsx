'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Pause, Play, Trash2, Copy, Download, Search } from 'lucide-react';
import type { LogEvent, LogLevel, LogPolicy } from '@sthstart/contracts';

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
      <div className="rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/18%)] bg-[#18201d] text-[#dae2de] overflow-hidden shadow-lg">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-white/10 bg-[#1f2925]">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connected ? 'bg-[#4e9b6b]' : 'bg-[#c9674a]'
              }`}
              title={connected ? 'SSE 实时已连接' : '未连接'}
            />
            <span className="text-xs font-mono text-[#8bbfa0] mr-2">
              {connected ? 'LIVE STREAM' : 'DISCONNECTED'}
            </span>

            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="h-8 rounded bg-[#2a3732] border border-white/10 text-xs text-[#dae2de] px-2 py-0.5 outline-none"
            >
              <option value="all">所有日志级别</option>
              <option value="error">ERROR</option>
              <option value="warn">WARN</option>
              <option value="info">INFO</option>
              <option value="debug">DEBUG</option>
            </select>

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="h-8 rounded bg-[#2a3732] border border-white/10 text-xs text-[#dae2de] px-2 py-0.5 outline-none"
            >
              <option value="all">所有服务</option>
              {services.map((s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ))}
            </select>

            {policy && onUpdatePolicy && (
              <select
                value={policy.globalLevel}
                aria-label="全局日志级别"
                onChange={(event) => {
                  void onUpdatePolicy({ globalLevel: event.target.value as LogLevel });
                }}
                className="h-8 rounded bg-[#2a3732] border border-white/10 text-xs text-[#dae2de] px-2 py-0.5 outline-none"
              >
                <option value="off">OFF</option>
                <option value="error">ERROR 起</option>
                <option value="warn">WARN 起</option>
                <option value="info">INFO 起</option>
                <option value="debug">DEBUG 起</option>
                <option value="trace">TRACE 起</option>
              </select>
            )}

            <div className="relative">
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="搜索日志内容…"
                className="h-8 w-44 sm:w-60 rounded bg-[#2a3732] border border-white/10 text-xs text-[#dae2de] pl-7 pr-2 outline-none focus:border-[#e45d35]"
              />
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-white/40" />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onTogglePause}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded bg-[#2a3732] hover:bg-[#34453e] text-xs text-[#dae2de] border border-white/10 transition-colors"
              title={paused ? '恢复实时滚动' : '暂停接收新输出'}
            >
              {paused ? (
                <>
                  <Play className="h-3.5 w-3.5 fill-current text-[#4e9b6b]" />
                  <span>恢复</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current text-[#d0a731]" />
                  <span>暂停</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setAutoScroll((value) => !value)}
              className={`h-8 px-2.5 rounded text-xs border border-white/10 transition-colors ${
                autoScroll ? 'bg-[#34453e] text-[#dae2de]' : 'bg-[#2a3732] text-white/50'
              }`}
              aria-pressed={autoScroll}
              title={autoScroll ? '关闭自动滚动' : '开启自动滚动'}
            >
              自动滚动
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded bg-[#2a3732] hover:bg-[#34453e] text-xs text-[#dae2de] border border-white/10 transition-colors"
              title="复制当前过滤日志"
              aria-label="复制当前过滤日志"
            >
              <Copy className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 rounded bg-[#2a3732] hover:bg-[#34453e] text-xs text-[#dae2de] border border-white/10 transition-colors"
              title="下载日志文件"
              aria-label="下载日志文件"
            >
              <Download className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onClear}
              className="p-1.5 rounded bg-[#2a3732] hover:bg-[#c9674a]/20 text-[#c9674a] border border-white/10 transition-colors"
              title="清空控制台"
              aria-label="清空控制台"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Console Box */}
        <div
          ref={logContainerRef}
          data-visual-dynamic="true"
          className="h-[520px] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-1 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-white/40 text-xs">
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
                  className={`flex items-start gap-2.5 py-0.5 px-1.5 rounded hover:bg-white/5 ${
                    isError
                      ? 'text-[#ff9b8b] bg-[#c9674a]/10'
                      : isWarn
                      ? 'text-[#e9c676] bg-[#d0a731]/10'
                      : isDebug
                      ? 'text-[#dae2de]/60'
                      : 'text-[#dae2de]'
                  }`}
                >
                  <time className="text-white/40 text-[10px] flex-shrink-0 pt-0.5">
                    {log.timestamp.slice(11, 19)}
                  </time>
                  <span className="font-semibold text-[#8bbfa0] flex-shrink-0 text-[10px] w-24 truncate">
                    [{log.serviceId}]
                  </span>
                  <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
