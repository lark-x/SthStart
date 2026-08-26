import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, type DatabaseMigration } from './database.js';

const initialSchema = [
  `CREATE TABLE IF NOT EXISTS narrative_sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, version TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ready', updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_works (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES narrative_sources(id), external_id TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', locale TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(source_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_releases (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(work_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_nodes (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
    release_id TEXT NOT NULL REFERENCES narrative_releases(id) ON DELETE CASCADE, parent_id TEXT REFERENCES narrative_nodes(id),
    external_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    UNIQUE(release_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_scenes (
    id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES narrative_nodes(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    UNIQUE(node_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_utterances (
    id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES narrative_scenes(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, sort_order INTEGER NOT NULL, kind TEXT NOT NULL,
    speaker TEXT, body TEXT NOT NULL, condition_text TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    UNIQUE(scene_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_entities (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, UNIQUE(work_id, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_entity_aliases (
    entity_id TEXT NOT NULL REFERENCES narrative_entities(id) ON DELETE CASCADE, alias TEXT NOT NULL,
    PRIMARY KEY(entity_id, alias)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_mentions (
    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES narrative_entities(id) ON DELETE CASCADE,
    utterance_id TEXT NOT NULL REFERENCES narrative_utterances(id) ON DELETE CASCADE,
    start_offset INTEGER, end_offset INTEGER, UNIQUE(entity_id, utterance_id, start_offset)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_claims (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
    type TEXT NOT NULL, subject_entity_id TEXT REFERENCES narrative_entities(id), object_entity_id TEXT REFERENCES narrative_entities(id),
    body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
    origin TEXT NOT NULL CHECK(origin IN ('human','ai')), generator_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_claim_evidence (
    claim_id TEXT NOT NULL REFERENCES narrative_claims(id) ON DELETE CASCADE,
    utterance_id TEXT NOT NULL REFERENCES narrative_utterances(id), quote_snapshot TEXT NOT NULL,
    valid INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(claim_id, utterance_id)
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_import_batches (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, work_external_id TEXT NOT NULL, release_external_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('preview','committed','cancelled','failed')),
    bundle_json TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS narrative_fts USING fts5(work_id UNINDEXED, kind UNINDEXED, ref_id UNINDEXED, title, body, tokenize='trigram')`,
  'CREATE INDEX IF NOT EXISTS idx_narrative_nodes_work ON narrative_nodes(work_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_narrative_scenes_node ON narrative_scenes(node_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_narrative_utterances_scene ON narrative_utterances(scene_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_narrative_claims_work_status ON narrative_claims(work_id, status)',
];

export const NARRATIVE_DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 1, name: 'initial', statements: initialSchema },
];

export class NarrativeDatabase {
  readonly connection: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON');
    this.connection.exec('PRAGMA journal_mode = WAL');
    migrateDatabase(this.connection, NARRATIVE_DATABASE_MIGRATIONS, 'narrative');
  }
  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.connection.exec('COMMIT'); return result; }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() { this.connection.close(); }
}
