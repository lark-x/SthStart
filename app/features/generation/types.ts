import type {
  GenerationConnectionTestResult,
  GenerationEditorConfig,
  GenerationModelEntry,
  GenerationNodeListResponse,
  GenerationPreset,
  GenerationTestRunDetail,
  GenerationTestRunSummary,
  WorkflowAnalyzeResponse,
} from '@sthstart/contracts';

export type Engine = { id: string; name: string; kind: 'comfyui' | 'worker' | 'cloud'; base_url: string; enabled: number | boolean; concurrency_limit: number; lastTest?: GenerationConnectionTestResult | null };
export type Worker = { engineId: string; name: string; baseUrl: string; enabled: boolean; model: string; temperature: number; concurrencyLimit: 1; ipAllowlist: string[]; diskWarningBytes: number; diskStopBytes: number; capabilities?: string[]; state: 'online' | 'offline' | 'unknown'; lastSeenAt: string | null };
export type MediaTool = { available: boolean; version: string | null; error: 'not_found' | 'unavailable' | null };
export type MediaDiagnostics = { checkedAt: string; video: { ffmpeg: MediaTool; ffprobe: MediaTool; preprocessingReady: boolean; installHint: string | null }; h3: { id?: string; enabled: boolean; available: boolean; ready: boolean; reason: string; constraints: { maxWidth: number; maxHeight: number; maxDurationSeconds: number; concurrencyLimit: number } } };
export type WorkflowVersion = {
  version: number;
  engineId: string | null;
  category?: 'image' | 'video' | 'audio' | 'transform';
  inputSchema: Record<string, unknown>;
  inputCapabilities?: Record<string, unknown>;
  nodeBindings: Record<string, string[]>;
  outputDeclarations: string[];
  outputMediaTypes?: string[];
  outputSchema?: Record<string, unknown>;
  configFormatVersion?: number;
  editorConfig?: GenerationEditorConfig | null;
  isPublished: boolean;
};
export type Workflow = { id: string; name: string; description: string; category?: 'image' | 'video' | 'audio' | 'transform'; engine_kind: Engine['kind']; latest_version: number; archivedAt?: string | null; versions: WorkflowVersion[] };
export type Assignment = { app_id: string; purpose: string; workflow_id: string; workflow_version: number; engine_id: string; default_preset_id?: string | null };

/** 工作流草稿载荷（与后端 GenerationDraftPayload 对应）。 */
export type DraftPayload = {
  formatVersion: 1 | 2;
  name: string | null;
  description: string | null;
  category?: 'image' | 'video' | 'audio' | 'transform';
  engineId: string | null;
  definition: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  inputCapabilities: Record<string, unknown>;
  nodeBindings: Record<string, string[]>;
  outputDeclarations: string[];
  outputMediaTypes?: string[];
  outputSchema: Record<string, unknown>;
  editorConfig: GenerationEditorConfig | null;
};

export type WorkflowDraft = {
  workflowId: string;
  baseVersion: number;
  revision: number;
  draft: DraftPayload;
  updatedAt: string;
};

export type { GenerationConnectionTestResult, GenerationModelEntry, GenerationNodeListResponse, GenerationPreset, GenerationTestRunDetail, GenerationTestRunSummary, WorkflowAnalyzeResponse };

/** 分析响应中的候选输入（含建议的显示标签）。 */
export type AnalyzedInput = WorkflowAnalyzeResponse['inputs'][number];

/** 连接发现返回的模型条目。 */
export type ModelEntry = GenerationModelEntry;

/** 创作中心选项投影。 */
export type CreativePurposeOptions = {
  purpose: string;
  ready: boolean;
  status: string;
  workflow: { id: string; name: string; version: number; category?: string } | null;
  engine: { id: string; name: string; kind: string; enabled: boolean } | null;
  defaultPresetId: string | null;
  presets: Array<{
    id: string;
    name: string;
    description: string;
    revision: number;
    isDefault: boolean;
    workflowId: string;
    workflowName: string;
    workflowVersion: number;
    modelSummary: string | null;
    values: Record<string, unknown>;
  }>;
  fields: FieldContract[];
  modelChoices: ModelEntry[] | null;
  modelChoicesStale?: boolean;
};

export type FieldContract = {
  key: string;
  label: string;
  description: string | null;
  type: 'text' | 'long-text' | 'integer' | 'number' | 'boolean' | 'enum' | 'model' | 'seed';
  section: 'basic' | 'advanced';
  order: number;
  defaultValue: unknown;
  minimum?: number;
  maximum?: number;
  step?: number;
  enumValues?: string[];
  required: boolean;
  modelCategory?: string;
};

export function versionKey(workflowId: string, version: number) {
  return `${workflowId}::${version}`;
}
