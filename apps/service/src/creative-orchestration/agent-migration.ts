/**
 * Migration 65 owns registration of these statements. Keep this file free of
 * runtime imports so database initialization never has to import the bridge.
 */
export const CREATIVE_AGENT_GRANT_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS co_agent_grants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    permissions_json TEXT NOT NULL,
    budget_json TEXT NOT NULL,
    usage_json TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_co_agent_grants_expiry ON co_agent_grants(revoked, expires_at)',
];
