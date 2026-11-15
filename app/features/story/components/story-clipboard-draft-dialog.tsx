'use client';

import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { useState } from 'react';

export function StoryClipboardDraftDialog({ draft, onClose, onReplace, onAppend }: {
  draft: string | null;
  onClose: () => void;
  onReplace: (text: string) => void;
  onAppend: (text: string) => void;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  return <><Dialog open={draft !== null && !confirmReplace} onOpenChange={(open) => { if (!open) onClose(); }} title="采纳剪贴板草稿"
    description="先预览内容，再选择追加或替换。取消会保留当前正文。"
    footer={<>
      <Button variant="ghost" onClick={onClose}>取消</Button>
      <Button variant="outline" onClick={() => setConfirmReplace(true)}>替换全文</Button>
      <Button onClick={() => { if (draft !== null) onAppend(draft); }}>追加到文末</Button>
    </>}>
    <p className="max-h-64 whitespace-pre-wrap break-words text-sm text-muted">{draft}</p>
  </Dialog>
  <ConfirmDialog
    open={confirmReplace}
    onOpenChange={setConfirmReplace}
    title="替换当前全文？"
    description="当前正文会被剪贴板内容替换。建议先复制原稿；取消会保留当前正文。"
    confirmLabel="替换全文"
    danger
    onConfirm={() => {
      if (draft !== null) onReplace(draft);
      setConfirmReplace(false);
    }}
  />
  </>;
}
