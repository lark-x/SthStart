import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { CreateNativeStoryProposalSchema } from '@sthstart/contracts';
import { storyFixture } from '../ai/fixture.js';

test('参考答案：保存章节 → 真实 MCP 读取 → 待审提案 → 接受/拒绝/版本冲突', async () => {
  const f = await storyFixture();
  try {
    const chapter = f.documents.get('chapter')!;
    const root = `/api/v1/admin/story/projects/${f.project.id}`;
    const headers = { 'x-sthstart-admin-token': f.adminToken };
    assert.equal((await f.app.inject({ url: `${root}/documents` })).statusCode, 401);
    const saved = await f.app.inject({ method: 'PUT', url: `${root}/documents/${chapter.id}`, headers,
      payload: { expectedRevision: 1, title: chapter.title, body: '林遥说：我会等你。' } });
    assert.equal(saved.statusCode, 200, saved.body);
    const client = await f.connect();
    const result = await client.callTool({ name: 'read_entry', arguments: { kind: 'chapter', id: chapter.id } });
    assert.ok(!result.isError); assert.match(JSON.stringify(result), /我会等你/);
    const input = { operation: 'update', kind: 'chapter', targetId: chapter.id, baseRevision: 2,
      proposedTitle: chapter.title, proposedBody: '林遥说：我会等钟声。', reason: '测试提案与正式资料的区别' };
    assert.equal(Value.Check(CreateNativeStoryProposalSchema, input), true);
    assert.equal(Value.Check(CreateNativeStoryProposalSchema, { ...input, baseRevision: null }), false);
    assert.ok(!(await client.callTool({ name: 'submit_proposal', arguments: input })).isError);
    const proposal = f.store.listProposals(f.project.id)[0]!;
    assert.equal(proposal.status, 'pending');
    assert.equal(f.store.getDocument(f.project.id, chapter.id)!.body, '林遥说：我会等你。');
    const rejected = await f.app.inject({ method: 'POST', url: `${root}/proposals/${proposal.id}/decision`, headers, payload: { decision: 'rejected' } });
    assert.equal(rejected.statusCode, 200);
    assert.equal(f.store.getDocument(f.project.id, chapter.id)!.body, '林遥说：我会等你。');
    await client.callTool({ name: 'submit_proposal', arguments: { ...input, proposedBody: '林遥说：我回来了。' } });
    const second = f.store.listProposals(f.project.id).find(item => item.status === 'pending')!;
    assert.equal((await f.app.inject({ method: 'POST', url: `${root}/proposals/${second.id}/decision`, headers, payload: { decision: 'accepted' } })).statusCode, 200);
    assert.equal(f.store.getDocument(f.project.id, chapter.id)!.body, '林遥说：我回来了。');
    assert.equal((await client.callTool({ name: 'submit_proposal', arguments: input })).isError, true, '旧基准版本不能覆盖新正文');
    const other = f.store.createProject({ title: '别的项目' });
    assert.equal((await f.app.inject({ url: `/api/v1/story-bridge/projects/${other.id}/entries`, headers: { authorization: `Bearer ${f.grant.token}` } })).statusCode, 401);
    f.store.revokeBridgeGrant(f.project.id);
    assert.equal((await client.callTool({ name: 'get_project', arguments: {} })).isError, true);
  } finally { await f.close(); }
});
