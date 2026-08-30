'use client';

import React, { useState } from 'react';
import { Trash2, Plus, ExternalLink } from 'lucide-react';
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
      <div className="pb-3 border-b border-[rgb(24_32_29/10%)]">
        <h3 className="font-serif text-2xl font-medium text-[#18201d]">关系与资料来源</h3>
        <p className="text-xs text-[#68716d] mt-1 leading-relaxed">
          关系是有方向的；“A 如何看待 B” 与 “B 如何看待 A” 可以具有不同的态度与描述。
        </p>
      </div>

      {/* Relationship Creator */}
      <div className="p-4 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#68716d]">
          添加人物关系
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[#18201d] mb-1">
              目标角色
            </label>
            <Select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={!canEdit}
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
            <label className="block text-[11px] font-semibold text-[#18201d] mb-1">关系类型</label>
            <Input
              value={relationType}
              onChange={(e) => setRelationType(e.target.value)}
              placeholder="如：同伴、保护者、宿敌、崇拜…"
              disabled={!canEdit}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#18201d] mb-1">关系说明与看法</label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="当前角色如何看待对方？有哪些难忘的交集？"
            disabled={!canEdit}
          />
        </div>

        <Button
          size="sm"
          variant="primary"
          disabled={!canEdit || !targetId}
          loading={saving}
          onClick={handleAdd}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>保存关系</span>
        </Button>
      </div>

      {/* Relationship List */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#68716d]">
          已建立的角色关系 ({detail?.relationships.length ?? 0})
        </h4>

        <div className="grid grid-cols-1 gap-2.5">
          {detail?.relationships.map((rel) => {
            const otherId = rel.fromCharacterId === detail.id ? rel.toCharacterId : rel.fromCharacterId;
            const other = library.find((c) => c.id === otherId);
            const isOutward = rel.fromCharacterId === detail.id;

            return (
              <div
                key={rel.id}
                className="flex items-start justify-between gap-3 p-3.5 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-semibold text-[#18201d]">
                      {other?.displayName || '未知角色'}
                    </strong>
                    <span className="text-[11px] font-medium text-[#b83b1b] bg-[#e45d35]/10 px-2 py-0.5 rounded-full">
                      {rel.relationType || '关系'}
                    </span>
                    <span className="text-[10px] text-[#68716d]">
                      {isOutward ? '由当前角色指向对方' : '由对方指向当前角色'}
                    </span>
                  </div>
                  {rel.description && (
                    <p className="mt-1 text-xs text-[#68716d] leading-relaxed">
                      {rel.description}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveRelationship(rel.id)}
                  className="p-1 text-[#68716d] hover:text-[#c9674a] transition-colors"
                  title="移除关系"
                  aria-label="移除关系"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {(!detail?.relationships || detail.relationships.length === 0) && (
            <div className="p-6 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/14%)] rounded">
              尚未建立任何角色关系。
            </div>
          )}
        </div>
      </div>

      {/* Sources List */}
      <div className="pt-4 border-t border-[rgb(24_32_29/10%)] space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#68716d]">
          参考资料来源 ({detail?.sources.length ?? 0})
        </h4>

        <div className="grid grid-cols-1 gap-2.5">
          {detail?.sources.map((source) => (
            <div
              key={source.id}
              className="p-3.5 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] space-y-1"
            >
              <div className="flex items-center justify-between">
                <strong className="text-xs font-semibold text-[#18201d]">{source.title}</strong>
                <span className="text-[10px] text-[#68716d]">
                  {source.sourceType} · {new Date(source.fetchedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-[#68716d] line-clamp-3 leading-relaxed">
                {source.excerpt}
              </p>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#b83b1b] font-medium hover:underline pt-1"
                >
                  <span>查看来源原文</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}

          {(!detail?.sources || detail.sources.length === 0) && (
            <div className="p-6 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/14%)] rounded">
              暂无参考来源。使用 AI 智能草稿生成或导入 Tavern 卡片时会自动记录。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
