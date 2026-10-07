import type { PublicationDocument } from '@sthstart/contracts';

export interface PublicationAudio { artifactId: string; durationMs: number }
export interface PublicationSubtitle { shotId: string; utteranceId: string; speaker: string; text: string; startMs: number; endMs: number; artifactId: string }
export interface PublicationTimeline { durationMs: number; shots: Array<{ id: string; startMs: number; endMs: number }>; subtitles: PublicationSubtitle[] }
export function publicationGraphemes(text: string): string[] {
  return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map(v => v.segment);
}
export function splitPublicationSubtitle(text: string, max = 24): string[] {
  const result: string[] = [];
  let current = '';
  for (const g of publicationGraphemes(text)) {
    current += g;
    if (publicationGraphemes(current).length >= max || /[。！？!?\n]/u.test(g)) { if (current.trim()) result.push(current.trim()); current = ''; }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
/** Actual probed durations, not estimates from text length. No audio or browser access here. */
export function compilePublicationTimeline(doc: PublicationDocument, audio: Record<string, PublicationAudio>): PublicationTimeline {
  const result: PublicationTimeline = { durationMs: 0, shots: [], subtitles: [] };
  for (const shot of doc.shots) {
    const startMs = result.durationMs;
    if (!shot.utterances.length) result.durationMs += 3000;
    for (const u of shot.utterances) {
      const asset = audio[u.id];
      if (!asset || !Number.isFinite(asset.durationMs) || asset.durationMs <= 0) throw new Error(`对白 ${u.id} 缺少可读取且有实际时长的配音。`);
      const parts = splitPublicationSubtitle(u.text), weights = parts.map(t => publicationGraphemes(t).length), total = weights.reduce((a, b) => a + b, 0);
      let position = result.durationMs;
      parts.forEach((text, i) => {
        const endMs = i === parts.length - 1 ? result.durationMs + asset.durationMs : position + asset.durationMs * weights[i] / total;
        result.subtitles.push({ shotId: shot.id, utteranceId: u.id, speaker: doc.actors.find(a => a.id === u.speakerActorId)?.name ?? '旁白',
          text, startMs: Math.round(position), endMs: Math.round(endMs), artifactId: asset.artifactId });
        position = endMs;
      });
      result.durationMs += asset.durationMs + 250;
    }
    result.durationMs += 400;
    result.shots.push({ id: shot.id, startMs, endMs: result.durationMs });
  }
  if (result.durationMs > 300000) throw new Error('视频超过首版 5 分钟限制，请拆分作品；未截断任何配音。');
  return result;
}
export function getPublicationFrameState(timeline: PublicationTimeline, timeMs: number) {
  const t = Math.max(0, Math.min(timeMs, timeline.durationMs - 1));
  const shot = timeline.shots.find(s => t >= s.startMs && t < s.endMs) ?? null;
  const subtitle = timeline.subtitles.find(s => t >= s.startMs && t < s.endMs) ?? null;
  return { shotId: shot?.id ?? null, subtitle, progress: shot ? (t - shot.startMs) / (shot.endMs - shot.startMs) : 0 };
}
export function publicationSrt(timeline: PublicationTimeline): string {
  const format = (ms: number) => {
    const rounded = Math.round(ms);
    return `${String(Math.floor(rounded / 3600000)).padStart(2,'0')}:${String(Math.floor(rounded / 60000) % 60).padStart(2,'0')}:${String(Math.floor(rounded / 1000) % 60).padStart(2,'0')},${String(rounded % 1000).padStart(3,'0')}`;
  };
  return timeline.subtitles.map((s,i) => `${i+1}\n${format(s.startMs)} --> ${format(s.endMs)}\n${s.speaker}：${s.text}\n`).join('\n');
}
