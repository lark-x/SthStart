import type { ServiceDatabase } from '../database.js';
import { importWorkflow, publishWorkflowVersion } from '../generation/workflow-publish.js';
import { buildMossImageWorkflow, MOSS_WORKFLOW_ID } from './moss-workflow.js';
import { parityContentHash } from './parity-workflows.js';

/**
 * MOSS 工作流注册：按内容哈希幂等。
 *
 * 与邻舍对齐工作流一致，只新增版本、不改写旧行；不创建预设、不改用途绑定，
 * 故事配图在运行配置里显式选择 moss-image-story 才会使用。
 */

export interface MossRegistrationResult {
  workflowId: string;
  workflowVersion: number;
  published: boolean;
  contentHash: string;
}

type MossVersionRow = {
  version: number;
  definition_json: string;
  input_schema_json: string;
  node_bindings_json: string;
  output_declarations_json: string;
  output_media_types_json: string;
  input_capabilities_json: string;
  editor_config_json: string | null;
};

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function registerMossImageWorkflow(database: ServiceDatabase, engineId: string): MossRegistrationResult {
  const bundle = buildMossImageWorkflow();
  const existing = database.connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?')
    .get(MOSS_WORKFLOW_ID) as { id: string; latest_version: number } | undefined;

  if (existing) {
    const rows = database.connection.prepare('SELECT version,definition_json,input_schema_json,node_bindings_json, '
      + 'output_declarations_json,output_media_types_json,input_capabilities_json,editor_config_json '
      + 'FROM generation_workflow_versions WHERE workflow_id=? ORDER BY version ASC').all(MOSS_WORKFLOW_ID) as MossVersionRow[];
    const match = rows.find((row) => parityContentHash({
      definition: parseJson(row.definition_json, {}),
      inputSchema: parseJson(row.input_schema_json, {}),
      nodeBindings: parseJson(row.node_bindings_json, {}),
      editorConfig: parseJson(row.editor_config_json, null),
      outputDeclarations: parseJson(row.output_declarations_json, []),
      outputMediaTypes: parseJson(row.output_media_types_json, []),
      inputCapabilities: parseJson(row.input_capabilities_json, {}),
    }) === bundle.contentHash);
    if (match) return { workflowId: MOSS_WORKFLOW_ID, workflowVersion: match.version, published: false, contentHash: bundle.contentHash };

    const published = publishWorkflowVersion(database, {
      workflowId: MOSS_WORKFLOW_ID, engineId,
      definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
      outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
      inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
    });
    return { workflowId: MOSS_WORKFLOW_ID, workflowVersion: published.version, published: true, contentHash: bundle.contentHash };
  }

  const imported = importWorkflow(database, {
    id: MOSS_WORKFLOW_ID, name: bundle.name, description: bundle.description,
    engineKind: bundle.engineKind, category: bundle.category, engineId,
    definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
    outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
    inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
  });
  return { workflowId: MOSS_WORKFLOW_ID, workflowVersion: imported.version, published: true, contentHash: bundle.contentHash };
}
