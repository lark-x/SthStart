import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import type { ServiceConfig } from '../config.js';
import type { StoryStore } from './store.js';

export class DshProcessManager {
  private currentProcess: ChildProcess | null = null;
  private currentProjectId: string | null = null;
  private currentPort = 3081;
  private currentUrl: string | null = null;

  constructor(
    private readonly config: ServiceConfig,
    private readonly store: StoryStore,
  ) {}

  private repoRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  }

  status(projectId: string): { running: boolean; port: number | null; url: string | null; projectId: string } {
    const isCurrent = this.currentProjectId === projectId;
    const running = Boolean(isCurrent && this.currentProcess && !this.currentProcess.killed && this.currentProcess.exitCode === null);
    return {
      running,
      port: running ? this.currentPort : null,
      url: running ? (this.currentUrl || `http://127.0.0.1:${this.currentPort}`) : null,
      projectId,
    };
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((res) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(600);
      socket.once('connect', () => { socket.destroy(); res(false); });
      socket.once('timeout', () => { socket.destroy(); res(false); });
      socket.once('error', (err: NodeJS.ErrnoException) => {
        socket.destroy();
        if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') res(true);
        else res(false);
      });
    });
  }

  private generatePatch(patchPath: string, env: NodeJS.ProcessEnv): void {
    const generator = resolve(this.repoRoot(), 'scripts/story-dsh/generate-web-patch.mjs');
    const result = spawnSync(process.execPath, [generator, patchPath], {
      cwd: this.repoRoot(),
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`DSH patch 生成失败: ${result.stderr || result.stdout || `exit code ${result.status}`}`);
    }
  }

  async start(projectId: string, options: { portalOrigin?: string } = {}): Promise<{ ok: boolean; url: string; port: number; projectId: string }> {
    this.store.requireProject(projectId);

    // If already running for this project, return current status
    const current = this.status(projectId);
    if (current.running && current.url) {
      return { ok: true, url: current.url, port: this.currentPort, projectId };
    }

    // Stop process for another project if active
    if (this.currentProcess) {
      await this.stop();
    }

    const port = this.currentPort;
    const available = await this.isPortAvailable(port);
    if (!available) {
      // An occupied port is not proof of a DSH instance or of its project identity.
      // Only the child process owned by this manager may be reused.
      throw new Error(`本机端口 ${port} 已被占用，请先退出占用进程。`);
    }

    // Prepare directories
    const dataRoot = dirname(this.config.databasePath);
    const dshHome = resolve(dataRoot, 'dsh', 'story', projectId);
    const workspace = resolve(dataRoot, 'story-workspaces', projectId);
    await mkdir(dshHome, { recursive: true });
    await mkdir(workspace, { recursive: true });

    // Generate grant token and patch
    const grant = this.store.createBridgeGrant(projectId);
    const patchPath = resolve(dshHome, 'managed-web.patch.yml');
    const portalPort = process.env.PORTAL_PORT || '4173';
    const portalOrigin = options.portalOrigin || `http://127.0.0.1:${portalPort}`;

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: dshHome,
      STHSTART_STORY_BRIDGE_TOKEN: grant.token,
      STHSTART_STORY_PROJECT_ID: projectId,
      STHSTART_STORY_PORTAL_URL: portalOrigin,
      STHSTART_STORY_WORKSPACE: workspace,
      STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'),
      STHSTART_STORY_MCP_SOURCE_PATH: resolve(this.repoRoot(), 'apps/service/src/story/native-mcp-server.ts'),
    };

    this.generatePatch(patchPath, childEnv);

    const require = createRequire(import.meta.url);
    const dshPackage = require.resolve('@deepseek-ai/dsh/package.json');
    const dshBin = resolve(dirname(dshPackage), 'lib/bin.js');

    const child = spawn(
      process.execPath,
      [
        dshBin,
        '--profile', 'web',
        '--patch', patchPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--no-open',
        '--trusted-host', `127.0.0.1:${portalPort}`,
        '--trusted-host', `localhost:${portalPort}`,
      ],
      {
        cwd: workspace,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    this.currentProcess = child;
    this.currentProjectId = projectId;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      const match = text.match(/(http:\/\/127\.0\.0\.1:\d+\/[^\s\)\n]*\?token=[^\s\)\n]+)/i);
      if (match) {
        this.currentUrl = match[1];
      }
    });

    child.on('exit', () => {
      if (this.currentProcess === child) {
        this.currentProcess = null;
        this.currentProjectId = null;
        this.currentUrl = null;
      }
    });

    // Poll until ready
    const maxRetries = 40;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (child.exitCode !== null) {
        throw new Error(`DSH 进程启动失败（退出码 ${child.exitCode}）。`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
        if (res.ok || res.status === 302 || res.status === 200) {
          return { ok: true, url: this.currentUrl || `http://127.0.0.1:${port}`, port, projectId };
        }
      } catch {
        // Keep waiting
      }
    }

    return { ok: true, url: this.currentUrl || `http://127.0.0.1:${port}`, port, projectId };
  }

  async stop(projectId?: string): Promise<{ ok: boolean }> {
    if (projectId && this.currentProjectId !== projectId) {
      return { ok: true };
    }
    this.currentUrl = null;
    if (this.currentProcess) {
      const proc = this.currentProcess;
      this.currentProcess = null;
      this.currentProjectId = null;
      try {
        proc.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 600));
        if (proc.exitCode === null) proc.kill('SIGKILL');
      } catch {
        // Ignore kill errors
      }
    }
    return { ok: true };
  }
}
