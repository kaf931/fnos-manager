import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { TerminalTransfers } from '../.web-test/terminal-transfers.js';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
function props(requests) {
  return {
    api: (path) => {
      const request = { ...deferred(), path };
      requests.push(request);
      return request.promise;
    },
    open: true,
    onClose() {},
    onCount() {},
    target: null,
  };
}
const row = (name) => ({
  id: name,
  path: '/' + name,
  size: 10,
  transferred: 10,
  direction: 'upload',
  status: 'completed',
});
test('switching sessions starts a new transfer request and ignores old failure', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    options = props(requests);
  await ui.render(TerminalTransfers, {
    ...options,
    target: { id: 'old', generation: 1, connected: true },
  });
  await ui.render(TerminalTransfers, {
    ...options,
    target: { id: 'new', generation: 2, connected: true },
  });
  assert.equal(requests.length, 2);
  await act(async () => {
    requests[1].resolve({ items: [row('new.txt')] });
  });
  await act(() => requests[0].reject(Error('old closed')));
  assert.match(ui.document.body.textContent, /new.txt/);
  assert.doesNotMatch(ui.document.body.textContent, /无法读取/);
});
test('clearing selected session rejects late transfer failure and resets badge', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    counts = [],
    options = { ...props(requests), onCount: (value) => counts.push(value) };
  await ui.render(TerminalTransfers, {
    ...options,
    target: { id: 'old', generation: 1, connected: true },
  });
  await ui.render(TerminalTransfers, options);
  await act(() => requests[0].reject(Error('closed')));
  assert.match(ui.document.body.textContent, /暂无文件传输记录/);
  assert.doesNotMatch(ui.document.body.textContent, /无法读取/);
  assert.equal(counts.at(-1), 0);
});
test('hidden transfer panel continues polling records and shows current records on reopen', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    counts = [],
    options = {
      ...props(requests),
      onCount: (value) => counts.push(value),
      target: { id: 'one', generation: 1, connected: true },
    };
  await ui.render(TerminalTransfers, { ...options, open: false });
  assert.doesNotMatch(requests[0].path, /summary=/);
  await act(async () => {
    requests[0].resolve({ items: [row('visible.txt')] });
  });
  await ui.render(TerminalTransfers, options);
  assert.match(ui.document.querySelector('aside').textContent, /visible.txt/);
  assert.equal(ui.document.querySelector('aside').hidden, false);
  assert.equal(counts.at(-1), 0);
});
test('unmount rejects pending transfer records and callbacks', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    counts = [],
    options = {
      ...props(requests),
      onCount: (value) => counts.push(value),
      target: { id: 'one', generation: 1, connected: true },
    };
  await ui.render(TerminalTransfers, options);
  await ui.unmount();
  const before = counts.length;
  await act(() => requests[0].resolve({ items: [{ ...row('late'), status: 'running' }] }));
  assert.equal(counts.length, before);
  assert.equal(ui.document.querySelector('aside'), null);
});
test('successful refresh clears a transient read error', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    options = props(requests);
  await ui.render(TerminalTransfers, { ...options, target: { id: 'one', connected: true } });
  await act(async () => requests[0].reject(Error('offline')));
  assert.match(ui.document.body.textContent, /暂时无法读取传输记录/);
  await act(async () => ui.document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => requests[1].resolve({ items: [row('recovered.txt')] }));
  assert.match(ui.document.body.textContent, /recovered.txt/);
  assert.doesNotMatch(ui.document.body.textContent, /暂时无法读取传输记录/);
});
test('successful polling does not erase a failed cancel action', async (t) => {
  const ui = remoteFixture(t),
    requests = [],
    options = props(requests);
  await ui.render(TerminalTransfers, { ...options, target: { id: 'one', connected: true } });
  await act(async () =>
    requests[0].resolve({ items: [{ ...row('active.txt'), status: 'running' }] }),
  );
  await act(async () =>
    [...ui.document.querySelectorAll('button')].find((b) => b.textContent === '取消').click(),
  );
  await act(async () => requests[1].reject(Error('取消失败')));
  await act(async () => requests[2].resolve({ items: [row('active.txt')] }));
  assert.match(ui.document.body.textContent, /取消失败/);
});
