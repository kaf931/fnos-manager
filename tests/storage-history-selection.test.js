import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoryRecords } from '../.web-test/storage-history-selection.js';
test('history selection admits at most 200 distinct IDs and reports rejected additions', () => {
  const first = Array.from({ length: 195 }, (_, i) => 'first-' + i),
    next = Array.from({ length: 10 }, (_, i) => 'next-' + i);
  const result = selectHistoryRecords(first, { add: next });
  assert.equal(result.ids.length, 200);
  assert.equal(result.limited, true);
  assert.deepEqual(result.ids.slice(195), next.slice(0, 5));
  assert.deepEqual(first.length, 195);
  assert.deepEqual(selectHistoryRecords(result.ids, { add: ['extra'] }), {
    ids: result.ids,
    limited: true,
  });
});
test('duplicates do not consume capacity and removing a selected page preserves other pages', () => {
  const selected = Array.from({ length: 200 }, (_, i) => String(i));
  assert.deepEqual(selectHistoryRecords(selected, { add: ['0', '0'] }), {
    ids: selected,
    limited: false,
  });
  const removed = selectHistoryRecords(selected, { remove: ['0', '1', 'missing'] });
  assert.equal(removed.ids.length, 198);
  assert.equal(removed.limited, false);
  assert.equal(removed.ids[0], '2');
  const restored = selectHistoryRecords(removed.ids, { add: ['new', 'new', 'last'] });
  assert.equal(restored.ids.length, 200);
  assert.equal(restored.limited, false);
});
