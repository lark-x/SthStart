import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { McpDiscoveredTool } from './client.js';

const validator = new AjvJsonSchemaValidator();
export function validateToolArguments(tool: McpDiscoveredTool, args: Record<string, unknown>) {
  const result = validator.getValidator(tool.inputSchema || { type: 'object' })(args);
  if (!result.valid) throw new Error(`工具 ${tool.name} 参数不符合要求：${result.errorMessage}`);
}
export function researchWorld(work: string) {
  const value = work.toLowerCase().trim();
  if (['gi', '原神', 'genshin impact'].includes(value)) return 'gi';
  if (['hsr', '星铁', '崩坏：星穹铁道', '崩坏星穹铁道', 'honkai: star rail'].includes(value)) return 'hsr';
  if (['bh3', '崩坏3', '崩坏三', 'honkai impact 3rd'].includes(value)) return 'bh3';
  return value;
}
/** Prefer exact discovered property names; use the model only for unfamiliar schemas. */
export async function researchToolArguments(tool: McpDiscoveredTool, keyword: string, world: string, document: Record<string, unknown> | undefined, generate: (prompt: string) => Promise<unknown>) {
  const properties = (tool.inputSchema?.properties || {}) as Record<string, Record<string, unknown>>;
  const args: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(properties)) {
    if (document && document[key] !== undefined) args[key] = document[key];
    else if (document && ['id', 'documentId', 'articleId', 'pathHash'].includes(key)) {
      const id = document.id ?? document.documentId ?? document.articleId ?? document.pathHash;
      if (id !== undefined) args[key] = id;
    } else if (['query', 'keyword', 'q', 'search', 'searchTerm'].includes(key)) args[key] = keyword;
    else if (key === 'world') args[key] = researchWorld(world);
    else if (['maxResults', 'limit', 'count'].includes(key)) args[key] = 5;
    else if (key === 'offset') args[key] = 1;
    else if (spec.default !== undefined) args[key] = spec.default;
  }
  try { validateToolArguments(tool, args); if (Object.keys(args).length || !Object.keys(properties).length) return args; } catch { /* complete unfamiliar required fields below */ }
  const generated = await generate(`为资料检索工具生成参数，只输出符合 inputSchema 的 JSON 对象。不得编造文档 ID 或 URL；读取只能使用已返回条目。\n工具：${JSON.stringify(tool)}\n关键词：${keyword}\n作品：${world}\n已返回条目：${JSON.stringify(document || null)}`);
  if (!generated || typeof generated !== 'object' || Array.isArray(generated)) throw new Error('工具参数必须是对象');
  validateToolArguments(tool, generated as Record<string, unknown>);
  return generated as Record<string, unknown>;
}
export function researchDocuments(structured: Record<string, unknown> | undefined, text: string): Record<string, unknown>[] {
  let data: unknown = structured;
  if (!data) { try { data = JSON.parse(text); } catch { return []; } }
  const object = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const items = Array.isArray(data) ? data : object.results ?? object.items ?? object.documents;
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && ['id', 'documentId', 'articleId', 'pathHash', 'url'].some(key => typeof item[key] === 'string')).slice(0, 2) : [];
}
