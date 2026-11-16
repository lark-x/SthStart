import type { ServiceConfig } from '../../config.js';
import { AkashaMcpConnector, type AkashaWorld } from '../../narrative-connectors.js';
import type { UpstreamCharacterBundle, WorkTarget } from './types.js';

const TARGET_TO_AKASHA: Partial<Record<WorkTarget, AkashaWorld>> = {
  genshin: 'gi',
  starrail: 'hsr',
  bh3: 'bh3',
};

/**
 * 若环境已配置 Akasha / 虚空终端 Story MCP，自动检索角色在剧情任务中的原生对白切片，
 * 作为提升 AI 故事推演沉浸感与语流还原度的高价值证据。
 */
export async function fetchAkashaDialogueSlices(
  name: string,
  target: WorkTarget,
  config: ServiceConfig | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const world = TARGET_TO_AKASHA[target];
  if (!world || !config?.akashaMcpUrl || !name.trim()) return null;

  try {
    const connector = new AkashaMcpConnector(
      config.akashaMcpUrl,
      Math.min(config.mcpTimeoutMs || 20_000, 15_000),
      fetcher,
      config.akashaMcpKey ?? null,
    );
    const hits = await connector.search(world, name.trim(), 5);
    if (!hits.length) return null;

    const dialogueSamples: string[] = [];
    const excerptParts: string[] = [];
    for (const hit of hits.slice(0, 3)) {
      const snippets = (hit.hits || [])
        .map((h) => h.snippet.trim())
        .filter(Boolean)
        .slice(0, 3);
      for (const s of snippets) {
        dialogueSamples.push(s.slice(0, 320));
      }
      if (snippets.length) {
        excerptParts.push(`【${hit.fileName}】\n${snippets.join('\n')}`);
      }
    }

    if (!dialogueSamples.length) return null;

    return {
      dialogueSamples,
      sources: [
        {
          title: `虚空终端剧情对白：${name.trim()}`,
          url: null,
          excerpt: excerptParts.join('\n\n').slice(0, 6_000),
          sourceType: 'akasha-mcp',
        },
      ],
    };
  } catch {
    return null;
  }
}
