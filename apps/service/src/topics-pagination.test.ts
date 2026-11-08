import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { TopicStore, type TopicUpsertInput } from './topics/store.js';

function topicInput(index: number): TopicUpsertInput {
  return {
    title: `Stable topic ${index}`,
    summary: `Stable pagination fixture ${index}`,
    works: ['Fixture'],
    characters: [],
    kind: 'meme',
    infoNature: 'community',
    adaptationTags: [],
    source: {
      sourceName: 'Fixture source',
      url: `https://fixture.test/topic-${index}`,
      documentLocator: `topic-${index}`,
      title: `Stable topic ${index}`,
      excerpt: `Fixture ${index}`,
    },
  };
}

test('topic pagination uses id as a stable tie-breaker for equal timestamps', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new TopicStore(database);
    for (let index = 0; index < 5; index += 1) store.upsertTopic(topicInput(index));
    const sameTime = '2026-11-08T12:00:00.000Z';
    database.connection.prepare('UPDATE topics SET last_seen_at=?, created_at=?').run(sameTime, sameTime);

    const all = store.listTopics({ days: 0, page: 1, pageSize: 20 });
    assert.equal(all.total, 5);
    const expected = all.items.map((topic) => topic.id).sort().reverse();
    assert.deepEqual(all.items.map((topic) => topic.id), expected);

    const paged: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const result = store.listTopics({ days: 0, page, pageSize: 1 });
      assert.equal(result.total, 5);
      assert.equal(result.items.length, 1);
      paged.push(result.items[0].id);
    }
    assert.deepEqual(paged, expected);
    assert.equal(new Set(paged).size, 5);
  } finally {
    database.close();
  }
});
