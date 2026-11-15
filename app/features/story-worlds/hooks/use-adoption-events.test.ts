import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldEvent, WorldEventPage } from '@sthstart/contracts';
import {
  ADOPTION_EVENT_PAGE_SIZE,
  adoptionEventPagination,
  mergeAdoptionEventPages,
} from './use-adoption-events';

function page(items: WorldEvent[], nextCursor: string | null, total: number): WorldEventPage {
  return { items, nextCursor, total, from: 0, to: 100, buckets: [] };
}

function event(id: string, tick: number): WorldEvent {
  return {
    id,
    worldId: 'world-1',
    branchId: 'branch-1',
    tick,
    duration: 0,
    title: id,
    summary: '',
    locationId: 'loc-1',
    participantIds: ['actor-a'],
    facts: [],
    perspectives: [],
    causeEventIds: [],
    storyLineIds: [],
    stateChanges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('adoption pages merge in tick order and drop cursor overlap duplicates', () => {
  const merged = mergeAdoptionEventPages([
    page([event('evt-b', 20), event('evt-c', 30)], 'cursor-1', 4),
    page([event('evt-c', 30), event('evt-a', 10), event('evt-d', 40)], null, 4),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ['evt-a', 'evt-b', 'evt-c', 'evt-d']);
});

test('adoption pages tolerate missing data', () => {
  assert.deepEqual(mergeAdoptionEventPages(undefined), []);
  assert.deepEqual(mergeAdoptionEventPages([]), []);
});

test('pagination keeps every historical page beyond the old 1000-row ceiling', () => {
  const pages = Array.from({ length: 8 }, (_, index) => {
    const start = index * ADOPTION_EVENT_PAGE_SIZE;
    return page(
      Array.from({ length: ADOPTION_EVENT_PAGE_SIZE }, (__, offset) =>
        event(`evt-${start + offset}`, start + offset)),
      index < 7 ? `cursor-${index}` : null,
      1_600,
    );
  });
  const result = adoptionEventPagination(pages);
  assert.equal(result.events.length, 1_600);
  assert.equal(result.loadedCount, 1_600);
  assert.equal(result.total, 1_600);
  assert.equal(result.hasMore, false);
  assert.equal(result.events[0].id, 'evt-0');
  assert.equal(result.events.at(-1)?.id, 'evt-1599');
});

test('an unfinished historical range still reports more pages after 1000 rows', () => {
  const pages = Array.from({ length: 6 }, (_, index) => {
    const start = index * ADOPTION_EVENT_PAGE_SIZE;
    return page(
      Array.from({ length: ADOPTION_EVENT_PAGE_SIZE }, (__, offset) =>
        event(`evt-${start + offset}`, start + offset)),
      `cursor-${index}`,
      2_000,
    );
  });
  const result = adoptionEventPagination(pages);
  assert.equal(result.events.length, 1_200);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 2_000);
});
