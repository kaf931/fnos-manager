import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi } from './fixtures/react-ui.js';
test('RDP reuses connection editor and defaults to port 3389 with domain field', async (t) => {
  const ui = await mountUi(t, 'features/terminal/connection-editor', 'ConnectionEditor', {
    connection: null,
    api: async () => ({}),
    toast: () => {},
    onSave: () => {},
  });
  const select = ui.get('select');
  assert.ok([...select.options].some((o) => o.value === 'rdp'));
  await act(async () => {
    select.value = 'rdp';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(ui.get('#terminal-port').value, '3389');
  assert.ok(ui.get('#terminal-domain'));
  assert.equal(document.querySelectorAll('select')[1].value, 'any');
  assert.equal(document.querySelectorAll('select')[2].value, 'strict');
  await act(async () => {
    const certificate = document.querySelectorAll('select')[2];
    certificate.value = 'tofu';
    certificate.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.match(document.body.textContent, /证书变化.*拒绝/);
  assert.ok(ui.get('.task-form-body'));
  assert.ok(ui.get('.dialog-footer'));
});

test('RDP editor saves the selected policies with the connection through the shared form', async (t) => {
  let saved;
  const ui = await mountUi(t, 'features/terminal/connection-editor', 'ConnectionEditor', {
    connection: {
      id: 'rdp-saved',
      name: 'Windows',
      protocol: 'rdp',
      host: 'win.local',
      port: 3389,
      username: 'u',
      domain: '',
      security: 'nla',
      certificatePolicy: 'strict',
    },
    api: async (route, method, body) => {
      saved = { route, method, body };
      return {};
    },
    toast: () => {},
    onSave: () => {},
  });
  await act(async () => {
    const select = document.querySelectorAll('select')[1];
    select.value = 'tls';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    const certificate = document.querySelectorAll('select')[2];
    certificate.value = 'tofu';
    certificate.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await act(async () => {
    ui.get('#terminal-connection-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(saved.route, '/rdp/connections/rdp-saved');
  assert.equal(saved.method, 'PUT');
  assert.equal(saved.body.security, 'tls');
  assert.equal(saved.body.certificatePolicy, 'tofu');
});
