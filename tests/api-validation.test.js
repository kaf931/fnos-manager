import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('unknown exceptions return 500 without exposing internal details', async () => {
  const { errorResponse } = await import('../server/app/common/errors.js');
  assert.deepEqual(errorResponse(new Error('password=secret /root/private-key')), {
    status: 500,
    error: '服务内部错误，请稍后重试',
  });
});
test('scan result API paginates in SQL, validates query values and isolates owners', async () => {
  const f = await appFixture();
  try {
    const { StorageService } = await import('../server/index.js');
    const repo = f.app.get(StorageService).service.repository;
    await repo.save({
      id: 'scan-api',
      owner: '1000',
      mode: 'space',
      path: '/vol1/data',
      status: 'completed',
      result: {
        catalog: Array.from({ length: 15 }, (_, i) => ({
          name: 'f' + i,
          path: '/vol1/data/f' + i,
          size: i,
          modifiedAt: i,
        })),
        largestFiles: [],
        entries: [],
        extensions: [],
        groups: [],
      },
    });
    const response = await fetch(
      f.base + '/storage/scans/scan-api/entries?page=2&pageSize=5&sort=size&direction=desc',
      { headers: f.headers },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 15);
    assert.equal(result.items.length, 5);
    assert.equal(result.items[0].size, 9);
    assert.equal(
      (await fetch(f.base + '/storage/scans/scan-api/entries?page=0', { headers: f.headers }))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(f.base + '/storage/scans/scan-api/entries', {
          headers: { ...f.headers, 'x-trim-userid': '1001' },
        })
      ).status,
      404,
    );
  } finally {
    await f.close();
  }
});
test('API rejects unknown fields and invalid booleans before side effects', async () => {
  const f = await appFixture();
  try {
    const send = (route, body) =>
      fetch(f.base + route, {
        method: 'POST',
        headers: { ...f.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    let response = await send('/entries', {
      name: 'a',
      url: 'http://nas/',
      mode: 'url',
      unexpected: true,
    });
    assert.equal(response.status, 400);
    response = await send('/tasks', {
      name: 'a',
      type: 'script',
      script: 'date',
      enabled: 'false',
      schedule: { kind: 'daily', time: '03:00' },
    });
    assert.equal(response.status, 400);
    response = await send('/wake/devices', {
      name: 'a',
      mac: '02:11:22:33:44:55',
      address: '192.168.1.255',
      port: 70000,
    });
    assert.equal(response.status, 400);
    response = await send('/terminal/connections', {
      name: 'a',
      kind: 'remote',
      host: 'nas',
      port: 22,
      username: 'user',
      extra: 'bad',
    });
    assert.equal(response.status, 400);
    const entries = await (await fetch(f.base + '/entries', { headers: f.headers })).json();
    assert.equal(entries.length, 0);
  } finally {
    await f.close();
  }
});
test('unexpected exceptions emit diagnostics without secrets or request bodies', async () => {
  const { ApiExceptionFilter } = await import('../server/app/common/errors.js');
  const events = [],
    res = {
      headersSent: false,
      status() {
        return this;
      },
      json() {},
    };
  const req = {
    method: 'POST',
    path: '/app/deskicons/api/terminal/connections',
    body: { password: 'SECRET' },
    headers: { authorization: 'SECRET' },
  };
  const error = Object.assign(new Error('password=SECRET'), { code: 'SQLITE_BUSY' });
  error.stack = 'Error: password=SECRET\n    at safeFunction (/app/service.js:10:2)';
  new ApiExceptionFilter((event) => events.push(event)).catch(error, {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].code, 'SQLITE_BUSY');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  assert.match(events[0].stack, /safeFunction/);
});

test('wake check API validates complete owner selection and returns public status rows', async () => {
  const f = await appFixture();
  try {
    const post = (route, body, headers = f.headers) =>
      fetch(f.base + route, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const created = await post('/wake/devices', {
      name: 'PC',
      mac: '02:11:22:33:44:55',
      address: '192.168.1.255',
      ip: '',
    });
    assert.equal(created.status, 201);
    const d = await created.json();
    const result = await post('/wake/check', { ids: [d.id] });
    assert.equal(result.status, 200);
    const [row] = await result.json();
    assert.equal(row.id, d.id);
    assert.equal(row.presence.reason, 'no_target');
    assert.equal(row.owner, undefined);
    assert.equal(row.checking, false);
    assert.equal(
      (await post('/wake/check', { ids: [d.id] }, { ...f.headers, 'x-trim-userid': '1001' }))
        .status,
      404,
    );
    assert.equal((await post('/wake/check', { ids: [] })).status, 400);
    assert.equal((await post('/wake/check', { ids: Array(51).fill(d.id) })).status, 400);
  } finally {
    await f.close();
  }
});
