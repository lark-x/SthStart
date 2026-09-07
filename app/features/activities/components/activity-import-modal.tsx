'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  CheckCircle2,
  FolderDown,
} from 'lucide-react';
import { useStageActivityZip, useCommitActivityImport } from '../mutations';
import type { StagedImportPreview } from '../api';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import { Badge } from '@/app/components/ui/badge';

interface ActivityImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ActivityImportModal({ open, onOpenChange }: ActivityImportModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stagedResult, setStagedResult] = useState<StagedImportPreview | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stageMutation = useStageActivityZip();
  const commitMutation = useCommitActivityImport();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setErrorMsg(null);
    setStagedResult(null);

    try {
      const preview = await stageMutation.mutateAsync(selected);
      setStagedResult(preview);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '解包校验活动文件失败');
    }
  };

  const handleCommit = async () => {
    if (!stagedResult) return;
    setErrorMsg(null);

    try {
      const res = await commitMutation.mutateAsync(stagedResult.importId);
      onOpenChange(false);
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入活动失败');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="导入活动工程包"
      description="选择此前导出的活动 ZIP 包。系统将重映射所有实体 ID 并注册媒体资源，创建一份全新的独立活动。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            取消
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={!stagedResult || commitMutation.isPending}
            onClick={handleCommit}
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
          >
            {commitMutation.isPending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {commitMutation.isPending ? '创建新活动中…' : '确认导入活动'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {errorMsg && (
          <Alert variant="danger" title="导入提示">
            {errorMsg}
          </Alert>
        )}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".zip,application/zip"
          className="hidden"
        />

        {/* Upload Area */}
        {!stagedResult && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[rgb(24_32_29/20%)] hover:border-[#e45d35]/60 bg-[#faf8f2] rounded-xl p-8 text-center cursor-pointer transition-colors space-y-3"
          >
            {stageMutation.isPending ? (
              <div className="space-y-2">
                <Spinner className="h-8 w-8 mx-auto text-[#e45d35] animate-spin" />
                <p className="text-xs text-[#18201d] font-medium">正在解析校验 ZIP 架构与素材哈希…</p>
              </div>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 mx-auto text-stone-400" />
                <div className="text-xs font-semibold text-[#18201d]">
                  点击选择活动 ZIP 文件，或拖入此处
                </div>
                <p className="text-[11px] text-[#68716d]">
                  支持包含 records.json 及媒体素材的活动包
                </p>
              </>
            )}
          </div>
        )}

        {/* Staged Preview */}
        {stagedResult && (
          <div className="p-4 rounded-lg bg-[#faf8f2] border border-[rgb(24_32_29/14%)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#18201d]">
                {stagedResult.preview.activity?.title || stagedResult.preview.title || '活动工程'}
              </span>
              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                校验通过
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-1">
              <div className="p-2 rounded bg-white border border-stone-200">
                <div className="text-xs font-bold text-[#18201d]">{stagedResult.preview.stageCount}</div>
                <div className="text-[10px] text-[#68716d]">阶段数量</div>
              </div>
              <div className="p-2 rounded bg-white border border-stone-200">
                <div className="text-xs font-bold text-[#18201d]">{stagedResult.preview.actorCount}</div>
                <div className="text-[10px] text-[#68716d]">角色数量</div>
              </div>
              <div className="p-2 rounded bg-white border border-stone-200">
                <div className="text-xs font-bold text-[#18201d]">
                  {stagedResult.preview.messageCount + stagedResult.preview.postCount}
                </div>
                <div className="text-[10px] text-[#68716d]">记录总数</div>
              </div>
              <div className="p-2 rounded bg-white border border-stone-200">
                <div className="text-xs font-bold text-[#18201d]">
                  {stagedResult.preview.assetCount ?? stagedResult.preview.mediaCount}
                </div>
                <div className="text-[10px] text-[#68716d]">媒体文件</div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStagedResult(null);
                  setFile(null);
                }}
                className="text-xs text-stone-500 hover:text-stone-800"
              >
                重新选择文件
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
