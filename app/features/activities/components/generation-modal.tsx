'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  RefreshCw,
  Check,
  Compass,
  MessageSquare,
  Layers,
} from 'lucide-react';
import type { Activity, StageDefinition, ActivityJob, ActivityCandidate } from '@sthstart/contracts';
import {
  useTriggerTextGeneration,
  useAdoptCandidate,
} from '../mutations';
import { useActivityJob } from '../queries';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';

interface GenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  stages: StageDefinition[];
  currentStageId?: string;
  onCandidateAdopted?: () => void;
}

export function GenerationModal({
  open,
  onOpenChange,
  activity,
  stages,
  currentStageId,
  onCandidateAdopted,
}: GenerationModalProps) {
  const [mode, setMode] = useState<'plan' | 'stage' | 'rewrite-records' | 'whole-text'>(
    currentStageId ? 'stage' : 'plan'
  );
  const [targetStageId, setTargetStageId] = useState<string>(currentStageId || stages[0]?.id || '');
  const [instruction, setInstruction] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const triggerMutation = useTriggerTextGeneration();
  const adoptMutation = useAdoptCandidate();

  // Poll active job
  const { data: jobData } = useActivityJob(activity.id, activeJobId || undefined);

  useEffect(() => {
    if (jobData?.candidates && jobData.candidates.length > 0) {
      const cand = jobData.candidates[jobData.candidates.length - 1];
      setActiveCandidateId(cand.id);
    }
  }, [jobData]);

  const handleStartGeneration = async () => {
    setErrorMsg(null);
    setActiveCandidateId(null);

    const scope: Record<string, unknown> = {};
    if (mode === 'stage' || mode === 'rewrite-records') {
      scope.stageId = targetStageId;
    }

    try {
      const job = await triggerMutation.mutateAsync({
        id: activity.id,
        input: {
          mode,
          userInstruction: instruction.trim() || undefined,
          scope,
          idempotencyKey: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        },
      });
      setActiveJobId(job.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动生成任务失败');
    }
  };

  const handleAdopt = async () => {
    if (!activeCandidateId) return;
    try {
      await adoptMutation.mutateAsync({
        id: activity.id,
        candidateId: activeCandidateId,
        expectedHeadVersion: activity.headVersion,
      });
      onCandidateAdopted?.();
      onOpenChange(false);
      setActiveJobId(null);
      setActiveCandidateId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '采用候选失败');
    }
  };

  const job = jobData?.job;
  const candidate = jobData?.candidates?.find((c) => c.id === activeCandidateId);
  const candidatePayload = candidate?.payload as Record<string, any> | undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI 活动内容生成与规划"
      description="基于角色快照与剧情约束生成内容。生成的结果为候选方案，必须由创作者明确确认后才会替换采用版本。"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            关闭
          </Button>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={triggerMutation.isPending || (job && job.status === 'running')}
              onClick={handleStartGeneration}
              className="text-xs flex items-center gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#e45d35]" />
              {candidate ? '重新生成' : '开始生成'}
            </Button>

            {candidate && (
              <Button
                size="sm"
                disabled={adoptMutation.isPending}
                onClick={handleAdopt}
                className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
              >
                <Check className="h-3.5 w-3.5" />
                采用并更新版本
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {errorMsg && (
          <Alert variant="danger" title="生成提示">
            {errorMsg}
          </Alert>
        )}

        {/* Mode Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'plan', label: '阶段规划', icon: Compass, desc: '构建整体情节骨架' },
            { id: 'stage', label: '阶段内容', icon: MessageSquare, desc: '生成群聊与朋友圈' },
            { id: 'rewrite-records', label: '局部重写', icon: RefreshCw, desc: '调整特定对话细节' },
            { id: 'whole-text', label: '整场生成', icon: Layers, desc: '逐阶段串行成文' },
          ].map((m) => {
            const Icon = m.icon;
            const isSelected = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id as any)}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-[#e45d35] bg-[#e45d35]/5 shadow-xs ring-1 ring-[#e45d35]'
                    : 'border-[rgb(24_32_29/10%)] hover:border-[#e45d35]/40 bg-[#faf8f2]'
                }`}
              >
                <Icon className={`h-4 w-4 mb-1.5 ${isSelected ? 'text-[#e45d35]' : 'text-[#68716d]'}`} />
                <div className="text-xs font-semibold text-[#18201d]">{m.label}</div>
                <div className="text-[10px] text-[#68716d] leading-tight mt-0.5">{m.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Stage selector if stage/rewrite */}
        {(mode === 'stage' || mode === 'rewrite-records') && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#18201d]">目标阶段</label>
            <Select
              value={targetStageId}
              onChange={(e) => setTargetStageId(e.target.value)}
              className="h-9 text-xs"
            >
              {stages.map((st, i) => (
                <option key={st.id} value={st.id}>
                  #{i + 1} {st.title} {st.locked ? '(已锁定)' : ''}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Instruction prompt */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#18201d]">生成指引与风格要求（可选）</label>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：着重描写晚餐时的温馨合照，岚要调侃一下澄的灯串挂反了…"
            rows={3}
            className="text-xs bg-transparent border-[rgb(24_32_29/14%)] resize-none"
          />
        </div>

        {/* Job Progress Indicator */}
        {job && job.status === 'running' && (
          <div className="p-3.5 rounded-lg bg-amber-50/50 border border-amber-200/80 flex items-center gap-3">
            <Spinner className="h-4 w-4 text-amber-600 animate-spin" />
            <div className="text-xs text-amber-900">
              AI 正在生成内容中（模式：{mode}）… 请稍候
            </div>
          </div>
        )}

        {/* Candidate Preview Area */}
        {candidate && candidatePayload && (
          <div className="p-3.5 rounded-lg bg-[#faf8f2] border border-[rgb(24_32_29/14%)] space-y-2.5 max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300">
                生成候选已就绪
              </Badge>
              <span className="text-[11px] text-[#68716d]">候选ID: {candidate.id.slice(0, 8)}…</span>
            </div>

            {candidatePayload.overview && (
              <div className="text-xs text-[#18201d] bg-white p-2 rounded border border-[rgb(24_32_29/10%)]">
                <span className="font-semibold">剧情规划概览：</span>
                {candidatePayload.overview}
              </div>
            )}

            {candidatePayload.summary && (
              <div className="text-xs text-[#18201d] bg-white p-2 rounded border border-[rgb(24_32_29/10%)]">
                <span className="font-semibold">阶段梗概：</span>
                {candidatePayload.summary}
              </div>
            )}

            {Array.isArray(candidatePayload.stages) && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-[#18201d]">规划阶段清单 ({candidatePayload.stages.length})：</div>
                {candidatePayload.stages.map((st: any, idx: number) => (
                  <div key={idx} className="text-xs p-2 rounded bg-white border border-[rgb(24_32_29/10%)] space-y-1">
                    <div className="font-medium text-[#18201d]">#{idx + 1} {st.title}（{st.location || '无地点'}）</div>
                    <div className="text-[11px] text-[#68716d]">{st.description || st.instruction}</div>
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(candidatePayload.messages) && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[#18201d]">
                  生成的群聊消息 ({candidatePayload.messages.length} 条)：
                </div>
                {candidatePayload.messages.slice(0, 5).map((msg: any, idx: number) => (
                  <div key={idx} className="text-[11px] text-[#18201d] p-1.5 rounded bg-white border border-stone-200">
                    <span className="font-medium text-[#e45d35]">{msg.speakerActorId || '角色'}: </span>
                    {msg.text}
                  </div>
                ))}
                {candidatePayload.messages.length > 5 && (
                  <div className="text-[10px] text-[#68716d] pl-1">
                    … 以及另外 {candidatePayload.messages.length - 5} 条消息
                  </div>
                )}
              </div>
            )}

            {Array.isArray(candidatePayload.posts) && candidatePayload.posts.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-xs font-semibold text-[#18201d]">
                  生成的朋友圈动态 ({candidatePayload.posts.length} 条)：
                </div>
                {candidatePayload.posts.map((post: any, idx: number) => (
                  <div key={idx} className="text-[11px] text-[#18201d] p-2 rounded bg-white border border-stone-200 space-y-1">
                    <div><span className="font-medium text-[#e45d35]">{post.authorActorId || '作者'}:</span> {post.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
