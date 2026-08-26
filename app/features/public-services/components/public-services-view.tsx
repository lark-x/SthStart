'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import type { ProviderProfile } from '@sthstart/contracts';
import { usePublicOverview } from '../queries';
import {
  useCreateProfile,
  useCloneProfile,
  useDeleteProfile,
  useCreateApp,
  useUpdateAssignments,
} from '../mutations';
import { EMPTY_LLM, type LlmDraft } from '../api';
import { ProviderList } from './provider-list';
import { ProviderForm } from './provider-form';
import { AppModelRouting } from './app-model-routing';
import { AppTokens } from './app-tokens';
import { OtherProviders } from './other-providers';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';

function cloneProfileId(sourceId: string, existingIds: string[]) {
  const suffix = '-copy';
  const base = `${sourceId.slice(0, 63 - suffix.length).replace(/-+$/g, '')}${suffix}`;
  if (!existingIds.includes(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${sourceId.slice(0, 63 - `-copy-${n}`.length).replace(/-+$/g, '')}-copy-${n}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
  return `${sourceId.slice(0, 54)}-${Math.random().toString(36).slice(2, 8)}`;
}

function profileDraft(profile: ProviderProfile): LlmDraft {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model ?? '',
    secret: '',
    thinkingMode: profile.thinkingMode,
    headers: JSON.stringify(profile.headers, null, 2),
    extraBody: JSON.stringify(profile.extraBody, null, 2),
    capabilities: [...profile.capabilities],
    enabled: profile.enabled,
  };
}

export function PublicServicesSettings() {
  const toast = useToast();
  const { data: overview, isLoading, error: queryError, refetch } = usePublicOverview();

  const [llmDraft, setLlmDraft] = useState<LlmDraft>(EMPTY_LLM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const createProfileMutation = useCreateProfile();
  const cloneProfileMutation = useCloneProfile();
  const deleteProfileMutation = useDeleteProfile();
  const createAppMutation = useCreateApp();
  const updateAssignmentsMutation = useUpdateAssignments();

  const llmProfiles = useMemo(
    () => overview?.profiles.filter((p) => p.kind === 'llm') ?? [],
    [overview]
  );

  const handleBeginNew = () => {
    setEditingId(null);
    setCloneSourceId(null);
    setLlmDraft(EMPTY_LLM);
    setErrorMessage('');
  };

  const handleBeginEdit = (p: ProviderProfile) => {
    setEditingId(p.id);
    setCloneSourceId(null);
    setLlmDraft(profileDraft(p));
    setErrorMessage('');
  };

  const handleBeginClone = (p: ProviderProfile) => {
    setEditingId(null);
    setCloneSourceId(p.id);
    setLlmDraft({
      ...profileDraft(p),
      id: cloneProfileId(
        p.id,
        llmProfiles.map((item) => item.id)
      ),
      name: `${p.name} 副本`,
      secret: '',
      enabled: true,
    });
    setErrorMessage('');
  };

  const handleSaveLlm = async (draft: LlmDraft) => {
    setErrorMessage('');
    if (!draft.capabilities.length) {
      setErrorMessage('请至少选择一个模型能力标签。');
      toast.warning('请至少选择一个模型能力标签');
      return;
    }

    try {
      const payload = {
        ...draft,
        headers: draft.headers.trim() ? JSON.parse(draft.headers) : {},
        extraBody: draft.extraBody.trim() ? JSON.parse(draft.extraBody) : {},
        secret: draft.secret || undefined,
        kind: 'llm',
      };

      if (cloneSourceId) {
        await cloneProfileMutation.mutateAsync({ sourceId: cloneSourceId, payload });
        const successMsg = '模型配置已复制为独立副本。';
        toast.success(successMsg);
      } else {
        await createProfileMutation.mutateAsync(payload);
        const successMsg = editingId ? '模型配置已更新。' : '模型配置已创建。';
        toast.success(successMsg);
      }
      handleBeginNew();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error('保存失败', msg);
    }
  };

  const handleDeleteProfile = async (p: ProviderProfile) => {
    if (!window.confirm(`确认删除“${p.name}”？正在被应用使用的模型不会被删除。`)) return;
    try {
      await deleteProfileMutation.mutateAsync(p.id);
      toast.success('模型配置已删除。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error('删除失败', msg);
    }
  };

  const handleCreateApp = async (id: string, name: string) => {
    const created = await createAppMutation.mutateAsync({
      id,
      name,
      capabilities: ['llm', 'vector', 'image', 'persona', 'logs'],
    });
    toast.success('应用令牌已生成');
    return created.token;
  };

  const handleSaveAssignment = async (
    appId: string,
    assignments: { textProfileId: string | null; multimodalProfileId: string | null }
  ) => {
    try {
      await updateAssignmentsMutation.mutateAsync({ appId, assignments });
      toast.success('应用的生效模型已更新。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error('更新生效模型失败', msg);
      throw err;
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f0e7] text-[#18201d] px-4 sm:px-8 md:px-12 py-8 max-w-7xl mx-auto space-y-6 public-services-layout">
      <PageHeader
        backHref="/"
        backLabel="返回门户首页"
        eyebrow="GLOBAL AI FOUNDATION"
        title="公共服务底座"
        description="管理全局大语言模型模板库、应用角色绑定与系统凭据。遵循「LLM 模板 → 应用角色绑定 → 应用调用」模型：修改模板配置即时对所有绑定应用生效，密钥由系统安全凭据库管理。"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>刷新数据</span>
            </Button>
            <Button size="sm" variant="primary" onClick={handleBeginNew}>
              <span>新建模板</span>
            </Button>
          </div>
        }
      />

      {queryError && (
        <Alert variant="danger" title="公共服务加载失败">
          {queryError instanceof Error ? queryError.message : String(queryError)}
        </Alert>
      )}

      {isLoading && !overview && (
        <div className="space-y-4" aria-label="正在加载公共服务">
          <Skeleton className="h-36 w-full rounded-[4px_20px_4px_4px]" />
          <Skeleton className="h-56 w-full rounded-[4px_20px_4px_4px]" />
        </div>
      )}

      {errorMessage && (
        <div className="settings-alert" role="alert">
          {errorMessage}
        </div>
      )}

      {/* Overview Status Card */}
      <section className="settings-panel settings-summary rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/18%)] bg-[#fffdf8] p-6 shadow-sm">
        <p className="eyebrow text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
          SERVICE STATUS
        </p>
        <h2 className="font-serif text-2xl font-medium text-[#18201d] mt-1">公共服务底座</h2>
        <div className="metric-row flex gap-8 sm:gap-16 py-4 my-2 border-y border-[rgb(24_32_29/12%)]">
          <span>
            <strong className="font-serif text-3xl text-[#18201d]">
              {overview?.apps.length ?? '—'}
            </strong>{' '}
            应用
          </span>
          <span>
            <strong className="font-serif text-3xl text-[#18201d]">
              {llmProfiles.length || '—'}
            </strong>{' '}
            LLM 模型
          </span>
          <span>
            <strong className="font-serif text-3xl text-[#18201d]">
              {overview?.personas.length ?? '—'}
            </strong>{' '}
            角色模板
          </span>
        </div>
        <p className="settings-note text-xs text-[#68716d] mt-2">
          安全存储：{overview?.keyring.available ? `已连接 ${overview.keyring.backend}` : '不可用，仅允许环境变量回退；无法独立复制带密钥的配置'}
        </p>
      </section>

      {/* LLM Model Library */}
      <section className="settings-panel settings-wide rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/18%)] bg-[#fffdf8] p-6 space-y-4">
        <div className="settings-heading-row flex items-center justify-between pb-2 border-b border-[rgb(24_32_29/10%)]">
          <div>
            <p className="eyebrow text-[10px] font-bold uppercase tracking-wider text-[#b83b1b]">
              LLM TEMPLATE LIBRARY
            </p>
            <h2 className="font-serif text-2xl font-medium text-[#18201d]">公共 LLM 模板库</h2>
          </div>
          <button
            type="button"
            className="secondary-button min-h-[34px] px-3 border border-[rgb(24_32_29/17%)] rounded-lg text-xs font-semibold hover:bg-[rgb(24_32_29/6%)] transition-colors cursor-pointer"
            onClick={handleBeginNew}
          >
            新建模板
          </button>
        </div>
        <p className="settings-note text-xs text-[#68716d]">
          LLM 模板包含地址、密钥、模型 ID、思考模式与自定义参数。修改模板后，所有绑定该模板的应用发起的新请求即时生效。
        </p>

        <ProviderList
          profiles={llmProfiles}
          overview={overview}
          onEdit={handleBeginEdit}
          onClone={handleBeginClone}
          onDelete={handleDeleteProfile}
        />

        <ProviderForm
          draft={llmDraft}
          onReset={handleBeginNew}
          onSubmit={handleSaveLlm}
          editingId={editingId}
          cloneSourceId={cloneSourceId}
          loading={createProfileMutation.isPending || cloneProfileMutation.isPending}
        />
      </section>

      {/* App Model Routing */}
      <AppModelRouting
        overview={overview}
        profiles={llmProfiles}
        onSaveAssignment={handleSaveAssignment}
      />

      {/* App Tokens & Other Providers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AppTokens overview={overview} onCreateApp={handleCreateApp} />
        <OtherProviders
          overview={overview}
          onSaveOther={async (payload) => {
            await createProfileMutation.mutateAsync(payload);
            toast.success('能力配置已保存。');
          }}
        />
      </div>

      {/* Character Library Entry Link */}
      <section className="settings-panel settings-wide character-service-entry rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/18%)] bg-[#fffdf8] p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
        <div className="md:col-span-2 space-y-1">
          <p className="eyebrow text-[10px] font-bold uppercase tracking-wider text-[#b83b1b]">
            CHARACTER LIBRARY
          </p>
          <h2 className="font-serif text-2xl font-medium text-[#18201d]">公共角色资料</h2>
          <p className="settings-note text-xs text-[#68716d]">
            角色创作、资料来源、关系与发布版本已经迁移到独立资料库。这里仅展示公共服务状态，不再用一段人格提示词代替完整角色资料。
          </p>
        </div>
        <div className="flex justify-end">
          <Link
            className="character-service-link inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[3px_14px_3px_3px] bg-[#18201d] text-[#f4f0e7] font-semibold text-xs hover:bg-black transition-colors"
            href="/apps/characters"
          >
            <span>打开角色资料库 →</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
