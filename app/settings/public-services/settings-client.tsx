'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { PublicServiceOverview } from '@sthstart/contracts';

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `HTTP ${response.status}`));
  return payload as T;
}

export function PublicServicesSettings() {
  const [overview, setOverview] = useState<PublicServiceOverview | null>(null);
  const [error, setError] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const refresh = useCallback(async () => {
    try { setOverview(await api<PublicServiceOverview>('overview')); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => {
    let active = true;
    api<PublicServiceOverview>('overview').then(
      (value) => { if (active) { setOverview(value); setError(''); } },
      (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { active = false; };
  }, []);

  async function createApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const created = await api<{ token: string }>('apps', { method: 'POST', body: JSON.stringify({ id: data.get('id'), name: data.get('name'), capabilities: ['llm', 'vector', 'image', 'persona', 'logs'] }) });
      setIssuedToken(created.token); event.currentTarget.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const raw = Object.fromEntries(data);
      const headers = String(raw.headers ?? '').trim() ? JSON.parse(String(raw.headers)) : {};
      const extraBody = String(raw.extraBody ?? '').trim() ? JSON.parse(String(raw.extraBody)) : {};
      await api('profiles', { method: 'POST', body: JSON.stringify({ ...raw, headers, extraBody }) });
      event.currentTarget.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function createPersona(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      await api('personas', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(data), tags: String(data.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean) }) });
      event.currentTarget.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return (
    <div className="settings-grid">
      {error && <div className="settings-alert">{error}</div>}
      <section className="settings-panel settings-summary">
        <p className="eyebrow">SERVICE STATUS</p><h2>公共服务底座</h2>
        <div className="metric-row">
          <span><strong>{overview?.apps.length ?? '—'}</strong> 应用</span>
          <span><strong>{overview?.profiles.length ?? '—'}</strong> 供应商配置</span>
          <span><strong>{overview?.personas.length ?? '—'}</strong> 角色模板</span>
        </div>
        <p className="settings-note">安全存储：{overview?.keyring.available ? `已连接 ${overview.keyring.backend}` : '不可用，仅允许环境变量回退'}</p>
      </section>

      <section className="settings-panel"><p className="eyebrow">APPLICATION TOKENS</p><h2>接入应用</h2>
        <div className="record-list">{overview?.apps.map((item) => <div className="record" key={item.id}><strong>{item.name}</strong><code>{item.id}</code><span>{item.capabilities.join(' · ')}</span></div>)}</div>
        {issuedToken && <div className="one-time-token"><strong>仅显示一次，请立即保存</strong><code>{issuedToken}</code></div>}
        <form className="settings-form" onSubmit={createApp}><input name="id" placeholder="应用 ID，例如 my-app" required pattern="[a-z][a-z0-9-]+"/><input name="name" placeholder="应用名称" required/><button>创建应用令牌</button></form>
      </section>

      <section className="settings-panel"><p className="eyebrow">PROVIDER PROFILES</p><h2>能力配置</h2>
        <div className="record-list">{overview?.profiles.map((item) => <div className="record" key={item.id}><strong>{item.name}</strong><code>{item.kind} / {item.id}</code><span>{item.baseUrl} · 密钥 {item.hasCredential ? `来自${item.credentialSource}` : '未配置'}</span></div>)}</div>
        <form className="settings-form" onSubmit={saveProfile}>
          <input name="id" placeholder="配置 ID" required/><input name="name" placeholder="显示名称" required/>
          <select name="kind" defaultValue="llm"><option value="llm">LLM</option><option value="vector">向量</option><option value="image">图片 / ComfyUI</option></select>
          <input name="baseUrl" type="url" placeholder="上游 Base URL" required/><input name="model" placeholder="默认模型（可留空）"/><select name="thinkingMode" defaultValue="omit"><option value="omit">不发送思考参数</option><option value="disabled">关闭思考</option><option value="enabled">开启思考</option></select><textarea name="headers" placeholder={'自定义请求头 JSON（不允许放密钥）\n{"X-Custom":"value"}'}/><textarea name="extraBody" placeholder={'额外请求参数 JSON\n{"temperature":0.8}'}/><input name="secret" type="password" placeholder="API Key（保存到系统凭据库）" autoComplete="new-password"/>
          <button>保存能力配置</button>
        </form>
      </section>

      <section className="settings-panel"><p className="eyebrow">PERSONA CATALOG</p><h2>通用角色模板</h2>
        <div className="record-list">{overview?.personas.map((item) => <div className="record" key={item.id}><strong>{item.displayName}</strong><code>v{item.latestVersion}</code><span>{item.tags.join(' · ') || '暂无标签'}</span></div>)}</div>
        <form className="settings-form" onSubmit={createPersona}><input name="displayName" placeholder="角色名称" required/><textarea name="personaPrompt" placeholder="通用人格提示词" required/><textarea name="appearancePrompt" placeholder="外观提示词（可选）"/><input name="tags" placeholder="标签，以逗号分隔"/><button>创建 v1 模板</button></form>
        <p className="settings-note">应用导入的是固定版本快照。以后模板升级不会自动覆盖应用角色，也不会携带邻舍中的记忆、关系或情绪数据。</p>
      </section>
    </div>
  );
}
