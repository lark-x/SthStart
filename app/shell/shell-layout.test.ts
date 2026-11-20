import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveShellLayout } from './shell-layout';

function layout(pathname: string, query = '') {
  return resolveShellLayout({ pathname, searchParams: new URLSearchParams(query) });
}

test('pages that render WorkspaceHeader suppress the duplicate shell toolbar', () => {
  for (const pathname of [
    '/apps/story-worlds/world-1',
    '/apps/story/project-1',
    '/apps/notebook/note-1',
    '/apps/activities/activity-1',
  ]) {
    const resolved = layout(pathname);
    assert.equal(resolved.workspaceHeader, true, pathname);
    assert.equal(resolved.workspace, true, pathname);
    assert.equal(resolved.workspaceKind, 'editor', pathname);
  }
});

test('library and creation pages keep their own layout', () => {
  assert.deepEqual(layout('/'), {
    workspaceHeader: false,
    workspace: false,
    workspaceKind: 'library',
    embed: false,
  });
  assert.equal(layout('/apps/resources').workspaceKind, 'library');
  assert.equal(layout('/apps/notebook').workspaceKind, 'library');
  assert.equal(layout('/apps/creative').workspaceKind, 'creative');
  assert.equal(layout('/apps/activities/new').workspaceHeader, false);
  assert.equal(layout('/apps/story-worlds').workspace, false);
  assert.equal(layout('/apps/story-worlds', 'world=world-1').workspace, true);
  assert.equal(layout('/apps/notebook/offline').workspaceHeader, false);
  for (const pathname of ['/apps/story-worlds/new', '/apps/story-worlds/world-1/edit']) {
    assert.equal(layout(pathname).workspaceHeader, false, pathname);
    assert.equal(layout(pathname).workspace, false, pathname);
  }
});

test('narrative focus follows view and mode parameters', () => {
  assert.equal(layout('/apps/narrative').workspaceHeader, true);
  assert.equal(layout('/apps/narrative', 'view=review').workspaceHeader, true);
  assert.equal(layout('/apps/narrative', 'mode=research').workspaceHeader, false);
  assert.equal(layout('/apps/narrative', 'mode=import').workspaceHeader, false);
  assert.equal(layout('/apps/narrative', 'project=p1').workspaceHeader, false);
});

test('embed mode is limited to the linshe entry', () => {
  assert.equal(layout('/apps/linshe').embed, true);
  assert.equal(layout('/apps/linshe/nested').embed, true);
  assert.equal(layout('/apps/linshe-other').embed, false);
});
