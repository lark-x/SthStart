import React, { memo, useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  FoldHorizontal,
  Layers,
  Clock,
  MoreHorizontal,
  Keyboard,
  Map as MapIcon,
  X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';

/**
 * 浮动画布工具栏是紧凑胶囊条：共享按钮默认的 36/44px 高度会把整条挤出视口，
 * 这里只收窄高度、内边距与圆角；焦点环、禁用态、aria-pressed 与键盘激活仍由共享组件提供。
 * 共享 Button 会把插槽类名换成 `ui-mantine-button-*`，因此显式把内层恢复成横向 flex，
 * 否则图标与文字会各自独占一行、胶囊条被撑高。
 */
const inlineContent = '[&_.ui-mantine-button-inner]:flex [&_.ui-mantine-button-inner]:h-auto [&_.ui-mantine-button-inner]:items-center [&_.ui-mantine-button-label]:flex [&_.ui-mantine-button-label]:h-auto [&_.ui-mantine-button-label]:items-center [&_.ui-mantine-button-label]:gap-1';
/* 共享基类带 1px 透明描边；胶囊条沿用原来的零描边，否则每个按钮宽 2px。 */
const chromeBase = 'h-auto min-h-0 shrink-0 border-0';
const compactPill = `${chromeBase} rounded-full px-1.5 py-0.5 text-[11px] font-medium text-fg-default enabled:hover:text-fg-default sm:min-h-0 ${inlineContent}`;
const compactToggle = `${chromeBase} rounded-full px-1.5 py-0.5 text-xs font-medium sm:min-h-0 ${inlineContent}`;
const compactToggleOn = `${compactToggle} bg-accent-soft font-semibold text-accent enabled:hover:bg-accent-soft enabled:hover:text-accent`;
const compactToggleOff = `${compactToggle} text-fg-default enabled:hover:text-fg-default`;
/* 22px 与改动前的 p-1 + 14px 图标一致，保证胶囊条在 1024 宽度下不被挤断。 */
const compactIcon = 'size-[22px] min-h-0 border-0 p-0 sm:size-[22px] sm:min-h-0';
/* ghost 基类的 hover 会把图标染成 ink；浮动条上的图标维持原色相。 */
const iconIdle = 'text-fg-default enabled:hover:text-fg-default';

interface FlowToolbarProps {
  from: number;
  to: number;
  foldGaps: boolean;
  onToggleFoldGaps: () => void;
  enableClustering: boolean;
  onToggleClustering: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onJumpToTick: (tick: number) => void;
  renderedNodesCount: number;
  totalEventsCount: number;
  showMiniMap?: boolean;
  onToggleMiniMap?: () => void;
}

export const FlowToolbar = memo(function FlowToolbar({
  from,
  to,
  foldGaps,
  onToggleFoldGaps,
  enableClustering,
  onToggleClustering,
  onZoomIn,
  onZoomOut,
  onFitView,
  onJumpToTick,
  renderedNodesCount,
  totalEventsCount,
  showMiniMap,
  onToggleMiniMap,
}: FlowToolbarProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // 点击外部自动收起溢出抽屉
  useEffect(() => {
    if (!showOverflow) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showOverflow]);

  return (
    <div
      role="toolbar"
      aria-label="长卷画布工具栏"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 select-none z-20 flex flex-col items-center pointer-events-auto"
    >
      {/* 溢出状态与快捷键提示浮层 */}
      {showOverflow ? (
        <div
          ref={overflowRef}
          className="mb-2 p-3 rounded-xl shadow-lg border border-hairline backdrop-blur-md w-72 text-xs space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--surface-raised, #ffffff) 96%, transparent)',
            color: 'var(--fg-default, #2b2925)',
          }}
        >
          <div className="flex items-center justify-between border-b border-hairline pb-1.5">
            <span className="font-semibold text-fg-default">画布统计与快捷操作</span>
            <IconButton
              icon={X}
              label="关闭统计与快捷键浮层"
              iconClassName="h-3.5 w-3.5"
              className="size-[18px] min-h-0 p-0 sm:size-[18px] sm:min-h-0"
              onClick={() => setShowOverflow(false)}
            />
          </div>

          {/* 详细指标 */}
          <div className="flex items-center justify-between text-fg-muted font-mono text-[11px] bg-surface-sunken p-1.5 rounded-lg">
            <span>当前视口: +{from}m ~ +{to}m</span>
            <span>节点: {renderedNodesCount} / {totalEventsCount}</span>
          </div>

          {/* 更多快速时间跳转点 */}
          <div>
            <div className="text-[10px] text-fg-subtle mb-1">更多时间定位：</div>
            <div className="flex items-center gap-1">
              {[
                { label: '0h', tick: 0 },
                { label: '6h', tick: 360 },
                { label: '12h', tick: 720 },
                { label: '18h', tick: 1080 },
                { label: '24h', tick: 1440 },
              ].map(item => (
                <Button
                  key={item.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onJumpToTick(item.tick);
                    setShowOverflow(false);
                  }}
                  className={`h-auto min-h-0 flex-1 rounded border border-hairline px-1 py-1 text-[11px] font-medium text-fg-default enabled:hover:text-fg-default sm:min-h-0 ${inlineContent}`}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 小地图显示切换 */}
          {onToggleMiniMap ? (
            <div className="flex items-center justify-between pt-1 border-t border-hairline">
              <span className="text-[11px] text-fg-muted flex items-center gap-1">
                <MapIcon className="w-3 h-3 text-fg-subtle" />
                右下角小地图
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={onToggleMiniMap}
                aria-pressed={Boolean(showMiniMap)}
                className={`h-auto min-h-0 rounded border-0 px-2 py-0.5 text-[11px] font-medium sm:min-h-0 ${inlineContent} ${
                  showMiniMap ? 'bg-accent-soft text-accent enabled:hover:bg-accent-soft enabled:hover:text-accent' : 'bg-surface-sunken text-fg-muted enabled:hover:bg-surface-sunken enabled:hover:text-fg-muted'
                }`}
              >
                {showMiniMap ? '已开启' : '已隐藏'}
              </Button>
            </div>
          ) : null}

          {/* 键盘无障碍指南 */}
          <div className="pt-1 border-t border-hairline text-[10px] text-fg-subtle space-y-1">
            <div className="flex items-center gap-1 font-medium text-fg-muted">
              <Keyboard className="w-3 h-3" />
              键盘快捷键：
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
              <div>← / →: 前后事件</div>
              <div>Home/End: 首末事件</div>
              <div>F: 切换空白折叠</div>
              <div>C: 切换时段聚合</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 核心高可用工具栏（紧凑设计，绝对确保 1024 与 1440 下缩放/全景按钮永不被截断） */}
      <div
        className="flex items-center gap-1 p-1 rounded-full shadow-md backdrop-blur-md border border-hairline transition-all shrink-0"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--surface-raised, #ffffff) 94%, transparent)',
        }}
      >
        {/* 视口时段状态徽标 */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium shrink-0"
          style={{
            backgroundColor: 'var(--surface-sunken, #ebe7df)',
            color: 'var(--fg-muted, #5a564f)',
          }}
          title={`当前视口：+${from}m ~ +${to}m，已渲染 ${renderedNodesCount} 个节点（总事件 ${totalEventsCount}）`}
        >
          <Clock className="w-3.5 h-3.5 text-accent" />
          <span>+{from}m~+{to}m</span>
        </div>

        {/* 常用快速时间导航锚点（紧凑精简） */}
        <div className="flex items-center gap-0.5 shrink-0">
          {[
            { label: '0h', tick: 0 },
            { label: '12h', tick: 720 },
            { label: '24h', tick: 1440 },
          ].map(item => (
            <Button
              key={item.label}
              type="button"
              variant="ghost"
              onClick={() => onJumpToTick(item.tick)}
              className={compactPill}
              title={`跳转至第 ${item.tick} 分钟 (${item.label})`}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="w-px h-3.5 bg-border-subtle my-auto shrink-0" />

        {/* 功能切换：空白折叠 (F) */}
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleFoldGaps}
          aria-pressed={foldGaps}
          className={`${foldGaps ? compactToggleOn : compactToggleOff} gap-1`}
          title="切换无事件空白折叠 (F)"
        >
          <FoldHorizontal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">{foldGaps ? '已折叠' : '完整'}</span>
        </Button>

        {/* 功能切换：缩放聚合 LOD (C) */}
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleClustering}
          aria-pressed={enableClustering}
          className={`${enableClustering ? compactToggleOn : compactToggleOff} gap-1`}
          title="切换事件多尺度聚合 (C)"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">{enableClustering ? '聚合' : '展开'}</span>
        </Button>

        <div className="w-px h-3.5 bg-border-subtle my-auto shrink-0" />

        {/* 缩放核心按钮（始终置于醒目位置，严禁挤出视口） */}
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton icon={ZoomIn} label="放大" title="放大视图" iconClassName="h-3.5 w-3.5" className={`${compactIcon} ${iconIdle}`} onClick={onZoomIn} />
          <IconButton icon={ZoomOut} label="缩小" title="缩小视图" iconClassName="h-3.5 w-3.5" className={`${compactIcon} ${iconIdle}`} onClick={onZoomOut} />
          <IconButton
            icon={Maximize2}
            label="全景自适应"
            title="全景自适应（总览全卷）"
            iconClassName="h-3.5 w-3.5"
            className={`${compactIcon} font-semibold text-accent enabled:hover:text-accent`}
            onClick={onFitView}
          />
        </div>

        <div className="w-px h-3.5 bg-border-subtle my-auto shrink-0" />

        {/* 溢出抽屉按钮 */}
        <IconButton
          icon={MoreHorizontal}
          label="更多设置与统计"
          iconClassName="h-3.5 w-3.5"
          className={`${compactIcon} ${showOverflow ? 'bg-surface-sunken text-accent enabled:hover:text-accent' : 'text-fg-subtle enabled:hover:text-fg-subtle'}`}
          aria-expanded={showOverflow}
          title="统计指标与快捷键指南"
          onClick={() => setShowOverflow(prev => !prev)}
        />
      </div>
    </div>
  );
});
