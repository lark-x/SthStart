'use client';
import { useState } from 'react';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import {
  CharacterBrowserPicker,
  activityActorFromCharacterSelection,
  type CharacterBrowserSelection,
} from '@/app/features/characters/public-ui';
import { useActivityCapabilities } from '@/app/features/activities/queries/activities';
import type { ActorSnapshot } from '@sthstart/contracts';

interface CharacterPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSourceCharacterIds: string[];
  existingActorCount: number;
  onSelectCharacter: (actor: ActorSnapshot) => void;
}
export function CharacterPickerDialog({
  open,
  onOpenChange,
  existingSourceCharacterIds,
  existingActorCount,
  onSelectCharacter,
}: CharacterPickerDialogProps) {
  const { data: capabilities } = useActivityCapabilities();
  const remaining = Math.max(
    0,
    (capabilities?.limits.maxActors ?? 20) - existingActorCount
  );
  const [selected, setSelected] = useState<
    Record<string, CharacterBrowserSelection>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = Object.values(selected).filter(
    (item) => !existingSourceCharacterIds.includes(item.profile.id)
  );
  const confirm = async () => {
    if (busy || !candidates.length) return;
    if (candidates.length > remaining) {
      setError(`本场还可加入 ${remaining} 位，请减少选择`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const actors = await Promise.all(
        candidates.map(activityActorFromCharacterSelection)
      );
      actors.forEach(onSelectCharacter);
      setSelected({});
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加入角色');
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
      title="选择活动角色"
      description="跨页选择角色、具名阶段、形态和服装，采用的设定将用于活动及生图。"
      className="max-w-4xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            已选 {candidates.length} 位 · 还可加入 {remaining} 位
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              disabled={
                busy || !candidates.length || candidates.length > remaining
              }
              onClick={() => void confirm()}
            >
              {busy ? '正在添加…' : `确认加入 ${candidates.length} 位`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <Alert variant="danger" title="无法加入角色">
            {error}
          </Alert>
        )}
        {!!candidates.length && (
          <div className="flex flex-wrap gap-2">
            {candidates.map((item) => (
              <Button
                key={item.profile.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelected((current) => {
                    const next = { ...current };
                    delete next[item.profile.id];
                    return next;
                  })
                }
              >
                {item.profile.displayName} ×
              </Button>
            ))}
          </div>
        )}
        <CharacterBrowserPicker
          active={open}
          selected={selected}
          maxSelected={remaining}
          disabled={busy}
          existingIds={existingSourceCharacterIds}
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
