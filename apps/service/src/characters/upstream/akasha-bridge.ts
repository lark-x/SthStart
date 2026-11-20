import type { ServiceConfig } from '../../config.js';
import { AkashaMcpConnector, type AkashaWorld, type AkashaDocument } from '../../narrative-connectors.js';
import { evidenceSource, type UpstreamCharacterBundle, type WorkTarget } from './types.js';

/** This connector speaks Story MCP's akasha_search/akasha_read protocol, not the GI-only searchAkasha API. */
export const AKASHA_CHARACTER_CAPABILITIES: Readonly<Partial<Record<WorkTarget, { world: AkashaWorld; protocol: string }>>> = {
  genshin: { world: 'gi', protocol: 'story-mcp:akasha_search+akasha_read' },
  starrail: { world: 'hsr', protocol: 'story-mcp:akasha_search+akasha_read' },
  bh3: { world: 'bh3', protocol: 'story-mcp:akasha_search+akasha_read' },
};

export async function fetchAkashaDialogueSlices(name: string, target: WorkTarget, config: ServiceConfig | undefined,
  fetcher: typeof fetch = fetch): Promise<Partial<UpstreamCharacterBundle> | null> {
  if (!name.trim()) return null;
  const capability = AKASHA_CHARACTER_CAPABILITIES[target];
  if (!capability) return { warnings: [`虚空终端 Story MCP 尚未声明支持作品 ${target}，已跳过。`] };
  if (!config?.akashaMcpUrl) return { warnings: ['虚空终端 Story MCP 未配置，未获取正文。'] };
  const warnings: string[] = [];
  try {
    const connector = new AkashaMcpConnector(config.akashaMcpUrl, Math.min(config.mcpTimeoutMs || 20_000, 15_000), fetcher, config.akashaMcpKey ?? null);
    const hits = await connector.search(capability.world, name.trim(), 5);
    if (!hits.length) return { warnings: [`虚空终端 ${capability.world} 未检索到 ${name} 的资料。`] };
    if (hits.length > 3) warnings.push(`虚空终端本次仅读取前 3 个相关来源，另 ${hits.length - 3} 个检索结果未读，不能视为完整语料。`);
    const sources: UpstreamCharacterBundle['sources'] = [];
    const stories: UpstreamCharacterBundle['stories'] = [];
    const dialogueSamples: string[] = [];
    for (const hit of hits.slice(0, 3)) {
      const parts: AkashaDocument[] = []; let offset = 1; let complete = false;
      try {
        // Retain all retrieved pages. An explicit warning distinguishes partial evidence from a full document.
        for (let page = 0; page < 100; page += 1) {
          const doc = await connector.read(capability.world, hit.pathHash, offset, 500); parts.push(doc);
          const end = Number(doc.lineRange.match(/(\d+)\s*[-–]\s*(\d+)/)?.[2] || doc.totalLines);
          if (!doc.remainingCharacters || end >= doc.totalLines) { complete = true; break; }
          if (!Number.isFinite(end) || end < offset) throw new Error('read pagination made no progress');
          offset = end + 1;
        }
      } catch (error) { warnings.push(`虚空终端 ${hit.fileName} 正文读取失败: ${error instanceof Error ? error.message : String(error)}`); }
      if (!parts.length) {
        const snippets = hit.hits.map((h) => `[L${h.line}] ${h.snippet}`).join('\n');
        sources.push(evidenceSource({ title: `${hit.fileName}（仅搜索摘要，正文失败）`, url: null, sourceType: 'akasha-mcp',
          externalId: `${capability.world}:${hit.pathHash}`, rawText: snippets, rawPayload: { world: capability.world, search: hit }, evidenceKind: 'snippet' }));
        continue;
      }
      const content = parts.map((p) => p.content).join('\n');
      if (!complete) warnings.push(`虚空终端 ${hit.fileName} 仅获取部分正文，尚有未读取内容。`);
      const pointer = `akasha:${capability.world}:${hit.pathHash}`;
      sources.push(evidenceSource({ title: hit.fileName, url: null, sourceType: 'akasha-mcp', externalId: `${capability.world}:${hit.pathHash}`,
        rawText: content, rawPayload: { world: capability.world, search: hit, pages: parts, complete }, evidenceKind: complete ? 'fulltext' : 'snippet' }));
      stories.push({ title: `${hit.fileName}${complete ? '' : '（部分正文）'}`, content, source: pointer });
      // Only the named speaker's actual lines become examples; narrator/other characters remain in story context.
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:\[?\d+\]?[.：:\s-]+)?([^：:]{1,40})[：:]\s*(.+)$/);
        if (match?.[1].trim() === name.trim()) dialogueSamples.push(line.trim());
      }
    }
    return { sources, stories, dialogueSamples, warnings };
  } catch (error) { return { warnings: [`虚空终端 ${capability.world} 检索失败: ${error instanceof Error ? error.message : String(error)}`] }; }
}
