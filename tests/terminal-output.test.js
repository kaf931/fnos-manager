import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputSink } from '../.web-test/terminal-output.js';
test('slow renderer output is bounded and ACK waits for consumption', () => {
  const pending = [],
    acks = [];
  let closed = 0;
  const sink = createOutputSink({
    limit: 8,
    write: (data, done) => pending.push({ data, done }),
    ack: (seq) => acks.push(seq),
    onOverflow: () => closed++,
  });
  sink.accept({ seq: 1, data: 'YWJjZA==' });
  assert.deepEqual(acks, []);
  pending.shift().done();
  assert.deepEqual(acks, [1]);
  sink.accept({ seq: 2, data: 'YWJjZA==' });
  sink.accept({ seq: 3, data: 'YWJjZA==' });
  sink.accept({ seq: 4, data: 'eA==' });
  assert.equal(closed, 1);
  assert.equal(pending.length, 2);
  pending[0].done();
  assert.deepEqual(acks, [1]);
});
test('renderer exceptions close rather than silently losing output', () => {
  let closed = 0;
  const sink = createOutputSink({
    write: () => {
      throw new Error('renderer unavailable');
    },
    ack: () => assert.fail('not consumed'),
    onOverflow: () => closed++,
  });
  sink.accept({ seq: 1, data: 'eA==' });
  assert.equal(closed, 1);
});
