'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import type { SceneImage, SceneImagePlanInput, StorySceneDraft } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { fetchCreativeGenerationOptions, uploadCreativeImage } from '@/app/features/creative/api';
import { useStoryWorlds, useWorldHub } from '@/app/features/story-worlds/queries';
import { Field, SceneText, surfaceClass, textClass } from './fields';
import { directionLabels } from './writing';
import type { SceneActionInput, SceneEdits } from './use-scene-session';

const fields = {
  moment: '正文中的瞬间', subject: '画面主体', camera: '构图与机位', blocking: '人物前后站位',
  action: '关键动作', occlusion: '空间遮挡', style: '画风或参考说明',
} as const;
type ImagePlanField = keyof typeof fields;
const imagePlanFieldNames = Object.entries(fields) as [ImagePlanField, string][];
export const blankImagePlan: SceneImagePlanInput = { moment: '', subject: '', camera: '', blocking: '', action: '', occlusion: '', style: '' };

function serializeImagePlan(plan: Partial<SceneImagePlanInput> | null | undefined) {
  return imagePlanFieldNames.map(([key, label]) => `${label}：${plan?.[key] ?? ''}`).join('\n');
}

function parseImagePlan(value: string): Pick<SceneImagePlanInput, ImagePlanField> {
  const result = Object.fromEntries(imagePlanFieldNames.map(([key]) => [key, ''])) as Pick<SceneImagePlanInput, ImagePlanField>;
  const labels = new Map(imagePlanFieldNames.map(([key, label]) => [label, key]));
  let active: ImagePlanField | null = null;
  for (const line of value.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^(.*?)[：:](.*)$/.exec(line);
    const key = match ? labels.get(match[1].trim()) : undefined;
    if (key) {
      active = key;
      result[key] = match?.[2].trimStart() ?? '';
    } else if (active) {
      result[active] = `${result[active]}\n${line}`.trimStart();
    } else if (line.trim()) {
      // Pasted freeform instructions remain useful as the described moment.
      result.moment = `${result.moment}${result.moment ? '\n' : ''}${line}`;
    }
  }
  return result;
}

const artifactUrl = (id: string) => `/api/admin/creative/artifacts/${encodeURIComponent(id)}`;
const imageStatus = { queued: '等待生成', running: '正在生成', uncertain: '等待确认上游任务状态', succeeded: '已完成', failed: '生成失败' };
const getSuccessfulImage = (images: SceneImage[]) => [...images].reverse().find(image => image.status === 'succeeded' && image.artifactId);

function ScenePicture({ image, outdated }: { image: SceneImage; outdated: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!image.artifactId) return null;
  const url = artifactUrl(image.artifactId);
  return <figure className="space-y-2">
    {broken ? <p role="status" className={textClass}>预览暂时无法载入。<a href={url} target="_blank" rel="noreferrer" className="text-accent underline">打开图片</a></p>
      : <a href={url} target="_blank" rel="noreferrer" aria-label="打开代表画面原图" className="block rounded-control focus-visible:outline-2 focus-visible:outline-focus-ring">
        <img src={url} alt="一幕故事的代表画面" onError={() => setBroken(true)} className="block max-h-120 w-full rounded-control bg-surface-sunken object-contain" />
      </a>}
    <figcaption className="text-xs text-muted">正文第 {image.bodyVersion} 版 · 构图第 {image.planVersion} 版{outdated ? ' · 基于旧稿' : ''}</figcaption>
  </figure>;
}

type ActionPanel = { draft: StorySceneDraft; busy: boolean; act: (input: SceneActionInput) => Promise<unknown> };

export function SceneImagePanel({ draft, busy, act, edit, bodyEdited, planEdit }: ActionPanel & { edit: (patch: SceneEdits) => void; bodyEdited: boolean; planEdit?: SceneImagePlanInput }) {
  const [instruction, setInstruction] = useState('');
  const [configId, setConfigId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [manual, setManual] = useState(false);
  const plan = planEdit ?? draft.imagePlan;
  const reference = plan?.referenceArtifactId;
  const options = useQuery({ queryKey: ['scene-creative-options'], queryFn: fetchCreativeGenerationOptions, staleTime: 60_000 });
  const purpose = options.data?.purposes.find(item => item.purpose === (reference ? 'image-to-image' : 'text-to-image'));
  const compatible = purpose?.presets.filter(preset => !preset.unavailableReason) ?? [];
  const config = compatible.find(preset => preset.id === configId)?.id;
  const latest = draft.images.at(-1);
  const image = getSuccessfulImage(draft.images);
  const activeImage = draft.images.some(item => ['queued', 'running', 'uncertain'].includes(item.status));
  const stalePlan = draft.imagePlan && (bodyEdited || draft.imagePlan.bodyVersion !== draft.bodyVersion);
  const [planText, setPlanText] = useState(() => serializeImagePlan(plan));

  useEffect(() => {
    // A new server plan gets a fresh version. Keep freeform edits untouched while
    // the local patch is being saved so the caret does not jump on each keystroke.
    setPlanText(serializeImagePlan(plan));
  }, [plan]);

  function updatePlan(patch: Partial<SceneImagePlanInput>) {
    // Pick editable fields explicitly so server-issued identifiers stay read-only.
    const current = { ...blankImagePlan };
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) current[key] = plan?.[key] ?? '';
    current.referenceArtifactId = reference;
    edit({ imagePlan: { ...current, ...patch } });
  }

  function updatePlanText(value: string) {
    updatePlan(parseImagePlan(value));
  }

  async function upload(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError('');
    try {
      const artifact = await uploadCreativeImage(file);
      updatePlan({ referenceArtifactId: artifact.id });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : '上传参考图失败。');
    } finally { setUploading(false); }
  }

  return <section className={`${surfaceClass} space-y-5`} aria-labelledby="scene-stage-heading">
    <header><h2 id="scene-stage-heading" tabIndex={-1} className="text-lg font-semibold">设计代表画面</h2><p className={`mt-1 ${textClass}`}>选正文里的一个瞬间，确定人物怎么站、镜头怎么看。</p></header>
    {image && <ScenePicture key={image.id} image={image} outdated={bodyEdited || !!planEdit || image.bodyVersion !== draft.bodyVersion || image.planVersion !== draft.imagePlan?.version} />}
    {latest && latest.status !== 'succeeded' && <Alert variant={latest.status === 'failed' ? 'warning' : 'info'} title={imageStatus[latest.status]}>{latest.error || (latest.status === 'uncertain' ? '正在恢复已提交的任务，请稍候。' : `正文第 ${latest.bodyVersion} 版 · 构图第 ${latest.planVersion} 版`)}</Alert>}
    <details className="space-y-3 border-t border-hairline pt-4" open={!plan || undefined}>
      <summary className="cursor-pointer text-sm font-medium">让 AI 推荐构图</summary>
      <SceneText label="想画的瞬间或构图要求（可选）" name="imageInstruction" rows={2} maxLength={2000} value={instruction} onChange={event => setInstruction(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        {!plan && <Button variant="ghost" onClick={() => setManual(true)}>手动设计</Button>}
        <Button variant={plan ? 'secondary' : 'primary'} disabled={busy || activeImage || uploading} onClick={() => void act({ action: 'plan-image', instruction: instruction.trim() || undefined })}><Sparkles className="size-4" aria-hidden="true" />{plan ? '重新推荐构图' : '推荐一个画面'}</Button>
      </div>
    </details>
    {(plan || manual) && <div className="space-y-4 border-t border-hairline pt-4">
      <h3 className="text-base font-semibold">构图方案</h3>
      {stalePlan && !planEdit && <Alert variant="info" title="正文已更新">生成前可按新稿调整或重新推荐构图。</Alert>}
      <SceneText
        label="构图说明"
        name="imagePlan"
        rows={11}
        maxLength={14000}
        disabled={uploading}
        value={planText}
        onChange={event => { setPlanText(event.target.value); updatePlanText(event.target.value); }}
        aria-describedby="scene-image-plan-help"
        className="min-h-64 font-mono text-sm leading-relaxed"
      />
      <p id="scene-image-plan-help" className="text-xs leading-relaxed text-muted">每行一个标签，可补充多行细节。生成时会按正文瞬间、主体、机位、站位、动作、遮挡和画风分别处理。</p>
      <div className="space-y-2">
        {reference ? <div className="flex flex-wrap items-center gap-3">
          <img src={artifactUrl(reference)} alt="已附参考图" className="size-16 rounded-control object-cover" />
          <Button size="sm" variant="ghost" disabled={uploading} onClick={() => updatePlan({ referenceArtifactId: null })}>移除参考图</Button>
        </div> : <Field label="附一张参考图">{id => <input id={id} name="referenceImage" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} className="block max-w-full text-sm file:me-2 file:rounded-control file:border-0 file:bg-surface-sunken file:px-3 file:py-2" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />}</Field>}
        {uploading && <p role="status" className={textClass}>正在保存参考图…</p>}
        {uploadError && <Alert variant="warning" title="参考图未上传">{uploadError}</Alert>}
      </div>
      <Field label={reference ? '图生图配置' : '文生图配置'}>{id => <Select id={id} name="imageConfig" value={config ?? ''} onChange={event => setConfigId(event.target.value)}>
        <option value="">使用默认配置</option>
        {compatible.map(item => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? '（默认）' : ''}</option>)}
      </Select>}</Field>
      {options.isSuccess && !purpose?.ready && <Alert variant="warning" title={reference ? '没有可用的图生图配置' : '没有可用的文生图配置'}>
        <p>可以前往图片生成设置配置通道。{reference ? '参考图已保留，也可以手动移除后使用文生图。' : '构图方案已保留。'}</p>
        <Link href="/apps/creative" className="mt-1 inline-block text-sm text-accent underline">查看自由生成配置</Link>
      </Alert>}
      <div className="flex justify-end"><Button variant="primary" disabled={busy || uploading || activeImage || (!!stalePlan && !planEdit) || !plan?.moment.trim() || !plan?.subject.trim()} onClick={() => void act({ action: 'generate-image', configId: config })}><ImageIcon className="size-4" aria-hidden="true" />{latest?.status === 'failed' ? '重新生成这张图' : '生成这张图'}</Button></div>
    </div>}
    {draft.images.filter(item => item.artifactId && item.id !== image?.id).length > 0 && <details className="space-y-3 border-t border-hairline pt-4">
      <summary className="cursor-pointer text-sm font-medium">查看以前的画面</summary>
      {draft.images.filter(item => item.artifactId && item.id !== image?.id).slice().reverse().map(item => <ScenePicture key={item.id} image={item} outdated={bodyEdited || !!planEdit || item.bodyVersion !== draft.bodyVersion || item.planVersion !== draft.imagePlan?.version} />)}
    </details>}
  </section>;
}

export function SceneAdoptPanel({ draft, busy, act }: ActionPanel) {
  const [worldId, setWorld] = useState('');
  const [projectId, setProject] = useState('');
  const works = useStoryWorlds();
  const projects = useWorldHub(!draft.adoption && worldId ? worldId : undefined);
  const bound = projects.data?.linkedProjects.map(item => item.project) ?? [];
  const selectedProject = bound.length === 1 ? bound[0].id : projectId || undefined;
  const image = getSuccessfulImage(draft.images.filter(item => item.bodyVersion === draft.bodyVersion && item.planVersion === draft.imagePlan?.version));

  return <section className={`${surfaceClass} space-y-4`} aria-labelledby="scene-stage-heading">
    <h2 id="scene-stage-heading" tabIndex={-1} className="text-lg font-semibold">收入作品</h2>
    {draft.adoption ? <><p className={textClass}>正文第 {draft.adoption.bodyVersion} 版已收入手稿。</p><Link href={draft.adoption.href} className={buttonVariants({ variant: 'primary' })}>打开手稿</Link></> : <>
      <Field label="目标作品">{id => <Select id={id} name="targetWorld" value={worldId} disabled={busy || works.isPending} onChange={event => { setWorld(event.target.value); setProject(''); }}>
        <option value="">{works.isPending ? '正在读取作品…' : '选择已建立的作品'}</option>
        {works.data?.items.map(work => <option key={work.id} value={work.id}>{work.title}</option>)}
      </Select>}</Field>
      {works.isError && <Button size="sm" variant="ghost" onClick={() => void works.refetch()}>重新读取作品</Button>}
      {works.isSuccess && !works.data.items.length && <Link href="/apps/story-worlds/new" className="text-sm text-accent underline">先新建作品</Link>}
      {worldId && projects.isPending && <p role="status" className={textClass}>正在读取手稿项目…</p>}
      {worldId && projects.isError && <Button size="sm" variant="ghost" onClick={() => void projects.refetch()}>重新读取手稿项目</Button>}
      {worldId && projects.isSuccess && (bound.length ? <Field label="目标手稿项目">{id => <Select id={id} name="targetProject" value={selectedProject ?? ''} disabled={busy} onChange={event => setProject(event.target.value)}>
        {bound.length > 1 && <option value="">选择手稿项目</option>}
        {bound.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </Select>}</Field> : <p className={textClass}>确认后将为该作品创建手稿项目。</p>)}
      <div className="space-y-3 border-t border-hairline pt-4">
        <h3 className="text-base font-semibold">本次收录内容</h3>
        <p className="wrap-anywhere text-sm">{draft.title.trim() || '未命名一幕'}{draft.direction && ` · ${directionLabels[draft.direction]}`}</p>
        <p className="max-h-64 overflow-y-auto rounded-control bg-surface-sunken/55 p-3 whitespace-pre-wrap wrap-anywhere text-base leading-relaxed" tabIndex={0}>{draft.body}</p>
        {image ? <ScenePicture key={image.id} image={image} outdated={false} /> : <p className="text-xs text-muted">当前正文与构图暂无匹配的图片。</p>}
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={busy || !worldId || !projects.isSuccess || (bound.length > 1 && !selectedProject)} onClick={() => void act({ action: 'adopt', worldId, projectId: selectedProject })}>确认收入作品</Button></div>
    </>}
  </section>;
}
