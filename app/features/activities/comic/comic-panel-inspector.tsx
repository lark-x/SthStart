'use client';

import type { ComicBubble, ComicPage, ComicPanel, ComicShotSize, ContentDocument } from '@sthstart/contracts';
import { getEffectiveStageScenes } from '../scene-beat-utils';

interface ComicPanelInspectorProps {
  panel: ComicPanel | null;
  content: ContentDocument;
  page: ComicPage;
  selectedBubbleId: string | null;
  issues: string[];
  onChange(panel: ComicPanel): void;
  onSelectBubble(bubbleId: string | null): void;
  onOpenRenderSettings(): void;
  onRerenderSelected(): void;
  onMovePanel(direction: -1 | 1): void;
  onExportPng(): void;
  canExport: boolean;
}

function updateBubble(panel: ComicPanel, bubbleId: string, patch: Partial<ComicBubble>): ComicPanel {
  return { ...panel, bubbles: panel.bubbles.map((bubble) => bubble.id === bubbleId ? { ...bubble, ...patch } : bubble) };
}

const fieldClass = 'w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-2.5 py-2 text-sm text-ink';
const labelClass = 'block space-y-1.5 text-xs font-medium text-muted';

export function ComicPanelInspector({ panel, content, page, selectedBubbleId, issues, onChange, onSelectBubble, onOpenRenderSettings, onRerenderSelected, onMovePanel, onExportPng, canExport }: ComicPanelInspectorProps) {
  if (!panel) return <aside className="flex min-h-0 flex-col border-l border-border-default bg-surface p-4"><p className="m-auto text-center text-sm text-muted">选择一个画格开始编辑。</p></aside>;
  const actors = content.actors;
  const sourceBeats = content.stages.flatMap((stage) => getEffectiveStageScenes(stage, content.scenes).flatMap((scene) => scene.beats.map((beat, index) => ({
    stageId: stage.id, sceneId: scene.id, beat, label: `${stage.title} / ${scene.title || '未命名场次'} / #${index + 1} ${beat.action.slice(0, 24)}`,
  }))));
  const panelIndex = page.panelIds.indexOf(panel.id);
  const selectedBubble = panel.bubbles.find((bubble) => bubble.id === selectedBubbleId) ?? null;
  const addBubble = () => {
    const bubble: ComicBubble = {
      id: crypto.randomUUID(), kind: 'speech', speakerActorId: panel.actorIds[0] ?? null, text: '点击此处编辑台词',
      rect: { x: 0.08, y: 0.06, width: 0.5, height: 0.22 }, tail: null, fontSize: 32,
    };
    onChange({ ...panel, bubbles: [...panel.bubbles, bubble] });
    onSelectBubble(bubble.id);
  };
  return (
    <aside className="flex min-h-0 flex-col border-l border-border-default bg-surface">
      <div className="border-b border-border-default px-3 py-2"><h3 className="text-sm font-semibold text-ink">画格属性</h3><p className="mt-0.5 text-xs text-muted">图片与台词分开保存；拖动气泡可调整位置。</p></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>本页第 {panelIndex + 1} / {page.panelIds.length} 格</span><div className="flex gap-1">
          <button type="button" disabled={panelIndex < 1} onClick={() => onMovePanel(-1)} className="rounded border border-border-default px-2 py-1 disabled:opacity-40">前移</button>
          <button type="button" disabled={panelIndex < 0 || panelIndex >= page.panelIds.length - 1} onClick={() => onMovePanel(1)} className="rounded border border-border-default px-2 py-1 disabled:opacity-40">后移</button>
        </div></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onOpenRenderSettings} className="rounded-[var(--radius-control)] bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-dark">✦ 绘制新图</button>
          <button type="button" onClick={onRerenderSelected} disabled={!panel.selectedImage} className="rounded-[var(--radius-control)] border border-border-default bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-50">按此图配置重绘</button>
        </div>
        {panel.selectedImage && <p className="text-xs text-muted">当前画面来源：{panel.selectedImage.origin === 'comic_render' ? '漫画绘制历史' : '原镜头绘制历史'}</p>}
        <label className={labelClass}>来源镜头
          <select className={fieldClass} value={sourceBeats.findIndex((item) => item.stageId === panel.source.stageId && item.sceneId === panel.source.sceneId && panel.source.beatIds.includes(item.beat.id))}
            onChange={(event) => { const selected = sourceBeats[Number(event.target.value)]; if (selected) { const actorIds = selected.beat.characterId ? [selected.beat.characterId] : panel.actorIds; onChange({ ...panel,
              source: { stageId: selected.stageId, sceneId: selected.sceneId, beatIds: [selected.beat.id] },
              actorIds, bubbles: panel.bubbles.map((bubble) => bubble.speakerActorId && !actorIds.includes(bubble.speakerActorId) ? { ...bubble, speakerActorId: null } : bubble),
            }); } }}>
            {sourceBeats.map((item, index) => <option key={`${item.sceneId}:${item.beat.id}`} value={index}>{item.label}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1"><legend className="text-xs font-medium text-muted">画面角色</legend><div className="flex flex-wrap gap-2">{actors.map((actor) => <label key={actor.id} className="flex items-center gap-1 text-xs text-ink"><input type="checkbox" checked={panel.actorIds.includes(actor.id)} onChange={(event) => onChange({ ...panel,
            actorIds: event.target.checked ? [...panel.actorIds, actor.id].slice(0, 8) : panel.actorIds.filter((id) => id !== actor.id),
            bubbles: event.target.checked ? panel.bubbles : panel.bubbles.map((bubble) => bubble.speakerActorId === actor.id ? { ...bubble, speakerActorId: null } : bubble),
          })} />{actor.displayName}</label>)}</div></fieldset>
        <label className={labelClass}>画面描述
          <textarea className={`${fieldClass} min-h-24 resize-y`} value={panel.visualDescription} onChange={(event) => onChange({ ...panel, visualDescription: event.target.value })} />
        </label>
        <label className={labelClass}>构图补充
          <textarea className={`${fieldClass} min-h-16 resize-y`} value={panel.composition} onChange={(event) => onChange({ ...panel, composition: event.target.value })} />
        </label>
        <label className={labelClass}>景别
          <select className={fieldClass} value={panel.shotSize} onChange={(event) => onChange({ ...panel, shotSize: event.target.value as ComicShotSize })}>
            <option value="wide">远景</option><option value="medium">中景</option><option value="closeup">特写</option><option value="detail">细节</option>
          </select>
        </label>
        <label className={labelClass}>气泡预留位置<select className={fieldClass} value={panel.textSafeArea} onChange={(event) => onChange({ ...panel, textSafeArea: event.target.value as ComicPanel['textSafeArea'] })}>
          <option value="none">不预留</option><option value="top_left">左上</option><option value="top_right">右上</option><option value="bottom">底部</option>
        </select></label>
        {panel.selectedImage && <fieldset className="space-y-2 rounded-[var(--radius-panel)] border border-border-default p-3"><legend className="px-1 text-xs font-semibold text-ink">图片裁切</legend>
          {([{ key: 'focalX', label: '水平焦点', min: 0, max: 1, step: 0.01 }, { key: 'focalY', label: '垂直焦点', min: 0, max: 1, step: 0.01 }, { key: 'zoom', label: '放大', min: 1, max: 3, step: 0.05 }] as const).map((field) => <label key={field.key} className={labelClass}>{field.label} · {panel.crop[field.key].toFixed(2)}
            <input className="w-full accent-accent" type="range" min={field.min} max={field.max} step={field.step} value={panel.crop[field.key]} onChange={(event) => onChange({ ...panel, crop: { ...panel.crop, [field.key]: Number(event.target.value) } })} />
          </label>)}</fieldset>}
        <div className="space-y-2 rounded-[var(--radius-panel)] border border-border-default p-3">
          <div className="flex items-center justify-between"><h4 className="text-xs font-semibold text-ink">画格台词</h4><button type="button" disabled={panel.bubbles.length >= 6} onClick={addBubble} className="text-xs font-semibold text-accent disabled:opacity-50">＋ 添加气泡</button></div>
          <div className="flex flex-wrap gap-1.5">
            {panel.bubbles.map((bubble, index) => <button type="button" key={bubble.id} onClick={() => onSelectBubble(bubble.id)}
              aria-pressed={bubble.id === selectedBubbleId} className={`max-w-full truncate rounded-full border px-2 py-1 text-xs ${bubble.id === selectedBubbleId ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-muted'}`}>气泡 {index + 1} · {bubble.text.slice(0, 10)}</button>)}
          </div>
          {selectedBubble && (
            <div className="space-y-2 border-t border-border-default pt-3">
              <label className={labelClass}>气泡文字
                <textarea className={`${fieldClass} min-h-20 resize-y`} maxLength={300} value={selectedBubble.text} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { text: event.target.value }))} />
              </label>
              <label className={labelClass}>说话角色
                <select className={fieldClass} value={selectedBubble.speakerActorId ?? ''} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { speakerActorId: event.target.value || null }))}>
                  <option value="">旁白 / 无角色</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
                </select>
              </label>
              <label className={labelClass}>气泡样式<select className={fieldClass} value={selectedBubble.kind} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { kind: event.target.value as ComicBubble['kind'], tail: event.target.value === 'speech' ? selectedBubble.tail : null }))}>
                <option value="speech">对话</option><option value="caption">旁白</option><option value="emphasis">强调</option>
              </select></label>
              {selectedBubble.kind === 'speech' && <div className="space-y-1"><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={selectedBubble.tail !== null} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { tail: event.target.checked ? { x: 0.5, y: 0.75 } : null }))} />显示气泡尾巴</label>
                {selectedBubble.tail && <div className="grid grid-cols-2 gap-2">{(['x', 'y'] as const).map((key) => <label key={key} className={labelClass}>尾巴{key === 'x' ? '水平' : '垂直'}位置
                  <input className="w-full accent-accent" type="range" min={0} max={1} step={0.01} value={selectedBubble.tail?.[key] ?? 0.5} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { tail: { ...selectedBubble.tail!, [key]: Number(event.target.value) } }))} />
                </label>)}</div>}</div>}
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((key) => <label className={labelClass} key={key}>{({ x: '横向位置', y: '纵向位置', width: '宽度', height: '高度' })[key]}
                  <input className={fieldClass} type="number" min={0.02} max={1} step={0.01} value={selectedBubble.rect[key]}
                    onChange={(event) => { const value = Math.max(0.02, Math.min(1, Number(event.target.value))); const rect = { ...selectedBubble.rect, [key]: value }; rect.x = Math.min(rect.x, 1 - rect.width); rect.y = Math.min(rect.y, 1 - rect.height); onChange(updateBubble(panel, selectedBubble.id, { rect })); }} />
                </label>)}
              </div>
              <label className={labelClass}>字号：{selectedBubble.fontSize}px
                <input className="w-full accent-accent" type="range" min={24} max={48} step={1} value={selectedBubble.fontSize} onChange={(event) => onChange(updateBubble(panel, selectedBubble.id, { fontSize: Number(event.target.value) }))} />
              </label>
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => onChange({ ...panel, bubbles: panel.bubbles.filter((bubble) => bubble.id !== selectedBubble.id) })}>删除此气泡</button>
            </div>
          )}
          {!selectedBubble && panel.bubbles.length > 0 && <p className="text-xs text-muted">点选上方气泡或直接在画布中拖动。</p>}
        </div>
        <details className="rounded-[var(--radius-panel)] border border-border-default p-3"><summary className="cursor-pointer text-xs font-semibold text-ink">阅读演出</summary><div className="mt-3 space-y-2">
          <label className={labelClass}>镜头移动<select className={fieldClass} value={panel.presentation.camera} onChange={(event) => onChange({ ...panel, presentation: { ...panel.presentation, camera: event.target.value as ComicPanel['presentation']['camera'] } })}>
            <option value="none">无</option><option value="push_in">轻推近</option><option value="pan_left">向左平移</option><option value="pan_right">向右平移</option>
          </select></label>
          <label className={labelClass}>强调效果<select className={fieldClass} value={panel.presentation.impact} onChange={(event) => onChange({ ...panel, presentation: { ...panel.presentation, impact: event.target.value as ComicPanel['presentation']['impact'] } })}>
            <option value="none">无</option><option value="shake">震动</option><option value="flash">闪白</option>
          </select></label>
          <label className={labelClass}>自动播放停留（毫秒，留空自动计算）<input className={fieldClass} type="number" min={500} max={30000} step={100} value={panel.presentation.holdMs ?? ''} onChange={(event) => onChange({ ...panel, presentation: { ...panel.presentation, holdMs: event.target.value ? Math.max(500, Math.min(30000, Number(event.target.value))) : null } })} /></label>
        </div></details>
        {issues.length > 0 && <div role="alert" className="rounded-[var(--radius-control)] border border-warning/30 bg-warning/5 p-2 text-xs text-warning">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
        <button type="button" disabled={!canExport} onClick={onExportPng} className="w-full rounded-[var(--radius-control)] bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">导出当前页 PNG</button>
      </div>
    </aside>
  );
}
