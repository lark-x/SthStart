'use client';

import React from 'react';
import { StudioShell } from './studio/studio-shell';

interface ActivityStudioWorkspaceProps {
  activityId: string;
}

/**
 * 活动创作工作室主工作台。
 * 已全面解耦并委托至现代三栏沉浸式 StudioShell 架构，具备移动端纯只读功能剪裁。
 */
export function ActivityStudioWorkspace({ activityId }: ActivityStudioWorkspaceProps) {
  return <StudioShell activityId={activityId} />;
}
