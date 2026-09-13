'use client';

import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  MapPin,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import type { StageDefinition, ActorSnapshot } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';

interface StagesEditorProps {
  stages: StageDefinition[];
  actors: ActorSnapshot[];
  onChange: (stages: StageDefinition[]) => void;
  disabled?: boolean;
}

export function StagesEditor({ stages, actors, onChange, disabled }: StagesEditorProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddStage = () => {
    const newStage: StageDefinition = {
      id: `stage_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `阶段 ${stages.length + 1}`,
      order: stages.length * 10 + 10,
      actorIds: actors.map((a) => a.id),
      location: '',
      instruction: '',
      requiredBeats: [],
      endCondition: '',
      locked: false,
    };
    onChange([...stages, newStage]);
    setErrorMsg(null);
  };

  const handleDeleteStage = (index: number) => {
    if (stages.length <= 2) {
      setErrorMsg('活动必须保留至少 2 个阶段，无法继续删除');
      return;
    }
    const updated = stages.filter((_, i) => i !== index).map((s, idx) => ({ ...s, order: (idx + 1) * 10 }));
    onChange(updated);
    setErrorMsg(null);
  };

  const handleMoveStage = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;

    const list = [...stages];
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    const reordered = list.map((s, idx) => ({ ...s, order: (idx + 1) * 10 }));
    onChange(reordered);
  };

  const handleUpdateStage = (index: number, patch: Partial<StageDefinition>) => {
    const list = [...stages];
    list[index] = { ...list[index], ...patch };
    onChange(list);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">活动阶段设定</h3>
          <p className="text-sm text-muted">
            活动按阶段推进情节展开。锁定阶段将不会被 AI 全局规划覆盖。至少需要保留 2 个阶段。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleAddStage}
          disabled={disabled}
          className="text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          新增阶段
        </Button>
      </div>

      {errorMsg && (
        <Alert variant="danger" title="阶段限制">
          {errorMsg}
        </Alert>
      )}

      <div className="space-y-3">
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            className={`p-4 rounded-[var(--radius-panel)] border transition-all ${
              stage.locked
                ? 'bg-amber-50/40 border-amber-300/60'
                : 'bg-surface border-border-default'
            }`}
          >
            {/* Header: Title, order, lock toggle, delete */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2 flex-1">
                <Badge variant="outline" className="text-sm font-mono">
                  #{index + 1}
                </Badge>
                <Input
                  value={stage.title}
                  onChange={(e) => handleUpdateStage(index, { title: e.target.value })}
                  placeholder="阶段名称（如：海边营地布置）"
                  disabled={disabled || stage.locked}
                  className="h-8 text-sm font-semibold max-w-xs bg-transparent"
                />
                {stage.locked && (
                  <Badge variant="outline" className="text-sm text-amber-700 border-amber-300 bg-amber-50 flex items-center gap-1">
                    <Lock className="h-2.5 w-2.5" />
                    已锁定
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUpdateStage(index, { locked: !stage.locked })}
                  disabled={disabled}
                  title={stage.locked ? '解锁此阶段' : '锁定此阶段（防止AI生成覆盖）'}
                  className="h-7 w-7 p-0 text-muted hover:text-ink"
                >
                  {stage.locked ? <Lock className="h-3.5 w-3.5 text-amber-600" /> : <Unlock className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMoveStage(index, 'up')}
                  disabled={disabled || index === 0}
                  className="h-7 w-7 p-0 text-muted hover:text-ink"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMoveStage(index, 'down')}
                  disabled={disabled || index === stages.length - 1}
                  className="h-7 w-7 p-0 text-muted hover:text-ink"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteStage(index)}
                  disabled={disabled || stages.length <= 2}
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-700 disabled:opacity-30"
                  title={stages.length <= 2 ? '至少需保留2个阶段' : '删除阶段'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Stage Body */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  阶段地点
                </label>
                <Input
                  value={stage.location || ''}
                  onChange={(e) => handleUpdateStage(index, { location: e.target.value })}
                  placeholder="如：海边沙滩、营地长桌"
                  disabled={disabled || stage.locked}
                  className="h-8 text-sm bg-transparent"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  阶段结束条件
                </label>
                <Input
                  value={stage.endCondition || ''}
                  onChange={(e) => handleUpdateStage(index, { endCondition: e.target.value })}
                  placeholder="如：营地帐篷搭建完毕，晚餐准备好"
                  disabled={disabled || stage.locked}
                  className="h-8 text-sm bg-transparent"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-muted flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  阶段指引 (Instruction)
                </label>
                <Textarea
                  value={stage.instruction || ''}
                  onChange={(e) => handleUpdateStage(index, { instruction: e.target.value })}
                  placeholder="描述此阶段发生的主要事情，指导 AI 生成对白与动态…"
                  disabled={disabled || stage.locked}
                  rows={2}
                  className="text-sm bg-transparent resize-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
