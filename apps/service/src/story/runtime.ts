import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { DeepSeekHarness, HarnessClient, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { StoryError, type StoryStore } from './store.js';

const PATCH_MARKER = '__STHSTART_STORY_RESUME_SERVER_PATH__';

export class StoryRuntime {
  private readonly runningProjects = new Set<string>();
  private readonly activeClients = new Set<DeepSeekHarness | HarnessClient>();
  private readonly mcpTokens = new Map<string, string>();
  constructor(private readonly config: ServiceConfig, private readonly db: ServiceDatabase,
    private readonly store: StoryStore, private readonly appToken: string) {}

  private model(): string {
    const binding = this.db.connection.prepare(`
      SELECT coalesce(m.model_id, p.model) as model FROM purpose_bindings pb
      LEFT JOIN model_profiles m ON m.id = pb.target_id AND m.enabled = 1
      LEFT JOIN provider_profiles p ON p.id = pb.target_id AND p.enabled = 1
      WHERE pb.app_id = 'story' AND pb.purpose_key IN ('story', 'writing') AND pb.target_type = 'model' AND pb.inherit_app_default = 0
      LIMIT 1
    `).get() as { model: string | null } | undefined;
    if (binding?.model) return binding.model;

    const row = this.db.connection.prepare(`SELECT coalesce(m.model_id, p.model) as model FROM app_llm_assignments a
      LEFT JOIN model_profiles m ON m.id=a.profile_id AND m.enabled=1
      LEFT JOIN provider_profiles p ON p.id=a.profile_id AND p.kind='llm' AND p.enabled=1
      WHERE a.app_id='story' AND a.role='text'`).get() as { model: string | null } | undefined;
    if (!row?.model) throw new StoryError('story_model_unconfigured', 503, '请先为剧情工作室绑定公共文本模型。');
    return row.model;
  }

  private sourcePath(name: string): string {
    const beside = resolve(import.meta.dirname, name);
    if (existsSync(beside)) return beside;
    const source = resolve(import.meta.dirname, '../../src/story', name);
    if (existsSync(source)) return source;
    throw new StoryError('story_runtime_files_missing', 503, `剧情运行文件缺失：${name}`);
  }

  private async options(projectId: string, runtimeSessionId: string) {
    const project = this.store.requireProject(projectId);
    const model = this.model();
    const dataRoot = dirname(this.config.databasePath);
    const dshHome = resolve(dataRoot, 'dsh', 'story', projectId);
    const workspace = resolve(dataRoot, 'story-workspaces', projectId);
    await mkdir(dshHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const source = await readFile(this.sourcePath('profile.cordis.patch.yml'), 'utf8');
    if (!source.includes(PATCH_MARKER)) throw new StoryError('story_runtime_patch_invalid', 503, '剧情运行配置缺少桥接路径占位符。');
    const patchPath = resolve(dshHome, 'managed-profile.patch.yml');
    await writeFile(patchPath, source.replace(PATCH_MARKER, this.sourcePath('dsh-resume-server.mjs').replaceAll('\\', '/')));
    const mcpToken = this.mcpTokens.get(projectId) ?? `${randomUUID()}${randomUUID()}`;
    this.mcpTokens.set(projectId, mcpToken);
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      STHSTART_STORY_APP_TOKEN: this.appToken,
      STHSTART_STORY_MCP_TOKEN: mcpToken,
      STHSTART_STORY_PROJECT_ID: projectId,
      STHSTART_STORY_RUNTIME_SESSION_ID: runtimeSessionId,
      STHSTART_STORY_MCP_SOURCE_PATH: this.sourcePath('mcp-server.ts'),
      STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'),
      STHSTART_STORY_SKILLS_DIR: this.sourcePath('skills'),
      STHSTART_STORY_INTERNAL_URL: `http://127.0.0.1:${this.config.port}`,
      STHSTART_STORY_LLM_BASE_URL: `http://127.0.0.1:${this.config.port}/v1`,
      STHSTART_STORY_MODEL_ID: model,
      STHSTART_STORY_CONTEXT_WINDOW: String(project.contextSettings.contextWindow),
      STHSTART_STORY_OUTPUT_TOKENS: String(project.contextSettings.outputTokens),
      STHSTART_STORY_COMPACT_THRESHOLD: String(project.contextSettings.compactThreshold),
      STHSTART_STORY_RETAIN_TOKENS: String(project.contextSettings.retainTokens),
      DSH_TELEMETRY_MODE: 'OFF',
    };
    return { profile: 'sdk-minimal', patches: [patchPath], dshHome, processCwd: workspace, cwd: workspace,
      provider: 'sthstart', model, maxTokens: project.contextSettings.outputTokens,
      initializeTimeoutMs: 45_000, env };
  }

  authorizeMcp(projectId: string, token: string): boolean {
    const expected = this.mcpTokens.get(projectId);
    if (!expected || expected.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  private async exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.runningProjects.has(projectId)) throw new StoryError('story_runtime_busy', 409, '该项目的 AI 正在处理另一项请求。');
    this.runningProjects.add(projectId);
    try { return await operation(); } finally { this.runningProjects.delete(projectId); }
  }

  async run(projectId: string, runtimeSessionId: string, input: string,
    onNotification?: (notification: HarnessNotification) => void): Promise<string> {
    return this.exclusive(projectId, async () => {
      const harness = new DeepSeekHarness(await this.options(projectId, runtimeSessionId));
      this.activeClients.add(harness);
      try {
        const result = await harness.run(input, { sessionId: runtimeSessionId, onNotification });
        if (!result.finalResponse.trim()) throw new StoryError('story_empty_response', 502, '模型没有返回可保存的回复。');
        return result.finalResponse;
      } finally { this.activeClients.delete(harness); await harness.close(); }
    });
  }

  async compact(projectId: string, runtimeSessionId: string): Promise<{ compacted: boolean; replacedItems: number; estimatedSourceTokens: number }> {
    return this.exclusive(projectId, async () => {
      const options = await this.options(projectId, runtimeSessionId);
      const client = new HarnessClient(options);
      this.activeClients.add(client);
      try {
        await client.start();
        await client.initialize({ cwd: options.cwd, provider: options.provider, model: options.model, maxTokens: options.maxTokens });
        return await client.request('session/compact', { sessionId: runtimeSessionId }, 125_000) as
          { compacted: boolean; replacedItems: number; estimatedSourceTokens: number };
      } finally { this.activeClients.delete(client); await client.close(); }
    });
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.activeClients].map((client) => client.close()));
  }
}
