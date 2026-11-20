'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GenerationTaskDescriptor } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { fetchImageGenerationOptions, type ImageGenerationSubmission } from '@/app/features/generation/image-api';
import { fetchCharacterGenerationTask } from '../api';
import { useApplyCharacterAvatar, useGenerateCharacterAvatar } from '../mutations';

type AvatarRefetch = () => Promise<unknown>;

/** 头像生成任务：配置读取、提交、轮询与结果采用。生成模块仍负责表单和参数准备。 */
export function useCharacterAvatarGeneration({
  characterId,
  enabled,
  refetchDetail,
}: {
  characterId?: string;
  enabled: boolean;
  refetchDetail: AvatarRefetch;
}) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pollError, setPollError] = useState('');
  const [result, setResult] = useState<GenerationTaskDescriptor | null>(null);
  const avatarOptions = useQuery({
    queryKey: ['generation', 'image-options', 'characters', 'character-avatar'],
    queryFn: () => fetchImageGenerationOptions('characters', 'character-avatar'),
    enabled,
  });
  const generateMutation = useGenerateCharacterAvatar();
  const applyMutation = useApplyCharacterAvatar();

  useEffect(() => {
    if (!taskId || !characterId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const task = await fetchCharacterGenerationTask(characterId, taskId);
        if (stopped) return;
        setPollError('');
        if (task.status === 'succeeded') {
          setTaskId(null);
          setResult(task);
          setPollError('');
          toast.success('头像生成完成，请预览后选择是否应用');
          return;
        }
        if (['failed', 'cancelled', 'abandoned'].includes(task.status)) {
          setTaskId(null);
          toast.error('头像生成失败', task.errorMessage || '生成任务未完成');
          return;
        }
        timer = window.setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!stopped) {
          setPollError(err instanceof Error ? err.message : String(err));
          timer = window.setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [characterId, taskId, toast]);

  const submit = async (input: ImageGenerationSubmission, variantId?: string) => {
    if (!characterId) throw new Error('请先保存角色。');
    const task = await generateMutation.mutateAsync({ id: characterId, input: { ...input, ...(variantId ? { variantId } : {}) } });
    setTaskId(task.id);
    toast.success('头像任务已提交');
  };

  /** 采用成功后返回 true，由调用方关闭生成面板。 */
  const apply = async () => {
    if (!characterId || !result) return false;
    try {
      await applyMutation.mutateAsync({ id: characterId, taskId: result.id });
      await refetchDetail();
      setResult(null);
      toast.success('已应用新头像');
      return true;
    } catch (error) {
      toast.error('应用头像失败', error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  return {
    avatarOptions,
    prompt,
    setPrompt,
    taskId,
    pollError,
    result,
    submit,
    apply,
    isApplying: applyMutation.isPending,
  };
}
