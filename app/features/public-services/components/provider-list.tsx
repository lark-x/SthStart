'use client';

import React from 'react';
import { Copy, Trash2, Edit3, Route } from 'lucide-react';
import type { ProviderProfile, PublicServiceOverview } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';

export function ProviderList({
  profiles,
  overview,
  onEdit,
  onClone,
  onDelete,
  onAssignToApps,
  searching = false,
}: {
  profiles: ProviderProfile[];
  overview?: PublicServiceOverview | null;
  onEdit: (p: ProviderProfile) => void;
  onClone: (p: ProviderProfile) => void;
  onDelete: (p: ProviderProfile) => void;
  onAssignToApps?: (p: ProviderProfile) => void;
  searching?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
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
              data-testid="model-card"
              className={`grid items-center gap-4 p-4 rounded-[var(--radius-panel)] border border-border-default bg-surface lg:grid-cols-[minmax(0,1fr)_auto] ${
                profile.enabled ? '' : 'opacity-65'
              }`}
            >
              <div className="grid min-w-0 items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)]">
                <div className="flex flex-col items-start gap-2">
                  <div className="min-w-0">
                    <strong className="text-sm font-semibold text-ink block truncate">
                      {profile.name}
                    </strong>
                    <code className="text-sm text-accent-dark block truncate mt-0.5 font-mono">
                      {profile.model || '尚未选择模型'}
                    </code>
                  </div>
                  <Badge variant={profile.enabled ? 'online' : 'stopped'}>
                    {!profile.enabled ? '停用' : profile.hasCredential ? '已启用' : '待配置凭据'}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {profile.capabilities.map((c) => (
                    <span
                      key={c}
                      className="text-xs bg-surface-muted text-muted px-2 py-0.5 rounded-full font-medium"
                    >
                      {c === 'text' ? '文本' : '多模态'}
                    </span>
                  ))}
                </div>

                <div className="min-w-0 text-sm text-muted space-y-1">
                  <p className="truncate">服务地址：{profile.baseUrl}</p>
                  <p>凭据： {profile.hasCredential ? profile.credentialSource : '未配置'}</p>
                  <p className="truncate">
                    使用方： {usedBy.join('、') || '尚未分配'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle pt-3 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
                {usedBy.length === 0 && onAssignToApps && (
                  <Button size="sm" variant="outline" className="mr-auto" onClick={() => onAssignToApps(profile)}>
                    <Route className="h-3.5 w-3.5" />
                    <span>分配到应用</span>
                  </Button>
                )}
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
                  className="text-danger hover:bg-danger/10"
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
          <div className="col-span-full p-8 text-center text-sm text-muted border border-dashed border-border-default rounded">
            {searching ? '没有匹配的模型，请调整搜索条件。' : '还没有模型模板。点击“新建模板”添加，再到“应用路由”选择生效模型。'}
          </div>
        )}
      </div>
    </div>
  );
}
