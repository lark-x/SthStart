'use client';

import { useState } from 'react';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import {
  CharacterBrowserPicker,
  storyCharacterFromCharacterSelection,
  type CharacterBrowserSelection,
} from '@/app/features/characters/public-ui';
import { storyApi } from '../api';

interface StoryWorkCastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultWorkId?: string | null;
  existingSources: Set<string>;
  onCharacterAdded: () => void;
}

export function StoryWorkCastDialog({
  open,
  onOpenChange,
  projectId,
  defaultWorkId,
  existingSources,
  onCharacterAdded,
}: StoryWorkCastDialogProps) {
  const [selected, setSelected] = useState<
    Record<string, CharacterBrowserSelection>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const inputs = await Promise.all(
        Object.values(selected).map((selection) =>
          storyCharacterFromCharacterSelection(selection.profile, selection)
        )
      );
      const candidates = inputs.filter(
        (item) =>
          !existingSources.has(
            `${item.sourceCharacterId}:${item.sourceVersion}`
          )
      );
      if (!candidates.length)
        throw new Error('所选阶段已引入项目，请选择其他角色或阶段。');
      for (const input of candidates)
        await storyApi.createCharacter(projectId, input);
      setSelected({});
      onCharacterAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入角色失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="从角色库引入登场角色"
      description="按作品和同源成员选角，原创可选择已保存的具名阶段。"
      size="lg"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
          <Button
            disabled={busy || !Object.keys(selected).length}
            onClick={() => void confirm()}
          >
            {busy ? '正在引入…' : `引入所选 ${Object.keys(selected).length} 位`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <Alert variant="danger" title="无法引入角色">
            {error}
          </Alert>
        )}
        <CharacterBrowserPicker
          active={open}
          initialFilter={defaultWorkId ? { works: [defaultWorkId] } : undefined}
          selected={selected}
          disabled={busy}
          onSelectionChange={(selection, checked) =>
            setSelected((current) => {
              const next = { ...current };
              if (checked) next[selection.profile.id] = selection;
              else delete next[selection.profile.id];
              return next;
            })
          }
        />
      </div>
    </Dialog>
  );
}
