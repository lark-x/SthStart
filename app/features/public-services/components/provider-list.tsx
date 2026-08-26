'use client';

import React from 'react';
import { Copy, Trash2, Edit3 } from 'lucide-react';
import type { ProviderProfile, PublicServiceOverview } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';

export function ProviderList({
  profiles,
  overview,
  onEdit,
  onClone,
  onDelete,
}: {
  profiles: ProviderProfile[];
  overview?: PublicServiceOverview | null;
  onEdit: (p: ProviderProfile) => void;
  onClone: (p: ProviderProfile) => void;
  onDelete: (p: ProviderProfile) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 model-card-grid">
        {profiles.map((profile) => {
          const usedBy =
            overview?.llmAssignments
              .filter(
                (a) =>
                  a.textProfileId === profile.id || a.multimodalProfileId === profile.id
              )
              .map(
                (a) => overview.apps.find((item) => item.id === a.appId)?.name ?? a.appId
              ) ?? [];

          return (
            <article
              key={profile.id}
              className={`flex flex-col justify-between p-4 rounded-[3px_16px_3px_3px] border border-[rgb(24_32_29/13%)] bg-[#fffdf8] model-card ${
                profile.enabled ? '' : 'opacity-65'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-sm font-semibold text-[#18201d] block truncate">
                      {profile.name}
                    </strong>
                    <code className="text-xs text-[#b83b1b] block truncate mt-0.5 font-mono">
                      {profile.model || '尚未选择模型'}
                    </code>
                  </div>
                  <Badge variant={profile.enabled ? 'online' : 'stopped'}>
                    {profile.enabled ? '可用' : '停用'}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {profile.capabilities.map((c) => (
                    <span
                      key={c}
                      className="text-[10px] bg-[rgb(24_32_29/6%)] text-[#596654] px-2 py-0.5 rounded-full font-medium"
                    >
                      {c === 'text' ? '文本' : '多模态'}
                    </span>
                  ))}
                </div>

                <div className="text-[11px] text-[#68716d] space-y-0.5 pt-1">
                  <p className="truncate">URL: {profile.baseUrl}</p>
                  <p>凭据: {profile.hasCredential ? profile.credentialSource : '未配置'}</p>
                  <p className="truncate">
                    使用方: {usedBy.join('、') || '尚未分配'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[rgb(24_32_29/9%)] model-actions">
                <Button size="sm" variant="ghost" onClick={() => onEdit(profile)}>
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>编辑</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClone(profile)}>
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制配置</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[#c9674a] hover:bg-[#c9674a]/10"
                  onClick={() => onDelete(profile)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>删除</span>
                </Button>
              </div>
            </article>
          );
        })}

        {profiles.length === 0 && (
          <div className="col-span-full p-8 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/18%)] rounded">
            还没有配置公共 LLM 模型。请在下方创建配置，并为邻舍等应用选择生效模型。
          </div>
        )}
      </div>
    </div>
  );
}
