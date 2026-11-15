import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import type { StoryDocument, StoryProject } from '@sthstart/contracts';
import { StoryTreePanel } from './story-tree-panel';
import { StoryChapterPager } from './story-chapter-pager';
import { StoryEntryToolbar } from './story-entry-toolbar';
import { StoryEmptyState } from './story-empty-state';
import { StoryEntryNotices } from './story-entry-notices';

const render = (markup: React.ReactElement) => renderToStaticMarkup(
  <HeadlessMantineProvider>{markup}</HeadlessMantineProvider>,
);

const project: StoryProject = {
  id: 'p1', title: '潮汐', summary: '', revision: 2, projectType: 'fiction', workId: '原神',
  contextSettings: { contextWindow: 32768, outputTokens: 2048, compactThreshold: 0.7, retainTokens: 2048 },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const chapter = (id: string, title: string, position: number): StoryDocument => ({
  id, projectId: 'p1', kind: 'chapter', title, body: '正文', position, revision: 3,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

test('story tree keeps chapter, settings and project statistics labels', () => {
  const first = chapter('c1', '第一章', 0);
  const html = render(<StoryTreePanel
    project={project}
    isReflection={false}
    search=""
    onSearchChange={() => {}}
    searchLoading={false}
    searchResults={undefined}
    entries={[{ kind: 'document', item: first }]}
    chapters={[first]}
    filteredChapters={[first]}
    totalWords={2}
    bibleCount={0}
    bibleGroups={[]}
    outlineDoc={undefined}
    activeId="c1"
    castList={[]}
    navTab="chapters"
    onNavTabChange={() => {}}
    onChooseEntry={() => {}}
    onReorderChapter={() => {}}
    onCreate={() => {}}
    onOpenProjectSettings={() => {}}
    onOpenCharacterLibrary={() => {}}
  />);

  for (const label of ['章节目录 (1)', '设定集 (0)', '第 1 章 · 第一章', 'v3', '原神', '本地私密创作空间']) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /aria-current="true"/);
});

test('reflection tree keeps outline and essay wording', () => {
  const essay = chapter('c1', '随笔一', 0);
  const html = render(<StoryTreePanel
    project={{ ...project, projectType: 'reflection', workId: '思考' }}
    isReflection
    search=""
    onSearchChange={() => {}}
    searchLoading={false}
    searchResults={undefined}
    entries={[{ kind: 'document', item: essay }]}
    chapters={[essay]}
    filteredChapters={[essay]}
    totalWords={2}
    bibleCount={1}
    bibleGroups={[]}
    outlineDoc={undefined}
    activeId={undefined}
    castList={[]}
    navTab="chapters"
    onNavTabChange={() => {}}
    onChooseEntry={() => {}}
    onReorderChapter={() => {}}
    onCreate={() => {}}
    onOpenProjectSettings={() => {}}
    onOpenCharacterLibrary={() => {}}
  />);

  for (const label of ['思考纲要', '感想随笔 (1)', '第 1 篇 · 随笔一', '对话感想空间']) assert.ok(html.includes(label), label);
});

test('chapter pager exposes previous, next and next-chapter creation states', () => {
  const first = chapter('c1', '第一章', 0);
  const second = chapter('c2', '第二章', 1);
  const both = render(<StoryChapterPager position={1} charCount={2} previous={first} next={second} onSwitchChapter={() => {}} onCreateNextChapter={() => {}} />);
  assert.match(both, /上一章：第一章/);
  assert.match(both, /下一章：第二章/);
  assert.match(both, /第 2 章 · 2 字/);

  const create = render(<StoryChapterPager position={0} charCount={0} previous={null} next={null} onCreateNextChapter={() => {}} />);
  assert.match(create, /写下一章/);
  assert.ok(!create.includes('上一章：'));
  assert.ok(!create.includes('下一章：'));
});

test('editor toolbar keeps status, mode choices and disabled save state', () => {
  const narrative = render(<StoryEntryToolbar
    label="章节" revision={4} statusLabel="待保存" statusDanger={false} charCount={2000} readMinutes={5}
    mode="source" onModeChange={() => {}} isReflection={false} saveDisabled
    onSave={() => {}} theme="interface" onThemeChange={() => {}} font="serif" onFontChange={() => {}}
    indent2em onIndent2emChange={() => {}} canvasWidth="wide" onCanvasWidthChange={() => {}}
  />);
  for (const label of ['章节 · v4', '待保存', '2,000 字 · 5 分钟', '剧本流', '保存']) assert.ok(narrative.includes(label), label);
  assert.match(narrative, /<button[^>]*disabled=""[^>]*>.*?保存/);

  const reflection = render(<StoryEntryToolbar
    label="感想随笔" revision={1} statusLabel="已保存" statusDanger={false} charCount={0} readMinutes={1}
    mode="source" onModeChange={() => {}} isReflection saveDisabled={false}
    onSave={() => {}} theme="interface" onThemeChange={() => {}} font="serif" onFontChange={() => {}}
    indent2em onIndent2emChange={() => {}} canvasWidth="wide" onCanvasWidthChange={() => {}}
  />);
  assert.doesNotMatch(reflection, /剧本流/);
});

test('empty state keeps the fiction and reflection entry actions', () => {
  const fiction = render(<StoryEmptyState isReflection={false} onCreate={() => {}} onOpenAgent={() => {}} />);
  assert.match(fiction, /从纯文字小说正文开始创作/);
  assert.match(fiction, /创建项目大纲/);
  const reflection = render(<StoryEmptyState isReflection onCreate={() => {}} onOpenAgent={() => {}} />);
  assert.match(reflection, /开始记录对话感想与思考/);
  assert.match(reflection, /写下第一篇随笔/);
});

test('conflict and local-only notices keep explicit recovery actions', () => {
  const conflict = render(<StoryEntryNotices
    recoveryAvailable={false} onRecover={() => {}} onDiscard={() => {}}
    error="服务器内容已变化。" status="conflict" onRetry={() => {}}
    entry={chapter('c1', '第一章', 0)} body="本机正文"
    onCopyLocal={() => {}} onAcceptServer={() => {}} onOverwriteLocal={() => {}}
  />);
  for (const label of ['服务器与本机内容冲突', '复制本地文本', '丢弃本地，使用服务器版本', '确认用本地版本覆盖服务器']) {
    assert.ok(conflict.includes(label), label);
  }

  const offline = render(<StoryEntryNotices
    recoveryAvailable onRecover={() => {}} onDiscard={() => {}}
    error="服务器暂不可用。" status="local-only" onRetry={() => {}}
    entry={chapter('c1', '第一章', 0)} body="本机正文"
    onCopyLocal={() => {}} onAcceptServer={() => {}} onOverwriteLocal={() => {}}
  />);
  assert.match(offline, /恢复本机文本/);
  assert.match(offline, /重新保存/);
});
