'use client';

import type { RefObject } from 'react';
import type { CastMember } from '../hooks/use-story-mention-picker';
import type { FontChoice, ViewMode } from '../model/story-editor-preferences';
import { fontFamilies } from '../model/story-editor-preferences';
import { StoryMarkdown } from '../story-markdown';

export function StoryEntryTextCanvas({
  mode, body, bodyRef, theme, font, indent2em,
  mentionActive, filteredCast, mentionIndex, onMentionHover, onMentionPick,
  onBodyChange, onBodyKeyDown,
}: {
  mode: ViewMode;
  body: string;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  theme: { text: string; muted: string; bubble: string; border: string };
  font: FontChoice;
  indent2em: boolean;
  mentionActive: boolean;
  filteredCast: CastMember[];
  mentionIndex: number;
  onMentionHover: (index: number) => void;
  onMentionPick: (name: string) => void;
  onBodyChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBodyKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const currentFont = fontFamilies[font];
  return <div className={`grid gap-6 ${mode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
    {mode !== 'preview' && (
      <div className="relative min-w-0 flex flex-col">
        {/* @ 角色补全浮层 */}
        {mentionActive && filteredCast.length > 0 && (
          <div
            className="absolute left-4 top-12 z-30 max-h-56 w-64 overflow-y-auto rounded-panel border border-border-default bg-surface p-1.5 shadow-floating"
            role="listbox"
            aria-label="角色对白补全"
          >
            <div className="px-2 py-1 text-xs font-medium text-muted border-b border-border-default/60">
              登场角色（回车填入对白引号）
            </div>
            {filteredCast.map((member, index) => (
              <button
                key={member.id || member.name}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => onMentionHover(index)}
                onClick={() => onMentionPick(member.name)}
                className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  index === mentionIndex ? 'bg-accent/15 text-accent font-semibold' : 'text-ink hover:bg-surface-hover'
                }`}
              >
                <div className="size-5 shrink-0 rounded-full overflow-hidden border border-border-default bg-surface-muted flex items-center justify-center text-xs">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" className="size-full object-cover" />
                  ) : (
                    member.name.slice(0, 1)
                  )}
                </div>
                <span className="truncate flex-1">{member.name}</span>
                {member.work && <span className="shrink-0 text-xs text-muted">{member.work}</span>}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={bodyRef}
          data-reading-surface
          aria-label="小说正文编辑"
          value={body}
          onChange={onBodyChange}
          onKeyDown={onBodyKeyDown}
          placeholder="在此倾泻思绪… 输入 @ 快捷填入登场角色对白"
          className="min-h-[30rem] w-full resize-none bg-transparent outline-none font-reading text-[16px] font-[430] leading-[1.85] tracking-[0.012em]"
          style={{ color: theme.text, fontFamily: currentFont.style }}
        />
      </div>
    )}

    {mode !== 'source' && (
      <div
        className="min-w-0 rounded-lg p-4 text-base break-words"
        style={{ backgroundColor: theme.bubble, borderColor: theme.border }}
      >
        {body.trim() ? (
          <div className={indent2em ? '[&_p]:indent-[2em]' : ''}>
            <StoryMarkdown source={body} />
          </div>
        ) : (
          <p className="text-sm text-muted">预览区将渲染小说排版效果。</p>
        )}
      </div>
    )}
  </div>;
}
