'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import type {
  CharacterAssetBatchType,
  CharacterBatchAvatarResponse,
  CharacterBatchEnrichRpResponse,
  CharacterBatchImportLocalCardsResponse,
  CharacterPreferredSources,
} from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { Select } from '@/app/components/ui/select';
import { useBatchEnrichRpCards, useBatchImportLocalCards, useBatchMatchOfficialAvatars } from '../mutations';

const SOURCE_STORAGE_KEY = 'sthstart:character-preferred-sources';

function loadSavedSources(): CharacterPreferredSources {
  try {
    const raw = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CharacterPreferredSources;
  } catch {}
  return { genshin: 'yatta', starrail: 'starrailres', default: 'bwiki' };
}

function persistSources(sources: CharacterPreferredSources) {
  try {
    window.localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(sources));
  } catch {}
}

export function CharacterBatchAssetsDialog({
  open,
  onOpenChange,
  initialScope = 'missing',
  selectedIds,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialScope?: 'missing' | 'selected' | 'all';
  selectedIds: string[];
  onCompleted: () => void;
}) {
  const batchMutation = useBatchMatchOfficialAvatars();
  const [scope, setScope] = useState<'missing' | 'selected' | 'all'>(initialScope);
  const [assetTypes, setAssetTypes] = useState<CharacterAssetBatchType[]>(['avatar', 'portrait', 'costume']);
  const [sources, setSources] = useState<CharacterPreferredSources>(() => loadSavedSources());
  const [result, setResult] = useState<CharacterBatchAvatarResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setScope(initialScope);
      setResult(null);
      setError('');
    }
  }, [open, initialScope]);

  const busy = batchMutation.isPending;

  const toggleType = (type: CharacterAssetBatchType, checked: boolean) => {
    setAssetTypes((prev) =>
      checked ? [...new Set([...prev, type])] : prev.filter((item) => item !== type),
    );
  };

  const updateSource = <K extends keyof CharacterPreferredSources>(key: K, val: CharacterPreferredSources[K]) => {
    const next = { ...sources, [key]: val };
    setSources(next);
    persistSources(next);
  };

  const handleRun = async () => {
    if (assetTypes.length === 0) {
      setError('请至少选择一种形象资产类型。');
      return;
    }
    setError('');
    setResult(null);
    try {
      const targetScope = scope === 'selected' && selectedIds.length === 0 ? 'missing' : scope;
      const res = await batchMutation.mutateAsync({
        ids: targetScope === 'selected' ? selectedIds : undefined,
        onlyMissing: targetScope === 'missing',
        assetTypes,
        preferredSources: sources,
      });
      setResult(res);
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setResult(null);
          setError('');
        }
      }}
      title="批量获取官方形象（头像 / 立绘 / 皮肤）"
      description="每种类型按单一首选来源抓取（不跨源重复堆砌），并自动按链接与图片指纹严格去重。"
      size="lg"
      footer={
        result ? (
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              setResult(null);
            }}
          >
            完成
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || assetTypes.length === 0}
              onClick={() => void handleRun()}
            >
              {!busy && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{busy ? '正在抓取官方形象…' : '开始批量获取'}</span>
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 text-sm">
        {!result ? (
          <>
            <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3.5">
              <span className="block font-semibold text-ink">1. 选择获取的资产类型</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 pt-1">
                <Checkbox
                  label="官方头像"
                  checked={assetTypes.includes('avatar')}
                  disabled={busy}
                  onChange={(e) => toggleType('avatar', e.target.checked)}
                />
                <Checkbox
                  label="官方全身立绘"
                  checked={assetTypes.includes('portrait')}
                  disabled={busy}
                  onChange={(e) => toggleType('portrait', e.target.checked)}
                />
                <Checkbox
                  label="全部皮肤与衍生形态"
                  checked={assetTypes.includes('costume')}
                  disabled={busy}
                  onChange={(e) => toggleType('costume', e.target.checked)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3.5">
              <span className="block font-semibold text-ink">2. 获取范围</span>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batchAssetScope"
                    checked={scope === 'missing'}
                    onChange={() => setScope('missing')}
                    disabled={busy}
                    className="accent-accent"
                  />
                  <span>仅补充<strong>缺失的头像/立绘与新增皮肤</strong>（推荐，不覆盖已手动指定的图）</span>
                </label>
                {selectedIds.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchAssetScope"
                      checked={scope === 'selected'}
                      onChange={() => setScope('selected')}
                      disabled={busy}
                      className="accent-accent"
                    />
                    <span>仅为<strong>当前选中的 {selectedIds.length} 位</strong>角色获取</span>
                  </label>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batchAssetScope"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                    disabled={busy}
                    className="accent-accent"
                  />
                  <span>扫描<strong>全部角色</strong>并设为官方最新头像/立绘（重复图片自动跳过）</span>
                </label>
              </div>
            </div>

            <details className="rounded-lg border border-hairline bg-surface p-3.5">
              <summary className="cursor-pointer font-semibold text-ink select-none">
                3. 单一数据源配置（已自动推荐最佳源）
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">原神默认单源</span>
                  <Select
                    value={sources.genshin || 'yatta'}
                    disabled={busy}
                    onChange={(e) => updateSource('genshin', e.target.value as CharacterPreferredSources['genshin'])}
                  >
                    <option value="yatta">Project Amber (Yatta · 推荐)</option>
                    <option value="enka">Enka CDN（解包直连）</option>
                    <option value="bwiki">BWiki（B站游戏维基）</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">星穹铁道默认单源</span>
                  <Select
                    value={sources.starrail || 'starrailres'}
                    disabled={busy}
                    onChange={(e) => updateSource('starrail', e.target.value as CharacterPreferredSources['starrail'])}
                  >
                    <option value="starrailres">StarRailRes（结构化推荐）</option>
                    <option value="bwiki">BWiki（含部分换装插画）</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">其他作品默认单源</span>
                  <Select
                    value={sources.default || 'bwiki'}
                    disabled={busy}
                    onChange={(e) => updateSource('default', e.target.value as CharacterPreferredSources['default'])}
                  >
                    <option value="bwiki">BWiki（推荐）</option>
                    <option value="moegirl">萌娘百科</option>
                    <option value="fandom">Fandom Wiki</option>
                  </Select>
                </label>
              </div>
            </details>

            {busy && (
              <div className="flex items-center justify-center gap-2 py-3 text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                <span>正在从官方源校验并下载头像、立绘与皮肤，请稍候…</span>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-success-bg p-3 border border-success-border">
                <div className="text-2xl font-semibold text-success-fg">{result.updated}</div>
                <div className="text-xs text-muted">新增/更新角色</div>
              </div>
              <div className="rounded-lg bg-surface-muted p-3 border border-border-default">
                <div className="text-2xl font-semibold text-ink">{result.skipped}</div>
                <div className="text-xs text-muted">已存在/跳过</div>
              </div>
              <div className="rounded-lg bg-danger-bg p-3 border border-danger-border">
                <div className="text-2xl font-semibold text-danger-fg">{result.failed}</div>
                <div className="text-xs text-muted">失败</div>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-default bg-surface p-2 text-xs space-y-1.5">
              {result.items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 px-2.5 rounded hover:bg-surface-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{item.displayName}</span>
                    {item.sourceUsed && (
                      <span className="text-xs text-muted">{item.sourceUsed}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.avatarAdded && <Badge variant="online">已加头像</Badge>}
                    {item.portraitAdded && <Badge variant="online">已加立绘</Badge>}
                    {(item.skinsAdded ?? 0) > 0 && <Badge variant="accent">皮肤 +{item.skinsAdded}</Badge>}
                    {item.success && !item.avatarAdded && !item.portraitAdded && !(item.skinsAdded ?? 0) && (
                      <span className="text-muted">{item.error || '已是最新'}</span>
                    )}
                    {!item.success && (
                      <span className="text-danger-fg">{item.error || '未匹配到'}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function CharacterBatchEnrichRpDialog({
  open,
  onOpenChange,
  initialScope = 'incomplete',
  selectedIds,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialScope?: 'incomplete' | 'selected' | 'all';
  selectedIds: string[];
  onCompleted: () => void;
}) {
  const enrichMutation = useBatchEnrichRpCards();
  const [scope, setScope] = useState<'incomplete' | 'selected' | 'all'>(initialScope);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [sources, setSources] = useState<CharacterPreferredSources>(() => loadSavedSources());
  const [result, setResult] = useState<CharacterBatchEnrichRpResponse | null>(null);
  const [error, setError] = useState('');

  const busy = enrichMutation.isPending;

  useEffect(() => {
    if (open) {
      setScope(initialScope);
      setResult(null);
      setError('');
    }
  }, [open, initialScope]);

  const handleRun = async () => {
    setError('');
    setResult(null);
    try {
      const targetScope = scope === 'selected' && selectedIds.length === 0 ? 'incomplete' : scope;
      const res = await enrichMutation.mutateAsync({
        ids: targetScope === 'selected' ? selectedIds : undefined,
        scope: targetScope,
        overwriteExisting,
        preferredSources: sources,
      });
      setResult(res);
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setResult(null);
          setError('');
        }
      }}
      title="批量获取并补全角色卡 (RP 设定)"
      description="从最权威且结构清晰的来源批量补齐说话方式、认知边界、代表台词、人设背景与外貌特征，不生成冗杂调试噪音。"
      size="lg"
      footer={
        result ? (
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              setResult(null);
            }}
          >
            完成
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => void handleRun()}>
              {!busy && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{busy ? '正在批量补全角色卡…' : '开始批量补全'}</span>
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 text-sm">
        {!result ? (
          <>
            <div className="rounded-lg border border-hairline bg-surface-sunken/40 p-3.5 text-xs leading-relaxed text-muted space-y-1">
              <p className="font-semibold text-ink">推荐主源组合：精炼官方人设库 + Yatta / StarRailRes 结构化档案 + 作品设定集</p>
              <p>完整详实、条理清晰（含说话方式与语气、认知边界与底线、防复读示例对白、生日标签与基础外貌），同时避免百科冗长杂项与底层编号索引。</p>
            </div>

            <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3.5">
              <span className="block font-semibold text-ink">补全范围</span>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batchRpScope"
                    checked={scope === 'incomplete'}
                    onChange={() => setScope('incomplete')}
                    disabled={busy}
                    className="accent-accent"
                  />
                  <span>仅为<strong>缺少语气、认知边界或对白示例</strong>的角色补全（推荐）</span>
                </label>
                {selectedIds.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchRpScope"
                      checked={scope === 'selected'}
                      onChange={() => setScope('selected')}
                      disabled={busy}
                      className="accent-accent"
                    />
                    <span>仅为<strong>当前选中的 {selectedIds.length} 位</strong>角色补全</span>
                  </label>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batchRpScope"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                    disabled={busy}
                    className="accent-accent"
                  />
                  <span>扫描<strong>全部角色</strong>补充缺失项</span>
                </label>
              </div>
              <div className="pt-2 border-t border-hairline">
                <Checkbox
                  label="覆盖重写已有字段（用于升级简陋草稿或重新从指定源同步）"
                  checked={overwriteExisting}
                  disabled={busy}
                  onChange={(e) => setOverwriteExisting(e.target.checked)}
                />
              </div>
            </div>

            <details className="rounded-lg border border-hairline bg-surface p-3.5">
              <summary className="cursor-pointer font-semibold text-ink select-none">
                数据源配置（可选）
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">原神官方源</span>
                  <Select
                    value={sources.genshin || 'yatta'}
                    disabled={busy}
                    onChange={(e) => {
                      const next = { ...sources, genshin: e.target.value as CharacterPreferredSources['genshin'] };
                      setSources(next);
                      persistSources(next);
                    }}
                  >
                    <option value="yatta">Project Amber (Yatta · 推荐)</option>
                    <option value="bwiki">BWiki（B站游戏维基）</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-ink">星穹铁道官方源</span>
                  <Select
                    value={sources.starrail || 'starrailres'}
                    disabled={busy}
                    onChange={(e) => {
                      const next = { ...sources, starrail: e.target.value as CharacterPreferredSources['starrail'] };
                      setSources(next);
                      persistSources(next);
                    }}
                  >
                    <option value="starrailres">StarRailRes（推荐）</option>
                    <option value="bwiki">BWiki（星穹铁道维基）</option>
                  </Select>
                </label>
              </div>
            </details>

            {busy && (
              <div className="flex items-center justify-center gap-2 py-3 text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                <span>正在整合人设设定、说话语气、认知边界与对话范例，请稍候…</span>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-success-bg p-3 border border-success-border">
                <div className="text-2xl font-semibold text-success-fg">{result.updated}</div>
                <div className="text-xs text-muted">成功补全</div>
              </div>
              <div className="rounded-lg bg-surface-muted p-3 border border-border-default">
                <div className="text-2xl font-semibold text-ink">{result.skipped}</div>
                <div className="text-xs text-muted">已完整/跳过</div>
              </div>
              <div className="rounded-lg bg-danger-bg p-3 border border-danger-border">
                <div className="text-2xl font-semibold text-danger-fg">{result.failed}</div>
                <div className="text-xs text-muted">失败</div>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-default bg-surface p-2 text-xs space-y-1.5">
              {result.items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 px-2.5 rounded hover:bg-surface-muted/50">
                  <div className="min-w-0">
                    <span className="font-semibold text-ink">{item.displayName}</span>
                    {item.sourceUsed && (
                      <span className="ml-2 text-xs text-muted">{item.sourceUsed}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {item.filledFields?.length ? (
                      <span className="inline-flex items-center gap-1 text-success-fg font-medium">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        已补全 {item.filledFields.length} 项（{item.filledFields.slice(0, 4).join('、')}{item.filledFields.length > 4 ? '…' : ''}）
                      </span>
                    ) : (
                      <span className="text-muted">{item.error || '无需更新'}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function CharacterBatchImportLocalDialog({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const importMutation = useBatchImportLocalCards();
  const assetMutation = useBatchMatchOfficialAvatars();
  const [includePlayable, setIncludePlayable] = useState(true);
  const [includeStory, setIncludeStory] = useState(true);
  const [includeNpc, setIncludeNpc] = useState(true);
  const [fetchAssets, setFetchAssets] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState('');
  const [result, setResult] = useState<{
    importRes: CharacterBatchImportLocalCardsResponse;
    assetsRes?: CharacterBatchAvatarResponse;
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setResult(null);
      setError('');
      setPhaseLabel('');
    }
  }, [open]);

  const busy = importMutation.isPending || assetMutation.isPending;

  const handleRun = async () => {
    setError('');
    setResult(null);
    try {
      setPhaseLabel('正在导入本地人设卡…');
      const importRes = await importMutation.mutateAsync({
        includePlayable,
        includeStory,
        includeNpc,
        overwriteExisting,
      });

      let assetsRes: CharacterBatchAvatarResponse | undefined;
      if (fetchAssets && importRes.playableIds.length > 0) {
        setPhaseLabel(`已入库人设，正在为 ${importRes.playableIds.length} 名自机/精选角色抓取唯一官方头像、立绘与皮肤…`);
        assetsRes = await assetMutation.mutateAsync({
          ids: importRes.playableIds,
          onlyMissing: true,
          assetTypes: ['avatar', 'portrait', 'costume'],
          preferredSources: loadSavedSources(),
        });
      }

      setResult({ importRes, assetsRes });
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhaseLabel('');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setResult(null);
          setError('');
        }
      }}
      title="导入本地精选人设库（原神 / 星穹铁道）"
      description="从本地 850+ 精选角色档案一键批量建档并清洗格式；同名同作品已有角色默认不重复覆盖。"
      size="lg"
      footer={
        result ? (
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              setResult(null);
            }}
          >
            完成
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || (!includePlayable && !includeStory && !includeNpc)}
              onClick={() => void handleRun()}
            >
              {!busy && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{busy ? '导入处理中…' : '开始批量导入'}</span>
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 text-sm">
        {!result ? (
          <>
            <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3.5">
              <span className="block font-semibold text-ink">1. 选择导入范围</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 pt-1">
                <Checkbox
                  label="自机角色（198）"
                  checked={includePlayable}
                  disabled={busy}
                  onChange={(e) => setIncludePlayable(e.target.checked)}
                />
                <Checkbox
                  label="剧情角色（43）"
                  checked={includeStory}
                  disabled={busy}
                  onChange={(e) => setIncludeStory(e.target.checked)}
                />
                <Checkbox
                  label="NPC 角色（612）"
                  checked={includeNpc}
                  disabled={busy}
                  onChange={(e) => setIncludeNpc(e.target.checked)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border-default bg-surface-muted/50 p-3.5">
              <span className="block font-semibold text-ink">2. 图片与冲突策略</span>
              <div className="space-y-2 pt-1">
                <Checkbox
                  label="同步为自机/特殊角色抓取官方头像、立绘与皮肤（每类仅取默认单源一张，严格去重）"
                  checked={fetchAssets}
                  disabled={busy}
                  onChange={(e) => setFetchAssets(e.target.checked)}
                />
                <Checkbox
                  label="覆盖已有角色的文案档案（默认仅新增缺失角色与空缺字段）"
                  checked={overwriteExisting}
                  disabled={busy}
                  onChange={(e) => setOverwriteExisting(e.target.checked)}
                />
              </div>
            </div>

            {busy && phaseLabel && (
              <div className="flex items-center justify-center gap-2 py-2 text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                <span>{phaseLabel}</span>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-success-bg p-3 border border-success-border">
                <div className="text-2xl font-semibold text-success-fg">{result.importRes.created}</div>
                <div className="text-xs text-muted">新增入库</div>
              </div>
              <div className="rounded-lg bg-surface-muted p-3 border border-border-default">
                <div className="text-2xl font-semibold text-ink">{result.importRes.updated + result.importRes.skipped}</div>
                <div className="text-xs text-muted">已有/更新（{result.importRes.updated} 更新）</div>
              </div>
              <div className="rounded-lg bg-danger-bg p-3 border border-danger-border">
                <div className="text-2xl font-semibold text-danger-fg">{result.importRes.failed}</div>
                <div className="text-xs text-muted">失败</div>
              </div>
            </div>
            {result.assetsRes && (
              <p className="rounded-lg border border-border-default bg-surface-muted/40 px-3 py-2 text-xs text-ink">
                官方形象同步：<strong>{result.assetsRes.updated}</strong> 位角色新增了头像/立绘/皮肤，
                {result.assetsRes.skipped} 位已完整或无官方图鉴，{result.assetsRes.failed} 位失败。
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
