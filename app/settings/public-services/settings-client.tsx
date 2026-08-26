'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { LlmModelCapability, ProviderProfile, PublicServiceOverview } from '@sthstart/contracts';
import { adminFetch } from '@/app/lib/admin-fetch';

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await adminFetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `HTTP ${response.status}`));
  return payload as T;
}

type LlmDraft = {
  id: string; name: string; baseUrl: string; model: string; secret: string;
  thinkingMode: ProviderProfile['thinkingMode']; headers: string; extraBody: string;
  capabilities: LlmModelCapability[]; enabled: boolean;
};

const EMPTY_LLM: LlmDraft = {
  id: '', name: '', baseUrl: '', model: '', secret: '', thinkingMode: 'omit',
  headers: '{}', extraBody: '{}', capabilities: ['text'], enabled: true,
};

function profileDraft(profile: ProviderProfile): LlmDraft {
  return {
    id: profile.id, name: profile.name, baseUrl: profile.baseUrl, model: profile.model ?? '', secret: '',
    thinkingMode: profile.thinkingMode, headers: JSON.stringify(profile.headers, null, 2),
    extraBody: JSON.stringify(profile.extraBody, null, 2), capabilities: [...profile.capabilities], enabled: profile.enabled,
  };
}

function capabilityLabel(capability: LlmModelCapability) { return capability === 'text' ? '文本' : '多模态'; }

function cloneProfileId(sourceId: string, existingIds: string[]) {
  const suffix = '-copy';
  const base = `${sourceId.slice(0, 63 - suffix.length).replace(/-+$/g, '')}${suffix}`;
  if (!existingIds.includes(base)) return base;
  for (let number = 2; number < 10_000; number++) {
    const numberedSuffix = `-copy-${number}`;
    const candidate = `${sourceId.slice(0, 63 - numberedSuffix.length).replace(/-+$/g, '')}${numberedSuffix}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
  return `${sourceId.slice(0, 54)}-${crypto.randomUUID().slice(0, 8)}`;
}

export function PublicServicesSettings() {
  const [overview, setOverview] = useState<PublicServiceOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [llmDraft, setLlmDraft] = useState<LlmDraft>(EMPTY_LLM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const refresh = useCallback(async () => {
    try { setOverview(await api<PublicServiceOverview>('overview')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => {
    let active = true;
    api<PublicServiceOverview>('overview').then(
      (value) => { if (active) { setOverview(value); setError(''); } },
      (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { active = false; };
  }, []);

  const llmProfiles = useMemo(() => overview?.profiles.filter((item) => item.kind === 'llm') ?? [], [overview]);
  const otherProfiles = useMemo(() => overview?.profiles.filter((item) => item.kind !== 'llm') ?? [], [overview]);

  function showError(cause: unknown) { setNotice(''); setError(cause instanceof Error ? cause.message : String(cause)); }
  function beginNewLlm() { setEditingId(null); setCloneSourceId(null); setAvailableModels([]); setLlmDraft(EMPTY_LLM); setError(''); setNotice(''); }
  function beginEdit(profile: ProviderProfile) { setEditingId(profile.id); setCloneSourceId(null); setAvailableModels([]); setLlmDraft(profileDraft(profile)); setError(''); setNotice(''); }
  function beginClone(profile: ProviderProfile) {
    setEditingId(null); setCloneSourceId(profile.id); setAvailableModels([]);
    setLlmDraft({
      ...profileDraft(profile),
      id: cloneProfileId(profile.id, llmProfiles.map((item) => item.id)),
      name: `${profile.name} 副本`, secret: '', enabled: true,
    }); setError(''); setNotice('');
  }
  function updateDraft<K extends keyof LlmDraft>(key: K, value: LlmDraft[K]) { setLlmDraft((current) => ({ ...current, [key]: value })); }
  function toggleCapability(capability: LlmModelCapability) {
    setLlmDraft((current) => ({ ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((item) => item !== capability) : [...current.capabilities, capability] }));
  }

  async function discoverModels() {
    if (!llmDraft.baseUrl.trim()) { setError('请先填写 API 地址。'); return; }
    setDiscovering(true); setError(''); setNotice('');
    try {
      const headers = llmDraft.headers.trim() ? JSON.parse(llmDraft.headers) : {};
      const result = await api<{ models: string[] }>('llm/models/discover', { method: 'POST', body: JSON.stringify({ profileId: editingId ?? cloneSourceId ?? undefined, baseUrl: llmDraft.baseUrl, secret: llmDraft.secret || undefined, headers }) });
      setAvailableModels(result.models); setNotice(`已获取 ${result.models.length} 个模型，可搜索选择，也可以继续手动填写。`);
    } catch (cause) { showError(cause); }
    finally { setDiscovering(false); }
  }

  async function saveLlm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      if (!llmDraft.capabilities.length) throw new Error('请至少选择一个模型能力标签。');
      const payload = { ...llmDraft, headers: llmDraft.headers.trim() ? JSON.parse(llmDraft.headers) : {}, extraBody: llmDraft.extraBody.trim() ? JSON.parse(llmDraft.extraBody) : {}, secret: llmDraft.secret || undefined, kind: 'llm' };
      if (cloneSourceId) await api(`profiles/${cloneSourceId}/clone`, { method: 'POST', body: JSON.stringify(payload) });
      else await api('profiles', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(cloneSourceId ? '模型配置已复制为独立副本。' : editingId ? '模型配置已更新。' : '模型配置已创建。');
      setEditingId(null); setCloneSourceId(null); setAvailableModels([]); setLlmDraft(EMPTY_LLM); await refresh();
    } catch (cause) { showError(cause); }
  }

  async function removeProfile(profile: ProviderProfile) {
    if (!window.confirm(`确认删除“${profile.name}”？正在被应用使用的模型不会被删除。`)) return;
    try { await api(`profiles/${profile.id}`, { method: 'DELETE' }); setNotice('模型配置已删除。'); await refresh(); }
    catch (cause) { showError(cause); }
  }

  async function createApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try { const created = await api<{ token: string }>('apps', { method: 'POST', body: JSON.stringify({ id: data.get('id'), name: data.get('name'), capabilities: ['llm', 'vector', 'image', 'persona', 'logs'] }) }); setIssuedToken(created.token); form.reset(); await refresh(); }
    catch (cause) { showError(cause); }
  }

  async function saveOtherProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try { await api('profiles', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(data), headers: {}, extraBody: {} }) }); form.reset(); setNotice('能力配置已保存。'); await refresh(); }
    catch (cause) { showError(cause); }
  }

  async function saveAssignments(appId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api(`apps/${appId}/llm-assignments`, { method: 'PUT', body: JSON.stringify({ textProfileId: data.get('textProfileId') || null, multimodalProfileId: data.get('multimodalProfileId') || null }) }); setNotice('应用的生效模型已更新。'); await refresh(); }
    catch (cause) { showError(cause); }
  }

  return (
    <div className="settings-grid public-services-layout">
      {error && <div className="settings-alert" role="alert">{error}</div>}
      {notice && <div className="settings-notice" role="status">{notice}</div>}

      <section className="settings-panel settings-summary">
        <p className="eyebrow">SERVICE STATUS</p><h2>公共服务底座</h2>
        <div className="metric-row"><span><strong>{overview?.apps.length ?? '—'}</strong> 应用</span><span><strong>{llmProfiles.length || '—'}</strong> LLM 模型</span><span><strong>{overview?.personas.length ?? '—'}</strong> 角色模板</span></div>
        <p className="settings-note">安全存储：{overview?.keyring.available ? `已连接 ${overview.keyring.backend}` : '不可用，仅允许环境变量回退；无法独立复制带密钥的配置'}</p>
      </section>

      <section className="settings-panel settings-wide"><div className="settings-heading-row"><div><p className="eyebrow">LLM MODEL LIBRARY</p><h2>公共模型</h2></div><button className="secondary-button" type="button" onClick={beginNewLlm}>新建模型</button></div>
        <p className="settings-note">一个 API 地址可以保存多个模型。能力标签由你确认，系统不会根据名称猜测。</p>
        <div className="model-card-grid">
          {llmProfiles.map((profile) => {
            const usedBy = overview?.llmAssignments.filter((assignment) => assignment.textProfileId === profile.id || assignment.multimodalProfileId === profile.id).map((assignment) => overview.apps.find((item) => item.id === assignment.appId)?.name ?? assignment.appId) ?? [];
            return <article className={`model-card ${profile.enabled ? '' : 'model-disabled'}`} key={profile.id}><div className="model-card-head"><div><strong>{profile.name}</strong><code>{profile.model || '尚未选择模型'}</code></div><span className={`model-status ${profile.enabled ? 'active' : ''}`}>{profile.enabled ? '可用' : '停用'}</span></div><div className="model-tags">{profile.capabilities.map((capability) => <span key={capability}>{capabilityLabel(capability)}</span>)}</div><small>{profile.baseUrl}</small><small>凭据：{profile.hasCredential ? profile.credentialSource : '未配置'}</small><small>使用方：{usedBy.join('、') || '尚未分配'}</small><div className="model-actions"><button type="button" onClick={() => beginEdit(profile)}>编辑</button><button type="button" onClick={() => beginClone(profile)}>复制配置</button><button type="button" className="danger-text" onClick={() => void removeProfile(profile)}>删除</button></div></article>;
          })}
          {!llmProfiles.length && <div className="empty-models">还没有公共 LLM 模型。先创建一个配置，再为应用选择生效模型。</div>}
        </div>

        <form className="settings-form llm-editor" onSubmit={saveLlm}>
          <div className="editor-title"><div><p className="eyebrow">{cloneSourceId ? 'CLONE MODEL' : editingId ? 'EDIT MODEL' : 'NEW MODEL'}</p><h3>{cloneSourceId ? '复制为独立配置' : editingId ? '编辑模型配置' : '添加模型配置'}</h3></div>{(editingId || cloneSourceId) && <button type="button" className="text-button" onClick={beginNewLlm}>取消</button>}</div>
          <div className="form-columns">
            <label>配置 ID<input value={llmDraft.id} disabled={Boolean(editingId)} onChange={(event) => updateDraft('id', event.target.value.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, ''))} placeholder="例如 deepseek-chat" required pattern="[a-z][a-z0-9-]+" maxLength={63} title="以小写字母开头，只能使用小写字母、数字和连字符"/><small>以小写字母开头，只能使用小写字母、数字和连字符。</small></label>
            <label>显示名称<input value={llmDraft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="例如 DeepSeek 对话" required/></label>
            <label className="span-two">API Base URL<input type="url" value={llmDraft.baseUrl} onChange={(event) => updateDraft('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" required/></label>
            {!cloneSourceId && <label className="span-two">API Key<input type="password" value={llmDraft.secret} onChange={(event) => updateDraft('secret', event.target.value)} placeholder={editingId ? '留空表示保持原 Key' : '保存到系统凭据库'} autoComplete="new-password"/></label>}
            <label className="span-two model-picker-label">模型 ID<div className="model-picker-row"><input list="public-llm-models" value={llmDraft.model} onChange={(event) => updateDraft('model', event.target.value)} placeholder="可获取列表，也可手动输入" required/><button type="button" onClick={() => void discoverModels()} disabled={discovering}>{discovering ? '正在获取…' : '获取模型'}</button></div><datalist id="public-llm-models">{availableModels.map((model) => <option value={model} key={model}/>)}</datalist></label>
            <label>思考参数<select value={llmDraft.thinkingMode} onChange={(event) => updateDraft('thinkingMode', event.target.value as ProviderProfile['thinkingMode'])}><option value="omit">不发送</option><option value="disabled">关闭思考</option><option value="enabled">开启思考</option></select></label>
            <label className="inline-check"><input type="checkbox" checked={llmDraft.enabled} onChange={(event) => updateDraft('enabled', event.target.checked)}/> 启用此配置</label>
          </div>
          <fieldset className="capability-picker"><legend>模型能力</legend><label><input type="checkbox" checked={llmDraft.capabilities.includes('text')} onChange={() => toggleCapability('text')}/> 文本</label><label><input type="checkbox" checked={llmDraft.capabilities.includes('multimodal')} onChange={() => toggleCapability('multimodal')}/> 多模态（文本＋图片输入）</label></fieldset>
          {!cloneSourceId && <details><summary>高级请求设置</summary><div className="form-columns advanced-fields"><label>自定义请求头 JSON<textarea value={llmDraft.headers} onChange={(event) => updateDraft('headers', event.target.value)}/></label><label>额外请求参数 JSON<textarea value={llmDraft.extraBody} onChange={(event) => updateDraft('extraBody', event.target.value)}/></label></div></details>}
          <button>{cloneSourceId ? '创建独立副本' : editingId ? '保存修改' : '保存模型配置'}</button>
        </form>
      </section>

      <section className="settings-panel settings-wide" id="app-model-routing"><p className="eyebrow">APP MODEL ROUTING</p><h2>应用生效模型</h2><p className="settings-note">每个应用分别选择文本与多模态模型。邻舍是系统内置应用，令牌由主服务自动注入；未选择模型时对应请求会明确报错。</p>
        <div className="assignment-grid">{overview?.apps.map((managedApp) => {
          const assignment = overview.llmAssignments.find((item) => item.appId === managedApp.id);
          const textOptions = llmProfiles.filter((profile) => profile.enabled && profile.capabilities.includes('text'));
          const multimodalOptions = llmProfiles.filter((profile) => profile.enabled && profile.capabilities.includes('multimodal'));
          return <form className="assignment-card" key={managedApp.id} onSubmit={(event) => void saveAssignments(managedApp.id, event)}><div><strong>{managedApp.name}{managedApp.id === 'linshe' && <span className="system-app-badge">系统</span>}</strong><code>{managedApp.id}</code></div><label>文本模型<select name="textProfileId" defaultValue={assignment?.textProfileId ?? ''} key={`text-${assignment?.textProfileId}`}><option value="">尚未选择</option>{textOptions.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.model}</option>)}</select></label><label>多模态模型<select name="multimodalProfileId" defaultValue={assignment?.multimodalProfileId ?? ''} key={`multi-${assignment?.multimodalProfileId}`}><option value="">尚未选择</option>{multimodalOptions.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.model}</option>)}</select></label><button>保存应用选择</button>{!assignment?.textProfileId && <small className="assignment-warning">必须选择文本模型后，邻舍公共聊天才可用</small>}{assignment?.textProfileId && !assignment?.multimodalProfileId && <small className="assignment-warning">多模态未配置，仅图片输入不可用</small>}</form>;
        })}</div>
      </section>

      <section className="settings-panel"><p className="eyebrow">APPLICATION TOKENS</p><h2>接入应用</h2><div className="record-list">{overview?.apps.map((item) => <div className="record" key={item.id}><strong>{item.name}{item.id === 'linshe' && <span className="system-app-badge">系统托管</span>}</strong><code>{item.id}</code><span>{item.capabilities.join(' · ')}</span></div>)}</div>{issuedToken && <div className="one-time-token"><strong>仅显示一次，请立即保存</strong><code>{issuedToken}</code></div>}<form className="settings-form" onSubmit={createApp}><input name="id" placeholder="应用 ID，例如 my-app" required pattern="[a-z][a-z0-9-]+"/><input name="name" placeholder="应用名称" required/><button>创建应用令牌</button></form></section>

      <section className="settings-panel"><p className="eyebrow">OTHER PROVIDERS</p><h2>向量与图片能力</h2><div className="record-list">{otherProfiles.map((item) => <div className="record" key={item.id}><strong>{item.name}</strong><code>{item.kind} / {item.id}</code><span>{item.baseUrl} · 密钥 {item.hasCredential ? `来自${item.credentialSource}` : '未配置'}</span></div>)}</div><form className="settings-form" onSubmit={saveOtherProfile}><input name="id" placeholder="配置 ID" required/><input name="name" placeholder="显示名称" required/><select name="kind" defaultValue="vector"><option value="vector">向量</option><option value="image">图片 / ComfyUI</option></select><input name="baseUrl" type="url" placeholder="上游 Base URL" required/><input name="model" placeholder="模型（可留空）"/><input name="secret" type="password" placeholder="API Key（可选）" autoComplete="new-password"/><button>保存能力配置</button></form></section>

      <section className="settings-panel settings-wide character-service-entry"><div><p className="eyebrow">CHARACTER LIBRARY</p><h2>公共角色资料</h2><p className="settings-note">角色创作、资料来源、关系与发布版本已经迁移到独立资料库。这里仅展示公共服务状态，不再用一段人格提示词代替完整角色资料。</p></div><div className="record-list">{overview?.personas.slice(0, 4).map((item) => <div className="record" key={item.id}><strong>{item.displayName}</strong><code>v{item.latestVersion}</code><span>{item.tags.join(' · ') || '暂无标签'}</span></div>)}</div><Link className="character-service-link" href="/apps/characters">打开角色资料库 →</Link></section>
    </div>
  );
}
