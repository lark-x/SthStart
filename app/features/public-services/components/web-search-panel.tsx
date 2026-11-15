'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Search, ShieldCheck, Sparkles } from 'lucide-react';
import type { WebSearchProvider, WebSearchResult, WebSearchSettings, WebSearchTestResult } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Spinner } from '@/app/components/ui/spinner';
import { Switch } from '@/app/components/ui/switch';
import { useToast } from '@/app/providers/ui-provider';
import {
  extractWebSearchItems,
  fetchWebSearchSettings,
  saveWebSearchSettings,
  searchWeb,
  testWebSearch,
} from '../web-search-api';

const CREDENTIAL_LABELS: Record<WebSearchSettings['credentialSource'], string> = {
  keyring: '系统钥匙串',
  environment: '服务端环境变量',
  none: '未配置',
};

const SEARCH_PROVIDERS = {
  anysearch: { name: 'AnySearch', description: '支持免密钥调用，公共额度有限；也可使用自己的 API Key。', url: 'https://anysearch.com' },
  exa: { name: 'Exa', description: '需要 API Key；提供每月免费额度与开户奖励，额度以账户为准。', url: 'https://exa.ai/pricing' },
  tavily: { name: 'Tavily', description: '需要 API Key；提供每月免费额度，具体用量以账户为准。', url: 'https://www.tavily.com/pricing' },
} satisfies Record<WebSearchProvider, {name: string; description: string; url: string}>;

const STATUS_LABELS: Record<WebSearchResult['status'], string> = {
  snippet: '搜索摘要',
  extracted: '已提取正文',
  failed: '提取失败',
};

export function WebSearchPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<WebSearchProvider>('tavily');
  const [anonymous, setAnonymous] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WebSearchTestResult | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<WebSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [extractNotice, setExtractNotice] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await fetchWebSearchSettings();
        if (!active) return;
        setSettings(next);
        setEnabled(next.enabled);
        setProvider(next.provider ?? 'tavily');
        setAnonymous(next.anonymous ?? false);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const credentialReady = Boolean(settings?.hasCredential || (settings?.provider === 'anysearch' && settings.anonymous));
  const dirty = Boolean(settings && (provider !== (settings.provider ?? 'tavily') || enabled !== settings.enabled || (provider === 'anysearch' && anonymous !== Boolean(settings.anonymous)) || apiKey.trim()));
  const canSearch = Boolean(settings?.enabled && credentialReady && !dirty);
  const providerInfo = SEARCH_PROVIDERS[provider];
  const savedProviderName = SEARCH_PROVIDERS[settings?.provider ?? 'tavily'].name;
  const draftHasCredential = settings?.providers?.find(item => item.provider === provider)?.hasCredential ?? (provider === (settings?.provider ?? 'tavily') && settings?.hasCredential);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || searching || extracting || testing) return;
    setSaving(true);
    setTestResult(null);
    try {
      const next = await saveWebSearchSettings({
        enabled,
        provider,
        anonymous: provider === 'anysearch' && anonymous,
        ...(apiKey.trim() && !(provider === 'anysearch' && anonymous) ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(next);
      setEnabled(next.enabled);
      setProvider(next.provider ?? 'tavily');
      setAnonymous(next.anonymous ?? false);
      setApiKey('');
      setResults([]);
      setSelected(new Set());
      setSearchError('');
      setExtractNotice('');
      toast.success('搜索设置已保存。');
    } catch (error) {
      toast.error('保存失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testWebSearch();
      setTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.warning('搜索测试未通过', result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ ok: false, message });
      toast.error('搜索测试失败', message);
    } finally {
      setTesting(false);
    }
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || !canSearch) return;
    setSearching(true);
    setSearchError('');
    setExtractNotice('');
    setResults([]);
    setSelected(new Set());
    try {
      const response = await searchWeb(normalized, 5);
      setResults(response.items);
      setSearchQuery(response.query);
      if (response.items.length === 0) {
        setSearchError(`${savedProviderName} 没有返回可用的公共网页结果。`);
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  };

  const handleExtract = async () => {
    const items = results.filter((item) => selected.has(item.id));
    if (items.length === 0) return;
    setExtracting(true);
    setExtractNotice('');
    try {
      const response = await extractWebSearchItems(items);
      const byId = new Map(response.items.map((item) => [item.id, item]));
      setResults((previous) => previous.map((item) => byId.get(item.id) ?? item));
      const succeeded = response.items.filter((item) => item.status === 'extracted').length;
      const failed = response.items.filter((item) => item.status === 'failed').length;
      setExtractNotice(
        failed === 0
          ? `已通过 ${savedProviderName} 提取 ${succeeded} 个网页正文。`
          : `已提取 ${succeeded} 个网页；${failed} 个未能提取，原因逐条显示在结果中。`,
      );
      setSelected(new Set());
    } catch (error) {
      setExtractNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <section className="min-w-0 space-y-6" aria-labelledby="web-search-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="web-search-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Search className="h-4 w-4 text-muted" aria-hidden="true" />
            联网搜索
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            为资料搜集查找网页并提取正文。选择一个搜索服务，启用后即可使用。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={settings?.enabled ? 'online' : 'stopped'}>
            {settings?.enabled ? '已启用' : '已停用'}
          </Badge>
          <Badge variant={credentialReady ? 'busy' : 'warning'}>
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            {settings?.provider === 'anysearch' && settings.anonymous ? '免密钥' : settings ? CREDENTIAL_LABELS[settings.credentialSource] : '检查密钥'}
          </Badge>
        </div>
      </div>

      {loadError && (
        <Alert variant="danger" title="无法读取搜索设置">
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner />
          正在读取搜索设置…
        </div>
      ) : settings && (
        <>
          <form
            onSubmit={handleSave}
            aria-label="联网搜索配置"
            className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="min-w-0 space-y-4">
              <Switch
                checked={enabled}
                onChange={(event) => { setEnabled(event.currentTarget.checked); setTestResult(null); }}
                disabled={saving || searching || extracting || testing}
                label="启用联网搜索"
                description="搜索内容会发送给你选择的服务。"
              />
              <FormField label="搜索服务">
                <Select value={provider} disabled={saving || testing || searching || extracting} onChange={event => {const next = event.target.value as WebSearchProvider; setProvider(next); setApiKey(''); setAnonymous(next === 'anysearch'); setTestResult(null);}}>
                  <option value="anysearch">AnySearch · 可免密钥</option>
                  <option value="exa">Exa · 每月免费额度</option>
                  <option value="tavily">Tavily · 每月免费额度</option>
                </Select>
              </FormField>
              <p className="text-sm leading-relaxed text-muted">{providerInfo.description}{' '}<a href={providerInfo.url} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">查看服务说明</a></p>
              {provider === 'anysearch' && <Checkbox label="使用免密钥模式" checked={anonymous} disabled={saving || searching || extracting || testing} onChange={event => {setAnonymous(event.target.checked); setApiKey(''); setTestResult(null);}} />}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {provider === 'anysearch' && anonymous ? '使用公共免费额度，可能受到限流' : draftHasCredential ? '该服务已配置密钥' : '该服务尚未配置密钥'}
                </span>
                <span aria-hidden="true">·</span>
                <span>保存后只显示来源，不回传密钥内容。</span>
              </div>
            </div>

            <div className="min-w-0 space-y-3">
              {!(provider === 'anysearch' && anonymous) && <FormField
                label={`${providerInfo.name} API Key`}
                hint="留空保留该服务的现有密钥。切换服务不会删除其他密钥。"
              >
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={draftHasCredential ? '已配置，输入新值可替换' : '粘贴该服务的 API Key'}
                />
              </FormField>}
              {dirty && <p role="status" className="text-sm text-muted">有未保存的修改。保存后再测试或搜索。</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleTest()}
                  loading={testing}
                  disabled={!canSearch || saving}
                >
                  测试连接
                </Button>
                <Button size="sm" variant="primary" type="submit" loading={saving} disabled={searching || extracting || testing}>
                  保存设置
                </Button>
              </div>
            </div>
          </form>

          {testResult && (
            <Alert
              variant={testResult.ok ? 'success' : 'danger'}
              title={testResult.ok ? '搜索连接正常' : '搜索连接失败'}
            >
              {testResult.message}
            </Alert>
          )}

          <details className="space-y-4 border-t border-border-subtle pt-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">试搜一下</summary>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-muted" aria-hidden="true" />
                搜索预览
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                先获取摘要，再选择最多 10 个公共网址提取正文。提取上限 20,000 字符，超出会标记为已截断。
              </p>
            </div>

            <form aria-label="搜索预览" onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入要搜索的主题"
                aria-label="搜索主题"
                maxLength={500}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                type="submit"
                loading={searching}
                disabled={!canSearch || !query.trim()}
              >
                搜索
              </Button>
            </form>

            {!canSearch && (
              <p className="text-xs leading-relaxed text-muted">
                {dirty ? '请先保存搜索设置。' : !settings.enabled
                  ? '启用并保存设置后才能搜索。'
                  : '配置当前服务的 API Key 后才能搜索。'}
              </p>
            )}

            {searchError && (
              <Alert variant="warning" title="搜索未完成">
                {searchError}
              </Alert>
            )}

            {extractNotice && (
              <Alert variant="info" title="提取结果">
                {extractNotice}
              </Alert>
            )}

            {results.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    “{searchQuery}” · {results.length} 条结果 · 已选 {selected.size}/10
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleExtract()}
                    loading={extracting}
                    disabled={selected.size === 0 || dirty || !canSearch}
                  >
                    提取所选正文
                  </Button>
                </div>
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {results.map((item) => (
                    <li key={item.id} className="grid gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--action-primary)]"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`选择提取：${item.title || item.url}`}
                        disabled={extracting}
                      />
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="min-w-0 break-words text-sm font-semibold text-ink underline decoration-border-default underline-offset-2 hover:text-primary"
                          >
                            {item.title || item.url}
                          </a>
                          <Badge variant={item.status === 'failed' ? 'error' : item.status === 'extracted' ? 'online' : 'secondary'}>
                            {STATUS_LABELS[item.status]}
                          </Badge>
                          {item.truncated && <Badge variant="warning">已截断</Badge>}
                        </div>
                        <p className="break-all text-xs text-muted">{item.siteName || item.url}</p>
                        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
                          {item.snippet || item.content || '暂无摘要'}
                        </p>
                        {item.status === 'extracted' && item.content && (
                          <details className="text-xs text-muted">
                            <summary className="cursor-pointer text-ink">查看提取正文</summary>
                            <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-sunken p-3 leading-relaxed">
                              {item.content}
                            </div>
                          </details>
                        )}
                        {item.error && (
                          <p className="text-xs leading-relaxed text-danger-fg">{item.error}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
