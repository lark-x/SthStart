/** Formal events remain authoritative. This complete fact index follows every writer, including historical forks. */
export const CREATIVE_MEMORY_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS co_memory_facts (
    branch_id TEXT NOT NULL, event_id TEXT NOT NULL, fact_id TEXT NOT NULL,
    world_id TEXT NOT NULL, tick INTEGER NOT NULL, location_id TEXT NOT NULL,
    content TEXT NOT NULL, nature TEXT NOT NULL, known_by_json TEXT NOT NULL,
    participant_ids_json TEXT NOT NULL, storyline_ids_json TEXT NOT NULL,
    PRIMARY KEY(branch_id,event_id,fact_id),
    FOREIGN KEY(branch_id,event_id) REFERENCES sw_events(branch_id,id) ON DELETE CASCADE
  )`,
  `INSERT OR IGNORE INTO co_memory_facts
    SELECT e.branch_id,e.id,json_extract(f.value,'$.id'),e.world_id,e.tick+e.duration,e.location_id,
      json_extract(f.value,'$.content'),json_extract(f.value,'$.nature'),json_extract(f.value,'$.knownBy'),
      json_extract(e.data_json,'$.participantIds'),json_extract(e.data_json,'$.storyLineIds')
    FROM sw_events e,json_each(e.data_json,'$.facts') f`,
  `CREATE TRIGGER IF NOT EXISTS co_memory_index_event AFTER INSERT ON sw_events BEGIN
    INSERT INTO co_memory_facts
      SELECT NEW.branch_id,NEW.id,json_extract(f.value,'$.id'),NEW.world_id,NEW.tick+NEW.duration,NEW.location_id,
        json_extract(f.value,'$.content'),json_extract(f.value,'$.nature'),json_extract(f.value,'$.knownBy'),
        json_extract(NEW.data_json,'$.participantIds'),json_extract(NEW.data_json,'$.storyLineIds')
      FROM json_each(NEW.data_json,'$.facts') f;
  END`,
  'CREATE INDEX IF NOT EXISTS co_memory_fact_timeline ON co_memory_facts(branch_id,tick,event_id,fact_id)',
  'CREATE INDEX IF NOT EXISTS co_memory_fact_location ON co_memory_facts(branch_id,location_id,tick)',
  'CREATE INDEX IF NOT EXISTS co_memory_fact_nature ON co_memory_facts(branch_id,nature,tick)',
  `CREATE TABLE IF NOT EXISTS co_memory_entries (
    scope_key TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('setting','foreshadowing')),
    revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','open','resolved')),
    title TEXT NOT NULL, content TEXT NOT NULL, source_artifact_id TEXT NOT NULL REFERENCES co_artifacts(id),
    source_hash TEXT NOT NULL, source_refs_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,kind,id)
  )`,
  `CREATE TABLE IF NOT EXISTS co_memory_entry_versions (
    scope_key TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL,
    content_json TEXT NOT NULL, content_hash TEXT NOT NULL, effective_tick INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,kind,id,revision)
  )`,
  `CREATE TABLE IF NOT EXISTS co_memory_branch_snapshots (
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    id TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, effective_tick INTEGER NOT NULL,
    entry_json TEXT NOT NULL, source_scope TEXT NOT NULL, source_version_hash TEXT NOT NULL,
    parent_revision INTEGER NOT NULL, fork_source_revision INTEGER NOT NULL,
    PRIMARY KEY(branch_id,kind,id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS co_memory_freeze_branch AFTER INSERT ON sw_branches
    WHEN NEW.parent_branch_id IS NOT NULL BEGIN
    INSERT INTO co_memory_branch_snapshots
      SELECT NEW.id,id,kind,revision,effective_tick,content_json,source_scope,content_hash,
        (SELECT revision FROM sw_branches WHERE id=NEW.parent_branch_id),NEW.source_revision
      FROM (
        SELECT *,ROW_NUMBER() OVER(PARTITION BY kind,id ORDER BY effective_tick DESC,revision DESC) rank FROM (
          SELECT id,kind,revision,effective_tick,content_json,scope_key AS source_scope,content_hash
            FROM co_memory_entry_versions WHERE scope_key='branch:'||NEW.parent_branch_id AND effective_tick<=NEW.fork_tick
          UNION ALL
          SELECT id,kind,revision,effective_tick,entry_json,source_scope,source_version_hash
            FROM co_memory_branch_snapshots WHERE branch_id=NEW.parent_branch_id AND effective_tick<=NEW.fork_tick
        )
      ) WHERE rank=1;
  END`,
  `CREATE TRIGGER IF NOT EXISTS co_memory_branch_snapshots_immutable BEFORE UPDATE ON co_memory_branch_snapshots
    BEGIN SELECT RAISE(ABORT,'memory branch snapshots are immutable'); END`,
  `CREATE TABLE IF NOT EXISTS co_memory_digests (
    scope_key TEXT NOT NULL, batch INTEGER NOT NULL, content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope_key,batch)
  )`,
  `CREATE TRIGGER IF NOT EXISTS co_memory_versions_immutable BEFORE UPDATE ON co_memory_entry_versions
    BEGIN SELECT RAISE(ABORT,'memory versions are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS co_memory_digests_immutable BEFORE UPDATE ON co_memory_digests
    BEGIN SELECT RAISE(ABORT,'memory digests are immutable'); END`,
];
