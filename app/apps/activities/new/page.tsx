'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Plus,
  Trash2,
  UserPlus,
  Compass,
  ArrowRight,
} from 'lucide-react';
import { useCreateActivity } from '@/app/features/activities/mutations';
import { CharacterPickerDialog } from '@/app/features/activities/components/character-picker-dialog';
import { StagesEditor } from '@/app/features/activities/components/stages-editor';
import { PageHeader } from '@/app/components/shared/page-header';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import type { ActorSnapshot, StageDefinition } from '@sthstart/contracts';

export default function NewActivityPage() {
  const router = useRouter();

  // Basic info state
  const [title, setTitle] = useState('');
  const [type, setType] = useState('生活与聚会');
  const [theme, setTheme] = useState('');
  const [location, setLocation] = useState('');
  const [rules, setRules] = useState('');

  // Stages state: min 2 required
  const [stages, setStages] = useState<StageDefinition[]>([
    {
      id: 'stage_init_1',
      title: '第一阶段：到达与准备',
      order: 10,
      actorIds: ['actor_user'],
      location: '活动现场',
      instruction: '角色陆续到达，分工整理准备，展开最初的寒暄与交流。',
      requiredBeats: [],
      endCondition: '准备工作就绪',
      locked: false,
    },
    {
      id: 'stage_init_2',
      title: '第二阶段：高潮与留念',
      order: 20,
      actorIds: ['actor_user'],
      location: '活动现场',
      instruction: '活动核心环节进行，大家互动拍照并发布活动动态。',
      requiredBeats: [],
      endCondition: '完成合照并互道告别',
      locked: false,
    },
  ]);

  // Actors state
  const [actors, setActors] = useState<ActorSnapshot[]>([
    {
      id: 'actor_user',
      displayName: '旅行者',
      activityRole: '发起者',
      persona: {
        identity: '活动的组织者与记录者',
        personality: '热情、温和、善于倾听',
        appearance: '常服便装',
        speakingStyle: '亲切平实',
      },
      outfitDescription: '日常活动便服',
      appearanceReferenceAssetKeys: [],
    },
  ]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const createMutation = useCreateActivity();

  const handleAddActorSnapshot = (actor: ActorSnapshot) => {
    setActors((prev) => [...prev, actor]);
  };

  const handleRemoveActor = (actorId: string) => {
    if (actors.length <= 1) {
      setErrorMsg('活动至少需要保留一位参与角色');
      return;
    }
    setActors((prev) => prev.filter((a) => a.id !== actorId));
    setErrorMsg(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('请填写活动标题');
      return;
    }
    if (stages.length < 2) {
      setErrorMsg('活动必须包含至少两个阶段');
      return;
    }
    if (actors.length === 0) {
      setErrorMsg('活动至少需要一位参与角色');
      return;
    }

    setErrorMsg(null);

    try {
      const res = await createMutation.mutateAsync({
        title: title.trim(),
        type: type.trim(),
        theme: theme.trim(),
        location: location.trim(),
        rules: rules.trim(),
        stageTitles: stages.map((s) => s.title),
        actors: actors.map((a) => ({
          sourceCharacterId: a.sourceCharacterId,
          sourceVersion: a.sourceVersion,
          displayName: a.displayName,
          activityRole: a.activityRole,
          outfitDescription: a.outfitDescription,
          appearanceReferenceAssetKeys: a.appearanceReferenceAssetKeys,
        })),
      });

      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '创建活动失败');
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#f4f0e7] text-[#18201d] px-4 sm:px-8 md:px-12 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          backHref="/apps/activities"
          backLabel="返回活动列表"
          eyebrow="CREATE ACTIVITY"
          title="新建活动"
          description="设定活动基本主题、初始化情节阶段，并从角色库中选取并快照参与角色的人设设定。"
        />

        {errorMsg && (
          <Alert variant="danger" title="创建提示">
            {errorMsg}
          </Alert>
        )}

        <form onSubmit={handleCreate} className="space-y-6">
          {/* 1. Basic Metadata */}
          <div className="p-5 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-4 shadow-xs">
            <h3 className="text-sm font-bold text-[#18201d] flex items-center gap-2">
              <Compass className="h-4 w-4 text-[#e45d35]" />
              基本信息设定
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-[#18201d]">
                  活动标题 <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：海边营地烧烤与合照日、岚的生日派对"
                  className="h-9 text-xs bg-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#18201d]">活动类型</label>
                <Input
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="如：生活日常、旅行探险、剧情派对"
                  className="h-9 text-xs bg-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#18201d]">活动地点</label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="如：海边悬崖营地、长桌餐厅"
                  className="h-9 text-xs bg-transparent"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-[#18201d]">活动主题与梗概</label>
                <Input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="如：夏日傍晚布置灯串与长桌，共进晚餐并拍照留念"
                  className="h-9 text-xs bg-transparent"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-[#18201d]">活动规则或导演约束（可选）</label>
                <Textarea
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder="为 AI 生成提供行动指引（如：两人分工合作，澄负责挂灯串，不可提前剧透准备的惊喜蛋糕）…"
                  rows={2}
                  className="text-xs bg-transparent resize-none"
                />
              </div>
            </div>
          </div>

          {/* 2. Actors Snapshot Picker */}
          <div className="p-5 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#18201d] flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-[#e45d35]" />
                  参与角色与人设快照 ({actors.length})
                </h3>
                <p className="text-xs text-[#68716d]">
                  选入活动的角色将锁定此时的人设快照，即使角色库后续修改也不会破坏活动对话风格。
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                className="text-xs flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                从角色库添加
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {actors.map((act) => (
                <div
                  key={act.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[#faf8f2] border border-[rgb(24_32_29/10%)] relative group"
                >
                  <div className="relative h-12 w-10 rounded bg-stone-300 overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-semibold text-stone-700">
                    {act.appearanceReferenceAssetKeys?.[0] ? (
                      <Image
                        src={act.appearanceReferenceAssetKeys[0]}
                        alt={act.displayName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      act.displayName.slice(0, 1)
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pr-6 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#18201d] truncate">
                        {act.displayName}
                      </span>
                      <Badge variant="outline" className="text-[9px] bg-white">
                        {act.activityRole || '参与者'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-[#68716d] line-clamp-2 leading-tight">
                      {String(act.persona?.identity || '自定义参与角色')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveActor(act.id)}
                    disabled={actors.length <= 1}
                    className="absolute right-2 top-2 p-1 text-stone-400 hover:text-red-500 transition-colors disabled:opacity-20"
                    title="移除角色"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Stages Initial Setup */}
          <div className="p-5 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-4 shadow-xs">
            <StagesEditor
              stages={stages}
              actors={actors}
              onChange={setStages}
            />
          </div>

          {/* Submit bar */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push('/apps/activities')}
              className="text-xs"
            >
              取消
            </Button>

            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending}
              className="px-5 text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
            >
              <span>{createMutation.isPending ? '创建中…' : '创建并进入工作室'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </form>

        <CharacterPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingSourceCharacterIds={actors.map((a) => a.sourceCharacterId).filter(Boolean) as string[]}
          onSelectCharacter={handleAddActorSnapshot}
        />
      </div>
    </main>
  );
}
