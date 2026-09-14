import crypto from 'node:crypto';
import type { McpConnectionTest, McpSource, McpSourceSave } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import type { McpDiscoveredTool } from './client.js';

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseDiscoveredTools(value: string | null | undefined): McpDiscoveredTool[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is McpDiscoveredTool => !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') : [];
  } catch {
    return [];
  }
}

function parseLastTest(value: string | null | undefined): McpConnectionTest | null {
  if (!value) return null;
  try { return JSON.parse(value) as McpConnectionTest; } catch { return null; }
}

function credentialAccount(id: string) {
  return `mcp-source:${id}`;
}

function envName(id: string) {
  return `STHSTART_MCP_SECRET_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export class McpSourceStore {
  constructor(
    private readonly database: ServiceDatabase,
    private readonly secrets: SecretStore,
  ) {}

  list(): McpSource[] {
    const rows = this.database.connection.prepare('SELECT * FROM mcp_sources ORDER BY updated_at DESC').all() as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  get(id: string): McpSource | null {
    const row = this.database.connection.prepare('SELECT * FROM mcp_sources WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  async save(input: McpSourceSave, existing?: McpSource | null): Promise<{ source: McpSource; secretStored: boolean; warning: string | null }> {
    const id = (input.id || crypto.randomUUID()).trim();
    if (!id.match(/^[a-z][a-z0-9-]{1,62}$/)) throw new Error('invalid_mcp_source_id');
    const name = input.name?.trim();
    const url = input.url?.trim();
    if (!name || !url) throw new Error('invalid_mcp_source');
    let normalizedUrl: string;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      normalizedUrl = parsed.toString().replace(/\/$/, '');
    } catch {
      throw new Error('invalid_mcp_source_url');
    }
    const authMode = input.authMode || 'none';
    if (!['none', 'bearer', 'header'].includes(authMode)) throw new Error('invalid_mcp_auth_mode');
    if (authMode === 'header' && !input.authHeaderName?.trim()) throw new Error('mcp_header_name_required');
    const account = credentialAccount(id);
    let secretStored = true;
    let warning: string | null = null;
    if (input.secret) {
      try {
        await this.secrets.set(account, input.secret);
      } catch (error) {
        secretStored = false;
        warning = error instanceof Error ? error.message : String(error);
      }
    }
    const now = nowIso();
    const allowedTools = Array.isArray(input.allowedTools) ? [...new Set(input.allowedTools.filter((item): item is string => typeof item === 'string'))].slice(0, 100) : [];
    const discoveredTools = existing?.discoveredTools ?? [];
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 45_000, 1_000), 300_000);
    const status = input.status === 'disabled' ? 'disabled' : 'enabled';
    this.database.connection.prepare(`INSERT INTO mcp_sources
      (id,name,url,auth_mode,auth_header_name,credential_account,applicable_works_json,universal,purpose,allowed_tools_json,discovered_tools_json,timeout_ms,status,last_test_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,url=excluded.url,auth_mode=excluded.auth_mode,auth_header_name=excluded.auth_header_name,
        applicable_works_json=excluded.applicable_works_json,universal=excluded.universal,purpose=excluded.purpose,
        allowed_tools_json=excluded.allowed_tools_json,timeout_ms=excluded.timeout_ms,status=excluded.status,updated_at=excluded.updated_at`)
      .run(
        id, name, normalizedUrl, authMode, input.authHeaderName?.trim() || null, account,
        JSON.stringify([...new Set((input.applicableWorks || []).filter((item): item is string => typeof item === 'string'))].slice(0, 100)),
        input.universal ? 1 : 0, input.purpose?.trim() || '',
        JSON.stringify(allowedTools), JSON.stringify(discoveredTools), timeoutMs, status,
        null, now, now,
      );
    return { source: this.get(id)!, secretStored, warning };
  }

  async updateTestResult(id: string, result: McpConnectionTest) {
    this.database.connection.prepare('UPDATE mcp_sources SET last_test_json=?,updated_at=? WHERE id=?').run(JSON.stringify(result), nowIso(), id);
  }

  async updateDiscoveredTools(id: string, tools: McpDiscoveredTool[]) {
    this.database.connection.prepare('UPDATE mcp_sources SET discovered_tools_json=?,updated_at=? WHERE id=?').run(JSON.stringify(tools), nowIso(), id);
  }

  async getSecret(source: McpSource): Promise<string | null> {
    if (!source.credentialAccount) return null;
    const credential = await this.secrets.get(source.credentialAccount, envName(source.id));
    return credential.value;
  }

  async delete(id: string): Promise<boolean> {
    const row = this.database.connection.prepare('SELECT credential_account FROM mcp_sources WHERE id=?').get(id) as { credential_account?: string } | undefined;
    if (!row) return false;
    this.database.connection.prepare('DELETE FROM mcp_sources WHERE id=?').run(id);
    if (row.credential_account) await this.secrets.delete(row.credential_account).catch(() => undefined);
    return true;
  }

  private mapRow(row: Record<string, unknown>): McpSource {
    const discoveredTools = parseDiscoveredTools(String(row.discovered_tools_json ?? '[]'));
    return {
      id: String(row.id),
      name: String(row.name),
      url: String(row.url),
      authMode: String(row.auth_mode) as McpSource['authMode'],
      authHeaderName: row.auth_header_name ? String(row.auth_header_name) : undefined,
      credentialAccount: row.credential_account ? String(row.credential_account) : undefined,
      applicableWorks: parseJsonArray(String(row.applicable_works_json ?? '[]')),
      universal: Boolean(row.universal),
      purpose: String(row.purpose ?? ''),
      allowedTools: parseJsonArray(String(row.allowed_tools_json ?? '[]')),
      discoveredTools,
      timeoutMs: Number(row.timeout_ms ?? 45_000),
      status: String(row.status) as McpSource['status'],
      hasCredential: Boolean(row.credential_account),
      lastTestResult: parseLastTest(row.last_test_json ? String(row.last_test_json) : null),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
