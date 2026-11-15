import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldActor, WorldLocation, WorldEvent } from '@sthstart/contracts';
import type { ClusterNodeData } from './types';
import {
  computeActorLanes,
  buildTimelineMapping,
  clusterEventsInWindow,
  computeStoryFlowLayout,
  shouldIgnoreKeyboardShortcut,
  DEFAULT_LAYOUT_CONFIG,
} from './layout-engine';

describe('故事世界长卷纯算法布局测试 (StoryWorldFlow Pure Algorithm Tests)', () => {
  // 构造 12 名角色（按世界定义顺序排列）
  const mockActors: WorldActor[] = [
    {
      id: 'actor-jingyuan',
      name: '景元',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '罗浮云骑将军',
      personality: '深沉从容',
      speechStyle: '平稳威严',
      appearance: '白发长袍',
      goals: ['守护罗浮安定'],
      locationId: 'loc-seat',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-danheng',
      name: '丹恒',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '星穹列车护卫',
      personality: '冷静内敛',
      speechStyle: '简短克制',
      appearance: '黑发青衣',
      goals: ['记录开拓之旅'],
      locationId: 'loc-seat',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-march7',
      name: '三月七',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '星穹列车成员',
      personality: '活泼开朗',
      speechStyle: '明快热情',
      appearance: '粉发短裙',
      goals: ['拍照记录新风景'],
      locationId: 'loc-harbor',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-fuxuan',
      name: '符玄',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '太卜司太卜',
      personality: '自信严谨',
      speechStyle: '条理清晰',
      appearance: '粉紫华服',
      goals: ['推演罗浮未来'],
      locationId: 'loc-divination',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-blade',
      name: '刃',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '星核猎手成员',
      personality: '孤僻冷酷',
      speechStyle: '低沉沙哑',
      appearance: '青黑古剑客装',
      goals: ['追寻命运归宿'],
      locationId: 'loc-harbor',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-kafka',
      name: '卡芙卡',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '星核猎手核心',
      personality: '优雅神秘',
      speechStyle: '温和从容',
      appearance: '紫色风衣',
      goals: ['执行艾利欧剧本'],
      locationId: 'loc-harbor',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-tingyun',
      name: '停云',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '天舶司商团接渡使',
      personality: '八面玲珑',
      speechStyle: '婉转讨喜',
      appearance: '狐人商旅礼服',
      goals: ['撮合星际贸易'],
      locationId: 'loc-harbor',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-qingque',
      name: '青雀',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '太卜司卜算子',
      personality: '随性乐天',
      speechStyle: '轻松幽默',
      appearance: '浅绿制服',
      goals: ['按时下班摸鱼'],
      locationId: 'loc-divination',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-yukong',
      name: '驭空',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '天舶司司舵',
      personality: '干练果决',
      speechStyle: '沉着严肃',
      appearance: '狐人戎装',
      goals: ['调度仙舟航道'],
      locationId: 'loc-harbor',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-bailu',
      name: '白露',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '丹鼎司衔药龙女',
      personality: '活泼天真',
      speechStyle: '娇憨脆爽',
      appearance: '持明龙女装',
      goals: ['研究药膳与逃跑'],
      locationId: 'loc-clinic',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-yanqing',
      name: '彦卿',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '罗浮剑首骁骑',
      personality: '意气风发',
      speechStyle: '清亮纯粹',
      appearance: '云骑骁将轻甲',
      goals: ['磨砺至高剑道'],
      locationId: 'loc-seat',
      referenceArtifactIds: [],
    },
    {
      id: 'actor-luocha',
      name: '罗刹',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '异邦行商医者',
      personality: '温文尔雅',
      speechStyle: '谦逊客气',
      appearance: '背棺欧式礼服',
      goals: ['履行为逝者安魂的誓言'],
      locationId: 'loc-clinic',
      referenceArtifactIds: [],
    },
  ];

  const mockLocations: WorldLocation[] = [
    { id: 'loc-seat', name: '神策府', description: '将军议事重地' },
    { id: 'loc-harbor', name: '星槎海中枢', description: '繁华商埠航道' },
    { id: 'loc-divination', name: '太卜司', description: '推演大衍穷观阵' },
    { id: 'loc-clinic', name: '丹鼎司', description: '药房与疗愈圣所' },
  ];

  test('测试 1: 角色稳定轨道算法——严格遵循定义顺序与持久ID，重命名与追加不漂移', () => {
    const baseLanes = computeActorLanes(mockActors, DEFAULT_LAYOUT_CONFIG);
    assert.equal(baseLanes.length, 12, '12 个角色全部保留定义顺序轨道');

    // 验证轨道顺序严格与 mockActors 定义顺序一致
    for (let i = 0; i < mockActors.length; i++) {
      assert.equal(baseLanes[i].actor.id, mockActors[i].id);
      assert.equal(baseLanes[i].index, i);
      assert.equal(baseLanes[i].y, DEFAULT_LAYOUT_CONFIG.headerOffsetTop + i * DEFAULT_LAYOUT_CONFIG.laneHeight);
    }

    // 验证场景 A：角色重命名（例如将三月七重命名为“列车三月七”）
    const renamedActors = mockActors.map(a =>
      a.id === 'actor-march7' ? { ...a, name: '列车三月七' } : a
    );
    const renamedLanes = computeActorLanes(renamedActors, DEFAULT_LAYOUT_CONFIG);
    for (let i = 0; i < baseLanes.length; i++) {
      assert.equal(
        renamedLanes[i].y,
        baseLanes[i].y,
        '角色改名后，所有角色 Y 轴物理轨道位置保持 100% 恒定不变'
      );
      assert.equal(renamedLanes[i].index, baseLanes[i].index);
    }

    // 验证场景 B：新增配角（如在末尾新增阿兰）
    const appendedActors: WorldActor[] = [
      ...mockActors,
      {
        id: 'actor-arlan',
        name: '阿兰',
        role: 'supporting',
        characterId: null,
        characterVersion: null,
        background: '空间站防卫科负责人',
        personality: '少言寡语',
        speechStyle: '质朴沉稳',
        appearance: '短发干练装',
        goals: ['保护空间站'],
        locationId: 'loc-seat',
        referenceArtifactIds: [],
      },
    ];
    const appendedLanes = computeActorLanes(appendedActors, DEFAULT_LAYOUT_CONFIG);
    assert.equal(appendedLanes.length, 13);
    for (let i = 0; i < 12; i++) {
      assert.equal(
        appendedLanes[i].y,
        baseLanes[i].y,
        '追加新角色后，既有 12 个角色的 Y 轴轨道绝对不受干扰'
      );
    }
    assert.equal(appendedLanes[12].index, 12);
  });

  test('测试 2: 窗口前按真实物理时间前进，绝不虚假折叠未加载早期时段；支持 dataComplete 严格约束', () => {
    // 假设 API 当前仅下发了窗口 [400, 900] 内的事件：
    // 事件1: 400 ~ 430m
    // 事件2: 800 ~ 830m (已知连续事件之间空闲 370m > 120m 阈值)
    const windowLoadedEvents: WorldEvent[] = [
      {
        id: 'ev-w1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 400,
        duration: 30,
        title: '午后巡察',
        summary: '星槎海巡视',
        locationId: 'loc-harbor',
        participantIds: ['actor-tingyun'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T06:40:00Z',
      },
      {
        id: 'ev-w2',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 800,
        duration: 30,
        title: '入夜部署',
        summary: '神策府布防',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T13:20:00Z',
      },
    ];

    const { gaps, tickToX, xToTick } = buildTimelineMapping(
      windowLoadedEvents,
      1440,
      DEFAULT_LAYOUT_CONFIG,
      { from: 400, to: 900 }
    );

    // 1. 验证：绝不将 0 ~ 400m 误当作空白折叠！
    // 仅且只有 ev-w1 与 ev-w2 之间已确认的 370m 被标记为折叠
    assert.equal(gaps.length, 1, '仅检测出已知连续事件之间的真实空白');
    assert.equal(gaps[0].startTick, 430);
    assert.equal(gaps[0].endTick, 800);
    assert.equal(gaps[0].gapMinutes, 370);

    // 2. 验证：在第一个事件之前的时段（0 ~ 400m），坐标按真实物理时间严格线性扩展
    const x0 = tickToX(0);
    const x100 = tickToX(100);
    const x200 = tickToX(200);
    const x400 = tickToX(400);

    assert.equal(x0, DEFAULT_LAYOUT_CONFIG.leftMargin);
    assert.ok(Math.abs((x100 - x0) - 100 * DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01);
    assert.ok(Math.abs((x200 - x100) - 100 * DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01);
    assert.ok(Math.abs((x400 - x0) - 400 * DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01);

    // 3. 验证锚点稳定性：即使后续加载了更早的事件（如在 tick=100 加载了事件），
    // 原事件 ev-w1 处的 X 坐标保持严格一致，杜绝视口漂移反馈环！
    const prependedEvents: WorldEvent[] = [
      {
        id: 'ev-w0',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 100,
        duration: 30,
        title: '清晨早操',
        summary: '早操',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T01:40:00Z',
      },
      ...windowLoadedEvents,
    ];
    const prependedMapping = buildTimelineMapping(
      prependedEvents,
      1440,
      DEFAULT_LAYOUT_CONFIG,
      { from: 400, to: 900 }
    );
    const newX400 = prependedMapping.tickToX(400);
    assert.ok(
      Math.abs(newX400 - x400) < 0.01,
      `事件锚点稳定：更新早期数据后，原有 tick=400 的物理坐标完全不变 (前=${x400}, 后=${newX400})`
    );

    // 4. 验证 dataComplete=false 时绝对禁止折叠任何空白时段
    const incompleteMapping = buildTimelineMapping(
      windowLoadedEvents,
      1440,
      { ...DEFAULT_LAYOUT_CONFIG, dataComplete: false },
      { from: 400, to: 900 }
    );
    assert.equal(
      incompleteMapping.gaps.length,
      0,
      '当 dataComplete=false 时，未确认完整性的数据绝对不折叠空白，保持真实时间'
    );

    // 5. 验证严格双向单调可逆性
    for (const testTick of [0, 50, 100, 300, 400, 500, 800, 1000, 1440]) {
      const calcX = tickToX(testTick);
      const invertedTick = xToTick(calcX);
      assert.ok(Math.abs(invertedTick - testTick) < 0.01, `t=${testTick} 精准可逆还原`);
    }
  });

  test('测试 3: 共享事件交叉且「一份事实」拓扑无冗余 (Single Source of Truth Shared Events)', () => {
    const sharedEvent: WorldEvent = {
      id: 'shared-ev-meet',
      worldId: 'w-1',
      branchId: 'b-1',
      tick: 180,
      duration: 45,
      title: '星槎海会合',
      summary: '列车组与云骑将军商议建木异动对策',
      locationId: 'loc-harbor',
      participantIds: ['actor-jingyuan', 'actor-danheng', 'actor-march7'],
      facts: [
        {
          id: 'fact-1',
          content: '建木根系发生异变',
          knownBy: ['actor-jingyuan', 'actor-danheng', 'actor-march7'],
          nature: 'canon',
        },
      ],
      perspectives: [],
      causeEventIds: [],
      storyLineIds: [],
      stateChanges: [],
      createdAt: '2026-11-11T03:00:00Z',
    };

    const prevJingyuan: WorldEvent = {
      id: 'jy-prev',
      worldId: 'w-1',
      branchId: 'b-1',
      tick: 60,
      duration: 30,
      title: '神策府批复',
      summary: '批复公文',
      locationId: 'loc-seat',
      participantIds: ['actor-jingyuan'],
      facts: [],
      perspectives: [],
      causeEventIds: [],
      storyLineIds: [],
      stateChanges: [],
      createdAt: '2026-11-11T01:00:00Z',
    };
    const nextJingyuan: WorldEvent = {
      id: 'jy-next',
      worldId: 'w-1',
      branchId: 'b-1',
      tick: 300,
      duration: 30,
      title: '调遣阵前',
      summary: '部署云骑守备',
      locationId: 'loc-seat',
      participantIds: ['actor-jingyuan'],
      facts: [],
      perspectives: [],
      causeEventIds: [],
      storyLineIds: [],
      stateChanges: [],
      createdAt: '2026-11-11T05:00:00Z',
    };

    const prevMarch: WorldEvent = {
      id: 'march-prev',
      worldId: 'w-1',
      branchId: 'b-1',
      tick: 90,
      duration: 20,
      title: '品尝鸣藕糕',
      summary: '街头拍照',
      locationId: 'loc-harbor',
      participantIds: ['actor-march7'],
      facts: [],
      perspectives: [],
      causeEventIds: [],
      storyLineIds: [],
      stateChanges: [],
      createdAt: '2026-11-11T01:30:00Z',
    };

    const events = [prevJingyuan, prevMarch, sharedEvent, nextJingyuan];

    const result = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events,
      from: 0,
      to: 400,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: false },
    });

    // 1. 验证单一事实：共享事件仅且仅有 1 个 React Flow 节点
    const renderedSharedNodes = result.nodes.filter(n => n.id === sharedEvent.id);
    assert.equal(renderedSharedNodes.length, 1, '共享事件仅对应 1 个实体节点，绝无多角色冗余副本');

    // 2. 验证共享事件 Y 坐标位于 3 位参与角色轨道的均值质心
    const jyLane = result.actorLanes.find(l => l.actor.id === 'actor-jingyuan')!;
    const dhLane = result.actorLanes.find(l => l.actor.id === 'actor-danheng')!;
    const m7Lane = result.actorLanes.find(l => l.actor.id === 'actor-march7')!;
    const expectedAvgY = (jyLane.y + dhLane.y + m7Lane.y) / 3 - 40;
    assert.ok(
      Math.abs(renderedSharedNodes[0].position.y - expectedAvgY) < 30,
      '共享事件汇聚在参与角色轨道质心'
    );

    // 3. 验证多角色连线汇聚与延伸
    const jyEdges = result.edges.filter(e => e.data?.actorId === 'actor-jingyuan');
    assert.equal(jyEdges.length, 2);
    assert.equal(jyEdges[0].source, 'jy-prev');
    assert.equal(jyEdges[0].target, 'shared-ev-meet');
    assert.equal(jyEdges[1].source, 'shared-ev-meet');
    assert.equal(jyEdges[1].target, 'jy-next');
  });

  test('测试 4: 12角色 1,000事件纯算法数据切片与布局耗时测试 (Pure Algorithmic Slicing Benchmark)', () => {
    // 构造 1,000 个密集事件（分布在 0 ~ 2880 分钟内）
    const thousandEvents: WorldEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      const tick = Math.floor((i / 1000) * 2880);
      const actor1 = mockActors[i % 12].id;
      const actor2 = mockActors[(i + 3) % 12].id;
      const isShared = i % 4 === 0;

      thousandEvents.push({
        id: `bench-ev-${i}`,
        worldId: 'w-bench',
        branchId: 'b-bench',
        tick,
        duration: 15,
        title: `故事事件 ${i}`,
        summary: `事件 ${i} 正在发生`,
        locationId: mockLocations[i % mockLocations.length].id,
        participantIds: isShared ? [actor1, actor2] : [actor1],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }

    assert.equal(thousandEvents.length, 1000);

    // 纯算法视口切片测试（从 1000 个事件中切片 [360m, 600m]）
    const startTime = performance.now();
    const result = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: thousandEvents,
      from: 360,
      to: 600,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: false },
    });
    const durationMs = performance.now() - startTime;

    // 1. 验证纯算法耗时严格低于 20ms
    assert.ok(
      durationMs < 20,
      `纯算法数据切片与布局计算耗时 ${durationMs.toFixed(2)}ms (必须 < 20ms)`
    );

    // 2. 验证纯算法节点数量严格按视口及缓冲区切片，不输出 1000 个全量节点
    assert.ok(
      result.nodes.length < 200,
      `仅布局视口切片数据，节点数 (${result.nodes.length}) 严格受控 (远小于 1000)`
    );
    assert.ok(result.nodes.length > 0, '视口内切片包含有效事件');
  });

  test('测试 5: 多尺度聚合 LOD 纯算法测试——按人物轨道分布，杜绝聚集同一Y，保留真实事件可选', () => {
    // 构造测试数据：停云在该时段有 3 个密集事件，景元有 1 个独立事件
    const denseEvents: WorldEvent[] = [
      {
        id: 'dense-ty-1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 100,
        duration: 5,
        title: '商会交涉',
        summary: '星槎海商谈',
        locationId: 'loc-harbor',
        participantIds: ['actor-tingyun'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'dense-ty-2',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 110,
        duration: 5,
        title: '调配星槎',
        summary: '调度货运',
        locationId: 'loc-harbor',
        participantIds: ['actor-tingyun'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'dense-ty-3',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 120,
        duration: 5,
        title: '签署公文',
        summary: '天舶司核准',
        locationId: 'loc-harbor',
        participantIds: ['actor-tingyun'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'real-jy-1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 115,
        duration: 10,
        title: '神策府点兵',
        summary: '景元调派守卫',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
    ];

    // 全景模式（跨度 1440m >= 360m）：停云的 3 个事件聚合在其轨道上，景元的 1 个事件作为真实事件独立显示
    const overviewResult = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: denseEvents,
      from: 0,
      to: 1440,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: true, clusterThresholdSpan: 360 },
    });

    const clusterNodes = overviewResult.nodes.filter(n => n.type === 'cluster');
    const eventNodes = overviewResult.nodes.filter(n => n.type === 'event');

    // 1. 验证聚合节点数量与独立真实事件数量
    assert.equal(clusterNodes.length, 1, '停云的 3 个密集事件聚合成 1 个 ClusterNode');
    assert.equal(eventNodes.length, 1, '景元的独立事件保留为真实 EventNode，保证初始有事件可选！');

    // 2. 验证聚合节点放置在停云自身的轨道 Y 轴上，绝非挤在平均 Y 轴
    const tyLane = overviewResult.actorLanes.find(l => l.actor.id === 'actor-tingyun')!;
    const jyLane = overviewResult.actorLanes.find(l => l.actor.id === 'actor-jingyuan')!;

    assert.equal(
      clusterNodes[0].position.y,
      tyLane.y - 40,
      '停云聚合节点精准定位于停云专属轨道，杜绝全局平均挤压'
    );
    assert.equal(
      eventNodes[0].position.y,
      jyLane.y - 40,
      '景元实体节点精准定位于景元专属轨道'
    );

    // 局部细节模式（跨度 40m < 360m）：全部细化为独立 EventNode
    const detailResult = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: denseEvents,
      from: 90,
      to: 130,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: true, clusterThresholdSpan: 360 },
    });

    const detailEventNodes = detailResult.nodes.filter(n => n.type === 'event');
    assert.equal(detailEventNodes.length, 4, '细化视口下全部展开为 4 个独立事件实体卡片');
  });

  test('测试 6: 键盘无障碍守卫——严禁拦截输入框/文本域/contenteditable中用户的正常输入', () => {
    // 模拟不同 DOM 触发目标
    assert.equal(
      shouldIgnoreKeyboardShortcut({ tagName: 'INPUT' }),
      true,
      'input 输入框应被忽略，不触发流快捷键'
    );
    assert.equal(
      shouldIgnoreKeyboardShortcut({ tagName: 'TEXTAREA' }),
      true,
      'textarea 文本域应被忽略'
    );
    assert.equal(
      shouldIgnoreKeyboardShortcut({ tagName: 'SELECT' }),
      true,
      'select 下拉框应被忽略'
    );
    assert.equal(
      shouldIgnoreKeyboardShortcut({ isContentEditable: true }),
      true,
      'contenteditable 富文本编辑区应被忽略'
    );
    assert.equal(
      shouldIgnoreKeyboardShortcut({
        tagName: 'SPAN',
        closest: (sel: string) => (sel.includes('input') ? {} : null),
      }),
      true,
      '输入框内嵌套元素应被忽略'
    );
    assert.equal(
      shouldIgnoreKeyboardShortcut({ tagName: 'DIV', isContentEditable: false }),
      false,
      '普通画布 DIV 应正常放行快捷键响应'
    );
    assert.equal(shouldIgnoreKeyboardShortcut(null), false, '空目标正常放行');
  });

  test('测试 7: 共享事件多角色交织聚合按具体参与者分组，杜绝全部下坠挤入中心轨道 (Shared Clusters Decentralization)', () => {
    // 构造测试数据：
    // 头部轨道角色（景元、丹恒，第0、1轨道）有 3 个交织事件
    // 尾部轨道角色（白露、彦卿，第10、11轨道）有 3 个交织事件
    const sharedEvents: WorldEvent[] = [
      {
        id: 'top-meet-1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 100,
        duration: 5,
        title: '神策府对弈',
        summary: '复盘棋局',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan', 'actor-danheng'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'top-meet-2',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 110,
        duration: 5,
        title: '密卷研读',
        summary: '研读古籍',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan', 'actor-danheng'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'top-meet-3',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 120,
        duration: 5,
        title: '阵前叮嘱',
        summary: '嘱咐行程',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan', 'actor-danheng'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'bottom-meet-1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 102,
        duration: 5,
        title: '丹鼎司采药',
        summary: '采买药材',
        locationId: 'loc-clinic',
        participantIds: ['actor-bailu', 'actor-yanqing'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'bottom-meet-2',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 112,
        duration: 5,
        title: '剑术问诊',
        summary: '检查旧伤',
        locationId: 'loc-clinic',
        participantIds: ['actor-bailu', 'actor-yanqing'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'bottom-meet-3',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 122,
        duration: 5,
        title: '赠送糖人',
        summary: '集市休憩',
        locationId: 'loc-clinic',
        participantIds: ['actor-bailu', 'actor-yanqing'],
        facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-11-11T00:00:00Z',
      },
    ];

    const result = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: sharedEvents,
      from: 0,
      to: 1440,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: true, clusterThresholdSpan: 360 },
    });

    const clusters = result.nodes.filter(n => n.type === 'cluster');
    assert.equal(clusters.length, 2, '两组不同角色的交织事件各自形成独立的聚合簇');

    const jyLane = result.actorLanes.find(l => l.actor.id === 'actor-jingyuan')!;
    const dhLane = result.actorLanes.find(l => l.actor.id === 'actor-danheng')!;
    const blLane = result.actorLanes.find(l => l.actor.id === 'actor-bailu')!;
    const yqLane = result.actorLanes.find(l => l.actor.id === 'actor-yanqing')!;

    const topCluster = clusters.find(c => (c.data as ClusterNodeData).participants.some((p: any) => p.id === 'actor-jingyuan'))!;
    const bottomCluster = clusters.find(c => (c.data as ClusterNodeData).participants.some((p: any) => p.id === 'actor-bailu'))!;

    assert.ok(topCluster, '顶部角色交织聚合簇必须存在');
    assert.ok(bottomCluster, '底部角色交织聚合簇必须存在');

    const expectedTopY = (jyLane.y + dhLane.y) / 2 - 40;
    const expectedBottomY = (blLane.y + yqLane.y) / 2 - 40;

    assert.ok(
      Math.abs(topCluster.position.y - expectedTopY) < 30,
      `顶部聚合簇定位于顶部轨道质心 (实际: ${topCluster.position.y}, 期望: ${expectedTopY})`
    );
    assert.ok(
      Math.abs(bottomCluster.position.y - expectedBottomY) < 30,
      `底部聚合簇定位于底部轨道质心 (实际: ${bottomCluster.position.y}, 期望: ${expectedBottomY})`
    );

    // 核心断言：两簇 Y 轴距离必须大于 800px，绝对禁止混杂坍缩在中间 Y 均值 800 处
    const verticalDistance = Math.abs(bottomCluster.position.y - topCluster.position.y);
    assert.ok(
      verticalDistance > 800,
      `两组聚合簇垂直距离 ${verticalDistance}px 充分分开，彻底解决共享事件集中堆叠中间轨道问题`
    );
  });

  test('测试 8: 时间标尺像素密度与非重叠自适应算法 (Time Ruler Pixel Density Guard)', () => {
    // 纯算法模拟 TimeRuler 在不同视口缩放下的 step 与像素间距
    function computeTimeRulerStep(zoom: number, minPixelSpacing = 115, pixelsPerMinute = 2.8): number {
      const effectiveZoom = Math.max(0.1, zoom);
      const screenPxPerMinute = pixelsPerMinute * effectiveZoom;
      const minMinutes = minPixelSpacing / screenPxPerMinute;
      const canonicalSteps = [15, 30, 60, 120, 180, 240, 360, 720, 1440];
      for (const s of canonicalSteps) {
        if (s >= minMinutes) return s;
      }
      return 1440;
    }

    // 1. 低缩放 (zoom = 0.35, 全景模式)
    const lowZoomStep = computeTimeRulerStep(0.35);
    assert.ok(lowZoomStep >= 120, `在 0.35 缩放下步长至少为 120m (实际: ${lowZoomStep}m)，杜绝文字横向撞车`);
    const lowZoomPxDistance = lowZoomStep * 2.8 * 0.35;
    assert.ok(lowZoomPxDistance >= 115, `屏幕物理间距 ${lowZoomPxDistance.toFixed(1)}px 远大于标签文字宽度 (~75px)`);

    // 2. 初始推荐舒适视口 (zoom = 0.82)
    const initZoomStep = computeTimeRulerStep(0.82);
    assert.equal(initZoomStep, 60, `在 0.82 舒适视口下步长为标准 60m (1小时整)`);
    const initZoomPxDistance = initZoomStep * 2.8 * 0.82;
    assert.ok(initZoomPxDistance >= 115, `屏幕物理间距 ${initZoomPxDistance.toFixed(1)}px 保持充裕清晰留白`);

    // 3. 细节放大视口 (zoom = 1.5)
    const highZoomStep = computeTimeRulerStep(1.5);
    assert.equal(highZoomStep, 30, `在 1.5 放大细节下步长自动细化为 30m`);
    const highZoomPxDistance = highZoomStep * 2.8 * 1.5;
    assert.ok(highZoomPxDistance >= 115, `放大细节下标尺标签物理间距严格受控`);
  });

  test('测试 9: buildTimelineMapping 重叠长事件 running max end 算法测试——杜绝相邻短事件错误折叠进行中区间', () => {
    // 构造重叠长事件场景：
    // 事件1（长事件）：tick=100, duration=300（覆盖 100 ~ 400 分钟）
    // 事件2（短事件A）：tick=150, duration=10（覆盖 150 ~ 160 分钟）
    // 事件3（短事件B）：tick=320, duration=15（覆盖 320 ~ 335 分钟）
    // 事件4（后续事件）：tick=600, duration=30（覆盖 600 ~ 630 分钟）
    // 旧算法缺陷：事件2结束（160）到事件3开始（320）间隔 160m > 120m，会被错误识别为时间空白并折叠！
    // 导致事件1在 160~320 期间明明仍在进行，却被强行折叠坍缩。
    // 新 runningMaxEnd 算法：事件1结束时刻为 400，事件2/3期间 runningMaxEnd 均为 400，不会产生虚假空白；
    // 仅在 400 ~ 600 之间（空闲 200m > 120m）产生唯一合法折叠段。
    const overlappingEvents: WorldEvent[] = [
      {
        id: 'ev-long',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 100,
        duration: 300,
        title: '长篇战略部署',
        summary: '全军布防',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'ev-short-1',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 150,
        duration: 10,
        title: '紧急信报',
        summary: '信鸽传书',
        locationId: 'loc-seat',
        participantIds: ['actor-danheng'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'ev-short-2',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 320,
        duration: 15,
        title: '前线斥候回报',
        summary: '确认无误',
        locationId: 'loc-seat',
        participantIds: ['actor-yanqing'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
      {
        id: 'ev-after',
        worldId: 'w-1',
        branchId: 'b-1',
        tick: 600,
        duration: 30,
        title: '夜幕降临决战',
        summary: '决战时刻',
        locationId: 'loc-harbor',
        participantIds: ['actor-jingyuan', 'actor-danheng'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      },
    ];

    const mapping = buildTimelineMapping(
      overlappingEvents,
      1440,
      DEFAULT_LAYOUT_CONFIG,
      { from: 0, to: 1440 }
    );

    // 1. 验证：仅检测出 1 处真实空白（400 ~ 600m），绝不折叠 160 ~ 320m！
    assert.equal(mapping.gaps.length, 1, '仅检测出长事件结束后的唯一真实时间空白');
    assert.equal(mapping.gaps[0].startTick, 400, '空白起点严格为历史所有重叠事件的最晚结束时间 400');
    assert.equal(mapping.gaps[0].endTick, 600, '空白终点为下一事件起始时间 600');
    assert.equal(mapping.gaps[0].gapMinutes, 200);

    // 2. 验证：长事件进行中（100 ~ 400m）时间轴保持严格均匀真实物理时间展开，无任何折叠畸变
    const x100 = mapping.tickToX(100);
    const x160 = mapping.tickToX(160);
    const x320 = mapping.tickToX(320);
    const x400 = mapping.tickToX(400);

    const span1 = (x160 - x100) / (160 - 100);
    const span2 = (x320 - x160) / (320 - 160);
    const span3 = (x400 - x320) / (400 - 320);

    assert.ok(Math.abs(span1 - DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01);
    assert.ok(Math.abs(span2 - DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01, '160~320m 区间按真实物理时间流逝，未发生错误折叠');
    assert.ok(Math.abs(span3 - DEFAULT_LAYOUT_CONFIG.pixelsPerMinute) < 0.01);
  });

  test('测试 10: 12角色 1,000事件真实矩形边界碰撞与 0 遮挡几何断言测试 (Real Rectangular Pairwise Non-Overlap)', () => {
    // 构造 1,000 个密集且高度重叠事件（覆盖 12 角色，故意制造同 tick、相近 tick 并发）
    const thousandEvents: WorldEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      // 故意让每 3~5 个事件共享完全相同的 tick，制造剧烈碰撞场景
      const tick = Math.floor(i / 3) * 6; // 0, 0, 0, 6, 6, 6, 12, 12, 12...
      const actor1 = mockActors[i % 12].id;
      const actor2 = mockActors[(i + 1) % 12].id;
      const actor3 = mockActors[(i + 4) % 12].id;
      const participantIds = i % 5 === 0 ? [actor1, actor2, actor3] : i % 2 === 0 ? [actor1, actor2] : [actor1];

      thousandEvents.push({
        id: `bench-ev-${i}`,
        worldId: 'w-bench',
        branchId: 'b-bench',
        tick,
        duration: 10,
        title: `故事事件 ${i}`,
        summary: `事件 ${i} 正在发生于仙舟罗浮`,
        locationId: mockLocations[i % mockLocations.length].id,
        participantIds,
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }

    // 选定一个特定事件作为选中焦点
    const focusEventId = 'bench-ev-6'; // tick = 12

    // 1. 在精细模式 (enableClustering: false) 下切片视口 [0, 60] 进行真实排布
    const detailResult = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: thousandEvents,
      from: 0,
      to: 60,
      selectedEventId: focusEventId,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: false },
    });

    const renderedNodes = detailResult.nodes.filter(n => n.type === 'event');
    assert.ok(renderedNodes.length >= 20, `精细视口内渲染了 ${renderedNodes.length} 个事件卡片`);

    // 验证 A：选中事件绝对保留在理想 Y 轨道上，未被并发卡片挤走
    const focusNode = renderedNodes.find(n => n.id === focusEventId);
    assert.ok(focusNode, '选中焦点事件节点必须存在');
    const focusEvent = thousandEvents.find(e => e.id === focusEventId)!;
    let expectedFocusY = detailResult.actorLanes.find(l => l.actor.id === focusEvent.participantIds[0])!.y - 40;
    if (focusEvent.participantIds.length > 1) {
      const sum = focusEvent.participantIds.reduce((acc, id) => {
        const l = detailResult.actorLanes.find(lane => lane.actor.id === id);
        return acc + (l ? l.y : 0);
      }, 0);
      expectedFocusY = sum / focusEvent.participantIds.length - 40;
    }
    assert.equal(
      focusNode.position.y,
      expectedFocusY,
      '选中事件节点享有绝对最高优先级，严格驻留在其理想角色轨道上，不受其他并发卡片挤占'
    );

    // 验证 B：所有渲染卡片真实矩形两两绝不重叠 (Pairwise Non-Overlap Verification)
    // 实际 DOM 尺寸：EventNode width=230, height=116
    const renderedBoxes = renderedNodes.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: 230,
      height: 116,
    }));

    let overlapCount = 0;
    const overlappingPairs: string[] = [];

    for (let i = 0; i < renderedBoxes.length; i++) {
      for (let j = i + 1; j < renderedBoxes.length; j++) {
        const a = renderedBoxes[i];
        const b = renderedBoxes[j];

        // 真实几何相交判定 (Separating Axis Theorem for AABB)
        const isSeparated =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;

        if (!isSeparated) {
          overlapCount++;
          overlappingPairs.push(`[${a.id} vs ${b.id}] a=(${a.x},${a.y}) b=(${b.x},${b.y})`);
        }
      }
    }

    assert.equal(
      overlapCount,
      0,
      `真实矩形碰撞排布必须实现 0 重叠遮挡！实际重叠数: ${overlapCount}。重叠卡片对: ${overlappingPairs.slice(0, 5).join('; ')}`
    );

    // 2. 在全景聚合模式 (enableClustering: true) 下对 1000 个事件进行全景视口验证
    const overviewResult = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: thousandEvents,
      from: 0,
      to: 2000,
      selectedEventId: focusEventId,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: true },
    });

    const overviewVisualNodes = overviewResult.nodes.filter(n => n.type === 'event' || n.type === 'cluster');
    const overviewBoxes = overviewVisualNodes.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.type === 'event' ? 230 : 196,
      height: n.type === 'event' ? 116 : 92,
    }));

    let overviewOverlapCount = 0;
    for (let i = 0; i < overviewBoxes.length; i++) {
      for (let j = i + 1; j < overviewBoxes.length; j++) {
        const a = overviewBoxes[i];
        const b = overviewBoxes[j];
        const isSeparated =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        if (!isSeparated) {
          overviewOverlapCount++;
        }
      }
    }

    assert.equal(
      overviewOverlapCount,
      0,
      `聚合概览模式下所有聚合卡片与真实卡片亦必须严格 0 重叠遮挡 (检查了 ${overviewBoxes.length} 个可视卡片)`
    );
  });

  test('测试 11: 概览聚合模式角色轨迹拓扑连线验证 (Cluster Mode Trajectory Routing & Interweaving)', () => {
    // 构造跨度超过 360m 的事件流，产生多个聚合簇与独立事件
    const multiSpanEvents: WorldEvent[] = [];
    // 景元在 tick=100, 110, 120 (聚合簇A) 和 tick=400, 410, 420 (聚合簇B)
    for (let t = 100; t <= 120; t += 10) {
      multiSpanEvents.push({
        id: `jy-cluster-1-${t}`,
        worldId: 'w-1',
        branchId: 'b-1',
        tick: t,
        duration: 5,
        title: `神策府事件 ${t}`,
        summary: '处理罗浮军政',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }
    for (let t = 400; t <= 420; t += 10) {
      multiSpanEvents.push({
        id: `jy-cluster-2-${t}`,
        worldId: 'w-1',
        branchId: 'b-1',
        tick: t,
        duration: 5,
        title: `阵前巡查 ${t}`,
        summary: '视察阵地',
        locationId: 'loc-seat',
        participantIds: ['actor-jingyuan'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }

    // 丹恒在 tick=100, 110, 120 (聚合簇C) 与 tick=400, 410, 420 (聚合簇D)
    for (let t = 100; t <= 120; t += 10) {
      multiSpanEvents.push({
        id: `dh-cluster-1-${t}`,
        worldId: 'w-1',
        branchId: 'b-1',
        tick: t,
        duration: 5,
        title: '车厢整理',
        summary: '整理资料',
        locationId: 'loc-seat',
        participantIds: ['actor-danheng'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }
    for (let t = 400; t <= 420; t += 10) {
      multiSpanEvents.push({
        id: `dh-cluster-2-${t}`,
        worldId: 'w-1',
        branchId: 'b-1',
        tick: t,
        duration: 5,
        title: '击退虚卒',
        summary: '护卫列车',
        locationId: 'loc-seat',
        participantIds: ['actor-danheng'],
        facts: [],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-11T00:00:00Z',
      });
    }

    const result = computeStoryFlowLayout({
      actors: mockActors,
      locations: mockLocations,
      events: multiSpanEvents,
      from: 0,
      to: 600,
      onSelectEvent: () => {},
      onWindowChange: () => {},
      config: { enableClustering: true, clusterThresholdSpan: 300 },
    });

    const clusters = result.nodes.filter(n => n.type === 'cluster');
    assert.ok(clusters.length >= 2, '成功产生多个聚合簇');

    // 核心断言：聚合模式下必须依然生成角色轨迹连线，展现人物交织概览
    assert.ok(result.edges.length > 0, `聚合模式下连线数 (${result.edges.length}) 必须 > 0，杜绝概览缺乏交织轨迹`);

    const jyEdges = result.edges.filter(e => e.data?.actorId === 'actor-jingyuan');
    assert.ok(jyEdges.length >= 1, '景元在不同聚合簇之间有连续的命运连线');
    assert.ok(jyEdges[0].sourceHandle?.startsWith('actor-out-actor-jingyuan'), '输入输出 Handle 严格对应角色 ID');
    assert.ok(jyEdges[0].targetHandle?.startsWith('actor-in-actor-jingyuan'), '连线目标 Handle 严格对齐');

    const dhEdges = result.edges.filter(e => e.data?.actorId === 'actor-danheng');
    assert.ok(dhEdges.length >= 1, '丹恒在不同聚合簇之间同样具备清晰连线');
  });
});
