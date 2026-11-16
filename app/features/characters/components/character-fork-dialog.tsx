'use client';

import { useMemo, useState } from 'react';
import { GitFork } from 'lucide-react';
import type { CharacterWork } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Checkbox } from '@/app/components/ui/checkbox';
import { useToast } from '@/app/providers/ui-provider';
import { useForkCharacterDerivative } from '../mutations';

export function CharacterForkDialog({
  open,
  onOpenChange,
  characterId,
  displayName,
  sourceWork,
  works,
  onForked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  displayName: string;
  sourceWork: string;
  works: CharacterWork[];
  onForked: (newCharacterId: string) => void;
}) {
  const toast = useToast();
  const forkMutation = useForkCharacterDerivative();
  const [targetWork, setTargetWork] = useState('');
  const [parentWorkDraft, setParentWorkDraft] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [shareAssets, setShareAssets] = useState(true);
  const parentWork = parentWorkDraft ?? sourceWork;

  const derivativeWorks = useMemo(() => {
    const normalizedSource = sourceWork.trim().toLowerCase();
    return works.filter((w) => {
      if (w.workNature !== 'derivative') return false;
      if (!normalizedSource) return true;
      return (w.parentWork || '').trim().toLowerCase() === normalizedSource;
    });
  }, [works, sourceWork]);

  const handleFork = async () => {
    const nextWork = targetWork.trim();
    if (!nextWork) {
      toast.warning('请先填写或选择一个目标同人作品名');
      return;
    }
    try {
      const result = await forkMutation.mutateAsync({
        id: characterId,
        payload: {
          targetWork: nextWork,
          parentWork: parentWork.trim() || undefined,
          summary: summary.trim() || undefined,
          shareAssets,
        },
      });
      toast.success(`已为「${displayName}」创建同人衍生版本（所属作品：${result.work.name}）`);
      setTargetWork('');
      setParentWorkDraft(null);
      setSummary('');
      onOpenChange(false);
      onForked(result.character.id);
    } catch (err) {
      toast.error('派生失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!forkMutation.isPending) onOpenChange(next);
      }}
      title={`复制「${displayName}」为同人衍生版`}
      description="从原作角色复制一份同人/AU/IF 专属设定，默认共享立绘与皮肤资产，改动只影响该同人作品。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={forkMutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            variant="accent"
            loading={forkMutation.isPending}
            disabled={!targetWork.trim()}
            onClick={() => void handleFork()}
            className="gap-1.5"
          >
            <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            <span>创建同人衍生版</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="fork-target-work" className="block text-xs font-semibold text-ink">
            目标同人作品名称
          </label>
          <Input
            id="fork-target-work"
            value={targetWork}
            onChange={(e) => setTargetWork(e.target.value)}
            placeholder="例如：枫丹现代歌剧社 AU、愚人众执行官 IF"
          />
          {derivativeWorks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {derivativeWorks.map((w) => (
                <Button
                  key={w.name}
                  type="button"
                  size="sm"
                  variant={targetWork.trim() === w.name ? 'secondary' : 'outline'}
                  onClick={() => setTargetWork(w.name)}
                  className="h-7 min-h-7 rounded-full px-2.5 text-xs"
                >
                  {w.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="fork-parent-work" className="block text-xs font-semibold text-ink">
            母原作（用于同源聚合与筛选联动）
          </label>
          <Input
            id="fork-parent-work"
            value={parentWork}
            onChange={(e) => setParentWorkDraft(e.target.value)}
            placeholder="例如：原神"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="fork-summary" className="block text-xs font-semibold text-ink">
            同人设定一句话概述（可选，留空沿用原版）
          </label>
          <Textarea
            id="fork-summary"
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="例如：现代大学歌剧社的毒舌但护短社长。"
          />
        </div>

        <Checkbox
          label="共享原角色立绘与皮肤资产（零拷贝引用，后续也可独立追加新图）"
          checked={shareAssets}
          onChange={(e) => setShareAssets(e.target.checked)}
        />
      </div>
    </Dialog>
  );
}
