import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { listUnifiedTasks, cancelUnifiedTask } from './tasks/adapters.js';

const adminToken = 'tasks-test-admin-token-12345678901234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

async function setup() {
  const database = new ServiceDatabase(':memory:');
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets });
  return { app, database, config, secrets };
}

test('Tasks: unified adapter aggregates tasks across domains', async () => {
  const { app, database, config, secrets } = await setup();
  try {
    // 1. Insert a test activity
    database.connection.prepare(`
      INSERT INTO activities (id, title, type, theme, location, rules, archived, head_version, created_at, updated_at)
      VALUES ('act_test_1', '海边日落派对', '日常', '海滩', '', '', 0, 1, '2026-09-10T10:00:00Z', '2026-09-10T10:00:00Z')
    `).run();

    // 2. Insert an activity text job
    database.connection.prepare(`
      INSERT INTO activity_jobs (id, activity_id, kind, mode, status, request_hash, target_revision_id, created_at, updated_at)
      VALUES ('job_text_1', 'act_test_1', 'text', 'whole-text', 'running', 'hash_1', 'rev_1', '2026-09-10T10:01:00Z', '2026-09-10T10:01:00Z')
    `).run();

    // 3. Insert an activity media batch
    database.connection.prepare(`
      INSERT INTO activity_media_batches (id, activity_id, content_revision_id, image_config_revision_id, request_hash, created_at, updated_at)
      VALUES ('batch_media_1', 'act_test_1', 'c_rev_1', 'img_rev_1', 'hash_b1', '2026-09-10T10:02:00Z', '2026-09-10T10:02:00Z')
    `).run();

    // 4. Insert a topic collection run
    database.connection.prepare(`
      INSERT INTO topic_collection_runs (id, status, progress_label, created_count, merged_count, failed_count, created_at, updated_at)
      VALUES ('run_topic_1', 'succeeded', '已完成采集', 5, 2, 0, '2026-09-10T09:00:00Z', '2026-09-10T09:05:00Z')
    `).run();

    // 5. Query via adapter
    const allTasks = listUnifiedTasks(database);
    assert.ok(allTasks.items.length >= 3);
    assert.equal(allTasks.activeCount, 2); // job_text_1 is running, batch_media_1 is preparing (0 items)

    // Check media batch task
    const batchTask = allTasks.items.find((t) => t.taskId === 'batch_media_1');
    assert.ok(batchTask);
    assert.equal(batchTask.domain, 'activity_media_batch');
    assert.equal(batchTask.activityId, 'act_test_1');
    assert.ok(batchTask.title.includes('海边日落派对'));

    // Check text job task
    const textTask = allTasks.items.find((t) => t.taskId === 'job_text_1');
    assert.ok(textTask);
    assert.equal(textTask.domain, 'activity_text');
    assert.equal(textTask.displayState, 'running');
    assert.equal(textTask.capabilities.cancel, true);

    // Check topic collection task
    const topicTask = allTasks.items.find((t) => t.taskId === 'run_topic_1');
    assert.ok(topicTask);
    assert.equal(topicTask.domain, 'topic_collection');
    assert.equal(topicTask.displayState, 'succeeded');

    // 6. Test GET /api/v1/admin/tasks endpoint
    const resAll = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tasks',
      headers: adminHeaders,
    });
    assert.equal(resAll.statusCode, 200);
    const jsonAll = resAll.json();
    assert.equal(jsonAll.activeCount, 2);

    // 7. Filter active
    const resActive = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tasks?state=active',
      headers: adminHeaders,
    });
    assert.equal(resActive.statusCode, 200);
    const jsonActive = resActive.json();
    assert.ok(jsonActive.items.every((t: any) => t.displayState === 'running' || t.displayState === 'waiting' || t.displayState === 'preparing'));

    // 8. Filter recent
    const resRecent = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tasks?state=recent',
      headers: adminHeaders,
    });
    assert.equal(resRecent.statusCode, 200);
    const jsonRecent = resRecent.json();
    assert.ok(jsonRecent.items.some((t: any) => t.taskId === 'run_topic_1'));

    // 9. Cancel text task via API
    const cancelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tasks/activity_text/job_text_1/cancel',
      headers: adminHeaders,
    });
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.json().success, true);

    // Verify status was updated to cancelled
    const updatedJob = database.connection
      .prepare('SELECT status FROM activity_jobs WHERE id = ?')
      .get('job_text_1') as { status: string };
    assert.equal(updatedJob.status, 'cancelled');

    // Active count should now be 1
    const resAfterCancel = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tasks',
      headers: adminHeaders,
    });
    assert.equal(resAfterCancel.json().activeCount, 1);
  } finally {
    await app.close();
    database.close();
  }
});

test('tasks show research and planning sessions and require the admin credential', async () => {
  const { app, database } = await setup();
  try {
    const now = new Date().toISOString();
    database.connection.prepare('INSERT INTO activity_planning_sessions(id,form_json,created_at,updated_at) VALUES (?,?,?,?)')
      .run('session_test', JSON.stringify({ title: '生日企划' }), now, now);
    database.connection.prepare('INSERT INTO activity_planning_jobs(id,session_id,status,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('plan_test', 'session_test', 'result_unknown', 'test', now, now);
    database.connection.prepare('INSERT INTO planning_research_tasks(id,session_id,status,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('research_test', 'session_test', 'partial', now, now);
    const tasks = listUnifiedTasks(database).items;
    assert.equal(tasks.find(task => task.taskId === 'plan_test')?.displayState, 'needs_attention');
    assert.equal(tasks.find(task => task.taskId === 'research_test')?.displayState, 'partial');
    assert.match(tasks.find(task => task.taskId === 'plan_test')!.title, /生日企划/);
    assert.equal(tasks.find(task => task.taskId === 'research_test')!.targetUrl, '/apps/activities/new?session=session_test');
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks' });
    assert.equal(response.statusCode, 401);
  } finally { await app.close(); database.close(); }
});
