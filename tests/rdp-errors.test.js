import test from 'node:test';
import assert from 'node:assert/strict';
import { rdpEngineError } from '../server/rdp/errors.js';
test('RDP diagnostics classify engine detail instead of assuming every 519 is a network or password error', () => {
  for (const [detail, hint] of [
    ['SSL/TLS connection failed (untrusted/self-signed certificate?)', /TLS.*证书/],
    ['DNS lookup failed (incorrect hostname?)', /主机名解析失败/],
    ['Authentication failure (invalid credentials?)', /身份认证失败/],
    ['Security negotiation failed (wrong security type?)', /安全协商失败.*NLA/],
    ['Server refused connection (wrong security type?)', /目标拒绝连接/],
    ['Access denied by server (account locked/disabled?)', /账号锁定/],
  ]) {
    const result = rdpEngineError(detail, '519');
    assert.equal(result.code, '519');
    assert.match(result.message, hint);
    assert.ok(result.message.includes(detail));
  }
  const unknown = rdpEngineError('', '519');
  assert.match(unknown.message, /引擎未提供具体原因/);
  assert.doesNotMatch(unknown.message, /密码错误/);
});
test('RDP diagnostics bound remote messages and remove passwords and control characters', () => {
  const result = rdpEngineError(
    'TLS\nprivate-password\u0000' + 'x'.repeat(2000),
    'invalid',
    'private-password',
  );
  assert.equal(result.code, '512');
  assert.doesNotMatch(result.message, /private-password|\u0000|\n/);
  assert.ok(result.message.length < 800);
});

test('the actual RDP adapter passes both engine status and reason to the UI', async () => {
  const { build } = await import('esbuild');
  const built = await build({
    entryPoints: ['web/rdp-client.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    plugins: [
      {
        name: 'guacamole-boundary',
        setup(b) {
          b.onResolve({ filter: /guacamole\/index\.js$/ }, () => ({
            path: 'guacamole',
            namespace: 'stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export default {};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', built.outputFiles[0].text)(mod, mod.exports);
  const instance = {},
    received = [];
  mod.exports.bindRdpEvents(
    instance,
    (...values) => received.push(values),
    () => {},
  );
  instance.onerror({ code: 519, message: 'SSL/TLS connection failed' });
  assert.deepEqual(received, [[519, 'SSL/TLS connection failed']]);
});
