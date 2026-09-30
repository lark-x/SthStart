import type { StoryScriptLine, StoryScriptProject } from '@sthstart/contracts';

export class StoryCompiler {
  /**
   * 将纯文字小说正文编译为标准化剧本工程结构
   */
  static compileToScript(
    novelBody: string,
    options: { chapterTitle?: string; projectTitle?: string } = {},
  ): StoryScriptProject {
    const lines: StoryScriptLine[] = [];
    const characters = new Set<string>();

    const paragraphs = novelBody.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);

    // 常见对白正则模式：
    // 1. 角色名：“对白” / 角色名: “对白” / 角色名：「对白」
    // 2. “对白，”角色名说道。
    // 3. 独立括号情绪，如 [微笑] / （叹气）
    const explicitSpeakerRegex = /^([^\s:：]{1,16})[：:]\s*[“「"']?([^”」"']+)["'”」]?$/;
    const dialogueWithQuoteRegex = /[“「]([^”」]+)[”」]/;
    const emotionRegex = /[（(\[][^）)\]]+[）)\]]/;

    for (const paragraph of paragraphs) {
      if (paragraph.startsWith('#') || paragraph.startsWith('【') || paragraph.startsWith('[')) {
        lines.push({
          type: 'scene_header',
          content: paragraph
            .replace(/^#+\s*/, '')
            .replace(/^[【[]|[】\]]$/g, '')
            .replace(/^(?:场景|Scene)[：:]\s*/i, '')
            .trim(),
        });
        continue;
      }

      const explicitMatch = paragraph.match(explicitSpeakerRegex);
      if (explicitMatch) {
        let speaker = explicitMatch[1]!.trim();
        let emotion: string | undefined;
        const speakerEmotionMatch = speaker.match(/^([^\s（(\[]+)[（(\[]([^）)\]]+)[）)\]]$/);
        if (speakerEmotionMatch) {
          speaker = speakerEmotionMatch[1]!.trim();
          emotion = speakerEmotionMatch[2]!.trim();
        }
        const rawContent = explicitMatch[2]!.trim();
        characters.add(speaker);
        lines.push({
          type: 'dialogue',
          speaker,
          content: rawContent,
          ...(emotion ? { emotion } : {}),
        });
        continue;
      }

      const quoteMatch = paragraph.match(dialogueWithQuoteRegex);
      if (quoteMatch) {
        let matchedSpeaker: string | undefined;
        let matchedEmotion: string | undefined;

        // 尝试从引号前的词缀提取说话人，例如 "荧（轻笑）说："
        const prefixMatch = paragraph.match(/^([^\s:：]{1,16}?)(?:[（(\[](.*)[）)\]])?(?:说|道|问|答|沉吟|笑道|叹道)?[：:]?\s*[“「]/);
        if (prefixMatch && prefixMatch[1]?.trim()) {
          matchedSpeaker = prefixMatch[1].trim();
          matchedEmotion = prefixMatch[2]?.trim();
        }

        if (matchedSpeaker) {
          characters.add(matchedSpeaker);
        }

        const emotionMatch = paragraph.match(emotionRegex);
        const emotion = matchedEmotion || (emotionMatch ? emotionMatch[0].replace(/[（(\[）)\]]/g, '') : undefined);

        lines.push({
          type: 'dialogue',
          speaker: matchedSpeaker,
          content: quoteMatch[1]!.trim(),
          ...(emotion ? { emotion } : {}),
        });

        // 如果引语外还有其他长段叙述，作为旁白补充
        const nonDialogue = paragraph.replace(dialogueWithQuoteRegex, '').replace(/^[^“「]+[：:]/, '').trim();
        if (nonDialogue.length > 15) {
          lines.push({
            type: 'narration',
            content: nonDialogue,
          });
        }
        continue;
      }

      // 普通段落视为环境/动作旁白
      lines.push({
        type: 'narration',
        content: paragraph,
      });
    }

    return {
      title: options.projectTitle || '未命名故事',
      chapterTitle: options.chapterTitle || '未命名章节',
      characters: Array.from(characters),
      lines,
    };
  }
}
