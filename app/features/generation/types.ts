export type Engine = { id: string; name: string; kind: 'comfyui' | 'worker' | 'cloud'; base_url: string; enabled: number | boolean; concurrency_limit: number };
export type Worker = { engineId: string; name: string; baseUrl: string; enabled: boolean; model: string; temperature: number; concurrencyLimit: 1; ipAllowlist: string[]; diskWarningBytes: number; diskStopBytes: number; capabilities?: string[]; state: 'online' | 'offline' | 'unknown'; lastSeenAt: string | null };
export type MediaTool = { available: boolean; version: string | null; error: 'not_found' | 'unavailable' | null };
export type MediaDiagnostics = { checkedAt: string; video: { ffmpeg: MediaTool; ffprobe: MediaTool; preprocessingReady: boolean; installHint: string | null }; h3: { id?: string; enabled: boolean; available: boolean; ready: boolean; reason: string; constraints: { maxWidth: number; maxHeight: number; maxDurationSeconds: number; concurrencyLimit: number } } };
export type WorkflowVersion = { version: number; engineId: string | null; category?: 'image' | 'video' | 'audio' | 'transform'; inputSchema: Record<string, unknown>; inputCapabilities?: Record<string, unknown>; nodeBindings: Record<string, string[]>; outputDeclarations: string[]; outputMediaTypes?: string[]; outputSchema?: Record<string, unknown>; isPublished: boolean };
export type Workflow = { id: string; name: string; description: string; category?: 'image' | 'video' | 'audio' | 'transform'; engine_kind: Engine['kind']; latest_version: number; versions: WorkflowVersion[] };
export type Assignment = { app_id: string; purpose: string; workflow_id: string; workflow_version: number; engine_id: string };

export function versionKey(workflowId: string, version: number) {
  return `${workflowId}::${version}`;
}
