import type { FastifyRequest } from 'fastify';
import type { PublicCapability } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';
import { hashToken, tokensEqual } from './security.js';

export interface AppIdentity {
  id: string;
  name: string;
  capabilities: PublicCapability[];
}

export function bearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export function authenticateApp(database: ServiceDatabase, request: FastifyRequest): AppIdentity | null {
  const token = bearerToken(request);
  if (!token) return null;
  const row = database.connection.prepare(
    'SELECT id, name, capabilities_json FROM managed_apps WHERE token_hash = ? AND enabled = 1',
  ).get(hashToken(token)) as { id: string; name: string; capabilities_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, capabilities: JSON.parse(row.capabilities_json) as PublicCapability[] };
}

export function hasCapability(identity: AppIdentity, capability: PublicCapability) {
  return identity.capabilities.includes(capability);
}

export function authenticateAdmin(adminToken: string | null, request: FastifyRequest) {
  if (!adminToken) return false;
  const token = request.headers['x-sthstart-admin-token'];
  return typeof token === 'string' && tokensEqual(token, adminToken);
}
