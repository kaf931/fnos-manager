import test from 'node:test';
import assert from 'node:assert/strict';
import { containerAddress } from '../.web-test/docker-address.js';
const state = { native: true, hostname: '192.168.1.35' },
  port = { hostPort: 18080, containerPort: 8080 };
test('Docker auto-fill uses NAS IP for mapped ports and replaces loopback labels', () => {
  assert.equal(containerAddress({}, port, state, 'localhost'), 'http://192.168.1.35:18080/');
  assert.equal(
    containerAddress({ serviceUrl: 'http://localhost:18080/app/' }, port, state, 'localhost'),
    'http://192.168.1.35:18080/app/',
  );
  assert.equal(
    containerAddress({ serviceUrl: 'http://127.0.0.1:18080/' }, port, state, 'localhost'),
    'http://192.168.1.35:18080/',
  );
  assert.equal(
    containerAddress({ serviceUrl: 'https://service.example/app' }, port, state, 'localhost'),
    'https://service.example/app',
  );
  assert.equal(
    containerAddress({}, port, { native: true, hostname: 'localhost' }, '127.0.0.1'),
    '',
  );
  assert.equal(
    containerAddress({}, port, { native: false, hostname: 'localhost' }, 'localhost'),
    'http://localhost:18080/',
  );
  assert.equal(
    containerAddress(
      {},
      { hostPort: 443, containerPort: 443 },
      { native: true, hostname: 'fd00::1' },
      'localhost',
    ),
    'https://[fd00::1]:443/',
  );
});
