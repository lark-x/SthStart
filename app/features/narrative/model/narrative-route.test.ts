import assert from 'node:assert/strict';
import test from 'node:test';
import { narrativeModeFromParams, narrativeReadingHref, nextNarrativeReadingHref } from './narrative-route';

test('narrative mode is restored from an explicit tab or a research project link', () => {
  assert.equal(narrativeModeFromParams(new URLSearchParams('')), 'read');
  assert.equal(narrativeModeFromParams(new URLSearchParams('mode=import')), 'import');
  assert.equal(narrativeModeFromParams(new URLSearchParams('mode=research')), 'research');
  assert.equal(narrativeModeFromParams(new URLSearchParams('project=p1')), 'research');
});

test('reading position updates in place without changing the selected tab', () => {
  const current = '/apps/narrative?work=w1&node=n1&mode=import#shell-content';
  const next = narrativeReadingHref(current, 'w2', 'n2');
  assert.equal(next, '/apps/narrative?work=w2&node=n2&mode=import#shell-content');
  assert.equal(narrativeModeFromParams(new URLSearchParams(next.split('?')[1]!.split('#')[0])), 'import');
  assert.equal(narrativeReadingHref('/apps/narrative?work=w1&node=n1', 'w1', ''), '/apps/narrative?work=w1');
});

test('a delayed reading update cannot override the mode selected after it was scheduled', () => {
  const beforeClick = '/apps/narrative?work=w1&node=n1';
  const scheduled = { mode: 'read' as const, worksLoading: false, treeLoading: false, workId: 'w1' };
  const apply = (currentHref: string, intendedMode: 'read' | 'import') => nextNarrativeReadingHref({
    ...scheduled, currentHref, nodeId: 'n2', intendedMode,
  });
  assert.equal(apply(beforeClick, 'read'), '/apps/narrative?work=w1&node=n2');
  // Simulate the click happening while the scheduled replace is still pending.
  assert.equal(apply(beforeClick, 'import'), null);
  // Once the import URL is committed, the stale read render is blocked as well.
  assert.equal(apply('/apps/narrative?mode=import', 'import'), null);
  // Back to the read history entry restores the reading-position writer.
  assert.equal(apply(beforeClick, 'read'), '/apps/narrative?work=w1&node=n2');
  assert.equal(narrativeModeFromParams(new URLSearchParams(beforeClick.split('?')[1])), 'read');
});

test('import click wins over a pending reading replace and Back restores the read entry', () => {
  const readHref = '/apps/narrative?work=w1&node=n1#shell-content';
  const history = [readHref];
  let currentMode: 'read' | 'import' = 'read';

  // Capture the default reading sync, then let the user select import first.
  const delayedReadingWrite = () => nextNarrativeReadingHref({
    currentHref: history.at(-1)!,
    workId: 'w1', nodeId: 'n2', mode: 'read', intendedMode: currentMode,
    worksLoading: false, treeLoading: false,
  });
  currentMode = 'import';
  const importHref = '/apps/narrative?mode=import';
  history.push(importHref);

  assert.equal(delayedReadingWrite(), null);
  assert.equal(history.at(-1), importHref);
  assert.equal(narrativeModeFromParams(new URLSearchParams(history.at(-1)!.split('?')[1])), 'import');

  history.pop();
  currentMode = 'read';
  assert.equal(history.at(-1), readHref);
  assert.equal(narrativeModeFromParams(new URLSearchParams(history.at(-1)!.split('?')[1]!.split('#')[0])), 'read');
});
