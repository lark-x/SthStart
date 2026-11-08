'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CharacterProfile } from '@sthstart/contracts';
import type { CharacterDetail } from '../api';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';

export function RelationsSection({
  detail,
  library,
  canEdit,
  onAddRelationship,
  onRemoveRelationship,
}: {
  detail?: CharacterDetail | null;
  library: CharacterProfile[];
  canEdit: boolean;
  onAddRelationship: (rel: {
    toCharacterId: string;
    relationType: string;
    description: string;
  }) => Promise<void>;
  onRemoveRelationship: (id: string) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState('');
  const [relationType, setRelationType] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const availableTargets = library.filter((item) => item.id !== detail?.id);

  const handleAdd = async () => {
    if (!targetId || !canEdit) return;
    setSaving(true);
    try {
      await onAddRelationship({
        toCharacterId: targetId,
        relationType: relationType.trim() || '关系',
        description: description.trim(),
      });
      setTargetId('');
      setRelationType('');
      setDescription('');
    } catch {
      // 保存失败时保留用户输入，错误提示由编辑器统一弹出。
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-3 border-b border-border-subtle">
        <h3 className="text-base font-semibold text-ink">关系与资料来源</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          关系是有方向的；“A 如何看待 B” 与 “B 如何看待 A” 可以具有不同的态度与描述。
        </p>
      </div>

      {/* Relationship Creator */}
      <div className="p-4 rounded-panel border border-border-subtle bg-surface space-y-3">
        <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          添加人物关系
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="rel-target-char" className="block text-xs font-medium text-fg-subtle mb-1">
              目标角色
            </label>
            <Select
              id="rel-target-char"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={!canEdit}
              className="text-base sm:text-sm"
            >
              <option value="">选择资料库中的角色</option>
              {availableTargets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="rel-type-input" className="block text-xs font-medium text-fg-subtle mb-1">
              关系类型
            </label>
            <Input
              id="rel-type-input"
              value={relationType}
              onChange={(e) => setRelationType(e.target.value)}
              placeholder="例如：挚友、宿敌、搭档"
              disabled={!canEdit}
              className="text-base sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="rel-desc-input" className="block text-xs font-medium text-fg-subtle mb-1">
              关系描述
            </label>
            <Textarea
              id="rel-desc-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：虽然表面经常争执，但危急时刻总是最信任对方。"
              disabled={!canEdit}
              className="text-base sm:text-sm"
            />
          </div>
        </div>

        <div className="pt-1 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={!targetId || !canEdit || saving}
            loading={saving}
            onClick={() => void handleAdd()}
          >
            添加关系
          </Button>
        </div>
      </div>

      {/* Existing Relationships */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          已有关系 ({detail?.relationships?.length ?? 0})
        </h4>

        {detail?.relationships && detail.relationships.length > 0 ? (
          <div className="rounded-panel border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
            {detail.relationships.map((rel) => {
              const otherId = rel.fromCharacterId === detail.id ? rel.toCharacterId : rel.fromCharacterId;
              const other = library.find((c) => c.id === otherId);
              const isOutward = rel.fromCharacterId === detail.id;

              return (
                <div key={rel.id} className="flex items-center justify-between p-3.5 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {other?.displayName || otherId}
                      </span>
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-surface-sunken text-fg-subtle border border-border-subtle">
                        {isOutward ? `-> ${rel.relationType}` : `<- ${rel.relationType}`}
                      </span>
                    </div>
                    {rel.description && (
                      <p className="mt-1 text-xs text-muted leading-relaxed">{rel.description}</p>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void onRemoveRelationship(rel.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-danger/10 hover:text-danger active:bg-danger/15 transition-colors"
                      title="删除关系"
                      aria-label="删除关系"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-panel border border-border-subtle bg-surface p-6 text-center text-xs text-muted">
            暂无已配置的人物关系。
          </div>
        )}
      </div>
    </div>
  );
}
