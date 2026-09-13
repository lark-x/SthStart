'use client';

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import type { ProviderProfile, SavedProfileResponse } from '@sthstart/contracts';
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
import { PageContainer } from '@/app/components/shared/page-layout';
import { Button } from '@/app/components/ui/button';
import { buttonVariants } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';

const SECTION_IDS = ['models', 'routing', 'access'] as const;
type SectionId = (typeof SECTION_IDS)[number];
const DEFAULT_SECTION: SectionId = 'models';

function isSectionId(value: string | null): value is SectionId {
  return value !== null && (SECTION_IDS as readonly string[]).includes(value);
}

/**
 * 分类与目标应用完全以 URL 为唯一数据源（useSyncExternalStore）。
 * 不能用 useState 初始化器直接读 window：SSR 与客户端水合结果不一致会让
 * vinext 的水合恢复流程卡住，之后所有 setState 都不再提交。
 */
const locationListeners = new Set<() => void>();
function notifyLocationListeners() {
  for (const listener of locationListeners) listener();
}
function subscribeToLocation(callback: () => void) {
  locationListeners.add(callback);
  window.addEventListener('popstate', callback);
  return () => {
    locationListeners.delete(callback);
    window.removeEventListener('popstate', callback);
  };
}
function readSectionFromUrl(): SectionId {
  if (isSectionId(new URLSearchParams(window.location.search).get('section'))) {
    return new URLSearchParams(window.location.search).get('section') as SectionId;
  }
  if (window.location.hash === '#app-model-routing') return 'routing';
  return DEFAULT_SECTION;
}
function readTargetAppFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('app');
}

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

/**
 * 后端 ID 来自 cross-keychain，直接显示对运维没有意义；这里给出可读名称，
 * 便于区分“系统凭据库”和容器内使用的加密文件存储。
 */
const keyringBackendLabels: Record<string, string> = {
  'native-windows': '系统凭据管理器 (Windows)',
  'native-macos': '系统钥匙串 (macOS)',
  'native-linux': '系统密钥环 (Linux)',
  'secret-service': '系统密钥环 (Secret Service)',
  windows: 'Windows 凭据管理器',
  macos: 'macOS 钥匙串',
  file: '容器内加密文件存储',
};

function keyringLabel(backend: string | null | undefined) {
  return (backend && keyringBackendLabels[backend]) || backend || '未知后端';
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

  // 深链接约定：/settings/public-services?section=routing&app=activities；
  // 旧锚点 #app-model-routing 自动打开应用路由分类。服务端渲染固定返回默认分类，
  // 客户端挂载后立即切换到 URL 指定的分类，避免水合不一致。
  const section = useSyncExternalStore(subscribeToLocation, readSectionFromUrl, () => DEFAULT_SECTION);
  const targetApp = useSyncExternalStore(subscribeToLocation, readTargetAppFromUrl, () => null);

  const setSection = useCallback((next: SectionId, options: { app?: string | null } = {}) => {
    const params = new URLSearchParams(window.location.search);
    if (next === DEFAULT_SECTION && !options.app) params.delete('section');
    else params.set('section', next);
    if (next === 'routing' && options.app) params.set('app', options.app);
    else params.delete('app');
    const query = params.toString();
    window.history.pushState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${next === 'routing' ? '#app-model-routing' : ''}`);
    notifyLocationListeners();
  }, []);

  /** 不产生历史记录的分类切换：用于编辑器打开/保存后的归类恢复。 */
  const replaceSection = useCallback((next: SectionId) => {
    const params = new URLSearchParams(window.location.search);
    if (next === DEFAULT_SECTION) params.delete('section');
    else params.set('section', next);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    notifyLocationListeners();
  }, []);

  // 路由分类挂载后定位目标应用行；不存在时保留路由分类并提示未找到。
  useEffect(() => {
    if (section !== 'routing' || !targetApp || !overview) return;
    if (!overview.apps.some((app) => app.id === targetApp)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`app-row-${targetApp}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [section, targetApp, overview]);

  const [llmDraft, setLlmDraft] = useState<LlmDraft>(EMPTY_LLM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState('');

  // 目标应用不存在时提示未找到；由 overview 与 targetApp 派生，无需额外状态。
  const appNotFound = Boolean(
    section === 'routing' && targetApp && overview && !overview.apps.some((app) => app.id === targetApp)
  );

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
    setLlmDraft({ ...EMPTY_LLM });
    replaceSection(DEFAULT_SECTION);
    setEditorOpen(true);
    setErrorMessage('');
  };

  const handleBeginEdit = (p: ProviderProfile) => {
    setEditingId(p.id);
    setCloneSourceId(null);
    setLlmDraft(profileDraft(p));
    setEditorOpen(true);
    setErrorMessage('');
  };

  const handleBeginClone = (p: ProviderProfile) => {
    setEditingId(null);
    setCloneSourceId(p.id);
    setEditorOpen(true);
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
    /**
     * 配置已经保存成功，只有 API Key 没能写入凭据库时给出警告，
     * 不要让用户以为整次保存都失败了。
     */
    const reportSaveResult = (result: SavedProfileResponse, successMessage: string) => {
      if (result.secretStored) { toast.success(successMessage); return; }
      const message = result.warning ?? 'API Key 未保存，请改用环境变量提供密钥。';
      setErrorMessage(message);
      toast.warning('配置已保存，但 API Key 未保存', message);
    };

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

      let savedResult: SavedProfileResponse;
      let successMessage: string;
      if (cloneSourceId) {
        const result = await cloneProfileMutation.mutateAsync({ sourceId: cloneSourceId, payload });
        savedResult = result;
        successMessage = '模型配置已复制为独立副本。';
      } else {
        const result = await createProfileMutation.mutateAsync(payload);
        savedResult = result;
        successMessage = editingId ? '模型配置已更新。' : '模型配置已创建。';
      }
      setEditorOpen(false);
      setSearch('');
      replaceSection(DEFAULT_SECTION);
      reportSaveResult(savedResult, successMessage);
      const refreshed = await refetch();
      if (refreshed.error || !refreshed.data?.profiles.some((profile) => profile.id === savedResult.id)) {
        const message = '配置已保存，但列表未能确认最新结果。请刷新数据，不要重复添加。';
        setErrorMessage([savedResult.warning, message].filter(Boolean).join(' '));
        toast.warning('列表更新未完成', message);
      }
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

  const filteredProfiles = llmProfiles.filter((profile) =>
    [profile.name, profile.model, profile.id, profile.baseUrl].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const saving = createProfileMutation.isPending || cloneProfileMutation.isPending;

  return (
    <PageContainer width="settings" className="py-5 public-services-layout">
        <div className="space-y-4">
        <PageHeader
          title="模型与公共服务"
          description="管理模型模板与应用路由，配置修改后对绑定应用生效。"
        />
        <section aria-label="服务概况" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border-default bg-surface px-4 py-2 text-sm">
          <span><strong>{overview ? llmProfiles.length : '—'}</strong> 个模型</span>
          <span><strong>{overview?.apps.length ?? '—'}</strong> 个应用</span>
          <span className="text-muted">安全存储：{!overview ? '状态未知' : overview.keyring.available ? keyringLabel(overview.keyring.backend) : '未连接'}</span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Link href="/apps/characters" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>角色资料库</Link>
            <Link href="/settings/control-center" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>控制中心</Link>
            <Button size="sm" variant="ghost" onClick={() => void refetch()}><RefreshCw className="h-3.5 w-3.5" />刷新数据</Button>
          </div>
        </section>
        {queryError && <Alert variant="danger" title="公共服务加载失败">{queryError instanceof Error ? queryError.message : String(queryError)}。请刷新重试；已有配置不会因此删除。</Alert>}
        {errorMessage && !editorOpen && <Alert variant="warning" title="配置提示">{errorMessage}</Alert>}
        <nav className="flex flex-wrap gap-2 border-b border-border-default pb-2" aria-label="公共服务分类">
          {([['models', '模型模板'], ['routing', '应用路由'], ['access', '访问与其他能力']] as Array<[SectionId, string]>).map(([id, label]) =>
            <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)} className={`min-h-10 rounded-md px-4 text-sm font-medium ${section === id ? 'bg-accent text-white' : 'hover:bg-surface text-muted'}`}>{label}</button>)}
        </nav>
        <div hidden={section !== 'models'} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">模型模板 <span className="text-sm font-sans text-muted">{overview ? llmProfiles.length : '—'}</span></h2>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Input aria-label="搜索模型模板" placeholder="搜索名称、模型或地址" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 sm:w-64" />
              <Button size="sm" variant="primary" onClick={handleBeginNew}>新建模板</Button>
            </div>
          </div>
          {isLoading && !overview ? <Skeleton className="h-48 w-full rounded-lg" /> : !overview ?
            <p className="rounded-lg border border-dashed border-border-default p-6 text-sm text-muted">模型列表尚未加载，暂时无法确认已有配置。请先刷新数据。</p> :
            <ProviderList profiles={filteredProfiles} overview={overview} searching={Boolean(search.trim())} onEdit={handleBeginEdit} onClone={handleBeginClone} onDelete={handleDeleteProfile} onAssignToApps={() => setSection('routing')} />}
        </div>
        <div hidden={section !== 'routing'}>
          <AppModelRouting
            overview={overview}
            profiles={llmProfiles}
            onSaveAssignment={handleSaveAssignment}
            highlightAppId={targetApp}
            appNotFound={appNotFound}
          />
        </div>
        <div hidden={section !== 'access'} className="space-y-3">
          {overview && !overview.keyring.available && <Alert variant="warning" title="安全存储未连接">配置 KEYRING_FILE_MASTER_KEY 可启用容器内加密存储，或使用环境变量提供模型密钥。</Alert>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AppTokens overview={overview} onCreateApp={handleCreateApp} />
            <OtherProviders overview={overview} onSaveOther={async (payload) => { await createProfileMutation.mutateAsync(payload); toast.success('能力配置已保存。'); }} />
          </div>
        </div>
        <Dialog open={editorOpen} onOpenChange={(open) => { if (!saving) setEditorOpen(open); }} title={cloneSourceId ? '复制模型模板' : editingId ? '编辑模型模板' : '新建模型模板'} className="max-w-2xl">
          {errorMessage && <Alert variant="danger" title="配置提示">{errorMessage}</Alert>}
          <ProviderForm draft={llmDraft} onReset={() => setEditorOpen(false)} onSubmit={handleSaveLlm} editingId={editingId} cloneSourceId={cloneSourceId} loading={saving} />
        </Dialog>
        </div>
    </PageContainer>
  );
}
