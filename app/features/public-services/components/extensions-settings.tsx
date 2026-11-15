'use client';

import React from 'react';
import Link from 'next/link';
import { ImageIcon, KeyRound } from 'lucide-react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { OtherServicesPanel } from './other-services-panel';

const keyringLabels: Record<string, string> = {
  'native-windows': 'Windows 凭据管理器',
  'native-macos': 'macOS 钥匙串',
  'native-linux': 'Linux 密钥环',
  'secret-service': 'Secret Service',
  windows: 'Windows 凭据管理器',
  macos: 'macOS 钥匙串',
  file: '加密文件存储',
};

export function ExtensionsSettings({
  overview,
  onRefresh,
}: {
  overview: PublicServiceOverview | null;
  onRefresh: () => Promise<void>;
}) {
  const keyringLabel = overview?.keyring.backend
    ? keyringLabels[overview.keyring.backend] ?? overview.keyring.backend
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-surface-sunken/50 px-4 py-3">
        <p className="max-w-2xl text-sm text-muted">
          联网搜索用于查找网页；资料连接用于检索已接入的资料库。需要时再启用。
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            {overview
              ? overview.keyring.available
                ? `凭据：${keyringLabel ?? '已连接'}`
                : '凭据存储未连接'
              : '凭据状态读取中'}
          </span>
          <Link
            href="/settings/generation"
            className="inline-flex items-center gap-1.5 text-accent hover:underline"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            绘图方案与工作流
          </Link>
        </div>
      </div>

      <OtherServicesPanel overview={overview} onRefresh={onRefresh} />
    </div>
  );
}
