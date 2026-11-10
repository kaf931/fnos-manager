import assert from 'node:assert/strict';
import test from 'node:test';
import { appFixture } from './fixtures/terminal-app.js';
import { NotificationService } from '../server/notifications/service.js';
test('notification routes enforce account, admin, CSRF and validation without external traffic', async () => {
  const f = await appFixture();
  try {
    await f.app.get(NotificationService).close();
    const call = (suffix = '', method = 'GET', body, extra = {}) =>
      fetch(f.base + '/notifications' + suffix, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    const settings = {
      enabled: false,
      url: 'http://127.0.0.1/hook?secret=query',
      token: 'token-secret',
      condition: 'errors',
      scanFailures: true,
    };
    assert.equal((await call('', 'PUT', settings, { 'x-trim-isadmin': 'false' })).status, 403);
    assert.equal((await call('', 'PUT', settings, { 'x-deskicons-token': 'wrong' })).status, 403);
    assert.equal((await call('', 'PUT', { ...settings, url: 'ftp://host' })).status, 400);
    assert.equal((await call('', 'PUT', settings)).status, 200);
    assert.equal(
      (await (await call('', 'GET', undefined, { 'x-trim-userid': '1001' })).json()).url,
      '',
    );
    assert.equal((await call('/test', 'POST', {})).status, 200);
    const page = await (await call('/deliveries')).json();
    assert.equal(page.total, 1);
    assert.doesNotMatch(JSON.stringify(page), /token-secret|secret=query/);
    assert.equal(
      (await (await call('/deliveries', 'GET', undefined, { 'x-trim-userid': '1001' })).json())
        .total,
      0,
    );
    assert.equal((await call('/deliveries?page=0')).status, 400);
    assert.equal((await call('', 'PUT', { ...settings, channel: 'unknown' })).status, 400);
    assert.equal(
      (await call('', 'PUT', { ...settings, headers: { Host: 'invalid' } })).status,
      400,
    );
    assert.equal((await call('', 'PUT', { ...settings, template: 'invalid JSON' })).status, 400);
    assert.equal(
      (
        await call('', 'PUT', {
          ...settings,
          channel: 'telegram',
          url: '',
          token: 'invalid',
          telegramChatId: '-123',
        })
      ).status,
      400,
    );
    const dingtalk = {
      ...settings,
      channel: 'dingtalk',
      url: 'http://localhost/hook',
      token: '123:ABC',
      headers: { 'X-Custom': 'value' },
      template: '{{name}}: {{statusText}}',
    };
    assert.equal((await call('', 'PUT', dingtalk)).status, 200);
    const saved = await (await call()).json();
    assert.equal(saved.channel, 'dingtalk');
    assert.equal(saved.headers['x-custom'], 'value');
    assert.equal((await call('/test', 'POST', {})).status, 200);
  } finally {
    await f.close();
  }
});

test('template CRUD and switches are owner scoped, validated and preserve delivery history', async () => {
  const f = await appFixture();
  try {
    await f.app.get(NotificationService).close();
    const call = (path, method = 'GET', body, extra = {}) =>
      fetch(f.base + '/notifications/templates' + path, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    const input = {
      name: 'Mail results',
      enabled: false,
      url: 'http://localhost/hook',
      token: 'PRIVATE',
      condition: 'all',
      scanFailures: true,
    };
    assert.equal((await call('', 'POST', input, { 'x-deskicons-token': 'wrong' })).status, 403);
    const response = await call('', 'POST', input);
    assert.equal(response.status, 200);
    const row = await response.json();
    const list = await (await call('')).json();
    assert.equal(list.length, 1);
    assert.doesNotMatch(JSON.stringify(list), /PRIVATE/);
    assert.equal(
      (await call('/' + row.id, 'GET', undefined, { 'x-trim-userid': '1001' })).status,
      404,
    );
    assert.equal((await call('/' + row.id + '/enabled', 'PATCH', { enabled: 'yes' })).status, 400);
    assert.equal((await call('/' + row.id + '/enabled', 'PATCH', { enabled: true })).status, 200);
    assert.equal((await call('/' + row.id + '/test', 'POST', {})).status, 200);
    assert.equal((await call('/' + row.id, 'DELETE')).status, 200);
    assert.equal((await (await call('')).json()).length, 0);
    assert.equal(
      (await (await fetch(f.base + '/notifications/deliveries', { headers: f.headers })).json())
        .total,
      1,
    );
  } finally {
    await f.close();
  }
});

test('reminder endpoints validate, isolate owners and manage notes without sending', async () => {
  const f = await appFixture();
  try {
    await f.app.get(NotificationService).close();
    const call = (path = '', method = 'GET', body, extra = {}) =>
      fetch(f.base + '/notifications/reminders' + path, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    const note = {
      name: 'Remember',
      content: 'Private note',
      dueAt: null,
      repeat: 'none',
      templateIds: [],
      enabled: false,
    };
    assert.equal((await call('', 'POST', note, { 'x-deskicons-token': 'bad' })).status, 403);
    const created = await call('', 'POST', note);
    assert.equal(created.status, 200);
    const r = await created.json();
    assert.equal((await (await call()).json()).length, 1);
    assert.equal(
      (await (await call('', 'GET', undefined, { 'x-trim-userid': '1001' })).json()).length,
      0,
    );
    assert.equal((await call('/' + r.id, 'PUT', note, { 'x-trim-userid': '1001' })).status, 404);
    assert.equal((await call('/' + r.id + '/enabled', 'PATCH', { enabled: true })).status, 400);
    assert.equal((await call('/' + r.id + '/completed', 'PATCH', { completed: true })).status, 200);
    assert.equal((await call('/' + r.id + '/snooze', 'POST', {})).status, 400);
    assert.equal(
      (await call('/' + r.id + '/completed', 'PATCH', { completed: false })).status,
      200,
    );
    assert.equal((await call('/' + r.id, 'DELETE')).status, 200);
    assert.equal((await (await call()).json()).length, 0);
    assert.equal((await call('', 'POST', { ...note, repeat: 'invalid' })).status, 400);
  } finally {
    await f.close();
  }
});

test('inbox routes validate and isolate reads while enforcing CSRF', async () => {
  const f = await appFixture();
  try {
    const service = f.app.get(NotificationService);
    await service.close();
    const repo = service.repository;
    const template = repo.createTemplate('1000', {
      channel: 'inapp',
      name: 'App',
      enabled: true,
      url: '',
      token: '',
      condition: 'all',
      scanFailures: true,
    });
    const item = repo.enqueueTest('1000', template.id),
      job = repo.claim();
    repo.finish(job, 204, false);
    const call = (path, method = 'GET', body, extra = {}) =>
      fetch(f.base + '/notifications/inbox' + path, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal((await call('?page=0')).status, 400);
    assert.equal((await call('?filter=invalid')).status, 400);
    assert.equal((await (await call('/unread')).json()).count, 1);
    assert.equal(
      (await (await call('/unread', 'GET', undefined, { 'x-trim-userid': '1001' })).json()).count,
      0,
    );
    assert.equal(
      (await call('/read', 'POST', { ids: [item.id] }, { 'x-deskicons-token': 'wrong' })).status,
      403,
    );
    assert.equal(
      (await call('/read', 'POST', { ids: [item.id] }, { 'x-trim-userid': '1001' })).status,
      409,
    );
    assert.equal((await call('/read', 'POST', { ids: [item.id] })).status, 200);
    assert.equal((await (await call('/unread')).json()).count, 0);
  } finally {
    await f.close();
  }
});
