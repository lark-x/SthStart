'use client';

import { BookOpen, Lightbulb, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { EmptyState } from '@/app/components/ui/empty-state';
import type { NewKind } from '../model/story-entry';

export function StoryEmptyState({ isReflection, onCreate, onOpenAgent }: {
  isReflection: boolean;
  onCreate: (kind: NewKind) => void;
  onOpenAgent: () => void;
}) {
  return <div className="story-empty-state flex h-full min-h-0 items-center justify-center p-6 text-center">
    {isReflection ? (
      <EmptyState
        icon={Lightbulb}
        title="开始记录对话感想与思考"
        description="左侧建立思考纲要或记录随笔篇目。可通过外部智能体（Antigravity、Cursor）借助标准 MCP 协议随时追加、查阅或提炼感想。"
        className="w-full max-w-lg"
        actions={<>
          <Button onClick={() => onCreate('outline')}>
            <Plus className="size-4" aria-hidden="true" />创建思考纲要
          </Button>
          <Button variant="outline" onClick={() => onCreate('chapter')}>
            <Plus className="size-4" aria-hidden="true" />写下第一篇随笔
          </Button>
          <Button variant="outline" onClick={onOpenAgent}>
            <Sparkles className="size-4 text-accent" aria-hidden="true" />配置 AI 协作 (MCP)
          </Button>
        </>}
      />
    ) : (
      <EmptyState
        icon={BookOpen}
        title="从纯文字小说正文开始创作"
        description="左侧建立大纲、世界观或从既有作品引入角色。可通过外部智能体（Antigravity、Cursor）借助标准 MCP 协议协同构思，构思完成后一键生成剧本工程或活动对白流。"
        className="w-full max-w-lg"
        actions={<>
          <Button onClick={() => onCreate('outline')}>
            <Plus className="size-4" aria-hidden="true" />创建项目大纲
          </Button>
          <Button variant="outline" onClick={onOpenAgent}>
            <Sparkles className="size-4 text-accent" aria-hidden="true" />配置 AI 协作 (MCP)
          </Button>
        </>}
      />
    )}
  </div>;
}
