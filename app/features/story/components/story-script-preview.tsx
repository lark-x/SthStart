'use client';

import { useMemo } from 'react';
import { Film } from 'lucide-react';
import type { CastMember } from '../hooks/use-story-mention-picker';
import { parseScriptBody } from '../model/story-editor-text';

export function StoryScriptPreview({ body, castList, indent2em, charCount, colors }: {
  body: string;
  castList: CastMember[];
  indent2em: boolean;
  charCount: number;
  colors: { text: string; muted: string; bubble: string; border: string };
}) {
  const lines = useMemo(() => parseScriptBody(body), [body]);
  return <div className="space-y-4">
    <div className="flex items-center justify-between border-b border-border-default/40 pb-2 text-xs text-muted">
      <span>剧本流演出预览（已识别台词与场景）</span>
      <span>{charCount} 字</span>
    </div>
    {lines.map((line, index) => {
      if (line.kind === 'blank') return <div key={index} className="h-3" />;
      if (line.kind === 'scene') {
        return (
          <div key={index} className="my-6 flex min-w-0 items-center gap-3 break-words">
            <div className="h-px flex-1 bg-border-default/60" />
            <div className="flex items-center gap-1.5 rounded-full border border-border-default/80 bg-surface/80 px-3 py-1 text-xs font-semibold text-accent shadow-2xs">
              <Film className="size-3.5" />
              <span>{line.text}</span>
            </div>
            <div className="h-px flex-1 bg-border-default/60" />
          </div>
        );
      }
      if (line.kind === 'dialogue') {
        const cast = castList.find((member) => member.name === line.speaker);
        return (
          <div key={index} className="my-3 flex items-start gap-3">
            <div className="size-8 shrink-0 rounded-full overflow-hidden border border-border-default bg-surface-muted flex items-center justify-center text-xs font-semibold text-muted shadow-2xs">
              {cast?.avatarUrl ? (
                <img src={cast.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                line.speaker.slice(0, 1)
              )}
            </div>
            <div className="min-w-0 max-w-[85%]">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold text-muted">{line.speaker}</span>
                {cast?.work && (
                  <span className="rounded border border-border-default/60 px-1 py-0.2 text-xs text-muted">
                    {cast.work}
                  </span>
                )}
              </div>
              <div
                className="rounded-control px-4 py-3 text-base leading-relaxed break-words"
                style={{ backgroundColor: colors.bubble, borderColor: colors.border, color: colors.text }}
              >
                “{line.dialogue}”
              </div>
            </div>
          </div>
        );
      }
      return (
        <p
          key={index}
          className={`break-words text-base leading-relaxed ${indent2em ? 'indent-[2em]' : ''}`}
          style={{ color: colors.muted }}
        >
          {line.text}
        </p>
      );
    })}
  </div>;
}
