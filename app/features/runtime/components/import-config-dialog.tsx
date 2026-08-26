'use client';

import React from 'react';
import type { ImportPreview } from '../api';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';

export function ImportConfigDialog({
  open,
  onOpenChange,
  preview,
  onCommit,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ImportPreview | null;
  onCommit: () => Promise<void>;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="导入旧启动器配置"
      description="检测到以往本地启动器的旧配置，导入将把已有参数和工作流迁移到 SthStart。"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="accent" loading={loading} onClick={onCommit}>
            确认导入
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-xs text-[#68716d]">
        <div className="p-3 bg-[rgb(24_32_29/6%)] rounded">
          <div>
            <strong>启动器路径:</strong> {preview?.launcher.path || '未找到'}
          </div>
          <div>
            <strong>状态:</strong>{' '}
            {preview?.launcher.available ? '可用配置' : '不可用'}
          </div>
        </div>

        {preview?.businessError && (
          <div className="p-3 bg-[#c9674a]/10 text-[#c9674a] rounded">
            <strong>业务数据提示:</strong> {preview.businessError}
          </div>
        )}
      </div>
    </Dialog>
  );
}

