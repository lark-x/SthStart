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
  {
    version: 2,
    name: 'narrative-research',
    statements: [
      /*
       * 研究专题：AI 建议与用户自定主题最终都落到同一张表，
       * 这样下游的检索、结论与资料发布只有一条链路。
       */
      `CREATE TABLE IF NOT EXISTS narrative_research_projects (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        question TEXT NOT NULL DEFAULT '',
        scope_json TEXT NOT NULL DEFAULT '{}',
        origin TEXT NOT NULL CHECK(origin IN ('ai-suggested','user-defined')),
        status TEXT NOT NULL CHECK(status IN ('draft','confirmed','researching','review','published','archived')),
        selected_topic_id TEXT,
        latest_run_id TEXT,
        published_note_id TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_narrative_research_projects_work
        ON narrative_research_projects(work_id, updated_at DESC)`,
      /*
       * 选题候选：只作为「还没成为专题」的建议保留，
       * 选中后才转换成研究专题，避免两套主题结构并存。
       */
      `CREATE TABLE IF NOT EXISTS narrative_research_topic_suggestions (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES narrative_works(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL,
        title TEXT NOT NULL,
        question TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        scope_json TEXT NOT NULL DEFAULT '{}',
        seed_evidence_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('candidate','selected','dismissed')),
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_narrative_research_suggestions_batch ON narrative_research_topic_suggestions(batch_id)',
      /*
       * 研究运行：每个阶段的结果单独落库，重试才能从最后一个有效阶段继续，
       * 而不是把已经花掉的检索重跑一遍。
       */
      `CREATE TABLE IF NOT EXISTS narrative_research_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES narrative_research_projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('queued','running','needs-review','succeeded','incomplete','failed','cancelled','interrupted')),
        stage TEXT NOT NULL DEFAULT 'inventory',
        input_snapshot_json TEXT NOT NULL DEFAULT '{}',
        corpus_version_json TEXT NOT NULL DEFAULT '{}',
        query_plan_json TEXT NOT NULL DEFAULT '[]',
        candidate_evidence_json TEXT NOT NULL DEFAULT '[]',
        verified_evidence_json TEXT NOT NULL DEFAULT '[]',
        synthesis_json TEXT NOT NULL DEFAULT '{}',
        progress_label TEXT,
        model_profile_id TEXT,
        used_model_calls INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        incomplete_reason TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_narrative_research_runs_project ON narrative_research_runs(project_id, created_at DESC)',
      /*
       * 通用证据：旧 narrative_claim_evidence 只能指向台词，
       * 研究需要同时引用节点与文档，所以新流程统一写这张表并冻结原文快照。
       * 证据行本身只属于「某次运行」，与结论的关联放在下面的关联表里：
       * 同一处原文经常同时支撑多条结论，把 claim_id 写在证据行上会让先建立的结论丢掉证据。
       */
      `CREATE TABLE IF NOT EXISTS narrative_research_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES narrative_research_projects(id) ON DELETE CASCADE,
        run_id TEXT,
        provider_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('utterance','node','document')),
        target_id TEXT NOT NULL,
        node_id TEXT,
        scene_id TEXT,
        locator TEXT NOT NULL DEFAULT '',
        quote_snapshot TEXT NOT NULL DEFAULT '',
        context_before TEXT NOT NULL DEFAULT '',
        context_after TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL,
        source_version_json TEXT NOT NULL DEFAULT '{}',
        valid INTEGER NOT NULL DEFAULT 1,
        validation_message TEXT,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_narrative_research_evidence_run ON narrative_research_evidence(run_id)',
      // 同一轮检索里同一目标只保留一条，重复命中不会把证据列表撑成重复项。
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_narrative_research_evidence_unique
        ON narrative_research_evidence(ifnull(run_id,''), target_type, target_id)`,
      // 结论与证据的关联：同一结论引用同一目标只保留一条。
      `CREATE TABLE IF NOT EXISTS narrative_research_claim_evidence (
        claim_id TEXT NOT NULL REFERENCES narrative_claims(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES narrative_research_evidence(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'support' CHECK(role IN ('support','counter')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(claim_id, evidence_id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_narrative_research_claim_evidence_claim ON narrative_research_claim_evidence(claim_id)',
      /*
       * 研究总稿：与专题是多对一，重新发布时增加 revision，
       * 旧活动引用的资料快照因此不会被改写。
       */
      `CREATE TABLE IF NOT EXISTS narrative_research_drafts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES narrative_research_projects(id) ON DELETE CASCADE,
        run_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK(status IN ('draft','approved','published')),
        content_hash TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_narrative_research_drafts_project ON narrative_research_drafts(project_id, revision DESC)',
      /*
       * 结论卡扩展：claim_type 是与「事实/推论/猜想/矛盾/开放问题」对应的分类，
       * 与既有的 type 列并存，旧数据不受影响。
       */
      'ALTER TABLE narrative_claims ADD COLUMN project_id TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN run_id TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN title TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN claim_type TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN explanation TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN uncertainty TEXT',
      'ALTER TABLE narrative_claims ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
      'CREATE INDEX IF NOT EXISTS idx_narrative_claims_project ON narrative_claims(project_id, status)',
    ],
  },
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
