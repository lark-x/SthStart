import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderWithUi as renderToStaticMarkup } from '../../../lib/render-with-ui-test';
import type {
  WorldActor,
  WorldLocation,
  WorldEvent,
  WorldImage,
  WorldBranch,
} from '@sthstart/contracts';
import {
  WorldReader,
  WorldImageReader,
  WorldEventDetail,
  WorldBranchComparison,
  formatTick,
  formatDuration,
  groupImagesByEvent,
  groupImagesForEvents,
} from './index';

const mockActors: WorldActor[] = [
  {
    id: 'actor-nahida',
    name: '纳西妲',
    role: 'main',
    characterId: 'char-nahida',
    characterVersion: 1,
    background: '须弥草神，智慧之神',
    personality: '温和理性，富有洞察力',
    speechStyle: '比喻精妙，循循善诱',
    appearance: '娇小的少女形象，白色与浅绿色的神性服饰',
    goals: ['探寻世界树污染根源', '守护须弥学者与民众'],
    locationId: 'loc-sanctuary',
    referenceArtifactIds: ['art-nahida-1'],
  },
  {
    id: 'actor-wanderer',
    name: '流浪者',
    role: 'main',
    characterId: 'char-wanderer',
    characterVersion: 1,
    background: '曾经的愚人众第六席「散兵」',
    personality: '傲娇直接，警惕心强',
    speechStyle: '尖锐中带着别扭的关切',
    appearance: '深蓝短发，斗笠，深蓝短褂与枫叶纹饰',
    goals: ['偿还过往因果', '协助草神调查世界树异动'],
    locationId: 'loc-sanctuary',
    referenceArtifactIds: ['art-wanderer-1'],
  },
  {
    id: 'actor-tighnari',
    name: '提纳里',
    role: 'supporting',
    characterId: null,
    characterVersion: null,
    background: '道成林巡林官',
    personality: '严谨专注，热心负责',
    speechStyle: '学术口吻，直率提醒',
    appearance: '长耳巡林官制服',
    goals: ['清理死域', '保护化城郭安全'],
    locationId: 'loc-forest',
    referenceArtifactIds: [],
  },
];

const mockLocations: WorldLocation[] = [
  {
    id: 'loc-sanctuary',
    name: '净善宫',
    description: '位于须弥城最高处的智慧宫殿，柔和微光流转于叶片与虚空网格间。',
  },
  {
    id: 'loc-forest',
    name: '道成林',
    description: '巨木参天、藤蔓垂挂的雨林深处，空气弥漫着湿润水汽与草药香气。',
  },
];

const mockEvents: WorldEvent[] = [
  {
    id: 'event-001',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    tick: 480, // Day 1 08:00
    duration: 45,
    title: '净善宫的晨曦推演',
    summary: '纳西妲与流浪者在净善宫中讨论近日世界树边缘出现的脉冲。流浪者虽言语不耐，但仍主动提供了风眼探查的记录。',
    locationId: 'loc-sanctuary',
    participantIds: ['actor-nahida', 'actor-wanderer'],
    facts: [
      {
        id: 'fact-1',
        content: '世界树南侧分支出现微小地脉逆流，尚未波及普通植物。',
        knownBy: ['actor-nahida', 'actor-wanderer'],
        nature: 'canon',
      },
      {
        id: 'fact-2',
        content: '流浪者私下前往过阿如村边缘，未告知其他教令院学者。',
        knownBy: ['actor-wanderer'],
        nature: 'author',
      },
    ],
    perspectives: [
      {
        actorId: 'actor-nahida',
        text: '清晨的净善宫很安静。世界树的叶脉传来微弱的共鸣，如同风铃拂过细沙。他站在殿前，斗笠遮住了目光，但我能感受到他风核中流动的气息已经不再像从前那样暴烈。',
      },
      {
        actorId: 'actor-wanderer',
        text: '真是麻烦的事。世界树那种东西，坏了就坏了，何必每次都让我亲自跑一趟。但看着草神那副认真的模样，把查到的报告丢在石案上，似乎也费不了多少力气。',
      },
    ],
    causeEventIds: [],
    storyLineIds: ['line-main'],
    stateChanges: [
      {
        actorId: 'actor-wanderer',
        locationId: 'loc-sanctuary',
        emotion: '别扭但专注',
        goals: ['核查道成林地脉异常', '暗中防范愚人众斥候'],
        relationships: [
          {
            actorId: 'actor-nahida',
            description: '从警惕疏离逐渐转变为值得信任的引路人',
            sourceEventId: 'event-001',
          },
        ],
        updatedTick: 525,
      },
    ],
    createdAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'event-002',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    tick: 720, // Day 1 12:00
    duration: 60,
    title: '道成林树冠的会合',
    summary: '提纳里在巡林途中察觉到异常的风痕，流浪者从高空掠下，二人交换了关于死域瘤与地脉枝杈的最新观察。',
    locationId: 'loc-forest',
    participantIds: ['actor-wanderer', 'actor-tighnari'],
    facts: [
      {
        id: 'fact-3',
        content: '死域瘤中析出了带有微弱风元素的结晶残渣。',
        knownBy: ['actor-wanderer', 'actor-tighnari'],
        nature: 'ai',
      },
      {
        id: 'fact-4',
        content: '林中潜伏着来自至冬国的不明通信装置，尚待核实。',
        knownBy: ['actor-tighnari'],
        nature: 'unverified',
      },
    ],
    perspectives: [
      {
        actorId: 'actor-tighnari',
        text: '突然落下的风压吹乱了蘑菇孢子的样本。我抬头看见了那位神出鬼没的流浪学者。他的态度一如既往生硬，但递过来的结晶确实有极高的毒性预警价值。',
      },
    ],
    causeEventIds: ['event-001'],
    storyLineIds: ['line-main'],
    stateChanges: [
      {
        actorId: 'actor-tighnari',
        locationId: 'loc-forest',
        emotion: '严谨警惕',
        goals: ['加固化城郭哨站防线'],
        relationships: [
          {
            actorId: 'actor-wanderer',
            description: '认可其实力与情报准确性，但提醒其遵守巡林安全条例',
            sourceEventId: 'event-002',
          },
        ],
        updatedTick: 780,
      },
    ],
    createdAt: '2026-11-10T12:00:00.000Z',
  },
];

const mockImages: WorldImage[] = [
  {
    id: 'img-est-001',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    eventId: 'event-001',
    runId: 'run-1',
    phase: 'establishing',
    caption: '晨曦透入净善宫，微光投射在绿色巨型叶冠之下。',
    prompt: 'Sanctuary of Surasthana, soft emerald morning light streaming through giant organic leaf canopy, tranquil atmosphere, cinematic wide shot',
    negativePrompt: 'blurry, dark, low resolution',
    status: 'succeeded',
    generationTaskId: 'task-img-1',
    artifactId: 'art-001',
    imageUrl: 'https://images.example.com/sanctuary-morning.webp',
    error: '',
    referenceArtifactIds: ['art-nahida-1'],
    consistencyNote: '需保持净善宫草神发光纹路一致性',
    createdAt: '2026-11-10T08:10:00.000Z',
  },
  {
    id: 'img-act-001',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    eventId: 'event-001',
    runId: 'run-1',
    phase: 'action',
    caption: '流浪者向草神推过风眼卷轴，纳西妲目光沉静注视。',
    prompt: 'Wanderer handing ancient parchment to Nahida, dramatic character interaction, detailed expression, mid shot',
    negativePrompt: '',
    status: 'running',
    generationTaskId: 'task-img-2',
    artifactId: null,
    imageUrl: null,
    error: '',
    referenceArtifactIds: ['art-nahida-1', 'art-wanderer-1'],
    consistencyNote: '',
    createdAt: '2026-11-10T08:15:00.000Z',
  },
  {
    id: 'img-res-001',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    eventId: 'event-001',
    runId: null,
    phase: 'result',
    caption: '卷轴微光散开，两人达成共识，流浪者转身欲行。',
    prompt: 'Wanderer turning to leave, green light hovering, cinematic lighting',
    negativePrompt: '',
    status: 'planned',
    generationTaskId: null,
    artifactId: null,
    imageUrl: null,
    error: '',
    referenceArtifactIds: [],
    consistencyNote: '',
    createdAt: '2026-11-10T08:20:00.000Z',
  },
  {
    id: 'img-act-002',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    eventId: 'event-002',
    runId: 'run-2',
    phase: 'action',
    caption: '林间风与毒孢子发生剧烈对撞',
    prompt: 'wind slash cutting corrupted spores in forest, fast motion blur, action shot',
    negativePrompt: '',
    status: 'failed',
    generationTaskId: 'task-img-3',
    artifactId: null,
    imageUrl: null,
    error: 'ComfyUI node timeout after 120s: GPU memory limit exceeded',
    referenceArtifactIds: [],
    consistencyNote: '',
    createdAt: '2026-11-10T12:10:00.000Z',
  },
];

const mockBranchLeft: WorldBranch = {
  id: 'branch-canon-gap',
  worldId: 'world-sumeru',
  title: '世界树净化余波（原作留白）',
  mode: 'canon-gap',
  parentBranchId: null,
  forkTick: 0,
  currentTick: 1440,
  revision: 1,
  sourceRevision: 1,
  direction: '严格遵循原作正史设定，补全主线第三幕后流浪者与小草神在净善宫的日常磨合与调查。',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
};

const mockBranchRight: WorldBranch = {
  id: 'branch-alternate',
  worldId: 'world-sumeru',
  title: '散兵记忆封印（平行世界）',
  mode: 'alternate',
  parentBranchId: 'branch-canon-gap',
  forkTick: 480,
  currentTick: 1200,
  revision: 2,
  sourceRevision: 1,
  direction: '假设流浪者未曾找回神之心时期的全部痛苦记忆，作为纯粹的人偶在须弥重新生活。',
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
};

const mockRightEvents: WorldEvent[] = [
  mockEvents[0], // shared before fork
  {
    id: 'event-alt-002',
    worldId: 'world-sumeru',
    branchId: 'branch-alternate',
    tick: 720,
    duration: 30,
    title: '普斯帕咖啡馆的平静午后',
    summary: '未恢复痛苦记忆的人偶少年在须弥城咖啡馆尝试甜点，对世俗生活感到新奇和平静。',
    locationId: 'loc-sanctuary',
    participantIds: ['actor-wanderer'],
    facts: [
      {
        id: 'fact-alt-1',
        content: '人偶第一次品尝了枣椰蜜糖，表示甜味过重但并未排斥。',
        knownBy: ['actor-wanderer'],
        nature: 'ai',
      },
    ],
    perspectives: [
      {
        actorId: 'actor-wanderer',
        text: '街上的人们来来往往，吵闹却并不刺耳。手里的蜜糖很甜，我不明白人类为什么喜欢这种黏糊糊的东西，但也并不讨厌。',
      },
    ],
    causeEventIds: ['event-001'],
    storyLineIds: ['line-alt'],
    stateChanges: [
      {
        actorId: 'actor-wanderer',
        locationId: 'loc-sanctuary',
        emotion: '平静安宁',
        goals: ['熟悉须弥城平民的生活方式'],
        relationships: [],
        updatedTick: 750,
      },
    ],
    createdAt: '2026-11-10T12:30:00.000Z',
  },
];

const mockRightImages: WorldImage[] = [
  {
    id: 'img-right-001',
    worldId: 'world-sumeru',
    branchId: 'branch-alternate',
    eventId: 'event-alt-002',
    runId: null,
    phase: 'action',
    caption: '人偶少年端着咖啡杯注视窗外喧闹的集市。',
    prompt: 'young wanderer holding coffee cup at cafe window, gentle lighting, peaceful expression',
    negativePrompt: '',
    status: 'succeeded',
    generationTaskId: 'task-alt-1',
    artifactId: null,
    imageUrl: 'https://images.example.com/cafe-afternoon.webp',
    error: '',
    referenceArtifactIds: [],
    consistencyNote: '',
    createdAt: '2026-11-10T12:35:00.000Z',
  },
];

test('WorldReader defaults to one objective summary per event without appending private passages', () => {
  const html = renderToStaticMarkup(
    <WorldReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      selectedEventId="event-001"
      onSelectEvent={() => {}}
    />
  );

  // Checks event titles and location names
  assert.ok(html.includes('净善宫的晨曦推演'), 'Should render event-001 title');
  assert.ok(html.includes('道成林树冠的会合'), 'Should render event-002 title');
  assert.ok(html.includes('净善宫'), 'Should render location name');
  assert.ok(html.includes('纳西妲'), 'Should render participant actor name');
  assert.ok(html.includes('流浪者'), 'Should render participant actor name');

  // Checks that event titles are clickable buttons for direct access
  assert.ok(html.includes('点击查看事件详细档案'), 'Event title should be clickable');

  // Checks that clean human-readable time is rendered without repetitive tick minute stamps
  assert.ok(html.includes('第 1 天 08:00'), 'Should render clean time tick without (480m)');
  assert.ok(!html.includes('(480m)'), 'Should not contain redundant (480m)');

  for (const event of mockEvents) {
    assert.equal(html.split(event.summary).length - 1, 1, 'Objective summary appears once for ' + event.id);
    for (const passage of event.perspectives) assert.ok(!html.includes(passage.text), 'Private passage requires explicit selection');
  }
  assert.ok(html.includes('纳西妲视角'), 'Explicit personal perspective remains accessible');
  assert.ok(html.includes('流浪者视角'), 'Participant without a passage still has an explicit perspective button');

  // Checks that facts and state changes are collapsed by default for clean mobile/reading view
  assert.ok(html.includes('展开事实 (2)'), 'Should render collapsed facts trigger with count');
  assert.ok(html.includes('展开状态 (1)'), 'Should render collapsed states trigger with count');
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 4, 'Both facts/state sections start collapsed on both events');
  assert.ok(!html.includes(mockEvents[0].facts[0].content), 'Collapsed facts do not appear in the narrative');
  assert.ok(!html.includes(mockEvents[0].stateChanges[0].emotion), 'Collapsed state does not appear in the narrative');
});

test('actor filtering defaults to the selected personal record without objective or other actors prose', () => {
  const html = renderToStaticMarkup(<WorldReader events={mockEvents} actors={mockActors} locations={mockLocations} actorId="actor-nahida" />);
  assert.ok(html.includes(mockEvents[0].perspectives[0].text));
  assert.ok(!html.includes(mockEvents[0].summary));
  assert.ok(!html.includes(mockEvents[0].perspectives[1].text));
  assert.ok(html.replace(/<[^>]*>/g, '').includes('正在阅读「纳西妲」的个人视角记录'));
});

test('a participant without a passage stays in their own missing perspective until objective is explicitly selected', () => {
  const event = mockEvents[1];
  const html = renderToStaticMarkup(<WorldReader events={[event]} actors={mockActors} locations={mockLocations} actorId="actor-wanderer" />);
  assert.ok(html.includes('此事件尚未记录「流浪者」的个人视角。'));
  assert.ok(html.includes('切换为客观叙述'));
  assert.ok(!html.includes(event.summary), 'No objective fallback inside the personal slot');
  assert.ok(!html.includes(event.perspectives[0].text), 'No substitute from another actor');
  assert.ok(!html.includes('正在阅读「'), 'Missing prose is not attributed as an existing record');
  const personalButton = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(button => button.includes('流浪者视角'));
  assert.ok(personalButton); assert.ok(personalButton.includes('aria-pressed="true"'));
});

test('perspective buttons include the union of participants and recorded authors without duplicate entries', () => {
  const event: WorldEvent = { ...mockEvents[0], perspectives: [mockEvents[0].perspectives[0], mockEvents[1].perspectives[0]] };
  const html = renderToStaticMarkup(<WorldReader events={[event]} actors={mockActors} locations={mockLocations} />);
  for (const name of ['纳西妲', '流浪者', '提纳里']) assert.equal(html.split(name + '视角').length - 1, 1);
  const authorHtml = renderToStaticMarkup(<WorldReader events={[event]} actors={mockActors} locations={mockLocations} actorId="actor-tighnari" />);
  assert.ok(authorHtml.includes(mockEvents[1].perspectives[0].text), 'A recorded author remains accessible outside participantIds');
  assert.ok(!authorHtml.includes(event.summary));
});

test('a sleeping actor record is attributed as a personal perspective without forcing first-person prose', () => {
  const sleepingText = '纳西妲安静地睡着，这一小时仍未醒来。';
  const event: WorldEvent = { ...mockEvents[0], participantIds: ['actor-nahida'], perspectives: [{ actorId: 'actor-nahida', text: sleepingText }] };
  const html = renderToStaticMarkup(<WorldReader events={[event]} actors={mockActors} locations={mockLocations} actorId="actor-nahida" />);
  assert.ok(html.includes(sleepingText));
  assert.ok(html.replace(/<[^>]*>/g, '').includes('正在阅读「纳西妲」的个人视角记录'));
  assert.ok(!html.includes('第一人称')); assert.ok(!html.includes(event.summary));
});

test('Controlled actorId filtering in WorldReader dynamically filters events', () => {
  // 1. Filter by Nahida: Nahida participated in event 1 only, not event 2
  const nahidaHtml = renderToStaticMarkup(
    <WorldReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      actorId="actor-nahida"
    />
  );
  assert.ok(nahidaHtml.includes('净善宫的晨曦推演'), 'Nahida participated in event 1');
  assert.ok(!nahidaHtml.includes('道成林树冠的会合'), 'Nahida did not participate in event 2');

  // 2. Filter by Tighnari: Tighnari participated in event 2 only, not event 1
  const tighnariHtml = renderToStaticMarkup(
    <WorldReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      actorId="actor-tighnari"
    />
  );
  assert.ok(!tighnariHtml.includes('净善宫的晨曦推演'), 'Tighnari did not participate in event 1');
  assert.ok(tighnariHtml.includes('道成林树冠的会合'), 'Tighnari participated in event 2');

  // 3. Clear filter (actorId = undefined): both events must be visible
  const allHtml = renderToStaticMarkup(
    <WorldReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      actorId={undefined}
    />
  );
  assert.ok(allHtml.includes('净善宫的晨曦推演'), 'All filter includes event 1');
  assert.ok(allHtml.includes('道成林树冠的会合'), 'All filter includes event 2');
});

test('Controlled actorId filtering in WorldImageReader dynamically filters visual scenes', () => {
  // Nahida filter: only event 1 is rendered
  const nahidaHtml = renderToStaticMarkup(
    <WorldImageReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      actorId="actor-nahida"
    />
  );
  assert.ok(nahidaHtml.includes('净善宫的晨曦推演'), 'Event 1 scene rendered for Nahida');
  assert.ok(!nahidaHtml.includes('道成林树冠的会合'), 'Event 2 scene excluded for Nahida');

  // Tighnari filter: only event 2 is rendered
  const tighnariHtml = renderToStaticMarkup(
    <WorldImageReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      actorId="actor-tighnari"
    />
  );
  assert.ok(!tighnariHtml.includes('净善宫的晨曦推演'), 'Event 1 scene excluded for Tighnari');
  assert.ok(tighnariHtml.includes('道成林树冠的会合'), 'Event 2 scene rendered for Tighnari');
});

test('groupImagesByEvent and groupImagesForEvents strictly reject mismatched branch images', () => {
  const mismatchedImage: WorldImage = {
    id: 'img-wrong-branch',
    worldId: 'world-sumeru',
    branchId: 'branch-alternate', // Mismatched branch!
    eventId: 'event-001',         // Same eventId
    runId: null,
    phase: 'action',
    caption: '错误分支的画面',
    prompt: 'an image from another branch',
    negativePrompt: '',
    status: 'succeeded',
    generationTaskId: null,
    artifactId: null,
    imageUrl: 'https://images.example.com/wrong.webp',
    error: '',
    referenceArtifactIds: [],
    consistencyNote: '',
    createdAt: '2026-11-10T08:00:00.000Z',
  };

  const imagesWithMismatched = [...mockImages, mismatchedImage];

  // 1. Test groupImagesForEvents: event-001 belongs to branch-canon-gap
  const groupedForEvents = groupImagesForEvents(imagesWithMismatched, mockEvents);
  const event1Images = groupedForEvents.get('event-001') || [];
  assert.ok(
    !event1Images.some(img => img.id === 'img-wrong-branch'),
    'groupImagesForEvents must reject images from a mismatched branchId'
  );
  assert.ok(
    event1Images.some(img => img.id === 'img-est-001'),
    'Valid matching branch image must be kept'
  );

  // 2. Test groupImagesByEvent with targetBranchId filter
  const groupedByBranch = groupImagesByEvent(imagesWithMismatched, 'branch-canon-gap');
  const branch1Images = groupedByBranch.get('event-001') || [];
  assert.ok(
    !branch1Images.some(img => img.id === 'img-wrong-branch'),
    'groupImagesByEvent with targetBranchId must reject mismatched branchId'
  );
  assert.equal(branch1Images.length, 3, 'Should only contain the 3 valid canon-gap images');
});

test('WorldImageReader renders 3 phases and displays statuses truthfully without raw prompt dump', () => {
  const html = renderToStaticMarkup(
    <WorldImageReader
      events={mockEvents}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      onSelectEvent={() => {}}
    />
  );

  // Checks 3 phases labels
  assert.ok(html.includes('场景建立'), 'Must render establishing phase');
  assert.ok(html.includes('关键行动'), 'Must render action phase');
  assert.ok(html.includes('结果变化'), 'Must render result phase');

  // Checks truthful statuses
  assert.ok(html.includes('已生成'), 'Must display succeeded status');
  assert.ok(html.includes('生成中'), 'Must display running status');
  assert.ok(html.includes('未生成'), 'Must display planned status');
  assert.ok(html.includes('生成失败'), 'Must display failed status truthfully');

  // Card view displays user-facing caption, not raw prompt dump
  assert.ok(html.includes('晨曦透入净善宫'), 'Card must display user-facing caption');
});

test('WorldEventDetail renders in-depth event data, cognitive boundaries, and folds technical configs', () => {
  const html = renderToStaticMarkup(
    <WorldEventDetail
      event={mockEvents[0]}
      actors={mockActors}
      locations={mockLocations}
      images={mockImages}
      onClose={() => {}}
      onSelectEvent={() => {}}
    />
  );

  assert.ok(html.includes('净善宫的晨曦推演'), 'Should render event title');
  assert.ok(html.includes('世界树南侧分支出现微小地脉逆流'), 'Should render fact content');
  assert.ok(html.includes('已知晓角色'), 'Should render knownBy boundary');
  assert.ok(html.includes('在场但被隐瞒/未察觉'), 'Should detect information asymmetry');
  assert.ok(html.includes('别扭但专注'), 'Should render emotion change');
  assert.ok(html.includes('记忆来源：事件 #event-001'), 'Should trace relationship update memory source');

  // Technical configuration must be folded under details
  assert.ok(html.includes('高级生成参数与提示词'), 'Technical prompt config must be folded');
});

test('WorldBranchComparison supports per-branch actors & locations override while retaining compatibility', () => {
  // Diverged actor specifically for left branch
  const divergedNahida: WorldActor = {
    ...mockActors[0],
    personality: '严苛冷峻的决断者',
  };

  const html = renderToStaticMarkup(
    <WorldBranchComparison
      left={{
        branch: mockBranchLeft,
        events: mockEvents,
        images: mockImages,
        actors: [divergedNahida, mockActors[1]], // Overridden actors on left
      }}
      right={{
        branch: mockBranchRight,
        events: mockRightEvents,
        images: mockRightImages,
      }}
      actors={mockActors} // Common fallback actors
      locations={mockLocations}
      onSelectEvent={() => {}}
    />
  );

  // Checks branch titles and mode badges
  assert.ok(html.includes('世界树净化余波（原作留白）'), 'Should render left branch title');
  assert.ok(html.includes('散兵记忆封印（平行世界）'), 'Should render right branch title');
  assert.ok(html.includes('原作留白'), 'Should render canon-gap badge');
  assert.ok(html.includes('平行世界'), 'Should render alternate badge');

  // Checks fork tick marker
  assert.ok(html.includes('分歧起点时刻'), 'Should display fork tick header');

  // Verifies that right-branch exclusive image is rendered in right branch
  assert.ok(html.includes('人偶少年端着咖啡杯'), 'Right branch exclusive caption rendered');
});

test('reading utilities format ticks and durations correctly', () => {
  assert.equal(formatTick(0), '第 1 天 00:00');
  assert.equal(formatTick(480), '第 1 天 08:00');
  assert.equal(formatTick(1440), '第 2 天 00:00');
  assert.equal(formatTick(1500), '第 2 天 01:00');

  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(45), '45 分钟');
  assert.equal(formatDuration(60), '1 小时');
  assert.equal(formatDuration(90), '1 小时 30 分钟');
});

test('WorldReader gracefully handles events without perspectives or missing actors', () => {
  const orphanEvent: WorldEvent = {
    id: 'event-orphan',
    worldId: 'world-sumeru',
    branchId: 'branch-canon-gap',
    tick: 900,
    duration: 30,
    title: '荒废古迹的无名低语',
    summary: '狂风吹过残垣断壁，遗迹深处未留存任何目击者的主观回忆。',
    locationId: 'loc-nonexistent',
    participantIds: ['actor-nonexistent'],
    facts: [],
    perspectives: [],
    causeEventIds: [],
    storyLineIds: [],
    stateChanges: [],
    createdAt: '2026-11-10T15:00:00.000Z',
  };

  const html = renderToStaticMarkup(
    <WorldReader
      events={[orphanEvent]}
      actors={mockActors}
      locations={mockLocations}
    />
  );

  assert.ok(html.includes('荒废古迹的无名低语'), 'Should render title');
  assert.ok(html.includes('狂风吹过残垣断壁'), 'Should fallback to summary when no perspectives exist');
  assert.ok(html.includes('地点 loc-no'), 'Should handle missing location fallback');
  assert.ok(html.includes('角色 actor-'), 'Should handle missing actor fallback');
});
