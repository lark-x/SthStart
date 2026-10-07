'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, Save } from 'lucide-react';
import { DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS, type ActivityImagePromptPolicy, type ActivityImagePromptPolicyResponse, type SaveActivityImagePromptPolicyRequest } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Textarea } from '@/app/components/ui/textarea';
import { fetchActivityImagePromptPolicy, saveActivityImagePromptPolicy } from '../api';
import type { Workflow } from '../types';

type PromptPolicyDraft = Pick<ActivityImagePromptPolicy, 'enabled' | 'instructions' | 'positiveSuffix' | 'negativePrompt' | 'outputFormat' | 'knowledgeMode'> & { revision: number };

const NEIGHBOR_STYLE = '@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025';
const NEIGHBOR_NEGATIVE = 'score_1, score_2, score_3, bad anatomy, bad proportions, deformed anatomy, deformed face, deformed eyes, text, multiple fingers, watermark, artist name, censor, mosaic';
const ANIMA_STANDARD_STYLE = 'masterpiece, best quality, score_7, safe';

export function ActivityImagePromptPolicyPanel({ workflows, preferredWorkflow }: { workflows: Workflow[]; preferredWorkflow?: { id: string; version: number } }) {
  const versions = useMemo(() => workflows.flatMap((workflow) => workflow.versions
    .filter((version) => version.isPublished && (version.category ?? workflow.category) === 'image')
    .map((version) => ({ id: workflow.id, name: workflow.name, version: version.version }))), [workflows]);
  const [selection, setSelection] = useState('');
  const [draft, setDraft] = useState<PromptPolicyDraft | null>(null);
  const [optimizer, setOptimizer] = useState<ActivityImagePromptPolicyResponse['optimizer'] | null>(null);
  const [styleManagedByActivity, setStyleManagedByActivity] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const selected = versions.find((item) => `${item.id}::${item.version}` === selection);

  useEffect(() => {
    if (!versions.length || selection) return;
    setSelection(`${versions[0].id}::${versions[0].version}`);
  }, [selection, versions]);

  useEffect(() => {
    if (!preferredWorkflow) return;
    const value = `${preferredWorkflow.id}::${preferredWorkflow.version}`;
    if (versions.some((item) => `${item.id}::${item.version}` === value)) setSelection(value);
  }, [preferredWorkflow?.id, preferredWorkflow?.version, versions]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    setError('');
    setSaved(false);
    void fetchActivityImagePromptPolicy(selected.id, selected.version).then((response) => {
      if (!active) return;
      // 画风由活动画风管理时，策略里的画师标签一律清空，避免与服务端组装重复。
      setStyleManagedByActivity(response.serviceFinalizedAssembly);
      setDraft(toDraft(response.policy, response.serviceFinalizedAssembly));
      setOptimizer(response.optimizer);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '读取提示词策略失败。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.id, selected?.version]);

  const save = async () => {
    if (!selected || !draft || saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    const request: SaveActivityImagePromptPolicyRequest = { workflowId: selected.id, workflowVersion: selected.version, ...draft,
      // 服务端组装模式下必须提交空画风，否则会因 409 被拒绝。
      ...(styleManagedByActivity ? { positiveSuffix: '' } : {}) };
    try {
      const response = await saveActivityImagePromptPolicy(request);
      setStyleManagedByActivity(response.serviceFinalizedAssembly);
      setDraft(toDraft(response.policy, response.serviceFinalizedAssembly));
      setOptimizer(response.optimizer);
      setSaved(true);
    } catch (cause) {
      // 409 冲突已经带有明确原因，只展示，不自动重发，避免覆盖他人的新版本。
      setError(cause instanceof Error ? cause.message : '保存提示词策略失败。');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 sm:p-6" aria-labelledby="activity-image-prompt-policy-title">
      <div>
        <h2 id="activity-image-prompt-policy-title" className="text-base font-semibold text-ink">画风与提示词</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">参考邻舍：画面描述、画师标签和质量词分开设置。这里只调整提交给所选工作流的提示词，不会改动模型或已有图片。</p>
      </div>

      {!versions.length ? <Alert variant="warning" title="暂无可配置工作流">请先导入并发布图片工作流，再为具体版本配置提示词策略。</Alert> : <>
        {preferredWorkflow && selected && <p className="text-sm text-muted">当前模式：{selected.name} v{selected.version}</p>}
        <details className="max-w-2xl" open={!preferredWorkflow ? true : undefined}>
          {preferredWorkflow && <summary className="cursor-pointer text-sm text-muted">配置其他工作流的画风</summary>}
          <label className="mt-2 block space-y-1.5">
            <span className="text-sm font-medium text-ink">应用到工作流版本</span>
            <select aria-label="提示词策略工作流版本" value={selection} onChange={(event) => setSelection(event.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink">
              {versions.map((item) => <option key={`${item.id}::${item.version}`} value={`${item.id}::${item.version}`}>{item.name} · {item.id} · v{item.version}</option>)}
            </select>
          </label>
        </details>

        {optimizer?.ready && <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <div className="font-medium">复用活动文本模型：{optimizer.profileName} · {optimizer.model}</div>
        </div>}

        {loading || !draft ? <div className="py-10 text-center text-sm text-muted" role="status">正在读取此工作流版本的策略…</div> : <div className="max-w-4xl space-y-4">
          <div className="space-y-2"><span className="text-sm font-medium text-ink">提示词组织方式</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={draft.outputFormat === 'prose' ? 'accent' : 'outline'}
                onClick={() => setDraft({ ...draft, outputFormat: 'prose', knowledgeMode: 'none' })}>原有描述</Button>
              <Button type="button" size="sm" variant={draft.outputFormat === 'tags' ? 'accent' : 'outline'}
                onClick={() => setDraft({ ...draft, outputFormat: 'tags' })}>结构化混合</Button>
            </div>
            <p className="text-xs text-muted">{draft.outputFormat === 'tags'
              ? '文本模型按角色、相机、场景与细节分槽返回，服务端按固定顺序组装并逐角色去重；该模式只对声明了服务端组装的工作流开放。'
              : '沿用单段自然语言描述，服务端不重排、不去重。'}</p>
          </div>
          <Checkbox checked={draft.knowledgeMode === 'keyword'} disabled={draft.outputFormat !== 'tags'}
            onChange={(event) => setDraft({ ...draft, knowledgeMode: event.target.checked ? 'keyword' : 'none' })}
            label="关键词补全标签" description={draft.outputFormat === 'tags'
              ? '按来源文本在本地通用词表里做关键词召回，只补充该作用域的可选措辞；不使用向量检索。'
              : '结构化混合模式下才可用。'} />
          {styleManagedByActivity && <Alert variant="info" title="画风由活动画风管理">
            该工作流版本声明了服务端组装，画师与质量标签来自活动画风，策略里的画风字段已清空并停用；如需修改请到活动画风设置。
          </Alert>}
          <div className="space-y-2"><span className="text-sm font-medium text-ink">一键画风</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={styleManagedByActivity} variant={draft.positiveSuffix === NEIGHBOR_STYLE ? 'accent' : 'outline'} onClick={() => setDraft({ ...draft, positiveSuffix: NEIGHBOR_STYLE, negativePrompt: NEIGHBOR_NEGATIVE })}>邻舍画风 · @ebora</Button>
              <Button type="button" size="sm" disabled={styleManagedByActivity} variant={draft.positiveSuffix === ANIMA_STANDARD_STYLE ? 'accent' : 'outline'} onClick={() => setDraft({ ...draft, positiveSuffix: ANIMA_STANDARD_STYLE })}>Anima 基础画风</Button>
              <Button type="button" size="sm" disabled={styleManagedByActivity} variant={!draft.positiveSuffix ? 'accent' : 'outline'} onClick={() => setDraft({ ...draft, positiveSuffix: '' })}>不追加画风</Button>
            </div>
            <p className="text-xs text-muted">{styleManagedByActivity
              ? '该工作流的画风来自活动画风，这里不再追加任何画师或质量标签。'
              : '邻舍画风复制其画师与质量标签；当前工作流自带的通用质量词仍会保留，所以不是逐节点完全相同。点击后还需保存。'}</p>
          </div>
          <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">画师与质量标签</span>
            <Textarea rows={2} value={draft.positiveSuffix} disabled={styleManagedByActivity} onChange={(event) => setDraft({ ...draft, positiveSuffix: event.target.value })} placeholder={styleManagedByActivity ? '由活动画风管理' : '例如：@ebora, masterpiece, best quality'} />
            <span className="block text-xs text-muted">{styleManagedByActivity
              ? '已停用：重复追加会让同一串质量词出现两次，最终提交内容可在 AI 调用日志中核对。'
              : '可自行修改；这些词追加在画面描述之后，最终提交内容可在 AI 调用日志中核对。'}</span>
          </label>
          <Checkbox checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            label="自动整理画面描述" description="开启时先用活动文本模型整理人物与动作；关闭时直接使用原描述，但仍追加上方画风。" />
          {draft.enabled && optimizer && !optimizer.ready && <Alert variant="warning" title="自动整理暂不可用">{optimizer.message ?? '活动文本模型尚未就绪。请先配置文本模型，或关闭自动整理再绘制。'}</Alert>}
          <details className="rounded-[var(--radius-control)] border border-border-subtle p-3"><summary className="cursor-pointer text-sm font-medium text-ink">高级提示词规则</summary>
            <div className="mt-3 space-y-3"><label className="block space-y-1.5"><span className="text-sm font-medium text-ink">通用改写规则</span>
              <Textarea rows={7} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="描述需要保留的人物、动作、场景与构图规则" />
              <span className="block text-xs text-muted">只控制文本模型如何整理画面；质量和画师标签由上面的画风设置负责。</span>
            </label>
            <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">默认反向提示词</span>
              <Textarea rows={3} value={draft.negativePrompt} onChange={(event) => setDraft({ ...draft, negativePrompt: event.target.value })} placeholder="镜头未单独设置时使用；留空采用工作流默认值" />
            </label></div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void save()} disabled={saving || loading}>
              {saving ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{saving ? '正在保存…' : '保存策略版本'}
            </Button>
            <span className="text-xs text-muted">当前版本：{draft.revision === 0 ? '尚未保存（默认规则）' : `r${draft.revision}`}</span>
            {saved && <span role="status" className="text-xs text-success">已保存为新版本</span>}
          </div>
        </div>}
      </>}
      {error && <Alert variant="danger" title="策略操作失败">{error}</Alert>}
    </section>
  );
}

function toDraft(policy: ActivityImagePromptPolicy | null, styleManagedByActivity = false): PromptPolicyDraft {
  const positiveSuffix = styleManagedByActivity ? '' : policy?.positiveSuffix ?? '';
  return policy
    ? { revision: policy.revision, enabled: policy.enabled, instructions: policy.instructions, positiveSuffix,
      negativePrompt: policy.negativePrompt, outputFormat: policy.outputFormat, knowledgeMode: policy.knowledgeMode }
    : { revision: 0, enabled: true, instructions: DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS, positiveSuffix: '',
      negativePrompt: '', outputFormat: 'prose', knowledgeMode: 'none' };
}
