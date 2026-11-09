import test from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../server/core.js').catch(() => ({}));
test('rejects script URLs and line breaks', () => {
  assert.equal(typeof core.validateEntry, 'function');
  for (const url of ['javascript:alert(1)', 'http://a/\nHeader:x', 'file:///etc/passwd'])
    assert.throws(() => core.validateEntry({ name: '测试', url }));
});
test('normalizes names, all mapped ports and icon label', () => {
  assert.equal(typeof core.normalizeContainer, 'function');
  const c = core.normalizeContainer({
    Id: 'abc',
    Names: ['/jellyfin'],
    Image: 'jellyfin/jellyfin',
    State: 'running',
    Labels: { 'net.unraid.docker.icon': 'https://example.com/icon.png' },
    Ports: [
      { PrivatePort: 8096, PublicPort: 18096, IP: '0.0.0.0', Type: 'tcp' },
      { PrivatePort: 8920, PublicPort: 18920, IP: '::', Type: 'tcp' },
      { PrivatePort: 7359, PublicPort: 7359, Type: 'udp' },
    ],
  });
  assert.equal(c.name, 'jellyfin');
  assert.equal(c.ports.length, 2);
  assert.equal(c.iconUrl, 'https://example.com/icon.png');
});
test('entry config uses stable prefixed IDs and chosen opening mode', () => {
  assert.equal(typeof core.entryConfig, 'function');
  const cfg = core.entryConfig({
    id: 'abc123',
    name: '影视',
    url: 'http://nas:8096/',
    mode: 'url',
  });
  assert.equal(cfg['.url']['deskicon.abc123.main'].type, 'url');
  assert.match(cfg['.url']['deskicon.abc123.main'].url, /index.cgi/);
});
test('local Docker service uses documented port entry without CGI auth and keeps path/query', () => {
  const entry = {
    id: 'abc123',
    name: 'LibreTV',
    url: 'http://192.168.1.35:18080/watch?a=1#part',
    mode: 'url',
    containerId: 'container-1',
  };
  const value = core.entryConfig(entry, { serviceHosts: ['192.168.1.35'] })['.url'][
    'deskicon.abc123.main'
  ];
  assert.equal(value.type, 'url');
  assert.equal(value.protocol, 'http');
  assert.equal(value.port, '18080');
  assert.equal(value.url, '/watch?a=1#part');
  assert.doesNotMatch(value.url, /cgi/);
  const external = core.entryConfig(
    { ...entry, url: 'https://external.example/app' },
    { serviceHosts: ['192.168.1.35'] },
  )['.url']['deskicon.abc123.main'];
  assert.match(external.url, /index.cgi/);
});
