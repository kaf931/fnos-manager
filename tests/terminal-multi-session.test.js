import { TerminalService as NestTerminalService } from '../server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalService } from '../server/terminal/transport.js';
import { appFixture } from './fixtures/terminal-app.js';
test('independent owned sessions enforce eight per owner and thirty two globally', async () => {
  const s = new TerminalService({ store: {} });
  try {
    const a = s.create('a', { id: 'a' }, 'https://nas'),
      b = s.create('a', { id: 'b' }, 'https://nas');
    assert.equal(s.activeFor('a').length, 2);
    assert.equal(s.usesConnection('a', 'b'), true);
    assert.throws(() => s.closeOwned('b', a.id));
    s.closeOwned('a', a.id);
    assert.equal(s.activeFor('a')[0].id, b.id);
    for (let i = 1; i < 8; i++) s.create('a', { id: 'a' }, 'https://nas');
    assert.throws(() => s.create('a', {}, 'https://nas'), { status: 409 });
    for (const owner of ['b', 'c', 'd'])
      for (let i = 0; i < 8; i++) s.create(owner, {}, 'https://nas');
    assert.throws(() => s.create('e', {}, 'https://nas'), { status: 503 });
  } finally {
    await s.close();
  }
});
test('editing and deleting connection used by second session is protected', async () => {
  const f = await appFixture();
  try {
    const body = { name: 'c', kind: 'local', username: 'tester' },
      a = await (await f.call('/connections', 'POST', body)).json(),
      b = await (await f.call('/connections', 'POST', body)).json();
    await f.call('/sessions', 'POST', { connectionId: a.id });
    const r = await f.call('/sessions', 'POST', { connectionId: b.id });
    assert.equal(r.status, 201);
    assert.equal((await f.call('/connections/' + b.id, 'PUT', body)).status, 409);
    assert.equal((await f.call('/connections/' + b.id, 'DELETE')).status, 409);
  } finally {
    await f.close();
  }
});
test('queued connection mutation and session creation serialize their snapshots', async () => {
  const f = await appFixture();
  try {
    const body = { name: 'before', kind: 'local', username: 'tester' },
      c = await (await f.call('/connections', 'POST', body)).json(),
      service = f.app.get(NestTerminalService).service,
      store = service.store;
    for (const method of ['PUT', 'DELETE']) {
      let release, queued;
      const original = store.transaction.bind(store);
      const held = original(() => new Promise((r) => (release = r)));
      await Promise.resolve();
      const enqueued = new Promise((r) => (queued = r));
      store.transaction = (fn) => {
        const result = original(fn);
        queued();
        return result;
      };
      const changed = f.call(
        '/connections/' + c.id,
        method,
        method === 'PUT' ? { ...body, name: 'after' } : undefined,
      );
      await enqueued;
      const created = f.call('/sessions', 'POST', { connectionId: c.id });
      setTimeout(release, 30);
      const [mutation, response] = await Promise.all([changed, created]);
      await held;
      if (response.status === 201) {
        const session = await response.json();
        assert.equal(
          service.sessions.get(session.id).connection.name,
          store.get('1000', c.id).name,
          'active connection snapshot must match saved config',
        );
        if (method === 'DELETE') assert.equal(mutation.status, 409);
        await f.call('/sessions/' + session.id, 'DELETE');
      } else assert.equal(response.status, 404);
      store.transaction = original;
    }
  } finally {
    await f.close();
  }
});
