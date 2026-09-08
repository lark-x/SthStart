import type { LlmModelRole } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile, resolveProfile } from '../providers.js';

export async function resolveCharacterLlmProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  characterId: string,
  role: LlmModelRole,
) {
  const row = database.connection.prepare('SELECT profile_id FROM character_model_assignments WHERE character_id=? AND role=?').get(characterId, role) as { profile_id: string } | undefined;
  if (row) return resolveProfile(database, secrets, 'llm', row.profile_id);
  return resolveAssignedLlmProfile(database, secrets, 'characters', role);
}

export function setCharacterLlmAssignment(database: ServiceDatabase, characterId: string, role: LlmModelRole, profileId: string | null) {
  if (!profileId) {
    database.connection.prepare('DELETE FROM character_model_assignments WHERE character_id=? AND role=?').run(characterId, role);
    return null;
  }
  const profile = database.connection.prepare(`SELECT p.id,o.capabilities_json
    FROM provider_profiles p LEFT JOIN provider_profile_options o ON o.profile_id=p.id
    WHERE p.id=? AND p.kind='llm' AND p.enabled=1`).get(profileId) as { id: string; capabilities_json?: string | null } | undefined;
  if (!profile) throw new Error('llm_profile_not_found');
  let capabilities: unknown = [];
  try { capabilities = JSON.parse(profile.capabilities_json ?? '[]'); } catch { capabilities = []; }
  if (!Array.isArray(capabilities) || !capabilities.includes(role)) throw new Error('profile_capability_mismatch');
  const updatedAt = new Date().toISOString();
  database.connection.prepare(`INSERT INTO character_model_assignments(character_id,role,profile_id,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(character_id,role) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`)
    .run(characterId, role, profileId, updatedAt);
  return { characterId, role, profileId, updatedAt };
}

export function listCharacterLlmAssignments(database: ServiceDatabase, characterId: string) {
  return database.connection.prepare('SELECT role,profile_id,updated_at FROM character_model_assignments WHERE character_id=? ORDER BY role').all(characterId) as Array<{ role: LlmModelRole; profile_id: string; updated_at: string }>;
}
