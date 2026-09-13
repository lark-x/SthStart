'use client';

import React, { useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Button } from './button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 说明会发生什么：包含对象名称与后果（§7.2）。 */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger：不可恢复删除等破坏性操作；确认按钮使用 danger 语义并默认聚焦取消。 */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * 统一确认弹窗（§7.2）：有对象名称、后果、取消和确认；
 * 危险操作默认聚焦取消按钮，确认过程中的重复提交被禁用。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      title={title}
      size="sm"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={submitting}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-muted leading-relaxed break-words">{description}</div>}
    </Dialog>
  );
}
