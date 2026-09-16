import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { KnowledgeStore } from './knowledge/store.js';
import { buildActivityExportPackage } from './activities/exports.js';
import { stageActivityImport, commitActivityImport } from './activities/imports.js';
import { ActivityStore } from './activities/store.js';

const adminToken = 'admin-knowledge-export-token-1234567';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

test('knowledge: 工程导出导入保留引用快照，且不误绑定目标环境的资料', async () => {
  const artifactDirectory = resolve(tmpdir(), 'knowledge-export-' + randomUUID());
  mkdirSync(artifactDirectory, { recursive: true });
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({
    ...process.env,
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets });
  const store = new ActivityStore(database);
  const knowledge = new KnowledgeStore(database);

  try {
    // 1. 一篇带来源的可参考资料，作为本次生成的依据。
    const note = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/notes', headers: adminHeaders, payload: {
      title: '钟离的人物关系', kind: 'note', stage: 'reference', summary: '与胡桃同属往生堂',
      content: [{ id: 'b1', type: 'text', text: '钟离是往生堂的客卿，胡桃是第七十七代堂主。' }], tags: ['原神'],
    } });
    const noteId = String(note.json().id);
    knowledge.writeKnowledge(noteId, {
      schemaVersion: 1,
      works: [{ key: 'gi', name: '原神' }],
      characters: [{ work: '原神', name: '钟离' }],
      locations: [{ work: '原神', name: '璃月港' }],
      category: 'relation',
      nature: 'canon',
      authorship: 'handwritten',
      usage: 'reference',
      sources: [{ id: 's1', kind: 'manual', title: '游戏内对话', excerpt: '钟离：我是往生堂的客卿。' }],
    });

    // 2. 编译引用快照（模拟企划生成时冻结的内容）。
    const compiled = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/preview', headers: adminHeaders, payload: {
      selections: [{ sourceKind: 'note', sourceId: noteId, usage: 'background' }],
    } });
    assert.equal(compiled.statusCode, 200);
    const snapshot = compiled.json().snapshot as { references: Array<{ contentHash: string }> };
    assert.equal(snapshot.references.length, 1);

    // 3. 建一个带依据快照的活动，作为导出源。
    const activityResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: {
      title: '资料引用导出测试', type: '聚会', theme: '温馨', location: '璃月港',
    } });
    const activityId = String(activityResponse.json().activity.id);
    const activity = store.getActivity(activityId)!;
    const revision = store.getContentRevision(activityId, activity.currentContentRevisionId!)!;
    const document = {
      ...revision.document,
      activity: {
        ...revision.document.activity,
        // planningBasis 里的 knowledge 就是采用方案时冻结的引用快照。
        planningBasis: {
          sessionId: 'session-export-1',
          researchRevisionId: null,
          evidence: [],
          characterCandidates: [],
          locationCandidates: [],
          createdAt: new Date().toISOString(),
          knowledge: snapshot,
        },
      },
    };
    database.connection.prepare('UPDATE activity_content_revisions SET document_json=? WHERE id=?')
      .run(JSON.stringify(document), revision.id);

    // 4. 导出 → 导入到同一实例的新活动。
    const zipBuffer = await buildActivityExportPackage(config, database, store, activityId, { format: 'project' });
    
    assert.ok(Buffer.isBuffer(zipBuffer) && zipBuffer.length > 0, '导出应产生 zip 内容');

    const staged = await stageActivityImport(config, database, zipBuffer);
    const committed = await commitActivityImport(config, database, store, staged.jobId);
    const imported = store.getActivity(committed.activity.id)!;
    const importedDoc = store.getContentRevision(imported.id, imported.currentContentRevisionId!)!.document;

    // 5. 引用快照必须完整保留：正文、来源与定位。
    const basis = importedDoc.activity.planningBasis;
    assert.ok(basis, '导入后应保留规划依据');
    assert.ok(basis.knowledge, '规划依据必须带上引用快照');
    const references = basis.knowledge.references;
    assert.equal(references.length, 1);
    assert.equal(references[0].sourceKind, 'note');
    assert.equal(references[0].title, '钟离的人物关系');
    assert.equal(references[0].nature, 'canon');
    assert.equal(references[0].authorship, 'handwritten');
    assert.ok(references[0].excerpt.includes('往生堂'), '快照正文要能读出原内容');
    assert.equal(references[0].contentHash, snapshot.references[0].contentHash, '内容 hash 应逐字保留');
    assert.equal(references[0].evidence.length, 1, '证据链要跟着快照走');
    assert.equal(references[0].evidence[0].title, '游戏内对话');

    // 6. 跨环境不能误绑定：快照里没有指向目标库的 note/narrative 外键。
    assert.equal(typeof references[0].sourceId, 'string');
    const noteExists = database.connection.prepare('SELECT 1 FROM creative_notes WHERE id=?').get(references[0].sourceId);
    // 同实例导入时原笔记仍然存在；关键是快照本身不依赖它就能读出出处。
    assert.equal(Boolean(noteExists), true);
    assert.equal(references[0].externalSource, true);
    const collisionCheck = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot: basis.knowledge } });
    assert.equal(collisionCheck.json().items[0].state, 'missing', '即使本地存在相同 ID，也不能误绑定导入的引用');
    assert.equal('externalSource' in snapshot.references[0], false, '不得修改原活动快照');
    // 删除源资料后，历史快照依然可读（导出到别的环境就是这个情形）。
    database.connection.prepare('DELETE FROM creative_notes WHERE id=?').run(noteId);
    assert.ok(importedDoc.activity.planningBasis!.knowledge!.references[0].excerpt.includes('往生堂'), '源资料删除后快照仍然可读');

    // 7. 更新检查会把不可用的来源标记为 missing，同时保留旧摘要。
    const checked = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: {
      snapshot: importedDoc.activity.planningBasis!.knowledge,
    } });
    assert.equal(checked.statusCode, 200);
    assert.equal(checked.json().items[0].state, 'missing');
    assert.ok(String(checked.json().items[0].previousExcerpt).includes('往生堂'));
    assert.ok(String(checked.json().items[0].message).includes('源资料已不可用'));
  } finally {
    await app.close();
    database.close();
  }
});
