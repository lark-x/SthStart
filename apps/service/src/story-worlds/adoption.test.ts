import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WorldDefinition, WorldEvent } from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { ensureGenerationConsumerApps } from '../generation/consumers.js';
import { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldAdoptions } from './adoption.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

class MemorySecrets extends SecretStore {
  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }
  override async get() {
    return { value: 'test-secret', source: 'keyring' as const };
  }
}

function testDefinition(): WorldDefinition {
  return {
    title: '璃月夜泊',
    summary: '商船入港，夜色渐深。',
    timeLabel: '初更',
    locations: [
      { id: 'loc-port', name: '南十字船队泊位', description: '海风吹拂着巨大的龙骨木帆船。' },
      { id: 'loc-market', name: '绯云坡街市', description: '灯火通明的繁华商街。' },
    ],
    actors: [
      {
        id: 'actor-beidou',
        name: '北斗',
        role: 'main',
        characterId: null,
        characterVersion: null,
        background: '南十字船队船长。',
        personality: '豪迈不羁。',
        speechStyle: '干脆豪爽。',
        appearance: '红衣眼罩，气势十足。',
        goals: ['确保货物安全入港'],
        locationId: 'loc-port',
        referenceArtifactIds: [],
      },
      {
        id: 'actor-kazuha',
        name: '万叶',
        role: 'main',
        characterId: null,
        characterVersion: null,
        background: '来自稻妻的风行浪人。',
        personality: '淡然优雅。',
        speechStyle: '带诗意。',
        appearance: '红白相间的浪人服。',
        goals: ['游历四方'],
        locationId: 'loc-port',
        referenceArtifactIds: [],
      },
      {
        id: 'actor-dockhand',
        name: '码头工',
        role: 'supporting',
        characterId: null,
        characterVersion: null,
        background: '璃月码头装卸工。',
        personality: '踏实劳作。',
        speechStyle: '朴素。',
        appearance: '布衣草鞋。',
        goals: ['按时交工'],
        locationId: 'loc-port',
        referenceArtifactIds: [],
      },
    ],
    sources: [],
    lockedFacts: ['南十字船队刚从远洋归来。'],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '水墨写意',
  };
}

function makeEvent(
  worldId: string,
  branchId: string,
  id: string,
  tick: number,
  participants: string[],
  summary: string,
  perspectives: Array<{ actorId: string; text: string }> = [],
): WorldEvent {
  return {
    id,
    worldId,
    branchId,
    tick,
    duration: 0,
    title: `事件-${id}`,
    summary,
    locationId: 'loc-port',
    participantIds: participants,
    facts: [],
    perspectives,
    causeEventIds: [],
    storyLineIds: [],
    stateChanges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function setupFixture() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sthstart-adoption-test-'));
  const database = new ServiceDatabase(':memory:');
  for (const statement of STORY_WORLD_MIGRATION_STATEMENTS) {
    database.connection.exec(statement);
  }

  ensureGenerationConsumerApps(database);

  const config = readConfig({
    STHSTART_ADMIN_TOKEN: 'test-admin-token-0123456789abcdef-32chars',
    STHSTART_ARTIFACT_DIR: tmpDir,
  });
  const secrets = new MemorySecrets();
  const store = new StoryWorldStore(database);
  const storyStore = new StoryStore(database);
  const adoptions = new StoryWorldAdoptions({ database, config, secrets, store });

  const world = store.create(testDefinition());
  const branchA = store.createBranch(world.id, {
    title: '主线分支A',
    mode: 'canon-gap',
    direction: '原作留白',
    expectedRevision: world.revision,
  });

  const branchB = store.createBranch(world.id, {
    title: '改编分支B',
    mode: 'adaptation',
    direction: '改编分支',
    expectedRevision: world.revision,
  });

  // 创建正式创作项目
  const project = storyStore.createProject({
    title: '南十字远航日记',
    summary: '船队在提瓦特海域的传奇故事。',
  });

  return {
    tmpDir,
    database,
    config,
    secrets,
    store,
    storyStore,
    adoptions,
    world,
    branchA,
    branchB,
    project,
    cleanup: () => {
      database.close();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

test('项目采纳：按已选事件与特定视角形成新章节，且绝不覆盖用户已有正文', () => {
  const f = setupFixture();
  try {
    // 1. 用户先手写了一个已有的第一章正文
    const userChapter = f.storyStore.createDocument(f.project.id, {
      kind: 'chapter',
      title: '第一章：出航的清晨',
      body: '这是用户手工精心编写的原作正文，绝对不能被任何外部采纳操作覆盖。',
    });
    assert.equal(userChapter.revision, 1);

    // 2. 故事世界分支 A 中推进两个事件
    const event1 = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-dock-1',
      10,
      ['actor-beidou', 'actor-kazuha'],
      '死兆星号缓缓靠泊，水手们收缆系紧。',
      [
        { actorId: 'actor-beidou', text: '这次远航虽然波折，但兄弟们总算平平安安回到璃月了。' },
        { actorId: 'actor-kazuha', text: '海风拂过枫叶，故土的气息依稀可辨，四海漂泊者又踏上了坚实的大地。' },
      ],
    );

    const event2 = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-dock-2',
      20,
      ['actor-beidou', 'actor-kazuha'],
      '北斗与万叶在甲板交接航海图与通关文书。',
      [
        { actorId: 'actor-kazuha', text: '文书已核验完毕，接下来便在城中驻留数日吧。' },
      ],
    );

    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 20,
      events: [event1, event2],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branchANew = f.store.getBranch(f.world.id, f.branchA.id);

    // 3. 执行采纳：选择万叶（actor-kazuha）视角形成新章节
    const adoptionResult = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branchANew.revision,
      idempotencyKey: 'adopt-kazuha-view-1',
      projectId: f.project.id,
      eventIds: [event1.id, event2.id],
      actorId: 'actor-kazuha',
      title: '第二章：归港浪人的私语',
    });

    assert.equal(adoptionResult.projectId, f.project.id);
    assert.equal(adoptionResult.sourceBranchId, f.branchA.id);
    assert.equal(adoptionResult.sourceRevision, branchANew.revision);
    assert.ok(adoptionResult.documentId);

    // 4. 验证新创建的章节内容正确包含万叶视角文字
    const adoptedDoc = f.storyStore.getDocument(f.project.id, adoptionResult.documentId);
    assert.ok(adoptedDoc);
    assert.equal(adoptedDoc.title, '第二章：归港浪人的私语');
    assert.equal(adoptedDoc.kind, 'chapter');
    assert.match(adoptedDoc.body, /海风拂过枫叶/);
    assert.match(adoptedDoc.body, /文书已核验完毕/);
    assert.match(adoptedDoc.body, /采纳自故事世界/);

    // 5. 核心证明：用户已有正文绝不被覆盖或改动！
    const userDocAfter = f.storyStore.getDocument(f.project.id, userChapter.id);
    assert.ok(userDocAfter);
    assert.equal(userDocAfter.title, '第一章：出航的清晨');
    assert.equal(
      userDocAfter.body,
      '这是用户手工精心编写的原作正文，绝对不能被任何外部采纳操作覆盖。',
    );
    assert.equal(userDocAfter.revision, 1);

    // 验证大纲条目也完好无损
    const docs = f.storyStore.listDocuments(f.project.id);
    const outline = docs.find((d) => d.kind === 'outline');
    assert.ok(outline);
    assert.equal(outline.title, '主线大纲');

    // 6. 验证正式条目版本记录（story_entry_revisions）正常生成
    const revisions = f.storyStore.listEntryRevisions(f.project.id, 'chapter', adoptedDoc.id);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].revision, 1);
  } finally {
    f.cleanup();
  }
});

test('采纳幂等性：request hash 严格校验、同一 key 重放不受分支后续版本影响、不同 payload 拒绝', () => {
  const f = setupFixture();
  try {
    const event1 = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-idemp-1',
      10,
      ['actor-beidou'],
      '夜色下的泊位清点。',
    );
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 10,
      events: [event1],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);

    // 首次采纳
    const firstResult = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-adopt-same',
      projectId: f.project.id,
      eventIds: [event1.id],
      title: '初次采纳章节',
    });

    // 故意让分支版本演进（commitStep 使 branch.revision 递增）
    const event2 = makeEvent(f.world.id, f.branchA.id, 'evt-idemp-2', 15, ['actor-beidou'], '后续事件。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 15,
      events: [event2],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const advancedBranch = f.store.getBranch(f.world.id, f.branchA.id);
    assert.ok(advancedBranch.revision > branch.revision);

    // 相同幂等键再次重放：因为在版本校验之前执行重复识别，即使分支版本已推移，仍安全返回原结果！
    const repeatResult = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision, // 哪怕是旧 expectedRevision
      idempotencyKey: 'idemp-adopt-same',
      projectId: f.project.id,
      eventIds: [event1.id],
      title: '初次采纳章节',
    });

    assert.equal(repeatResult.documentId, firstResult.documentId);
    assert.equal(repeatResult.projectId, firstResult.projectId);

    // 验证项目中只增加了一章，没有重复创建文档
    const chapters = f.storyStore.listDocuments(f.project.id).filter((d) => d.kind === 'chapter');
    assert.equal(chapters.length, 1);

    // 使用相同幂等键但不同 payload (不同 title) 提交：必须抛出 409 幂等冲突
    assert.throws(
      () =>
        f.adoptions.adopt(f.world.id, f.branchA.id, {
          expectedRevision: advancedBranch.revision,
          idempotencyKey: 'idemp-adopt-same',
          projectId: f.project.id,
          eventIds: [event1.id],
          title: '试图改名的冲突标题',
        }),
      (err: unknown) =>
        err instanceof StoryWorldError && err.code === 'story_adoption_idempotency_conflict',
    );
  } finally {
    f.cleanup();
  }
});

test('幂等跨世界校验：同一幂等键禁止跨世界或跨分支复用返回缓存', () => {
  const f = setupFixture();
  try {
    const eventA = makeEvent(f.world.id, f.branchA.id, 'evt-cross-world-a', 10, ['actor-beidou'], '世界A的事件。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 10,
      events: [eventA],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branchA.revision,
      idempotencyKey: 'shared-cross-key',
      projectId: f.project.id,
      eventIds: [eventA.id],
      title: '世界A分支A采纳',
    });

    // 创建第二个独立世界 world2
    const world2 = f.store.create(testDefinition());
    const branch2 = f.store.createBranch(world2.id, {
      title: '世界2分支',
      mode: 'adaptation',
      direction: '分支2',
      expectedRevision: world2.revision,
    });
    const event2 = makeEvent(world2.id, branch2.id, 'evt-world2-1', 10, ['actor-beidou'], '世界2的事件。');
    f.store.commitStep(world2.id, branch2.id, branch2.revision, {
      tick: 10,
      events: [event2],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const freshBranch2 = f.store.getBranch(world2.id, branch2.id);

    // 在 world2 上尝试使用同一个 idempotencyKey：必须抛出 409 拒绝，严禁返回缓存
    assert.throws(
      () =>
        f.adoptions.adopt(world2.id, freshBranch2.id, {
          expectedRevision: freshBranch2.revision,
          idempotencyKey: 'shared-cross-key',
          projectId: f.project.id,
          eventIds: [event2.id],
          title: '世界2采纳',
        }),
      (err: unknown) =>
        err instanceof StoryWorldError && err.code === 'story_adoption_idempotency_conflict',
    );
  } finally {
    f.cleanup();
  }
});

test('重复 eventIds 去重：不产生重复正文段落', () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-dedup-1', 10, ['actor-beidou'], '死兆星号系缆。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 10,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    // 重复传入两次相同 eventId
    const res = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'adopt-dedup-event',
      projectId: f.project.id,
      eventIds: [event.id, event.id],
      title: '去重测试章节',
    });

    const doc = f.storyStore.getDocument(f.project.id, res.documentId);
    assert.ok(doc);
    // 标题段落 ### 事件-evt-dedup-1 应该只出现一次
    const occurrences = (doc.body.match(/### 事件-evt-dedup-1/g) || []).length;
    assert.equal(occurrences, 1);
  } finally {
    f.cleanup();
  }
});

test('视角约束：角色未出场事件不能强塞为个人旁白，直接拒绝', () => {
  const f = setupFixture();
  try {
    // 该事件仅有码头工参与，万叶并未在场
    const dockEvent = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-dockhand-only',
      12,
      ['actor-dockhand'],
      '码头工单独清点货箱。',
    );
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 12,
      events: [dockEvent],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);

    // 强行指定未出场的万叶作为该事件的视角角色：必须抛出 400 明确拒绝
    assert.throws(
      () =>
        f.adoptions.adopt(f.world.id, f.branchA.id, {
          expectedRevision: branch.revision,
          idempotencyKey: 'adopt-absent-actor',
          projectId: f.project.id,
          eventIds: [dockEvent.id],
          actorId: 'actor-kazuha',
          title: '万叶未出场章节',
        }),
      (err: unknown) =>
        err instanceof StoryWorldError &&
        err.code === 'story_actor_not_participant' &&
        err.statusCode === 400 &&
        err.message.includes('未参与事件'),
    );
  } finally {
    f.cleanup();
  }
});

test('跨分支隔离：不能跨分支采纳不存在的事件', () => {
  const f = setupFixture();
  try {
    const eventB = makeEvent(
      f.world.id,
      f.branchB.id,
      'evt-branch-b-1',
      15,
      ['actor-beidou'],
      '分支 B 的独有事件。',
    );
    f.store.commitStep(f.world.id, f.branchB.id, f.branchB.revision, {
      tick: 15,
      events: [eventB],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branchA = f.store.getBranch(f.world.id, f.branchA.id);

    // 在分支 A 上尝试采纳属于分支 B 的事件 ID
    assert.throws(
      () =>
        f.adoptions.adopt(f.world.id, f.branchA.id, {
          expectedRevision: branchA.revision,
          idempotencyKey: 'cross-branch-fail',
          projectId: f.project.id,
          eventIds: [eventB.id],
          title: '非法跨分支采纳',
        }),
      (err: unknown) =>
        err instanceof StoryWorldError && err.code === 'story_event_not_found',
    );
  } finally {
    f.cleanup();
  }
});

test('独立项目分支绑定 sw_project_bindings 与版本校验', () => {
  const f = setupFixture();
  try {
    // 1. 尝试以错误的分支版本绑定：必须抛出 409
    assert.throws(
      () => f.adoptions.bindProject(f.project.id, f.world.id, f.branchA.id, 999),
      (err: unknown) =>
        err instanceof StoryWorldError && err.code === 'story_branch_revision_conflict',
    );

    // 2. 正确版本绑定
    const binding = f.adoptions.bindProject(
      f.project.id,
      f.world.id,
      f.branchA.id,
      f.branchA.revision,
    );
    assert.equal(binding.projectId, f.project.id);
    assert.equal(binding.worldId, f.world.id);
    assert.equal(binding.branchId, f.branchA.id);
    assert.equal(binding.sourceRevision, f.branchA.revision);

    // 3. 读取绑定
    const retrieved = f.adoptions.getProjectBinding(f.project.id);
    assert.ok(retrieved);
    assert.equal(retrieved.projectId, f.project.id);
    assert.equal(retrieved.worldId, f.world.id);
    assert.equal(retrieved.branchId, f.branchA.id);
    assert.equal(retrieved.sourceRevision, f.branchA.revision);

    // 4. 执行一次采纳并验证历史
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-hist-1', 5, ['actor-beidou'], '商船靠港记事。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 5,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const res = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'adopt-hist-key',
      projectId: f.project.id,
      eventIds: [event.id],
      title: '历史记录测试章节',
    });

    // 查阅历史采纳记录
    const adoptionsList = f.adoptions.listProjectAdoptions(f.project.id);
    assert.equal(adoptionsList.length, 1);
    assert.equal(adoptionsList[0].documentId, res.documentId);
    assert.equal(adoptionsList[0].sourceBranchId, f.branchA.id);
    assert.deepEqual(adoptionsList[0].eventIds, [event.id]);
  } finally {
    f.cleanup();
  }
});

test('个人视角完整性约束：参与事件但缺少个人视角正文时明确拒绝采纳，杜绝回退全知概括泄露角色未知秘密；具备个人正文时正常采纳', () => {
  const f = setupFixture();
  try {
    // 1. 事件1：码头工虽在现场参与搬运，但全知概括中包含只有北斗知晓的秘密货物（神之眼夹层）；码头工缺少个人视角正文
    const secretEvent = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-secret-cargo',
      10,
      ['actor-beidou', 'actor-dockhand'],
      '北斗指挥搬运夹层藏有秘密神之眼的货物，码头工在旁协助搬运但对夹层内幕一无所知。',
      [
        { actorId: 'actor-beidou', text: '这批货底细特殊，绝不能让外人和普通工人看出端倪。' },
        // actor-dockhand 没有个人 perspective 正文
      ],
    );

    // 事件2：码头工参与且具有完整的个人视角正文
    const normalEvent = makeEvent(
      f.world.id,
      f.branchA.id,
      'evt-dockhand-view',
      20,
      ['actor-dockhand'],
      '码头工在泊位整理木箱。',
      [
        { actorId: 'actor-dockhand', text: '今天在泊位搬了整整一天货箱，肩膀酸痛，但好在拿到了工钱。' },
      ],
    );

    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 20,
      events: [secretEvent, normalEvent],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);

    // 2. 尝试以码头工视角采纳包含 secretEvent 的章节：
    // 码头工参与了该事件但缺少个人 perspective，若回退全知 summary 将泄露其不知情的秘密（夹层藏有神之眼）。
    // 必须抛出 400 明确拒绝，并提供可操作中文提示！
    assert.throws(
      () =>
        f.adoptions.adopt(f.world.id, f.branchA.id, {
          expectedRevision: branch.revision,
          idempotencyKey: 'adopt-secret-fail',
          projectId: f.project.id,
          eventIds: [secretEvent.id],
          actorId: 'actor-dockhand',
          title: '码头工不知情视角采纳尝试',
        }),
      (err: unknown) =>
        err instanceof StoryWorldError &&
        err.code === 'story_actor_perspective_missing' &&
        err.statusCode === 400 &&
        err.message.includes('缺少其个人视角正文') &&
        err.message.includes('可能泄露该角色不知情的事实') &&
        err.message.includes('请切换为客观视角采纳，或先为该角色补充个人视角正文后重试'),
    );

    // 3. 切换为客观/导演视角（不传 actorId）：正常采纳，不被主观视角缺失阻断
    const objResult = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'adopt-secret-objective',
      projectId: f.project.id,
      eventIds: [secretEvent.id],
      title: '客观视角下的秘密货物事件',
    });
    const objDoc = f.storyStore.getDocument(f.project.id, objResult.documentId);
    assert.ok(objDoc);
    assert.match(objDoc.body, /北斗指挥搬运夹层藏有秘密神之眼的货物/);
    assert.match(objDoc.body, /> \*\*北斗\*\*：这批货底细特殊/);

    // 4. 对具备个人正文的 normalEvent，使用码头工（actor-dockhand）视角正常采纳
    const dockhandResult = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'adopt-dockhand-normal',
      projectId: f.project.id,
      eventIds: [normalEvent.id],
      actorId: 'actor-dockhand',
      title: '码头工的辛劳一天',
    });
    const dockhandDoc = f.storyStore.getDocument(f.project.id, dockhandResult.documentId);
    assert.ok(dockhandDoc);
    assert.match(dockhandDoc.body, /今天在泊位搬了整整一天货箱，肩膀酸痛/);
    assert.doesNotMatch(dockhandDoc.body, /全知/);
    assert.doesNotMatch(dockhandDoc.body, /秘密神之眼/);
  } finally {
    f.cleanup();
  }
});

test('采纳标题与正文上限：新请求拒绝超过 120 字符标题和 100000 字符正文，且不写入章节', () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-limits-1', 10, ['actor-beidou'], '泊位清点。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 10,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const before = f.storyStore.listDocuments(f.project.id).length;

    assert.throws(
      () => f.adoptions.adopt(f.world.id, f.branchA.id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'adopt-title-too-long',
        projectId: f.project.id,
        eventIds: [event.id],
        title: '标'.repeat(121),
      }),
      (err: unknown) => err instanceof StoryWorldError
        && err.code === 'story_adoption_title_too_long'
        && err.statusCode === 400
        && err.message.includes('120'),
    );

    const oversizedEvents = Array.from({ length: 4 }, (_, index) => makeEvent(
      f.world.id,
      f.branchA.id,
      `evt-limits-${index + 2}`,
      20 + index,
      ['actor-beidou'],
      '长正文事件。',
      [{ actorId: 'actor-beidou', text: '长'.repeat(30_000) }],
    ));
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 23,
      events: oversizedEvents,
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const advanced = f.store.getBranch(f.world.id, f.branchA.id);

    assert.throws(
      () => f.adoptions.adopt(f.world.id, f.branchA.id, {
        expectedRevision: advanced.revision,
        idempotencyKey: 'adopt-body-too-large',
        projectId: f.project.id,
        eventIds: oversizedEvents.map((item) => item.id),
        title: '过长正文',
      }),
      (err: unknown) => err instanceof StoryWorldError
        && err.code === 'story_adoption_body_too_large'
        && err.statusCode === 400
        && err.message.includes('100000'),
    );

    assert.equal(f.storyStore.listDocuments(f.project.id).length, before);
    assert.equal(f.adoptions.listProjectAdoptions(f.project.id).length, 0);
  } finally {
    f.cleanup();
  }
});

test('采纳标题上限兼容旧幂等记录：已写入的 300 字符标题重放仍返回原章节', () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-legacy-title', 10, ['actor-beidou'], '旧标题记录。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 10,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const legacyTitle = '旧'.repeat(300);

    const inserted = f.storyStore.createDocument(f.project.id, {
      kind: 'chapter',
      title: legacyTitle,
      body: '旧记录正文。',
    });
    const requestHash = createHash('sha256').update(JSON.stringify({
      events: [event.id],
      actor: null,
      title: legacyTitle,
      project: f.project.id,
    })).digest('hex');
    f.database.connection.prepare(`
      INSERT INTO sw_adoptions (id, world_id, branch_id, project_id, idempotency_key, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-adoption-record',
      f.world.id,
      f.branchA.id,
      f.project.id,
      'legacy-title-key',
      JSON.stringify({
        id: 'legacy-adoption-record',
        worldId: f.world.id,
        branchId: f.branchA.id,
        projectId: f.project.id,
        documentId: inserted.id,
        sourceBranchId: f.branchA.id,
        sourceRevision: branch.revision,
        eventIds: [event.id],
        actorId: null,
        title: legacyTitle,
        requestHash,
        adoptedAt: '2026-01-01T00:00:00.000Z',
      }),
      '2026-01-01T00:00:00.000Z',
    );

    const replay = f.adoptions.adopt(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'legacy-title-key',
      projectId: f.project.id,
      eventIds: [event.id],
      title: legacyTitle,
    });
    assert.equal(replay.documentId, inserted.id);
  } finally {
    f.cleanup();
  }
});

test('项目绑定 CAS：显式 expectedBinding 只允许匹配当前绑定，旧调用不能改绑另一分支', () => {
  const f = setupFixture();
  try {
    const noBinding = f.adoptions.bindProject(
      f.project.id,
      f.world.id,
      f.branchA.id,
      f.branchA.revision,
      null,
    );
    assert.equal(noBinding.branchId, f.branchA.id);

    assert.throws(
      () => f.adoptions.bindProject(
        f.project.id,
        f.world.id,
        f.branchB.id,
        f.branchB.revision,
        null,
      ),
      (err: unknown) => err instanceof StoryWorldError
        && err.code === 'story_project_binding_conflict'
        && err.statusCode === 409,
    );

    const rebound = f.adoptions.bindProject(
      f.project.id,
      f.world.id,
      f.branchA.id,
      f.branchA.revision,
      noBinding,
    );
    assert.equal(rebound.sourceRevision, f.branchA.revision);

    const switched = f.adoptions.bindProject(
      f.project.id,
      f.world.id,
      f.branchB.id,
      f.branchB.revision,
      noBinding,
    );
    assert.equal(switched.branchId, f.branchB.id);

    assert.throws(
      () => f.adoptions.bindProject(
        f.project.id,
        f.world.id,
        f.branchA.id,
        f.branchA.revision,
        noBinding,
      ),
      (err: unknown) => err instanceof StoryWorldError
        && err.code === 'story_project_binding_conflict'
        && err.statusCode === 409,
    );

    assert.equal(f.adoptions.getProjectBinding(f.project.id)?.branchId, f.branchB.id);
  } finally {
    f.cleanup();
  }
});

test('旧绑定调用兼容：同分支更新修订允许，改绑另一分支被 409 拒绝', () => {
  const f = setupFixture();
  try {
    f.adoptions.bindProject(f.project.id, f.world.id, f.branchA.id, f.branchA.revision);

    const event = makeEvent(f.world.id, f.branchA.id, 'evt-bind-old', 5, ['actor-beidou'], '绑定后推进。');
    f.store.commitStep(f.world.id, f.branchA.id, f.branchA.revision, {
      tick: 5,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    const advanced = f.store.getBranch(f.world.id, f.branchA.id);

    const updated = f.adoptions.bindProject(f.project.id, f.world.id, f.branchA.id, advanced.revision);
    assert.equal(updated.sourceRevision, advanced.revision);

    assert.throws(
      () => f.adoptions.bindProject(f.project.id, f.world.id, f.branchB.id, f.branchB.revision),
      (err: unknown) => err instanceof StoryWorldError
        && err.code === 'story_project_binding_conflict'
        && err.statusCode === 409,
    );
    assert.equal(f.adoptions.getProjectBinding(f.project.id)?.branchId, f.branchA.id);
  } finally {
    f.cleanup();
  }
});
