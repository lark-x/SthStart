import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, SERVICE_DATABASE_MIGRATIONS } from '../database.js';

test('story migration 45 upgrades existing rows and preserves legacy proposal links', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  try {
    migrateDatabase(db, SERVICE_DATABASE_MIGRATIONS.slice(0, -1), 'service-test');
    db.prepare(`INSERT INTO story_projects(id,title,summary,revision,context_settings_json,created_at,updated_at)
      VALUES ('project-1','雾港','',1,'{}','2026-01-01','2026-01-01')`).run();
    db.prepare(`INSERT INTO story_documents(id,project_id,kind,title,body,position,revision,created_at,updated_at)
      VALUES ('outline-1','project-1','outline','大纲','旧正文',0,3,'2026-01-01','2026-01-03')`).run();
    db.prepare(`INSERT INTO story_agent_sessions(id,project_id,title,runtime_session_id,status,created_at,updated_at)
      VALUES ('session-1','project-1','旧会话','runtime-1','idle','2026-01-01','2026-01-01')`).run();
    db.prepare(`INSERT INTO story_proposals(id,project_id,session_id,kind,target_id,base_revision,proposed_title,proposed_body,reason,status,created_at,decided_at)
      VALUES ('proposal-1','project-1','session-1','outline','outline-1',3,'新大纲','提案正文','补充冲突','pending','2026-01-03',NULL)`).run();

    migrateDatabase(db, SERVICE_DATABASE_MIGRATIONS, 'service-test');

    const proposal = db.prepare('SELECT * FROM story_proposals WHERE id=?').get('proposal-1') as Record<string, unknown>;
    assert.equal(proposal.operation, 'update');
    assert.equal(proposal.origin, 'legacy');
    assert.equal(proposal.session_id, 'session-1');
    assert.equal(proposal.result_entry_id, null);
    const baseline = db.prepare('SELECT * FROM story_entry_revisions WHERE entry_id=?').get('outline-1') as Record<string, unknown>;
    assert.equal(baseline.revision, 3);
    assert.equal(baseline.source, 'baseline');
    assert.deepEqual(JSON.parse(String(baseline.snapshot_json)), { kind: 'outline', title: '大纲', body: '旧正文' });
    db.prepare(`INSERT INTO story_documents(id,project_id,kind,title,body,position,revision,created_at,updated_at)
      VALUES ('chapter-1','project-1','chapter','第一章','章节正文',0,1,'2026-01-04','2026-01-04')`).run();
    assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
  } finally { db.close(); }
});
