'use client';

import { useState, useSyncExternalStore } from 'react';
import type { StudioViewMode } from '../model/studio-view';

function subscribeMobile(callback: () => void) {
  const mql = window.matchMedia('(max-width: 767px)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getMobileSnapshot() {
  return window.matchMedia('(max-width: 767px)').matches;
}

const COMPACT_WORKBENCH_QUERY = '(min-width: 768px) and (max-width: 1279px)';

function subscribeCompactWorkbench(callback: () => void) {
  const mql = window.matchMedia(COMPACT_WORKBENCH_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getCompactWorkbenchSnapshot() {
  return window.matchMedia(COMPACT_WORKBENCH_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/** 工作台视口、视图模式与左右栏折叠；不持有草稿或服务器数据。 */
export function useStudioLayout() {
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
  const compactWorkbench = useSyncExternalStore(subscribeCompactWorkbench, getCompactWorkbenchSnapshot, getServerSnapshot);
  const [viewMode, setViewMode] = useState<StudioViewMode>('storyboard');
  const [mobileDrawing, setMobileDrawing] = useState(false);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightInspectorOverride, setRightInspectorCollapsed] = useState<boolean | null>(null);
  const rightInspectorCollapsed = rightInspectorOverride ?? compactWorkbench;

  return {
    isMobile,
    compactWorkbench,
    viewMode,
    setViewMode,
    mobileDrawing,
    setMobileDrawing,
    leftRailCollapsed,
    setLeftRailCollapsed,
    rightInspectorCollapsed,
    setRightInspectorCollapsed,
  };
}
