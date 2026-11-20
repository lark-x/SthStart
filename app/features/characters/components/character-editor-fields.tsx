'use client';

import { useState } from 'react';
import { useFieldArray, type Control, type FieldArrayWithId, type UseFormRegister } from 'react-hook-form';
import { BookOpen, MessageSquareQuote, PenLine, Plus, ShieldCheck, Trash2, Volume2 } from 'lucide-react';
import { stripMachineCharacterIndex, type CharacterDraftV2 } from '@sthstart/contracts';
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

type DossierSection = {
  title: string;
  blocks: PersonaBlock[];
};

function groupPersonaSections(blocks: PersonaBlock[]): DossierSection[] {
  const sections: DossierSection[] = [];
  let current: DossierSection | null = null;

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (current && current.blocks.length > 0) sections.push(current);
      current = { title: block.text, blocks: [] };
      continue;
    }
    if (!current) {
      current = { title: '详细设定', blocks: [] };
    }
    current.blocks.push(block);
  }
  if (current && current.blocks.length > 0) sections.push(current);
  return sections;
}

function splitKeyedText(text: string): { key: string; body: string } | null {
  const match = /^([^：:\n]{1,32})[：:]\s*([\s\S]+)$/.exec(text.trim());
  if (!match) return null;
  return { key: match[1].trim(), body: match[2].trim() };
}

function isCompactSpecSection(section: DossierSection): boolean {
  if (!/基础档案|基本资料|属性/.test(section.title) && section.blocks.length > 4) return false;
  if (section.blocks.length === 0 || section.blocks.length > 6) return false;
  return section.blocks.every((block) => {
    if (block.type === 'field') return block.content.length <= 28;
    if (block.type === 'bullet') return block.text.length <= 36 && Boolean(splitKeyedText(block.text));
    return false;
  });
}

function renderReadingBlocks(blocks: PersonaBlock[]) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'field') {
          return (
            <div
              key={index}
              className="rounded-lg border border-hairline bg-surface-sunken/35 px-3.5 py-2.5 space-y-1"
            >
              <div className="text-xs font-semibold text-accent-dark">{block.label}</div>
              <p className="font-reading text-[14.5px] leading-[1.75] text-ink">{block.content || '—'}</p>
            </div>
          );
        }
        if (block.type === 'bullet') {
          const keyed = splitKeyedText(block.text);
          if (keyed) {
            return (
              <div key={index} className="space-y-1 border-b border-hairline/70 pb-2.5 last:border-b-0 last:pb-0">
                <div className="text-[13px] font-semibold text-ink flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <span>{keyed.key}</span>
                </div>
                <p className="pl-3.5 font-reading text-[14.5px] leading-[1.8] text-ink/90 whitespace-pre-wrap">
                  {keyed.body}
                </p>
              </div>
            );
          }
          return (
            <div key={index} className="flex items-start gap-2 font-reading text-[14.5px] leading-[1.8] text-ink">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span className="whitespace-pre-wrap">{block.text}</span>
            </div>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap font-reading text-[14.5px] leading-[1.8] text-ink">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

/** 完整阅读态：采用全宽分栏卡片网格（核心语态/行为边界并排、分节卡片自适应填满），告别单侧留白窄栏。 */
export function CharacterDossierReading({ draft, visual = false }: { draft: CharacterDraftV2; visual?: boolean }) {
  if (visual) {
    const visualSections = [
      { title: '基础外貌特征', text: draft.appearance.baseText, hint: '尚未填写基础外貌特征，可进入编辑补充。' },
      { title: '代表性装扮与配饰', text: draft.appearance.defaultOutfitText, hint: '尚未填写代表性装扮与配饰，可进入编辑补充。' },
    ];
    return (
      <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 break-words">
        {visualSections.map((sec) => {
          const blocks = parsePersonaBlocks(sec.text || '');
          return (
            <section
              key={sec.title}
              className="rounded-xl border border-border-subtle bg-surface-sunken/25 p-5 space-y-3"
            >
              <h3 className="flex items-center gap-2 border-b border-hairline pb-2.5 text-[15px] font-semibold text-ink">
                <span className="h-4 w-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                <span>{sec.title}</span>
              </h3>
              {blocks.length > 0 ? renderReadingBlocks(blocks) : <p className="text-sm text-muted">{sec.hint}</p>}
            </section>
          );
        })}
      </div>
    );
  }

  const personaSections = groupPersonaSections(parsePersonaBlocks(stripMachineCharacterIndex(draft.personaText || '')));
  const specSections = personaSections.filter(isCompactSpecSection);
  const richSections = personaSections.filter((sec) => !isCompactSpecSection(sec));

  const speechBlocks = parsePersonaBlocks(draft.speechText || '');
  const behaviorBlocks = parsePersonaBlocks(draft.behaviorRules || '');
  const exampleCount = draft.dialogueExamples.length;
  const examplesGridCols =
    exampleCount <= 1
      ? 'grid-cols-1'
      : exampleCount === 2
        ? 'grid-cols-1 lg:grid-cols-2'
        : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="w-full space-y-5 break-words">
      {/* 0. 一句话概述导读 + 基础档案参数条（放入右侧阅读区顶部，左栏保持紧凑不留白） */}
      {(draft.summary || specSections.length > 0) && (
        <div className="space-y-3">
          {draft.summary && (
            <div className="rounded-xl border border-hairline bg-surface-sunken/40 px-4 py-3.5 font-reading text-[15px] leading-[1.75] text-ink">
              {draft.summary}
            </div>
          )}
          {specSections.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-sunken/30 px-4 py-2.5">
              {specSections.map((sec) => (
                <span key={sec.title} className="text-xs font-semibold text-muted mr-1">
                  {sec.title}
                </span>
              ))}
              {specSections.flatMap((sec) =>
                sec.blocks.map((block, idx) => {
                  const rawText = block.type === 'field' ? `${block.label}：${block.content}` : block.type === 'bullet' ? block.text : '';
                  const keyed = splitKeyedText(rawText);
                  return (
                    <span
                      key={`${sec.title}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-xs"
                    >
                      {keyed ? (
                        <>
                          <span className="text-muted">{keyed.key}</span>
                          <span className="font-semibold text-ink">{keyed.body}</span>
                        </>
                      ) : (
                        <span className="font-medium text-ink">{rawText}</span>
                      )}
                    </span>
                  );
                }),
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. 核心演绎双栏卡：说话方式与语气 + 认知边界与行为底线 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border-subtle bg-surface-sunken/25 p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 border-b border-hairline pb-2.5 text-[15px] font-semibold text-ink">
            <Volume2 className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
            <span>说话方式与语气</span>
          </h3>
          {speechBlocks.length > 0 ? (
            renderReadingBlocks(speechBlocks)
          ) : (
            <p className="text-sm text-muted">尚未填写说话方式与语气，可进入编辑补充。</p>
          )}
        </section>

        <section className="rounded-xl border border-border-subtle bg-surface-sunken/25 p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 border-b border-hairline pb-2.5 text-[15px] font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
            <span>认知边界与行为底线</span>
          </h3>
          {behaviorBlocks.length > 0 ? (
            renderReadingBlocks(behaviorBlocks)
          ) : (
            <p className="text-sm text-muted">尚未填写认知边界与行为底线，可进入编辑补充。</p>
          )}
        </section>
      </div>

      {/* 3. 详细人设背景（按章节分卡，双栏自适应，奇数末卡自动全宽） */}
      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold text-muted">详细人设档案</h3>
        {richSections.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {richSections.map((sec, idx) => {
              const spanFull = richSections.length % 2 === 1 && idx === richSections.length - 1;
              return (
                <section
                  key={`${sec.title}-${idx}`}
                  className={`rounded-xl border border-border-subtle bg-surface-raised/60 p-4 sm:p-5 space-y-3 ${
                    spanFull ? 'xl:col-span-2' : ''
                  }`}
                >
                  <h4 className="flex items-center gap-2 border-b border-hairline pb-2.5 text-[15.5px] font-semibold text-ink">
                    <span className="h-4 w-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                    <span>{sec.title}</span>
                  </h4>
                  {renderReadingBlocks(sec.blocks)}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border-subtle bg-surface-sunken/20 p-6 text-sm text-muted">
            尚未填写详细人设背景，可进入编辑补充或使用「上游重构 RP 卡」。
          </div>
        )}
      </div>

      {/* 4. 情境对话范例（全宽对话脚本卡网格） */}
      {exampleCount > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted">
            <MessageSquareQuote className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
            <span>情境对话范例</span>
          </h3>
          <div className={`grid gap-4 ${examplesGridCols}`}>
            {draft.dialogueExamples.map((example, index) => {
              const lines = example
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
              return (
                <div
                  key={index}
                  className="rounded-xl border border-hairline bg-surface-sunken/30 p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between border-b border-hairline/70 pb-2 text-xs font-semibold text-muted">
                    <span>对话示例 {index + 1}</span>
                  </div>
                  <div className="space-y-2">
                    {lines.map((line, lIdx) => {
                      const speakerMatch = /^([^：:\n]{1,12})[：:]\s*(.+)$/.exec(line);
                      if (speakerMatch) {
                        const speaker = speakerMatch[1].trim();
                        const speech = speakerMatch[2].trim();
                        const isUserTurn = /^(用户|我|旅伴|开拓者|旅行者|user)$/i.test(speaker);
                        return (
                          <div
                            key={lIdx}
                            className={`rounded-lg px-3 py-2 text-[13.5px] leading-[1.7] ${
                              isUserTurn
                                ? 'bg-surface border border-hairline text-muted'
                                : 'bg-surface-raised border border-border-subtle text-ink'
                            }`}
                          >
                            <span className={`mr-1.5 font-semibold ${isUserTurn ? 'text-muted' : 'text-accent-dark'}`}>
                              {speaker}：
                            </span>
                            <span className="whitespace-pre-wrap">{speech}</span>
                          </div>
                        );
                      }
                      return (
                        <p key={lIdx} className="whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink">
                          {line}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function CharacterPersonaPanel({
  control,
  register,
  draft,
  onDirty,
}: {
  control?: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  draft: CharacterDraftV2;
  onDirty: () => void;
}) {
  const cleanPersona = stripMachineCharacterIndex(draft.personaText || '');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const blocks = parsePersonaBlocks(cleanPersona);
  const exampleFields = useFieldArray({
    control,
    name: 'dialogueExamples',
  });

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      {/* 一句话概述 */}
      <div className="space-y-1.5">
        <label htmlFor="char-summary" className="block text-[13px] font-semibold text-ink">
          一句话概述
        </label>
        <Textarea
          id="char-summary"
          rows={2}
          {...register('summary', { onChange: onDirty })}
          placeholder="例如：西风骑士团代理团长，以责任感守护蒙德。"
          className="min-h-14.5 bg-surface-input font-reading text-[15px] font-[450] leading-[1.7] px-3.5 py-2"
        />
      </div>

      {/* 说话方式与语流（直接赋予 AI 故事推演沉浸感） */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="char-speech" className="block text-[13px] font-semibold text-ink">
            说话方式与语气
          </label>
          <Textarea
            id="char-speech"
            rows={3}
            {...register('speechText', { onChange: onDirty })}
            placeholder="例如：礼貌稳重、措辞严谨；面对休息与关心时会短暂停顿并流露疲惫。"
            className="bg-surface-input text-sm leading-relaxed p-3"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="char-behavior-rules" className="block text-[13px] font-semibold text-ink">
            认知边界与行为底线
          </label>
          <Textarea
            id="char-behavior-rules"
            rows={3}
            {...register('behaviorRules', { onChange: onDirty })}
            placeholder="例如：坚守世界观认知盲区，不理解现代网络梗；遇到原则问题绝不妥协。"
            className="bg-surface-input text-sm leading-relaxed p-3"
          />
        </div>
      </div>

      {/* 防复读情境对话范例 */}
      <div className="space-y-2 rounded-panel border border-hairline bg-surface-sunken/35 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-ink">
            情境对话范例（校准语气与节奏）
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              exampleFields.append({ value: '' });
              onDirty();
            }}
            className="h-7 px-2 text-xs text-accent"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            <span>添加示例</span>
          </Button>
        </div>

        {exampleFields.fields.length === 0 ? (
          <p className="text-xs text-muted">
            暂无对话示例；可通过「从上游重构 RP 卡」自动提炼原生语音与剧情切片，或手动添加 2~3 条示范。
          </p>
        ) : (
          <div className="space-y-2">
            {exampleFields.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <Textarea
                  rows={2}
                  aria-label={`第 ${index + 1} 条情境对话范例`}
                  {...register(`dialogueExamples.${index}.value`, { onChange: onDirty })}
                  placeholder="情境：日常交流 / 被质疑时……"
                  className="w-full bg-surface-input text-xs leading-relaxed p-2.5"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`移除第 ${index + 1} 条对话示例`}
                  onClick={() => {
                    exampleFields.remove(index);
                    onDirty();
                  }}
                  className="h-8 w-8 p-0 text-muted hover:text-danger-fg shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详细人设背景（清除机器索引行与冗余说明） */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="char-persona" className="text-[13px] font-semibold text-ink">
            详细人设背景
          </label>
          <div className="inline-flex items-center rounded-lg border border-hairline bg-surface-sunken p-0.5">
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
              <span>阅读视图</span>
            </button>
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
              <span>编辑原文</span>
            </button>
          </div>
        </div>

        {/* 编辑视图：始终保持挂载以保留 RHF ref 与输入历史 */}
        <div className={viewMode === 'preview' ? 'hidden' : 'block'}>
          <Textarea
            id="char-persona"
            rows={14}
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
  loraFields,
  onAppendLora,
  onRemoveLora,
}: {
  register: UseFormRegister<CharacterFormValues>;
  onDirty: () => void;
  loraFields?: FieldArrayWithId<CharacterFormValues, 'visualLoras', 'id'>[];
  onAppendLora?: () => void;
  onRemoveLora?: (index: number) => void;
}) {
  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="char-appearance-base" className="text-[13px] font-semibold text-ink">
            基础外貌特征
          </label>
          <span className="text-muted text-xs">跨服装保持不变的面部、发色、瞳色与体貌</span>
        </div>
        <Textarea
          id="char-appearance-base"
          rows={4}
          {...register('appearance.baseText', { onChange: onDirty })}
          placeholder="例如：金发束成高马尾，碧蓝色眼眸，身姿挺拔。"
          className="bg-surface-input font-reading text-[15px] font-[420] leading-[1.8] tracking-[0.01em] p-3.5"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="char-outfit" className="text-[13px] font-semibold text-ink">
            代表性装扮与配饰
          </label>
          <span className="text-muted text-xs">未指定皮肤或特殊服装时使用的基准穿搭</span>
        </div>
        <Textarea
          id="char-outfit"
          rows={4}
          {...register('appearance.defaultOutfitText', { onChange: onDirty })}
          placeholder="例如：白蓝黑相间的西风骑士团礼服披肩与白色长靴。"
          className="bg-surface-input font-reading text-[15px] font-[420] leading-[1.8] tracking-[0.01em] p-3.5"
        />
      </div>

      {loraFields && onAppendLora && onRemoveLora && (
        <details className="rounded-panel border border-hairline bg-surface-sunken/35 p-3.5">
          <summary className="cursor-pointer text-xs font-semibold text-ink select-none">
            高级生图参数：角色专属 LoRA ({loraFields.length})
          </summary>
          <div className="mt-4">
            <CharacterLoraPanel
              register={register}
              fields={loraFields}
              onAppend={onAppendLora}
              onRemove={onRemoveLora}
            />
          </div>
        </details>
      )}
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
