'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { Search, UserPlus, Check } from 'lucide-react';
import { useCharacters } from '@/app/features/characters/queries';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Skeleton } from '@/app/components/ui/skeleton';
import type { ActorSnapshot } from '@sthstart/contracts';

interface CharacterPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSourceCharacterIds: string[];
  onSelectCharacter: (actor: ActorSnapshot) => void;
}

export function CharacterPickerDialog({
  open,
  onOpenChange,
  existingSourceCharacterIds,
  onSelectCharacter,
}: CharacterPickerDialogProps) {
  const { data, isLoading } = useCharacters();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredCharacters = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!needle) return items;
    return items.filter((c) =>
      `${c.displayName} ${c.draft?.englishName || ''} ${c.draft?.work || ''} ${c.draft?.world || ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [data, search]);

  const handleConfirm = () => {
    if (!selectedId) return;
    const char = data?.items?.find((c) => c.id === selectedId);
    if (!char) return;

    const newActor: ActorSnapshot = {
      id: `actor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceCharacterId: char.id,
      sourceVersion: 1,
      displayName: char.displayName,
      activityRole: '参与者',
      persona: {
        identity: char.draft?.identity || char.displayName,
        personality: char.draft?.personality?.join('；') || '',
        appearance: char.draft?.appearance?.description || '',
        speakingStyle: char.draft?.speech?.tone || '',
      },
      avatarAssetKey: char.avatarUrl || undefined,
      outfitDescription: '日常活动便服',
      appearanceReferenceAssetKeys: char.avatarUrl ? [char.avatarUrl] : [],
    };

    onSelectCharacter(newActor);
    setSelectedId(null);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="从公共角色库添加人物快照"
      description="活动将锁定选定角色的当前人设快照，后续公共角色更新不会篡改本场活动剧本。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={!selectedId}
            onClick={handleConfirm}
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white"
          >
            确认添加快照
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-1">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-[#68716d]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索角色姓名、世界观或标签…"
            className="pl-9 h-9 bg-transparent border-[rgb(24_32_29/14%)] text-xs"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : filteredCharacters.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#68716d]">
              未找到匹配的角色
            </div>
          ) : (
            filteredCharacters.map((char) => {
              const isAdded = existingSourceCharacterIds.includes(char.id);
              const isSelected = selectedId === char.id;

              return (
                <div
                  key={char.id}
                  onClick={() => !isAdded && setSelectedId(char.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isAdded
                      ? 'opacity-50 cursor-not-allowed bg-stone-100 border-stone-200'
                      : isSelected
                      ? 'border-[#e45d35] bg-[#e45d35]/5 shadow-xs'
                      : 'border-[rgb(24_32_29/10%)] hover:border-[#e45d35]/40 bg-[#faf8f2]'
                  }`}
                >
                  <div className="relative h-12 w-10 rounded overflow-hidden bg-stone-300 flex-shrink-0 flex items-center justify-center text-sm font-semibold text-stone-600">
                    {char.avatarUrl ? (
                      <Image
                        src={char.avatarUrl}
                        alt={char.displayName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      char.displayName.slice(0, 1)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs text-[#18201d] truncate">
                        {char.displayName}
                      </span>
                      {isAdded && (
                        <span className="text-[10px] text-stone-500 font-medium">已添加</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#68716d] truncate">
                      {char.draft?.identity || char.draft?.work || '暂无详细身份'}
                    </p>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 text-[#e45d35] flex-shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
