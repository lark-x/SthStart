export const CREATIVE_INTEGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE co_scope_policies (
    scope_key TEXT PRIMARY KEY, scope_json TEXT NOT NULL, data_json TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE co_run_models (
    run_id TEXT NOT NULL REFERENCES co_runs(id), role_id TEXT NOT NULL,
    profile_id TEXT NOT NULL, profile_hash TEXT NOT NULL,
    PRIMARY KEY(run_id,role_id))`,
  `CREATE TABLE co_conversations (
    id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE co_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES co_conversations(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL, created_at TEXT NOT NULL)`,
  'CREATE INDEX idx_co_messages_conversation ON co_messages(conversation_id,created_at,id)',
  `CREATE TABLE co_external_candidates (
    idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES co_runs(id), receipt_json TEXT NOT NULL)`,
];
