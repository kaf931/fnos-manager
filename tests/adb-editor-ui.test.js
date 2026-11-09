import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { mountUi } from './fixtures/react-ui.js';
async function change(input, value) {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}
async function editor(t, props = {}) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return mountUi(t, 'features/terminal/connection-editor', 'ConnectionEditor', {
    connection: null,
    api: async () => ({}),
    toast() {},
    onSave() {},
    ...props,
  });
}
test('ADB editor hides SSH authentication, defaults to port 5555 and submits only ADB fields', async (t) => {
  const writes = [],
    ui = await editor(t, {
      api: async (...args) => {
        writes.push(args);
        return {};
      },
    });
  await change(ui.get('select'), 'adb');
  assert.equal(ui.get('#terminal-port').value, '5555');
  assert.equal(ui.get('#terminal-user').hidden, true);
  assert.equal(ui.get('#terminal-saved-password'), null);
  assert.equal(ui.get('textarea'), null);
  await change(ui.get('#terminal-name'), 'Phone');
  await change(ui.get('#terminal-host'), '192.168.1.9');
  await act(async () =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes[0][0], '/adb/connections');
  assert.equal(writes[0][1], 'POST');
  assert.deepEqual(writes[0][2], {
    name: 'Phone',
    folderId: null,
    host: '192.168.1.9',
    port: 5555,
    protocol: 'adb',
    transport: 'tcp',
    serial: '',
  });
});
test('ADB USB editor uses a serial instead of host and retains backend device type on direct edit', async (t) => {
  const writes = [],
    ui = await editor(t, {
      connection: {
        id: 'usb',
        protocol: 'adb',
        deviceType: 'usb',
        serial: 'ABC123',
        name: 'USB phone',
        host: '',
        port: 5555,
      },
      api: async (...args) => {
        writes.push(args);
        return {};
      },
    });
  const selects = document.querySelectorAll('select');
  assert.equal(selects[1].value, 'usb');
  assert.equal(ui.get('#terminal-host'), null);
  assert.equal(ui.get('#terminal-port').hidden, true);
  const serial = [...document.querySelectorAll('input')].find((input) => input.value === 'ABC123');
  assert.ok(serial);
  assert.equal(serial.required, true);
  assert.equal(serial.maxLength, 128);
  await change(serial, 'USB456');
  await act(async () =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes[0][0], '/adb/connections/usb');
  assert.equal(writes[0][1], 'PUT');
  assert.equal(writes[0][2].serial, 'USB456');
  assert.equal(writes[0][2].transport, 'usb');
  assert.equal('username' in writes[0][2], false);
});
test('ADB USB discovery selects an available NAS device while retaining manual serial entry', async (t) => {
  const ui = await editor(t, {
    connection: { protocol: 'adb', deviceType: 'usb', name: 'Phone', serial: 'manual', port: 5555 },
    api: async (path) =>
      path === '/adb/devices'
        ? {
            items: [
              { serial: 'USB999', status: 'device', name: 'Pixel', transport: 'usb' },
              { serial: '192.168.1.9:5555', status: 'device', name: 'TCP phone', transport: 'tcp' },
              { serial: 'LOCKED', status: 'unauthorized', name: 'Locked phone', transport: 'usb' },
            ],
          }
        : {},
  });
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === '发现 NAS USB 设备',
  );
  assert.ok(button);
  await act(async () => button.click());
  const select = [...document.querySelectorAll('select')].find((select) =>
    [...select.options].some((option) => option.value === 'USB999'),
  );
  assert.ok(select);
  assert.equal(
    [...select.options].some((option) => option.value === '192.168.1.9:5555'),
    false,
  );
  assert.equal([...select.options].find((option) => option.value === 'LOCKED').disabled, true);
  await change(select, 'USB999');
  assert.equal(ui.get('[aria-label="USB 设备序列号"]'), null);
  await change(select, '');
  await change(ui.get('[aria-label="USB 设备序列号"]'), 'MANUAL456');
  assert.equal(ui.get('[aria-label="USB 设备序列号"]').value, 'MANUAL456');
});
test('changing protocol aborts USB discovery and ignores its late failure', async (t) => {
  let reject, signal;
  const ui = await editor(t, {
    connection: { protocol: 'adb', deviceType: 'usb', name: 'Phone', serial: 'manual', port: 5555 },
    api: async (_path, _method, _body, value) => {
      signal = value;
      return new Promise((_, no) => {
        reject = no;
      });
    },
  });
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === '发现 NAS USB 设备',
  );
  assert.ok(button);
  await act(async () => button.click());
  await change(ui.get('select'), 'ssh');
  assert.equal(signal.aborted, true);
  await act(async () => reject(new Error('stale discovery failure')));
  assert.doesNotMatch(document.body.textContent, /stale discovery failure/);
});
test('unmounting the editor aborts in-flight USB discovery', async (t) => {
  let signal, resolve;
  const ui = await editor(t, {
    connection: { protocol: 'adb', deviceType: 'usb', serial: 'manual', port: 5555 },
    api: async (_path, _method, _body, value) => {
      signal = value;
      return new Promise((yes) => {
        resolve = yes;
      });
    },
  });
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === '发现 NAS USB 设备',
  );
  await act(async () => button.click());
  await act(async () => ui.close());
  assert.equal(signal.aborted, true);
  await act(async () => resolve({ items: [] }));
});

test('network ADB editor pairs before saving and never stores the temporary pairing fields', async (t) => {
  const writes = [];
  const ui = await editor(t, {
    api: async (...args) => {
      writes.push(args);
      return {};
    },
  });
  await change(ui.get('select'), 'adb');
  await change(ui.get('#terminal-name'), 'Phone');
  await change(ui.get('#terminal-host'), '192.168.1.9');
  assert.ok(ui.get('#adb-pair-port'));
  assert.ok(ui.get('#adb-pair-code'));
  await change(ui.get('#adb-pair-port'), '43139');
  await change(ui.get('#adb-pair-code'), '123456');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(
    writes.map((w) => w[0]),
    ['/adb/pair', '/adb/connections'],
  );
  assert.deepEqual(writes[0][2], { host: '192.168.1.9', port: 43139, code: '123456' });
  assert.ok(!('pairCode' in writes[1][2]));
  assert.ok(!('pairPort' in writes[1][2]));
});

test('failed ADB pairing prevents saving, keeps the editor open and allows retry', async (t) => {
  let fail = true;
  const writes = [];
  const ui = await editor(t, {
    api: async (path) => {
      writes.push(path);
      if (path === '/adb/pair' && fail) throw Error('配对码已失效');
      return {};
    },
  });
  await change(ui.get('select'), 'adb');
  await change(ui.get('#terminal-host'), '192.168.1.9');
  assert.ok(ui.get('#adb-pair-port'));
  await change(ui.get('#adb-pair-port'), '43139');
  await change(ui.get('#adb-pair-code'), '123456');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(writes, ['/adb/pair']);
  assert.match(document.body.textContent, /配对码已失效/);
  fail = false;
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(writes, ['/adb/pair', '/adb/pair', '/adb/connections']);
});

test('incomplete pairing details prevent both pairing and connection writes', async (t) => {
  const writes = [];
  const ui = await editor(t, {
    api: async (path) => {
      writes.push(path);
      return {};
    },
  });
  await change(ui.get('select'), 'adb');
  await change(ui.get('#adb-pair-port'), '43139');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(writes, []);
  assert.match(document.body.textContent, /六位配对码/);
});

test('a connection save retry does not reuse a consumed pairing code', async (t) => {
  const writes = [];
  let first = true;
  const ui = await editor(t, {
    api: async (path) => {
      writes.push(path);
      if (path === '/adb/connections' && first) {
        first = false;
        throw Error('保存失败');
      }
      return {};
    },
  });
  await change(ui.get('select'), 'adb');
  await change(ui.get('#terminal-host'), '192.168.1.9');
  await change(ui.get('#adb-pair-port'), '43139');
  await change(ui.get('#adb-pair-code'), '123456');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(ui.get('#adb-pair-code').value, '');
  assert.equal(ui.get('#adb-pair-port').value, '');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(writes, ['/adb/pair', '/adb/connections', '/adb/connections']);
});

test('a pairing response after editor teardown never saves a connection', async (t) => {
  const writes = [];
  let resolve;
  const ui = await editor(t, {
    api: async (path) => {
      writes.push(path);
      return new Promise((yes) => {
        resolve = yes;
      });
    },
  });
  await change(ui.get('select'), 'adb');
  await change(ui.get('#terminal-host'), '192.168.1.9');
  await change(ui.get('#adb-pair-port'), '43139');
  await change(ui.get('#adb-pair-code'), '123456');
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(() => ui.close());
  await act(() => resolve({}));
  assert.deepEqual(writes, ['/adb/pair']);
});

test('USB empty discovery keeps one serial field and shared inline discover action', async (t) => {
  const ui = await editor(t, {
    connection: { protocol: 'adb', deviceType: 'usb', serial: '', port: 5555 },
    api: async () => ({ items: [] }),
  });
  const button = ui.get('[aria-label="发现 NAS USB 设备"]');
  await act(async () => button.click());
  assert.equal(ui.get('[aria-label="已发现的 USB 设备"]'), null);
  assert.ok(ui.get('[aria-label="USB 设备序列号"]'));
  assert.equal(button.parentElement.className, 'form-input-row');
  assert.equal(button.textContent, '发现设备');
  assert.equal(button.classList.contains('icon-button'), false);
  assert.equal(button.querySelector('svg'), null);
  assert.match(document.body.textContent, /未发现 USB 设备/);
});
