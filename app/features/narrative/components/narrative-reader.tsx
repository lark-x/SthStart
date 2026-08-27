'use client';

import React from 'react';
import { Bookmark, Sparkles } from 'lucide-react';
import type { NarrativeReading } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

export function NarrativeReader({
  reading,
  onSaveUtteranceToNotebook,
  onOpenImport,
  onGenerateConcept,
  generatingConcept,
}: {
  reading: NarrativeReading | null;
  onSaveUtteranceToNotebook: (utteranceId: string) => Promise<void>;
  onOpenImport: () => void;
  onGenerateConcept: () => void;
  generatingConcept: boolean;
}) {
  if (!reading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#f5f1e8] min-h-[60vh]">
        <span className="font-serif text-5xl text-[#b08a4b] mb-4">⌁</span>
        <h2 className="font-serif text-3xl font-medium text-[#202631]">档案仍是空的</h2>
        <p className="mt-2 text-xs text-[#72777e] max-w-sm leading-relaxed">
          从一份规范化的剧情 JSON，或通过虚空终端 MCP 数据源连接器导入完整剧情任务链。
        </p>
        <Button variant="primary" className="mt-6" onClick={onOpenImport}>
          打开导入工作台
        </Button>
      </div>
    );
  }

  return (
    <article className="flex-1 min-w-0 bg-[#f5f1e8] px-6 sm:px-12 md:px-16 py-10 space-y-10 overflow-y-auto">
      {/* Node Header */}
      <header className="pb-8 border-b border-[rgb(32_38_49/13%)] space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a6a35]">
          CONTINUOUS READING
        </span>
        <h1 className="font-serif text-4xl sm:text-5xl font-medium tracking-tight text-[#202631]">
          {reading.node.title}
        </h1>
        {reading.node.summary && (
        <p className="text-sm text-[#70747a] leading-relaxed max-w-3xl pt-1">
          {reading.node.summary}
        </p>
        )}
        <Button type="button" size="sm" variant="accent" onClick={onGenerateConcept} loading={generatingConcept}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>生成概念图</span>
        </Button>
      </header>

      {reading.node.conceptArtifacts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#8e9194]">CONCEPT ART</span>
            <span className="text-xs text-[#8e9194]">已附加 {reading.node.conceptArtifacts.length} 张</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {reading.node.conceptArtifacts.map((artifact) => (
              <a key={artifact.artifactId} href={artifact.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-[rgb(32_38_49/12%)] bg-[#fffdf7]">
                <img src={artifact.url} alt="剧情概念图" loading="lazy" className="aspect-video w-full object-cover" />
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Scenes */}
      <div className="space-y-12">
        {reading.scenes.map((scene, index) => (
          <section key={scene.id} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="font-serif text-2xl text-[#b08a4b]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <span className="text-[9px] uppercase font-bold tracking-widest text-[#8e9194] block">
                  SCENE
                </span>
                <h3 className="font-serif text-xl font-medium text-[#202631]">
                  {scene.title || `场景 ${index + 1}`}
                </h3>
              </div>
            </div>

            {scene.summary && (
              <p className="text-xs text-[#777b80] leading-relaxed italic pl-9">
                {scene.summary}
              </p>
            )}

            {/* Utterances */}
            <div className="space-y-3 pt-2">
              {scene.utterances.map((line) => {
                const isNarration = line.kind === 'narration';
                const isChoice = line.kind === 'choice';

                return (
                  <div
                    key={line.id}
                    className={`group relative max-w-3xl p-4 transition-colors ${
                      isNarration
                        ? 'border-l-2 border-[#778495] bg-transparent text-[#616873] italic'
                        : isChoice
                        ? 'ml-6 border border-[#b7a57c] bg-[#fffdf7] rounded-[3px_14px_3px_3px]'
                        : 'border-l-2 border-[#c6b998] bg-[#fffdf7]'
                    }`}
                  >
                    {line.speaker && (
                      <strong className="block text-xs font-semibold text-[#7e5e30] mb-1.5 font-sans">
                        {line.speaker}
                      </strong>
                    )}

                    <p className="font-serif text-base text-[#202631] leading-relaxed">
                      {line.text}
                    </p>

                    {line.condition && (
                      <small className="block mt-2 text-[10px] text-[#898c90]">
                        条件: {line.condition}
                      </small>
                    )}

                    <button
                      type="button"
                      onClick={() => onSaveUtteranceToNotebook(line.id)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity mt-2 text-[11px] text-[#8a6a35] font-semibold flex items-center gap-1 cursor-pointer hover:underline"
                    >
                      <Bookmark className="h-3 w-3" />
                      <span>存入创作笔记</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
