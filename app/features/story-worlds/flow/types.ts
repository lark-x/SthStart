import type { WorldActor, WorldLocation, WorldEvent } from '@sthstart/contracts';
import type { Node, Edge } from '@xyflow/react';

/**
 * 协作接口规范中固定的 StoryWorldFlow 组件 Props
 */
export interface StoryWorldFlowProps {
  actors: WorldActor[];
  locations: WorldLocation[];
  events: WorldEvent[];
  selectedEventId?: string;
  onSelectEvent(id: string): void;
  from: number;
  to: number;
  onWindowChange(from: number, to: number): void;
  /** 可选：允许外部覆盖或配置折叠阈值与聚合策略 */
  className?: string;
  /** 可选：初始是否折叠超长空白时段，默认 true */
  defaultFoldGaps?: boolean;
  /** 可选：事件数据是否全量完整加载。为 false 时禁止将未加载数据误折叠 */
  dataComplete?: boolean;
}

/**
 * 人物稳定轨迹轨道定义
 */
export interface ActorLane {
  actor: WorldActor;
  index: number;
  y: number;
  color: string;
  bgTone: string;
}

/**
 * 无事发生的时段折叠信息
 */
export interface TimeGap {
  id: string;
  startTick: number;
  endTick: number;
  gapMinutes: number;
  folded: boolean;
  startX: number;
  endX: number;
  width: number;
}

/**
 * 单事件节点数据载荷
 */
export interface EventNodeData extends Record<string, unknown> {
  event: WorldEvent;
  location?: WorldLocation;
  participants: WorldActor[];
  isSelected: boolean;
  onSelect(id: string): void;
  actorColors: Record<string, string>;
  isShared: boolean;
}

/**
 * 缩放聚合节点数据载荷（LOD 概览模式）
 */
export interface ClusterNodeData extends Record<string, unknown> {
  clusterId: string;
  fromTick: number;
  toTick: number;
  events: WorldEvent[];
  locations: WorldLocation[];
  participants: WorldActor[];
  onExpand(fromTick: number, toTick: number): void;
  actorColors: Record<string, string>;
  trackKey?: string;
}

/**
 * 空白折叠节点数据载荷
 */
export interface FoldGapNodeData extends Record<string, unknown> {
  gap: TimeGap;
  onToggleFold?(gapId: string): void;
}

/**
 * 角色轨迹连线数据载荷
 */
export interface TrajectoryEdgeData extends Record<string, unknown> {
  actorId: string;
  actorName: string;
  color: string;
  isSelected: boolean;
  isShared: boolean;
}

export type StoryFlowNode = Node<EventNodeData | ClusterNodeData | FoldGapNodeData>;
export type StoryFlowEdge = Edge<TrajectoryEdgeData>;

/**
 * 布局引擎配置项
 */
export interface LayoutConfig {
  pixelsPerMinute: number;
  laneHeight: number;
  headerOffsetTop: number;
  leftMargin: number;
  eventCardWidth: number;
  eventCardHeight: number;
  gapFoldThresholdMinutes: number;
  foldedGapWidth: number;
  bufferRatio: number;
  clusterThresholdSpan: number;
  clusterBucketMinutes: number;
  foldGaps: boolean;
  enableClustering: boolean;
  dataComplete?: boolean;
}

/**
 * 布局引擎执行产物
 */
export interface LayoutResult {
  nodes: StoryFlowNode[];
  edges: StoryFlowEdge[];
  actorLanes: ActorLane[];
  gaps: TimeGap[];
  totalWidth: number;
  totalHeight: number;
  tickToX(tick: number): number;
  xToTick(x: number): number;
  stats: {
    totalEvents: number;
    windowEvents: number;
    renderedNodes: number;
    renderedEdges: number;
    isClustered: boolean;
    foldedGapCount: number;
    from: number;
    to: number;
  };
}
