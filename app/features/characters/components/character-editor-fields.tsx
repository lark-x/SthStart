'use client';

import { useState } from 'react';
import type { FieldArrayWithId, UseFormRegister } from 'react-hook-form';
import { BookOpen, PenLine, Plus, Trash2 } from 'lucide-react';
import type { CharacterDraftV2 } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import type { CharacterFormValues } from '../model/character-form-values';

export const PERSONA_PLACEHOLDER = [
  '### 身份与经历',
  '社会身份、对外形象与核心经历。',
  '',
  '### 性格与处世',
  '- 语气特征与日常处世风格',
  '- 话语与内在情感的反差',
  '',
  '### 好恶与动机',
  '- 喜欢：...',
  '- 不喜欢：...',
  '- 核心内在动机：...',
].join('\n');

type PersonaBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'field'; label: string; content: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string };

function parsePersonaBlocks(text: string): PersonaBlock[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const blocks: PersonaBlock[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }
    const fieldMatch = /^【([^】]+)】\s*[：:]?\s*(.*)$/.exec(line);
    if (fieldMatch) {
      blocks.push({ type: 'field', label: fieldMatch[1].trim(), content: fieldMatch[2].trim() });
      continue;
    }
    const bulletMatch = /^[-*•]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      blocks.push({ type: 'bullet', text: bulletMatch[1].trim() });
      continue;
    }
    blocks.push({ type: 'paragraph', text: line });
  }
  return blocks;
}

function extractPersonaDimensions(blocks: PersonaBlock[]): string[] {
  const seen = new Set<string>();
  const dims: string[] = [];
  for (const b of blocks) {
    const raw = b.type === 'heading' ? b.text : b.type === 'field' ? b.label : '';
    if (!raw || raw.includes('MCP角色索引')) continue;
    const clean = raw.replace(/[：:]+$/, '').trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      dims.push(clean);
    }
    if (dims.length >= 10) break;
  }
  return dims;
}

export function CharacterPersonaPanel({
  register,
  draft,
  onDirty,
}: {
  register: UseFormRegister<CharacterFormValues>;
  draft: CharacterDraftV2;
  onDirty: () => void;
}) {
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const personaText = draft.personaText || '';
  const blocks = parsePersonaBlocks(personaText);
  const dimensions = extractPersonaDimensions(blocks);

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      {/* 一句话概述引言卡片 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="char-summary" className="text-[13px] font-semibold text-ink">
            一句话概述
          </label>
          <span className="text-xs text-muted">用于卡片预览与人物列表</span>
        </div>
        <Textarea
          id="char-summary"
          rows={2}
          {...register('summary', { onChange: onDirty })}
          placeholder="例如：枫丹前水神，聚光灯下华丽戏剧化，内心敏感孤单的戏剧家。"
          className="min-h-[64px] bg-surface-input font-reading text-[15px] font-[450] leading-[1.75] tracking-[0.008em] px-3.5 py-2.5"
        />
      </div>

      {/* 详细人设背景 */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2.5">
            <label htmlFor="char-persona" className="text-[13px] font-semibold text-ink">
              详细人设背景
            </label>
            <span className="hidden text-xs text-muted sm:inline">支持 ### 章节与【维度】结构化排版</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted tabular-nums">
              {personaText.length} 字
            </span>
            <div className="inline-flex items-center rounded-lg border border-hairline bg-surface-sunken p-0.5">
              <button
                type="button"
                aria-pressed={viewMode === 'edit'}
                onClick={() => setViewMode('edit')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'edit'
                    ? 'bg-surface-raised text-ink shadow-2xs ring-1 ring-border-subtle'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <PenLine className="h-3 w-3" aria-hidden="true" />
                <span>编辑设定</span>
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'preview'}
                onClick={() => setViewMode('preview')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'preview'
                    ? 'bg-surface-raised text-ink shadow-2xs ring-1 ring-border-subtle'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                <span>设定集预览</span>
              </button>
            </div>
          </div>
        </div>

        {/* 设定维度速览标签 */}
        {dimensions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-hairline bg-surface-sunken/40 px-3 py-2">
            <span className="mr-1 text-[11px] font-semibold tracking-wide text-muted">设定维度</span>
            {dimensions.map((dim) => (
              <button
                key={dim}
                type="button"
                onClick={() => setViewMode('preview')}
                className="inline-flex items-center rounded-md border border-hairline bg-surface px-2 py-0.5 text-[11.5px] font-medium text-ink transition-colors hover:border-accent/40 hover:text-accent cursor-pointer"
                title="点击以设定集画册排版预览完整结构"
              >
                {dim}
              </button>
            ))}
          </div>
        )}

        {/* 编辑视图：始终保持挂载以保留 RHF ref 与输入历史 */}
        <div className={viewMode === 'preview' ? 'hidden' : 'block'}>
          <Textarea
            id="char-persona"
            rows={16}
            {...register('personaText', { onChange: onDirty })}
            placeholder={PERSONA_PLACEHOLDER}
            className="font-reading text-[15.5px] font-[420] leading-[1.85] tracking-[0.012em] p-4"
          />
        </div>

        {/* 设定集画册排版阅读视图 */}
        {viewMode === 'preview' && (
          <div className="rounded-xl border border-border-subtle bg-surface-raised p-5 sm:p-6 shadow-xs space-y-3.5">
            {blocks.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-muted">尚未填写详细人设背景。</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setViewMode('edit')}>
                  切回编辑设定
                </Button>
              </div>
            ) : (
              blocks.map((block, index) => {
                if (block.type === 'heading') {
                  return (
                    <h3
                      key={index}
                      className="flex items-center gap-2 border-b border-border-subtle pb-2 pt-2 first:pt-0 text-[16px] font-[650] tracking-[-0.01em] text-ink"
                    >
                      <span className="h-3.5 w-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                      <span>{block.text}</span>
                    </h3>
                  );
                }
                if (block.type === 'field') {
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-1 gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4 rounded-lg bg-surface-sunken/40 px-3.5 py-2.5"
                    >
                      <div className="text-[13px] font-semibold text-accent-dark sm:pt-0.5">
                        {block.label}
                      </div>
                      <div className="font-reading text-[15px] font-[420] leading-[1.8] tracking-[0.01em] text-ink">
                        {block.content || '—'}
                      </div>
                    </div>
                  );
                }
                if (block.type === 'bullet') {
                  return (
                    <div
                      key={index}
                      className="flex items-start gap-2.5 pl-1 font-reading text-[15px] font-[420] leading-[1.8] text-ink"
                    >
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      <span>{block.text}</span>
                    </div>
                  );
                }
                return (
                  <p
                    key={index}
                    className="font-reading text-[15.5px] font-[420] leading-[1.85] tracking-[0.012em] text-ink"
                  >
                    {block.text}
                  </p>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CharacterVisualPanel({
  register,
  onDirty,
}: {
  register: UseFormRegister<CharacterFormValues>;
  onDirty: () => void;
}) {
  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="char-appearance-base" className="text-[13px] font-semibold text-ink">
            基础外貌特征
          </label>
          <span className="text-muted text-xs">面部、发型发色、身形与体貌特征</span>
        </div>
        <Textarea
          id="char-appearance-base"
          rows={5}
          {...register('appearance.baseText', { onChange: onDirty })}
          placeholder="例如：蓝白相间中长发，双色渐变微卷发尾；水蓝色异色瞳孔；身形娇小玲珑，神情灵动。"
          className="bg-surface-input font-reading text-[15px] font-[420] leading-[1.8] tracking-[0.01em] p-3.5"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="char-outfit" className="text-[13px] font-semibold text-ink">
            代表性装扮与配饰
          </label>
          <span className="text-muted text-xs">默认服装、经典礼服或随身配饰</span>
        </div>
        <Textarea
          id="char-outfit"
          rows={5}
          {...register('appearance.defaultOutfitText', { onChange: onDirty })}
          placeholder="例如：华丽的深蓝与白色枫丹礼服礼帽，精致蕾丝领结，左眼单片水滴装饰。"
          className="bg-surface-input font-reading text-[15px] font-[420] leading-[1.8] tracking-[0.01em] p-3.5"
        />
      </div>
    </div>
  );
}

export function CharacterLoraPanel({
  register,
  fields,
  onAppend,
  onRemove,
}: {
  register: UseFormRegister<CharacterFormValues>;
  fields: FieldArrayWithId<CharacterFormValues, 'visualLoras', 'id'>[];
  onAppend: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <div>
          <h4 className="text-sm font-semibold text-ink">角色专属 LoRA 模型</h4>
          <p className="text-xs text-muted mt-0.5">
            活动镜头使用此角色时，会自动将这些 LoRA 叠加到画风设置中。
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAppend}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          <span>添加 LoRA</span>
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center text-xs text-muted">
          暂未配置角色 LoRA，生图时将采用全局与活动画风默认模型。
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 gap-3 rounded-panel border border-border-subtle bg-surface-raised/40 p-3.5 sm:grid-cols-[minmax(0,1.5fr)_96px_minmax(0,1fr)_auto] sm:items-end"
            >
              <label className="block min-w-0 text-xs font-medium text-muted">
                LoRA 文件名
                <Input
                  {...register(`visualLoras.${index}.model`)}
                  placeholder="character-lora.safetensors"
                  className="mt-1.5 h-9 bg-surface text-sm sm:text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-muted">
                强度
                <Input
                  type="number"
                  min={-10}
                  max={10}
                  step={0.05}
                  {...register(`visualLoras.${index}.strength`, { valueAsNumber: true })}
                  className="mt-1.5 h-9 bg-surface text-sm sm:text-xs"
                />
              </label>
              <label className="block min-w-0 text-xs font-medium text-muted">
                触发词
                <Input
                  {...register(`visualLoras.${index}.triggerWord`)}
                  placeholder="触发关键词"
                  className="mt-1.5 h-9 bg-surface text-sm sm:text-xs"
                />
              </label>
              <div className="flex h-9 items-center justify-between gap-3 sm:justify-end">
                <Checkbox
                  label="启用"
                  {...register(`visualLoras.${index}.enabled`)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`移除第 ${index + 1} 个角色 LoRA`}
                  onClick={() => onRemove(index)}
                  className="h-9 min-h-9 w-9 p-0 text-muted hover:text-danger-fg"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
