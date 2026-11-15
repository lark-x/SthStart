'use client';

import React from 'react';
import { Settings2 } from 'lucide-react';
import type { ModelProfile } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import {
  modelNameById,
  summarizeAppExceptions,
  type AppExceptionRow,
} from './public-services-model-settings';

export function AppExceptionsSummary({
  rows,
  models,
  loading,
  onOpen,
}: {
  rows: AppExceptionRow[];
  models: ModelProfile[];
  loading: boolean;
  onOpen: () => void;
}) {
  const summary = summarizeAppExceptions(rows);
  const customRows = rows.filter((row) => row.custom);

  return (
    <section className="tpl-panel space-y-3 p-4" aria-labelledby="app-exceptions-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="app-exceptions-title" className="text-base font-semibold text-ink">
            应用例外
          </h2>
          <p className="mt-1 text-sm text-muted">
            {loading
              ? '正在读取应用设置…'
              : `${summary.inherited} 个应用继承常用模型，${summary.custom} 个自定义`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onOpen} disabled={loading || rows.length === 0}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          管理
        </Button>
      </div>

      {customRows.length > 0 && (
        <ul className="space-y-1.5 border-t border-border-subtle pt-3 text-sm">
          {customRows.slice(0, 3).map((row) => {
            const textName = modelNameById(models, row.textRoute?.primaryModelId);
            const visionName = modelNameById(models, row.multimodalRoute?.primaryModelId);
            const detail = [
              row.textRoute ? `文本 ${textName ?? '自定义'}` : null,
              row.multimodalRoute ? `看图 ${visionName ?? '自定义'}` : null,
            ].filter(Boolean).join(' · ');
            return (
              <li key={row.app.id} className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate font-medium text-ink">{row.app.name}</span>
                <span className="max-w-[60%] shrink-0 break-words text-right text-xs text-muted">
                  {detail}
                </span>
              </li>
            );
          })}
          {customRows.length > 3 && (
            <li className="text-xs text-muted">另有 {customRows.length - 3} 个自定义应用</li>
          )}
        </ul>
      )}
    </section>
  );
}
