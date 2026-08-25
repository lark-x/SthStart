'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { LogEvent, LogLevel, LogPolicy, RuntimeOverview, RuntimeSettings } from '@sthstart/contracts';

type Tab = 'overview' | 'runtime' | 'creative' | 'models' | 'logs';
type ImportPreview = { launcher: { available: boolean; path: string | null; settings: Partial<RuntimeSettings> | null }; business: Record<string, unknown> | null; businessError: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `HTTP ${response.status}`));
  return payload as T;
}

async function linsheLaunchUrl() {
  try {
    const response = await fetch('/api/apps/linshe', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json() as { launchUrl?: unknown };
      if (typeof payload.launchUrl === 'string' && payload.launchUrl.trim()) return payload.launchUrl;
    }
  } catch {
    // Fall back to the portal route so a remote browser never receives the
    // Mac-only 127.0.0.1 address when the registry is temporarily unavailable.
  }
  return new URL('/apps/linshe', window.location.href).toString();
}

function stateLabel(state: string) {
  return ({ running: '运行中', starting: '启动中', stopping: '停止中', stopped: '已停止', external: '外部启动', degraded: '降级', error: '异常' } as Record<string, string>)[state] ?? state;
}

function plusMinutes(minutes: number) { return new Date(Date.now() + minutes * 60_000).toISOString(); }

export function ControlCenter() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<RuntimeOverview | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const refresh = useCallback(async () => {
    try { setOverview(await api<RuntimeOverview>('runtime/overview')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);

  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => void refresh(), 4_000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  useEffect(() => {
    void api<{ items: LogEvent[] }>('logs?limit=500').then((result) => setLogs(result.items)).catch(() => undefined);
    const source = new EventSource('/api/admin/logs/stream');
    source.onmessage = (message) => {
      if (paused) return;
      try { const item = JSON.parse(message.data) as LogEvent; setLogs((current) => [...current.slice(-1_999), item]); } catch { /* ignore malformed frames */ }
    };
    return () => source.close();
  }, [paused]);

  async function command(action: 'start' | 'stop' | 'restart', id = 'linshe') {
    setBusy(`${id}:${action}`); setError('');
    const popup = action === 'start' && id === 'linshe' && overview?.settings.autoOpenBrowser ? window.open('', '_blank') : null;
    try { await api(`runtime/services/${id}/${action}`, { method: 'POST' }); if (popup) popup.location.href = await linsheLaunchUrl(); await new Promise((resolve) => setTimeout(resolve, 600)); await refresh(); }
    catch (cause) { popup?.close(); const message = cause instanceof Error ? cause.message : String(cause); setError(message === 'comfyui_not_running' ? '没有检测到 ComfyUI。请先启动 ComfyUI，或在运行配置中关闭启动前检查。' : message); }
    finally { setBusy(''); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!overview) return;
    const data = new FormData(event.currentTarget);
    const next: Partial<RuntimeSettings> = {
      autoStart: data.get('autoStart') === 'on', autoOpenBrowser: data.get('autoOpenBrowser') === 'on',
      checkComfyuiBeforeStart: data.get('checkComfyuiBeforeStart') === 'on', useMirror: data.get('useMirror') === 'on',
      comfyuiExecutable: String(data.get('comfyuiExecutable') ?? ''),
      extraLoraFolders: String(data.get('extraLoraFolders') ?? '').split(';').map((value) => value.trim()).filter(Boolean),
      maibotAutostart: data.get('maibotAutostart') === 'on',
    };
    try { await api('runtime/settings', { method: 'PUT', body: JSON.stringify(next) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function saveCreative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!overview) return;
    const data = new FormData(event.currentTarget); const old = overview.settings.creative as Record<string, unknown>;
    const comfy = { ...(old.comfy as object ?? {}), url: String(data.get('comfyUrl') ?? ''), width: Number(data.get('width')), height: Number(data.get('height')), tlsVerify: data.get('tlsVerify') === 'on' };
    const features = { ...(old.features as object ?? {}), memory: data.get('memory') === 'on', proactiveChat: data.get('proactiveChat') === 'on', events: data.get('events') === 'on', weather: data.get('weather') === 'on' };
    const creative = { ...old, comfy, features, workflow: { ...(old.workflow as object ?? {}), mode: String(data.get('workflowMode') ?? 'turbo') }, groupChat: { ...(old.groupChat as object ?? {}), temperature: Number(data.get('temperature')), summaryInterval: Number(data.get('summaryInterval')) } };
    try { await api('runtime/settings', { method: 'PUT', body: JSON.stringify({ creative }) }); await api('runtime/settings/apply', { method: 'POST' }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function updatePolicy(patch: Partial<LogPolicy>) {
    try { await api('logging/policy', { method: 'PUT', body: JSON.stringify(patch) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function loadImport() { try { setPreview(await api<ImportPreview>('runtime/imports/linshe/preview')); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  async function commitImport() { if (!preview) return; try { await api('runtime/imports/linshe/commit', { method: 'POST', body: JSON.stringify({ launcher: preview.launcher.available, business: preview.business }) }); setPreview(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  async function downloadDiagnostics() {
    const response = await fetch('/api/admin/diagnostics/export', { method: 'POST' });
    if (!response.ok) { setError('诊断包生成失败'); return; }
    const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sthstart-diagnostics-${Date.now()}.json.gz`; anchor.click(); URL.revokeObjectURL(url);
  }

  const filteredLogs = useMemo(() => logs.filter((item) => (!serviceFilter || item.serviceId === serviceFilter) && (!query || item.message.toLowerCase().includes(query.toLowerCase()))), [logs, query, serviceFilter]);
  const creative = (overview?.settings.creative ?? {}) as Record<string, unknown>;
  const comfy = (creative.comfy ?? {}) as Record<string, unknown>; const features = (creative.features ?? {}) as Record<string, unknown>;
  const workflow = (creative.workflow ?? {}) as Record<string, unknown>; const group = (creative.groupChat ?? {}) as Record<string, unknown>;

  return <div className="control-center">
    <nav className="control-tabs" aria-label="控制中心页面">
      {([['overview', '概览'], ['runtime', '运行配置'], ['creative', '创作配置'], ['models', '模型服务'], ['logs', '日志诊断']] as [Tab, string][]).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <div className="settings-alert">{error}</div>}

    {tab === 'overview' && <section className="control-grid">
      <article className="control-panel control-primary"><p className="eyebrow">NEIGHBORHOOD STACK</p><div className="control-title-row"><h2>邻舍运行栈</h2><span className={`runtime-pill state-${overview?.services.some((item) => item.state === 'running') ? 'running' : 'stopped'}`}>{overview?.services.filter((item) => item.state === 'running').length ?? 0} 项运行</span></div>
        <div className="runtime-actions"><button disabled={Boolean(busy)} onClick={() => void command('start')}>▶ 启动邻舍</button><button className="quiet" disabled={Boolean(busy)} onClick={() => void command('stop')}>■ 全部停止</button><button className="quiet" disabled={Boolean(busy)} onClick={() => void api('runtime/comfyui/start', { method: 'POST' }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>启动 ComfyUI</button></div>
      </article>
      <article className="control-panel metric-panel"><span>最近 24 小时异常</span><strong>{overview?.recentErrors ?? '—'}</strong><small>日志溢出丢弃 {overview?.droppedLogs ?? 0} 条</small></article>
      <div className="service-board">{overview?.services.map((service) => <article className="service-row" key={service.id}><span className={`service-light state-${service.state}`} /><div><strong>{service.name}</strong><small>:{service.port} · {stateLabel(service.state)}{service.pid ? ` · PID ${service.pid}` : ''}</small></div><div className="service-row-actions"><button disabled={!service.installed || service.state === 'external' || Boolean(busy)} onClick={() => void command(service.managed ? 'restart' : 'start', service.id)}>{service.managed ? '重启' : '启动'}</button>{service.managed && <button onClick={() => void command('stop', service.id)}>停止</button>}</div></article>)}</div>
    </section>}

    {tab === 'runtime' && <section className="control-grid">
      <form className="control-panel control-form" onSubmit={saveSettings}><p className="eyebrow">STARTUP SETTINGS</p><h2>运行配置</h2>
        <label>ComfyUI 启动器路径<input name="comfyuiExecutable" defaultValue={overview?.settings.comfyuiExecutable}/></label>
        <label>额外 LoRA 文件夹<input name="extraLoraFolders" defaultValue={overview?.settings.extraLoraFolders.join(';')} placeholder="多个路径以 ; 分隔"/></label>
        <div className="switch-list"><label><input type="checkbox" name="autoStart" defaultChecked={overview?.settings.autoStart}/> 主项目启动时自动启动邻舍</label><label><input type="checkbox" name="autoOpenBrowser" defaultChecked={overview?.settings.autoOpenBrowser}/> 就绪后自动打开邻舍</label><label><input type="checkbox" name="checkComfyuiBeforeStart" defaultChecked={overview?.settings.checkComfyuiBeforeStart}/> 启动前检查 ComfyUI</label><label><input type="checkbox" name="useMirror" defaultChecked={overview?.settings.useMirror}/> 安装依赖时使用国内镜像</label><label><input type="checkbox" name="maibotAutostart" defaultChecked={overview?.settings.maibotAutostart}/> 同时启动 MaiBot</label></div><button type="submit">保存运行配置</button>
      </form>
      <article className="control-panel"><p className="eyebrow">ONE-TIME IMPORT</p><h2>导入原 EXE 配置</h2><p className="panel-copy">只在你确认后导入。导入完成后由 SthStart 独立维护，不会与 EXE 双向覆盖。</p><button className="secondary-button" onClick={() => void loadImport()}>检查可导入内容</button>
        {preview && <div className="import-preview"><strong>{preview.launcher.available ? `发现 ${preview.launcher.path}` : '没有发现 launcher_config.json'}</strong><span>{preview.business ? '邻舍业务配置可导入' : `业务配置不可用：${preview.businessError ?? '邻舍未启动'}`}</span><button onClick={() => void commitImport()}>确认导入</button></div>}
      </article>
    </section>}

    {tab === 'creative' && <form className="control-panel control-form creative-form" onSubmit={saveCreative}><p className="eyebrow">SHARED CREATIVE SETTINGS</p><h2>邻舍常用创作配置</h2><div className="form-columns"><label>ComfyUI 地址<input name="comfyUrl" type="url" defaultValue={String(comfy.url ?? 'http://127.0.0.1:8188')}/></label><label>工作流模式<select name="workflowMode" defaultValue={String(workflow.mode ?? 'turbo')}><option value="turbo">Turbo</option><option value="base">Base</option><option value="hybrid">Hybrid</option></select></label><label>聊天图片宽度<input name="width" type="number" min="256" max="8192" defaultValue={Number(comfy.width ?? 768)}/></label><label>聊天图片高度<input name="height" type="number" min="256" max="8192" defaultValue={Number(comfy.height ?? 512)}/></label><label>群聊温度<input name="temperature" type="number" min="0.5" max="1.2" step="0.1" defaultValue={Number(group.temperature ?? .7)}/></label><label>记忆总结间隔<input name="summaryInterval" type="number" min="2" max="10" defaultValue={Number(group.summaryInterval ?? 4)}/></label></div><div className="switch-list"><label><input name="tlsVerify" type="checkbox" defaultChecked={comfy.tlsVerify !== false}/> 验证 ComfyUI TLS 证书</label><label><input name="memory" type="checkbox" defaultChecked={features.memory !== false}/> 长期记忆</label><label><input name="proactiveChat" type="checkbox" defaultChecked={features.proactiveChat !== false}/> 主动聊天</label><label><input name="events" type="checkbox" defaultChecked={features.events !== false}/> 奇遇系统</label><label><input name="weather" type="checkbox" defaultChecked={features.weather !== false}/> 实时天气</label></div><button>保存并应用到邻舍</button><p className="settings-note">邻舍离线时配置仍会保存，并在下一次由控制中心启动后自动应用。</p></form>}

    {tab === 'models' && <section className="control-grid"><article className="control-panel control-primary"><p className="eyebrow">PUBLIC PROVIDERS</p><h2>公共模型配置是唯一来源</h2><p className="panel-copy">LLM、向量与图片供应商由公共服务统一保存，邻舍和后续应用通过各自令牌按授权使用。</p><a className="control-link-button" href="/settings/public-services">管理模型与应用令牌 →</a></article><article className="control-panel"><p className="eyebrow">MIGRATION NOTE</p><h2>旧模型档案</h2><p className="panel-copy">导入邻舍业务配置时会迁移档案名称、地址和模型名。出于安全考虑，旧 API Key 不会从邻舍接口读取，需要在公共模型配置中重新填写。</p></article></section>}

    {tab === 'logs' && <section className="logs-layout"><aside className="control-panel log-controls"><p className="eyebrow">LOG POLICY</p><h2>采集策略</h2><label>全局级别<select value={overview?.logPolicy.globalLevel ?? 'info'} onChange={(event) => void updatePolicy({ globalLevel: event.target.value as LogLevel })}>{['off','error','warn','info','debug','trace'].map((level) => <option key={level}>{level}</option>)}</select></label><div className="service-log-levels">{overview?.services.map((service) => <label key={service.id}>{service.name}<select value={overview.logPolicy.serviceLevels[service.id] ?? ''} onChange={(event) => void updatePolicy({ serviceLevels: { ...overview.logPolicy.serviceLevels, [service.id]: event.target.value ? event.target.value as LogLevel : null } })}><option value="">继承全局</option>{['off','error','warn','info','debug','trace'].map((level) => <option value={level} key={level}>{level}</option>)}</select></label>)}</div><div className="switch-list"><label><input type="checkbox" checked={Boolean(overview?.logPolicy.diagnosticUntil)} onChange={(event) => void updatePolicy({ diagnosticUntil: event.target.checked ? plusMinutes(30) : null })}/> 详细诊断（30 分钟）</label><label><input type="checkbox" checked={Boolean(overview?.logPolicy.sensitiveUntil)} onChange={(event) => void updatePolicy({ sensitiveUntil: event.target.checked ? plusMinutes(30) : null })}/> 敏感正文诊断（30 分钟）</label></div><p className="settings-note">敏感诊断默认关闭；即使开启，导出的诊断包仍会移除正文。</p><button className="secondary-button" onClick={() => void downloadDiagnostics()}>下载脱敏诊断包</button></aside>
      <div className="control-panel log-viewer"><div className="log-toolbar"><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">全部服务</option>{overview?.services.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选日志…"/><button onClick={() => setPaused((value) => !value)}>{paused ? '继续' : '暂停'}</button><button onClick={() => setLogs([])}>清空视图</button></div><div className="log-lines" role="log" aria-live="off">{filteredLogs.length ? filteredLogs.slice(-1_000).map((item) => <div className={`log-line level-${item.level}`} key={item.id}><time>{new Date(item.timestamp).toLocaleTimeString()}</time><b>{item.serviceId}</b><span>{item.message}</span></div>) : <div className="log-empty">当前没有符合条件的日志。</div>}</div></div>
    </section>}
  </div>;
}
