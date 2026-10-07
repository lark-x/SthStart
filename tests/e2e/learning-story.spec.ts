import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? 4273}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
async function seed(request: APIRequestContext) {
  const result = await request.post(`${service}/api/v1/admin/story/projects`, { headers, data: { title: `学习-${randomUUID()}` } });
  expect(result.status()).toBe(201); const project = await result.json();
  const root = `${service}/api/v1/admin/story/projects/${project.id}`;
  const chapterResponse = await request.post(`${root}/documents`, { headers, data: { kind: 'chapter', title: '学习章节', body: '林遥说：等钟响后再走。' } });
  expect(chapterResponse.status()).toBe(201);
  return { project, root, chapter: await chapterResponse.json() };
}

test('学习流程：编辑保存 → MCP 读正文并提交提案 → 作者接受与拒绝', async ({ page, request }) => {
  const f = await seed(request);
  const client = new Client({ name: 'learning-browser', version: '1.0.0' });
  try {
    await page.goto(`/apps/story/${f.project.id}`);
    await page.getByRole('button', { name: '学习章节', exact: false }).first().click();
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(editor).toHaveValue('林遥说：等钟响后再走。');
    await editor.fill('林遥说：我会等你。');
    await expect.poll(async () => (await (await request.get(`${f.root}/documents`, { headers })).json()).items.find((item: { id: string }) => item.id === f.chapter.id).body).toBe('林遥说：我会等你。');
    const grant = await (await request.post(`${f.root}/bridge-grant`, { headers, data: {} })).json();
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: ['--import', import.meta.resolve('tsx/esm'), resolve('apps/service/src/story/native-mcp-server.ts')], stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', STHSTART_STORY_PROJECT_ID: f.project.id,
        STHSTART_STORY_BRIDGE_TOKEN: grant.token, STHSTART_STORY_PORTAL_URL: portal } }));
    expect(JSON.stringify(await client.callTool({ name: 'read_entry', arguments: { kind: 'chapter', id: f.chapter.id } }))).toContain('我会等你');
    for (const [decision, body] of [['accepted', '林遥说：我会等钟声。'], ['rejected', '不会被采用的正文']] as const) {
      const current = (await (await request.get(`${f.root}/documents`, { headers })).json()).items.find((item: { id: string }) => item.id === f.chapter.id);
      const submitted = await client.callTool({ name: 'submit_proposal', arguments: { operation: 'update', kind: 'chapter', targetId: f.chapter.id,
        baseRevision: current.revision, proposedTitle: current.title, proposedBody: body, reason: `学习 ${decision}` } });
      expect(submitted.isError).toBeFalsy();
      await page.reload();
      await page.getByRole('button', { name: '提案审阅', exact: false }).click();
      const dialog = page.getByRole('dialog', { name: '审阅与项目连接' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: decision === 'accepted' ? '接受并保存' : '拒绝', exact: true }).click();
      await expect(dialog.getByText(decision === 'accepted' ? '已接受' : '已拒绝', { exact: false })).toBeVisible();
      const updated = (await (await request.get(`${f.root}/documents`, { headers })).json()).items.find((item: { id: string }) => item.id === f.chapter.id);
      expect(updated.body).toBe(decision === 'accepted' ? body : current.body);
    }
  } finally { await client.close(); await request.delete(f.root, { headers }); }
});

for (const status of [503, 409]) test(`学习异常：保存返回 ${status} 时保留本地草稿`, async ({ page, request }) => {
  const f = await seed(request);
  try {
    await page.goto(`/apps/story/${f.project.id}`);
    await page.getByRole('button', { name: '学习章节', exact: false }).first().click();
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(editor).toHaveValue(f.chapter.body);
    const pattern = `**/story/projects/${f.project.id}/documents/${f.chapter.id}`;
    await page.route(pattern, route => route.request().method() === 'PUT'
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: status === 409 ? 'story_revision_conflict' : 'service_unavailable', message: '学习模拟失败' }) }) : route.continue());
    await editor.fill('保存失败也不能丢失这段草稿');
    await expect(page.getByText(status === 409 ? '版本冲突' : '仅保存在本机', { exact: true }).first()).toBeVisible();
    await expect(editor).toHaveValue('保存失败也不能丢失这段草稿');
    expect((await (await request.get(`${f.root}/documents`, { headers })).json()).items.find((item: { id: string }) => item.id === f.chapter.id).body).toBe(f.chapter.body);
    await page.reload();
    await page.getByRole('button', { name: '学习章节', exact: false }).first().click();
    await expect(page.getByRole('button', { name: '恢复本机文本' })).toBeVisible();
    await page.getByRole('button', { name: '恢复本机文本' }).click();
    await expect(editor).toHaveValue('保存失败也不能丢失这段草稿');
  } finally { await request.delete(f.root, { headers }); }
});
