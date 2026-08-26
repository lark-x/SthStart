import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import type {
  LogEvent,
  LogLevel,
  LogPolicy,
  RuntimeOverview,
  RuntimeService,
  RuntimeServiceState,
  RuntimeSettings,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = { off: -1, error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const execFileAsync = promisify(execFile);

const DEFAULT_SETTINGS: RuntimeSettings = {
  autoStart: false,
  autoOpenBrowser: false,
  useMirror: true,
  publicLlmEnabled: true,
  comfyuiExecutable: '',
  extraLoraFolders: [],
  maibotAutostart: false,
  maibotBrowserMaibot: true,
  maibotBrowserSnowluma: true,
  creative: {},
};

const DEFAULT_POLICY: LogPolicy = {
  globalLevel: 'info',
  serviceLevels: {},
  retentionDays: 7,
  maxBytes: 200 * 1024 * 1024,
  sensitiveUntil: null,
  diagnosticUntil: null,
};

function setting<T>(database: ServiceDatabase, key: string, fallback: T): T {
  const row = database.connection.prepare('SELECT value_json FROM runtime_settings WHERE key=?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try { return { ...fallback, ...JSON.parse(row.value_json) } as T; } catch { return fallback; }
}

function saveSetting(database: ServiceDatabase, key: string, value: unknown) {
  database.connection.prepare(`INSERT INTO runtime_settings(key,value_json,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), nowIso());
}

function future(value: string | null) {
  return value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

function redact(input: string) {
  return input
    .replace(/(authorization|api[-_ ]?key|token|secret|password)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]')
    .replace(/\b(?:sk|sth|Bearer)[-_][A-Za-z0-9._-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/([?&](?:key|token|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/g, '[USER_HOME]');
}

function inferLevel(text: string, stream: LogEvent['stream']): Exclude<LogLevel, 'off'> {
  const lower = text.toLowerCase();
  if (stream === 'stderr' || /\[error\]|exception|traceback|fatal|uncaught/.test(lower)) return 'error';
  if (/\[warn\]|warning|\bwarn\b/.test(lower)) return 'warn';
  if (/\[trace\]|\btrace\b/.test(lower)) return 'trace';
  if (/\[debug\]|\bdebug\b/.test(lower)) return 'debug';
  return 'info';
}

export class RuntimeSettingsStore {
  constructor(private readonly database: ServiceDatabase) {}

  get(): RuntimeSettings { return setting(this.database, 'runtime.settings', DEFAULT_SETTINGS); }

  update(patch: Partial<RuntimeSettings>) {
    const current = this.get();
    const next: RuntimeSettings = {
      ...current,
      autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
      autoOpenBrowser: typeof patch.autoOpenBrowser === 'boolean' ? patch.autoOpenBrowser : current.autoOpenBrowser,
      useMirror: typeof patch.useMirror === 'boolean' ? patch.useMirror : current.useMirror,
      publicLlmEnabled: typeof patch.publicLlmEnabled === 'boolean' ? patch.publicLlmEnabled : current.publicLlmEnabled,
      comfyuiExecutable: typeof patch.comfyuiExecutable === 'string' ? patch.comfyuiExecutable.trim() : current.comfyuiExecutable,
      maibotAutostart: typeof patch.maibotAutostart === 'boolean' ? patch.maibotAutostart : current.maibotAutostart,
      maibotBrowserMaibot: typeof patch.maibotBrowserMaibot === 'boolean' ? patch.maibotBrowserMaibot : current.maibotBrowserMaibot,
      maibotBrowserSnowluma: typeof patch.maibotBrowserSnowluma === 'boolean' ? patch.maibotBrowserSnowluma : current.maibotBrowserSnowluma,
      extraLoraFolders: Array.isArray(patch.extraLoraFolders)
        ? patch.extraLoraFolders.map(String).map((item) => item.trim()).filter(Boolean)
        : current.extraLoraFolders,
      creative: patch.creative && typeof patch.creative === 'object' ? patch.creative : current.creative,
    };
    saveSetting(this.database, 'runtime.settings', next);
    return next;
  }
}

export class RuntimeLogService {
  private events: LogEvent[] = [];
  private nextId = 1;
  private dropped = 0;
  private emitter = new EventEmitter();
  private writeChain = Promise.resolve();
  private queuedWrites = 0;
  private readonly maxQueue = 10_000;
  private readonly file: string;

  constructor(private readonly database: ServiceDatabase, private readonly directory: string, private readonly persistence = true) {
    this.file = resolve(directory, 'events.jsonl');
    if (persistence) void this.maintain();
  }

  getPolicy(): LogPolicy {
    const policy = setting(this.database, 'logging.policy', DEFAULT_POLICY);
    if (!future(policy.sensitiveUntil)) policy.sensitiveUntil = null;
    if (!future(policy.diagnosticUntil)) policy.diagnosticUntil = null;
    return policy;
  }

  setPolicy(patch: Partial<LogPolicy>) {
    const current = this.getPolicy();
    const levels = new Set<LogLevel>(['off', 'error', 'warn', 'info', 'debug', 'trace']);
    const serviceLevels = patch.serviceLevels && typeof patch.serviceLevels === 'object'
      ? Object.fromEntries(Object.entries(patch.serviceLevels).filter(([, value]) => value === null || levels.has(value as LogLevel)))
      : current.serviceLevels;
    const retentionDays = Number(patch.retentionDays ?? current.retentionDays);
    const maxBytes = Number(patch.maxBytes ?? current.maxBytes);
    const next: LogPolicy = {
      ...current,
      ...patch,
      globalLevel: levels.has(patch.globalLevel as LogLevel) ? patch.globalLevel as LogLevel : current.globalLevel,
      serviceLevels,
      retentionDays: Number.isFinite(retentionDays) ? Math.max(1, Math.min(90, retentionDays)) : current.retentionDays,
      maxBytes: Number.isFinite(maxBytes) ? Math.max(10 * 1024 * 1024, Math.min(2 * 1024 * 1024 * 1024, maxBytes)) : current.maxBytes,
    };
    saveSetting(this.database, 'logging.policy', next);
    void this.maintain();
    return next;
  }

  effectiveLevel(serviceId: string) {
    const policy = this.getPolicy();
    const configured = policy.serviceLevels[serviceId] ?? policy.globalLevel;
    return future(policy.diagnosticUntil) && LEVEL_WEIGHT[configured] < LEVEL_WEIGHT.debug ? 'debug' : configured;
  }

  append(input: Omit<LogEvent, 'id' | 'timestamp' | 'level' | 'sensitive'> & { level?: Exclude<LogLevel, 'off'>; sensitive?: boolean; force?: boolean }) {
    const level = input.level ?? inferLevel(input.message, input.stream);
    if (!input.force && LEVEL_WEIGHT[level] > LEVEL_WEIGHT[this.effectiveLevel(input.serviceId)]) return null;
    const policy = this.getPolicy();
    const allowSensitive = future(policy.sensitiveUntil);
    const event: LogEvent = {
      id: this.nextId++, timestamp: nowIso(), appId: input.appId, serviceId: input.serviceId, level,
      message: input.sensitive && !allowSensitive ? '[敏感正文已省略]' : redact(input.message).slice(0, 32_000),
      stream: input.stream, sensitive: Boolean(input.sensitive && allowSensitive),
    };
    this.events.push(event);
    if (this.events.length > 2_000) this.events.splice(0, this.events.length - 2_000);
    this.emitter.emit('event', event);
    this.persist(event);
    return event;
  }

  list(filters: { serviceId?: string; level?: LogLevel; query?: string; after?: number; limit?: number } = {}) {
    const query = filters.query?.toLowerCase();
    const result = this.events.filter((event) =>
      (!filters.after || event.id > filters.after) &&
      (!filters.serviceId || event.serviceId === filters.serviceId) &&
      (!filters.level || filters.level === 'off' || LEVEL_WEIGHT[event.level] <= LEVEL_WEIGHT[filters.level]) &&
      (!query || event.message.toLowerCase().includes(query)));
    return result.slice(-Math.max(1, Math.min(2_000, filters.limit ?? 500)));
  }

  subscribe(listener: (event: LogEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  get droppedLogs() { return this.dropped; }
  recentErrorCount() { return this.events.filter((event) => event.level === 'error' && Date.now() - Date.parse(event.timestamp) < 24 * 60 * 60_000).length; }

  diagnosticBundle(overview: RuntimeOverview) {
    const payload = {
      generatedAt: nowIso(),
      platform: { platform: process.platform, arch: process.arch, node: process.version },
      services: overview.services.map(({ id, name, port, installed, state, startedAt, message, managed }) => ({ id, name, port, installed, state, startedAt, message: message ? redact(message) : null, managed })),
      settings: { ...overview.settings, comfyuiExecutable: overview.settings.comfyuiExecutable ? basename(overview.settings.comfyuiExecutable) : '', extraLoraFolders: overview.settings.extraLoraFolders.map((item) => basename(item)) },
      logPolicy: { ...overview.logPolicy, sensitiveUntil: null },
      droppedLogs: overview.droppedLogs,
      logs: this.events.slice(-1_000).map((event) => ({ ...event, message: event.sensitive ? '[敏感正文已省略]' : redact(event.message) })),
    };
    return gzipSync(JSON.stringify(payload, null, 2));
  }

  private persist(event: LogEvent) {
    if (!this.persistence) return;
    if (this.queuedWrites >= this.maxQueue && (LEVEL_WEIGHT[event.level] > LEVEL_WEIGHT.warn || this.queuedWrites >= this.maxQueue + 2_000)) { this.dropped++; return; }
    this.queuedWrites++;
    this.writeChain = this.writeChain
      .then(async () => { await mkdir(this.directory, { recursive: true }); await appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8'); })
      .catch(() => { this.dropped++; })
      .finally(() => { this.queuedWrites--; });
  }

  private async maintain() {
    try {
      await mkdir(this.directory, { recursive: true });
      const policy = this.getPolicy();
      const entries = await readdir(this.directory, { withFileTypes: true });
      const files = (await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => ({ path: resolve(this.directory, entry.name), name: entry.name, stat: await stat(resolve(this.directory, entry.name)) })))).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      const deadline = Date.now() - policy.retentionDays * 24 * 60 * 60_000;
      let total = files.reduce((sum, item) => sum + item.stat.size, 0);
      for (const item of [...files].reverse()) {
        if (item.stat.mtimeMs < deadline || total > policy.maxBytes) { await rm(item.path, { force: true }); total -= item.stat.size; }
      }
      const current = await stat(this.file).catch(() => null);
      if (current && current.size > 10 * 1024 * 1024) await rename(this.file, resolve(this.directory, `events-${Date.now()}.jsonl`));
    } catch {
      // Maintenance failures are observable without recursively writing a log.
      this.dropped++;
    }
  }
}

interface Definition {
  id: string; name: string; port: number; optional: boolean; cwd: string; command: string; args: string[]; health: string; installed: boolean;
}

interface Managed {
  process: ChildProcessWithoutNullStreams;
  state: RuntimeServiceState;
  startedAt: string;
  message: string | null;
}

interface PortOwner {
  pid: number;
  processGroup: number | null;
  cwd: string | null;
  belongsToProject: boolean;
}

interface RuntimeManagerOptions {
  appToken?: string;
  fetcher?: typeof fetch;
}

export class RuntimeManager {
  private managed = new Map<string, Managed>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: ServiceConfig, private readonly settings: RuntimeSettingsStore, private readonly logs: RuntimeLogService, private readonly options: RuntimeManagerOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  private definitions(): Definition[] {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const python = process.platform === 'win32'
      ? resolve(this.config.linsheRoot, 'vector-service/venv/Scripts/python.exe')
      : resolve(this.config.linsheRoot, 'vector-service/venv/bin/python');
    const maibotRoot = resolve(this.config.linsheRoot, 'MaiBot-Container');
    const maibotPythonCandidates = process.platform === 'win32'
      ? [resolve(maibotRoot, 'MaiBot/python/python.exe'), resolve(maibotRoot, 'MaiBot/.venv/Scripts/python.exe')]
      : [resolve(maibotRoot, 'MaiBot/.venv/bin/python'), 'python3'];
    const maibotPython = maibotPythonCandidates.find((candidate) => candidate === 'python3' || existsSync(candidate)) ?? '';
    const snowNode = process.platform === 'win32' && existsSync(resolve(maibotRoot, 'Snowluma/node.exe')) ? resolve(maibotRoot, 'Snowluma/node.exe') : process.execPath;
    return [
      { id: 'linshe-vector', name: '向量服务', port: 8765, optional: true, cwd: resolve(this.config.linsheRoot, 'vector-service'), command: existsSync(python) ? python : 'python3', args: ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8765', '--no-access-log'], health: 'http://127.0.0.1:8765/health', installed: existsSync(resolve(this.config.linsheRoot, 'vector-service/server.py')) },
      { id: 'linshe-agent', name: '邻舍主控后端', port: 3099, optional: false, cwd: resolve(this.config.linsheRoot, 'agent-core'), command: process.execPath, args: ['app.js'], health: this.config.linsheHealthUrl, installed: existsSync(resolve(this.config.linsheRoot, 'agent-core/app.js')) },
      // The public launch URL may point at Cloudflare Tunnel, but service
      // management must always probe the local Vite listener. A remote URL
      // can require an Access cookie and would otherwise make a healthy local
      // process look stopped to the Mac-side runtime manager.
      { id: 'linshe-web', name: '邻舍 Web', port: 5173, optional: false, cwd: resolve(this.config.linsheRoot, 'web-ui'), command: npm, args: ['run', 'dev', '--', '--host', this.config.lanAccess ? '0.0.0.0' : '127.0.0.1', '--port', '5173'], health: 'http://127.0.0.1:5173', installed: existsSync(resolve(this.config.linsheRoot, 'web-ui/package.json')) },
      { id: 'maibot', name: 'MaiBot', port: 8001, optional: true, cwd: resolve(maibotRoot, 'MaiBot'), command: maibotPython, args: ['bot.py'], health: 'http://127.0.0.1:8001', installed: existsSync(resolve(maibotRoot, 'MaiBot/bot.py')) && Boolean(maibotPython) },
      { id: 'snowluma', name: 'SnowLuma', port: 5099, optional: true, cwd: resolve(maibotRoot, 'Snowluma'), command: snowNode, args: ['index.mjs'], health: 'http://127.0.0.1:5099', installed: existsSync(resolve(maibotRoot, 'Snowluma/index.mjs')) },
    ];
  }

  async snapshot(): Promise<RuntimeService[]> {
    return Promise.all(this.definitions().map(async (definition) => {
      const item = this.managed.get(definition.id);
      let healthy = false;
      try { healthy = (await this.fetcher(definition.health, { signal: AbortSignal.timeout(this.config.probeTimeoutMs) })).ok; } catch { /* offline */ }
      const timedOut = item?.state === 'starting' && Date.now() - Date.parse(item.startedAt) > 60_000;
      const state: RuntimeServiceState = item ? (healthy && item.state === 'starting' ? 'running' : timedOut ? 'degraded' : item.state) : (healthy ? 'external' : 'stopped');
      if (item && state === 'running') item.state = 'running';
      return { id: definition.id, name: definition.name, port: definition.port, optional: definition.optional, installed: definition.installed, state, pid: item?.process.pid ?? null, startedAt: item?.startedAt ?? null, message: item?.message ?? null, managed: Boolean(item) };
    }));
  }

  async start(id: string): Promise<unknown> {
    if (id === 'linshe') {
      const results: unknown[] = []; const started: string[] = [];
      const ids = ['linshe-agent', 'linshe-web', 'linshe-vector', ...(this.settings.get().maibotAutostart ? ['maibot', 'snowluma'] : [])];
      try {
        for (const serviceId of ids) {
          const definition = this.definitions().find((item) => item.id === serviceId)!;
          if (definition.optional && !definition.installed) continue;
          if (this.managed.has(serviceId)) { results.push({ id: serviceId, started: false, reason: 'already_managed' }); continue; }
          try {
            results.push(await this.start(serviceId)); started.push(serviceId);
          } catch (error) {
            if (!definition.optional) throw error;
            const message = error instanceof Error ? error.message : String(error);
            results.push({ id: serviceId, started: false, optional: true, error: message });
            this.logs.append({ appId: 'linshe', serviceId, stream: 'system', level: 'warn', message: `${definition.name} 启动失败，邻舍将以降级模式继续：${message}`, force: true });
          }
        }
        return results;
      } catch (error) {
        for (const serviceId of started.reverse()) await this.stop(serviceId);
        throw error;
      }
    }
    const definition = this.definitions().find((item) => item.id === id);
    if (!definition) throw new Error('unknown_service');
    if (!definition.installed || !definition.command) throw new Error('service_not_installed');
    if (this.managed.has(id)) throw new Error('service_already_managed');
    const owner = await this.portOwner(definition);
    if (owner) {
      if (!owner.belongsToProject) throw new Error('port_owned_by_other_process');
      this.logs.append({ appId: 'linshe', serviceId: id, stream: 'system', level: 'info', message: `检测到项目遗留进程 PID ${owner.pid}，正在安全接管`, force: true });
      await this.terminateOwner(owner);
      for (let attempt = 0; attempt < 20 && await this.portOwner(definition); attempt++) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      if (await this.portOwner(definition)) throw new Error('project_process_takeover_failed');
    }
    const runtime = this.settings.get();
    const child = spawn(definition.command, definition.args, {
      cwd: definition.cwd, windowsHide: true, detached: process.platform !== 'win32',
      env: {
        ...process.env, NODE_ENV: 'production', PYTHONUNBUFFERED: '1',
        // The bundled ONNX Runtime exposes CoreML on macOS, but compiling the
        // Jina transformer with it can exhaust a 16 GB machine. Keep CPU as
        // the safe default while still allowing an explicit user override.
        ...(id === 'linshe-vector' && process.platform === 'darwin' && !process.env.EMBED_EXECUTION_PROVIDER
          ? { EMBED_EXECUTION_PROVIDER: 'cpu' }
          : {}),
        STHSTART_LOG_LEVEL: this.logs.effectiveLevel(id),
        STHSTART_SERVICE_URL: `http://127.0.0.1:${this.config.port}`,
        ...(id === 'linshe-agent' ? {
          STHSTART_APP_TOKEN: this.options.appToken ?? '',
          STHSTART_PUBLIC_LLM: runtime.publicLlmEnabled ? 'true' : 'false',
          STHSTART_PORTAL_URL: this.config.portalOrigins[0] ?? 'http://127.0.0.1:4173',
        } : {}),
        EXTRA_LORA_FOLDERS: runtime.extraLoraFolders.join(';'),
      },
    });
    const managed: Managed = { process: child, state: 'starting', startedAt: nowIso(), message: null };
    this.managed.set(id, managed);
    this.capture(definition, child.stdout, 'stdout');
    this.capture(definition, child.stderr, 'stderr');
    child.once('error', (error) => { managed.state = 'error'; managed.message = error.message; this.logs.append({ appId: 'linshe', serviceId: id, stream: 'system', level: 'error', message: error.message, force: true }); });
    child.once('exit', (code, signal) => {
      this.managed.delete(id);
      this.logs.append({ appId: 'linshe', serviceId: id, stream: 'system', level: code === 0 ? 'info' : 'error', message: `${definition.name} 已退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`, force: true });
    });
    this.logs.append({ appId: 'linshe', serviceId: id, stream: 'system', level: 'info', message: `${definition.name} 正在启动`, force: true });
    return { id, pid: child.pid ?? null };
  }

  async stop(id: string): Promise<unknown> {
    if (id === 'linshe') {
      const results = [];
      for (const serviceId of ['linshe-web', 'linshe-agent', 'linshe-vector', 'snowluma', 'maibot']) results.push(await this.stop(serviceId));
      return results;
    }
    const item = this.managed.get(id);
    if (!item) {
      const definition = this.definitions().find((candidate) => candidate.id === id);
      if (!definition) return { id, stopped: false, reason: 'unknown_service' };
      const owner = await this.portOwner(definition);
      if (!owner) return { id, stopped: false, reason: 'not_running' };
      if (!owner.belongsToProject) return { id, stopped: false, reason: 'foreign_process' };
      await this.terminateOwner(owner);
      return { id, stopped: true, external: true };
    }
    item.state = 'stopping';
    const exited = new Promise<boolean>((resolveExit) => {
      if (item.process.exitCode !== null || item.process.signalCode !== null) resolveExit(true);
      else item.process.once('exit', () => resolveExit(true));
    });
    try {
      if (process.platform === 'win32' && item.process.pid) spawn('taskkill', ['/PID', String(item.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else if (item.process.pid) process.kill(-item.process.pid, 'SIGTERM');
      else item.process.kill('SIGTERM');
    } catch { item.process.kill('SIGTERM'); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const graceful = await Promise.race([exited, new Promise<false>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 5_000); timer.unref(); })]);
    if (timer) clearTimeout(timer);
    if (!graceful && item.process.exitCode === null && item.process.signalCode === null) {
      try { if (process.platform !== 'win32' && item.process.pid) process.kill(-item.process.pid, 'SIGKILL'); else item.process.kill('SIGKILL'); } catch { /* process already exited */ }
      await Promise.race([exited, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))]);
    }
    return { id, stopped: item.process.exitCode !== null || item.process.signalCode !== null, forced: !graceful };
  }

  async close() {
    // Service shutdown only owns children spawned by this manager. Explicit
    // stop actions may take over verified project processes, but a test run or
    // service restart must never terminate an unrelated existing session.
    for (const id of [...this.managed.keys()].reverse()) await this.stop(id);
  }

  launchComfyui() {
    const executable = this.settings.get().comfyuiExecutable;
    if (!executable || !existsSync(executable)) throw new Error('comfyui_executable_not_found');
    const child = spawn(executable, [], { cwd: resolve(executable, '..'), detached: true, windowsHide: false, stdio: 'ignore' });
    child.unref();
    this.logs.append({ appId: 'linshe', serviceId: 'comfyui', stream: 'system', level: 'info', message: '已启动配置的 ComfyUI 启动器', force: true });
    return { started: true };
  }

  private capture(definition: Definition, stream: NodeJS.ReadableStream, kind: 'stdout' | 'stderr') {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.logs.append({ appId: 'linshe', serviceId: definition.id, stream: kind, message: line.trim() });
    });
    stream.on('end', () => { if (pending.trim()) this.logs.append({ appId: 'linshe', serviceId: definition.id, stream: kind, message: pending.trim() }); });
  }

  private isProjectPath(candidate: string | null, root: string) {
    if (!candidate) return false;
    const difference = relative(resolve(root), resolve(candidate));
    return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
  }

  private async portOwner(definition: Definition): Promise<PortOwner | null> {
    if (process.platform === 'win32') {
      try {
        const script = `$p=(Get-NetTCPConnection -State Listen -LocalPort ${definition.port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess); if($p){$w=Get-CimInstance Win32_Process -Filter \"ProcessId=$p\"; Write-Output $p; Write-Output $w.CommandLine}`;
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 2_000 });
        const [pidText, ...commandParts] = stdout.trim().split(/\r?\n/); const pid = Number(pidText);
        if (!Number.isInteger(pid)) return null;
        const command = commandParts.join(' ');
        return { pid, processGroup: null, cwd: null, belongsToProject: command.includes(this.config.linsheRoot) || command.includes(definition.cwd) };
      } catch { return null; }
    }
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${definition.port}`, '-sTCP:LISTEN', '-t'], { timeout: 2_000 });
      const pid = Number(stdout.trim().split(/\s+/)[0]);
      if (!Number.isInteger(pid)) return null;
      const [{ stdout: cwdOutput }, { stdout: groupOutput }] = await Promise.all([
        execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2_000 }).catch(() => ({ stdout: '', stderr: '' })),
        execFileAsync('ps', ['-o', 'pgid=', '-p', String(pid)], { timeout: 2_000 }).catch(() => ({ stdout: '', stderr: '' })),
      ]);
      const cwd = cwdOutput.split(/\r?\n/).find((line) => line.startsWith('n'))?.slice(1) || null;
      const processGroup = Number(groupOutput.trim());
      return { pid, processGroup: Number.isInteger(processGroup) && processGroup > 1 ? processGroup : null, cwd, belongsToProject: this.isProjectPath(cwd, definition.cwd) };
    } catch { return null; }
  }

  private async terminateOwner(owner: PortOwner) {
    if (process.platform === 'win32') {
      await new Promise<void>((resolvePromise) => {
        const killer = spawn('taskkill', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('exit', () => resolvePromise()); killer.once('error', () => resolvePromise());
      });
      return;
    }
    // External listeners are not children of this manager. Terminate only the
    // verified listener PID: its process group may also contain the shell or
    // the currently running SthStart service.
    try { process.kill(owner.pid, 'SIGTERM'); }
    catch { try { process.kill(owner.pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
}

export function readLauncherImport(config: ServiceConfig) {
  const candidates = [resolve(config.linsheRoot, 'launcher_config.json'), resolve(config.linsheRoot, '../launcher_config.json')];
  const path = candidates.find(existsSync);
  if (!path) return { available: false, path: null, settings: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      available: true, path: basename(path),
      settings: {
        autoOpenBrowser: Boolean(raw.auto_open_browser ?? true),
        useMirror: Boolean(raw.use_mirror ?? true), comfyuiExecutable: String(raw.comfyui_exe ?? ''),
        extraLoraFolders: String(raw.extra_lora_folders ?? '').split(';').map((item) => item.trim()).filter(Boolean),
        maibotAutostart: Boolean(raw.maibot_autostart), maibotBrowserMaibot: Boolean(raw.maibot_browser_maibot ?? true), maibotBrowserSnowluma: Boolean(raw.maibot_browser_snowluma ?? true),
      } satisfies Partial<RuntimeSettings>,
    };
  } catch { return { available: false, path: basename(path), settings: null, error: 'invalid_launcher_config' }; }
}
