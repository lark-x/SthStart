import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import type { StoryWorldFlowProps } from './types';
import { computeStoryFlowLayout, shouldIgnoreKeyboardShortcut } from './layout-engine';
import { EventNode } from './nodes/event-node';
import { ClusterNode } from './nodes/cluster-node';
import { FoldGapNode } from './nodes/fold-gap-node';
import { ActorTrajectoryEdge } from './edges/trajectory-edge';
import { ActorLaneHeader } from './controls/actor-lane-header';
import { TimeRuler } from './controls/time-ruler';
import { FlowToolbar } from './controls/flow-toolbar';
import '@xyflow/react/dist/style.css';
import './flow.css';

/**
 * 内部画布组件（运行在 ReactFlowProvider 下）
 */
function StoryWorldFlowInner({
  actors,
  locations,
  events,
  selectedEventId,
  onSelectEvent,
  from,
  to,
  onWindowChange,
  className = '',
  defaultFoldGaps = true,
  dataComplete = true,
}: StoryWorldFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 750 });
  const [foldGaps, setFoldGaps] = useState(defaultFoldGaps);
  const [enableClustering, setEnableClustering] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 24, y: 8, zoom: 0.82 });
  const isProgrammaticMoveRef = useRef(false);
  const lastEmittedWindowRef = useRef({ from: -1, to: -1 });
  const initialFitDoneRef = useRef(false);

  const { zoomIn, zoomOut, fitView, setViewport: setFlowViewport } = useReactFlow();

  // 监听容器物理尺寸自适应
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 首次数据加载或分支切换时自动适配合理舒适初始视口（zoom ~0.82，展示前 3~5 位角色与早期时间段，文字清晰）
  // 总览全景通过工具栏中的全景自适应按钮显式触发，杜绝初始缩放至 0.35 导致文字微缩
  useEffect(() => {
    if (events.length > 0 && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
      requestAnimationFrame(() => {
        setFlowViewport({ x: 24, y: 8, zoom: 0.82 });
      });
    }
  }, [events.length, setFlowViewport]);

  // 注册自定义节点类型
  const nodeTypes = useMemo(
    () => ({
      event: EventNode,
      cluster: ClusterNode,
      foldGap: FoldGapNode,
    }),
    []
  );

  // 注册自定义连线类型
  const edgeTypes = useMemo(
    () => ({
      trajectory: ActorTrajectoryEdge,
    }),
    []
  );

  // 核心纯函数布局计算
  const layout = useMemo(() => {
    return computeStoryFlowLayout({
      actors,
      locations,
      events,
      from,
      to,
      selectedEventId,
      onSelectEvent,
      onWindowChange,
      config: {
        foldGaps,
        enableClustering,
        dataComplete,
      },
    });
  }, [
    actors,
    locations,
    events,
    from,
    to,
    selectedEventId,
    onSelectEvent,
    onWindowChange,
    foldGaps,
    enableClustering,
    dataComplete,
  ]);

  // 当用户平移或缩放结束时，计算可视窗口对应的相对时间刻度并防抖上报（防止反馈震荡）
  const handleMoveEnd = useCallback(
    (_event: unknown, currentViewport: Viewport) => {
      setViewport(currentViewport);
      if (isProgrammaticMoveRef.current) {
        isProgrammaticMoveRef.current = false;
        return;
      }
      if (currentViewport.zoom <= 0 || !_event) return;

      const screenLeftX = -currentViewport.x / currentViewport.zoom;
      const screenRightX = (-currentViewport.x + containerSize.width) / currentViewport.zoom;

      const windowFromTick = Math.max(0, Math.floor(layout.xToTick(screenLeftX)));
      const windowToTick = Math.max(windowFromTick + 15, Math.ceil(layout.xToTick(screenRightX)));

      const diffFrom = Math.abs(windowFromTick - from);
      const diffTo = Math.abs(windowToTick - to);
      const diffLastFrom = Math.abs(windowFromTick - lastEmittedWindowRef.current.from);
      const diffLastTo = Math.abs(windowToTick - lastEmittedWindowRef.current.to);

      // 仅在刻度有实际实质性移动（>= 15m）且避免与上次上报抖动时通知父层，阻断反馈环
      if ((diffFrom >= 15 || diffTo >= 15) && (diffLastFrom >= 5 || diffLastTo >= 5)) {
        lastEmittedWindowRef.current = { from: windowFromTick, to: windowToTick };
        onWindowChange(windowFromTick, windowToTick);
      }
    },
    [containerSize.width, layout, from, to, onWindowChange]
  );

  // 时间跳转定位（设置标记避免 programmatic 触发 moveEnd 反馈循环）
  const handleJumpToTick = useCallback(
    (tick: number) => {
      isProgrammaticMoveRef.current = true;
      const targetWorldX = layout.tickToX(tick);
      const targetScreenX = -targetWorldX * viewport.zoom + containerSize.width * 0.35;
      setFlowViewport({
        x: targetScreenX,
        y: viewport.y,
        zoom: viewport.zoom,
      });
      lastEmittedWindowRef.current = { from: tick, to: tick + Math.max(120, to - from) };
      onWindowChange(tick, tick + Math.max(120, to - from));
    },
    [layout, viewport.zoom, viewport.y, containerSize.width, to, from, setFlowViewport, onWindowChange]
  );

  // 键盘无障碍交互导航 (Keyboard Ergonomics)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 1. CJK 输入法合成守卫
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;

      // 2. 严禁拦截输入框、文本框、选择框或富文本编辑区（包括 jump 输入与表单）
      if (shouldIgnoreKeyboardShortcut(e.target as HTMLElement | null)) {
        return;
      }

      const sorted = [...events].sort((a, b) => a.tick - b.tick);
      if (sorted.length === 0) return;

      const currentIndex = sorted.findIndex(ev => ev.id === selectedEventId);

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          const nextIndex = currentIndex < sorted.length - 1 ? currentIndex + 1 : 0;
          const nextEvent = sorted[nextIndex];
          onSelectEvent(nextEvent.id);
          handleJumpToTick(nextEvent.tick);
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : sorted.length - 1;
          const prevEvent = sorted[prevIndex];
          onSelectEvent(prevEvent.id);
          handleJumpToTick(prevEvent.tick);
          break;
        }
        case 'Home': {
          e.preventDefault();
          const first = sorted[0];
          onSelectEvent(first.id);
          handleJumpToTick(first.tick);
          break;
        }
        case 'End': {
          e.preventDefault();
          const last = sorted[sorted.length - 1];
          onSelectEvent(last.id);
          handleJumpToTick(last.tick);
          break;
        }
        case 'f':
        case 'F': {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setFoldGaps(prev => !prev);
          }
          break;
        }
        case 'c':
        case 'C': {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setEnableClustering(prev => !prev);
          }
          break;
        }
      }
    },
    [events, selectedEventId, onSelectEvent, handleJumpToTick]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="故事世界人物交织时间长卷交互画布"
      onKeyDown={handleKeyDown}
      className={`story-world-flow-container relative w-full h-full select-none outline-none focus-visible:ring-1 focus-visible:ring-accent ${className}`}
    >
      {/* 顶部相对时间标尺 */}
      <TimeRuler
        viewport={viewport}
        containerWidth={containerSize.width}
        tickToX={layout.tickToX}
        xToTick={layout.xToTick}
        gaps={layout.gaps}
        from={from}
        to={to}
        onJumpToTick={handleJumpToTick}
      />

      {/* 左侧固定角色轨道标头 */}
      <ActorLaneHeader
        actorLanes={layout.actorLanes}
        viewport={viewport}
        containerHeight={containerSize.height}
      />

      {/* 浮动操作工具栏 */}
      <FlowToolbar
        from={from}
        to={to}
        foldGaps={foldGaps}
        onToggleFoldGaps={() => setFoldGaps(prev => !prev)}
        enableClustering={enableClustering}
        onToggleClustering={() => setEnableClustering(prev => !prev)}
        onZoomIn={() => zoomIn({ duration: 250 })}
        onZoomOut={() => zoomOut({ duration: 250 })}
        onFitView={() => fitView({ duration: 400, padding: 0.15 })}
        onJumpToTick={handleJumpToTick}
        renderedNodesCount={layout.stats.renderedNodes}
        totalEventsCount={layout.stats.totalEvents}
        showMiniMap={showMiniMap}
        onToggleMiniMap={() => setShowMiniMap(prev => !prev)}
      />

      {/* React Flow 主交互流画布 */}
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false} // 严格禁止拖拽节点修改时间事实
        nodesConnectable={false}
        elementsSelectable={true}
        onMoveEnd={handleMoveEnd}
        onViewportChange={setViewport}
        minZoom={0.2}
        maxZoom={2.5}
        panOnScroll={true}
        zoomOnScroll={false}
        preventScrolling={true}
        defaultViewport={{ x: 24, y: 8, zoom: 0.82 }}
        aria-label="人物交织时间长卷画布"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.2}
          color="var(--border-default)"
        />

        {/* 角色轨道背景参考辅助线 (SVG Layer 在 viewport 坐标系下严格跟随缩放平移) */}
        <svg
          className="absolute inset-0 pointer-events-none w-full h-full overflow-visible"
          style={{ zIndex: 0 }}
        >
          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {layout.actorLanes.map(lane => (
              <line
                key={lane.actor.id}
                x1={0}
                y1={lane.y}
                x2={layout.totalWidth}
                y2={lane.y}
                stroke="var(--border-subtle)"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.6}
              />
            ))}
          </g>
        </svg>

        {/* 紧凑轻量小地图 MiniMap（默认收起防遮挡，大画布可按需展开，杜绝占满右下角） */}
        {showMiniMap && containerSize.width >= 900 && containerSize.height >= 550 ? (
          <MiniMap
            position="bottom-right"
            zoomable
            pannable
            nodeColor={node => {
              if (node.type === 'cluster') return 'var(--accent)';
              if (node.type === 'foldGap') return 'var(--border-strong)';
              return 'var(--tone-violet)';
            }}
            nodeStrokeWidth={1.5}
            nodeBorderRadius={4}
            maskColor="color-mix(in srgb, var(--bg-app) 65%, transparent)"
            style={{
              width: 140,
              height: 85,
              marginBottom: 16,
              marginRight: 16,
              borderRadius: 8,
              border: '1px solid var(--hairline)',
              backgroundColor: 'color-mix(in srgb, var(--surface) 92%, transparent)',
              backdropFilter: 'blur(8px)',
              boxShadow: 'var(--elev-sm)',
            }}
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}

/**
 * 故事世界「人物交织时间长卷」主组件
 * 提供默认导出 StoryWorldFlow 与完备类型
 */
export default function StoryWorldFlow(props: StoryWorldFlowProps) {
  return (
    <ReactFlowProvider>
      <StoryWorldFlowInner {...props} />
    </ReactFlowProvider>
  );
}

export { StoryWorldFlow };
