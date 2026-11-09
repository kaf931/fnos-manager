import test from 'node:test';
import assert from 'node:assert/strict';
import { GuacamoleParser, instruction, rdpArguments } from '../server/rdp/protocol.js';
test('Guacamole framing handles fragmented UTF-8 and multiple instructions', () => {
  const values = [];
  const p = new GuacamoleParser((v) => values.push(v));
  const b = Buffer.from(instruction('name', '中文😀') + instruction('sync', '42'));
  for (const byte of b) p.push(Buffer.from([byte]));
  assert.deepEqual(values, [
    ['name', '中文😀'],
    ['sync', '42'],
  ]);
});
test('Guacamole framing rejects malformed and unbounded input', () => {
  for (const input of ['x.foo;', '99999999.x', '1.a!'])
    assert.throws(() => new GuacamoleParser(() => {}).push(Buffer.from(input)));
});
test('RDP arguments enforce NLA and certificate checks and map only saved credentials', () => {
  const args = rdpArguments(
    { host: 'win.local', port: 3389, username: '用户', password: 'secret', domain: 'WORK' },
    1280,
    720,
  );
  assert.equal(args.security, 'nla');
  assert.equal(args['ignore-cert'], 'false');
  assert.equal(args.hostname, 'win.local');
  assert.equal(args.password, 'secret');
  assert.equal(args.width, '1280');
  assert.equal(args['enable-drive'], 'false');
});

test('Guacamole caps an instruction across individually bounded fragments', () => {
  const parser = new GuacamoleParser(() => {}),
    chunk = 'x'.repeat(1024 * 1024);
  assert.throws(() => {
    for (let n = 0; n < 9; n++) parser.push(Buffer.from(`${chunk.length}.${chunk},`));
  }, /too large/);
});

test('saved RDP security and certificate policies are independent and mapped explicitly', () => {
  const base = { host: 'win.local', port: 3389, username: 'u', password: 'p', domain: '' };
  for (const security of ['any', 'nla', 'tls', 'rdp']) {
    for (const certificatePolicy of ['strict', 'tofu', 'ignore']) {
      const args = rdpArguments({ ...base, security, certificatePolicy }, 800, 600);
      assert.equal(args.security, security);
      assert.equal(args['ignore-cert'], String(certificatePolicy === 'ignore'));
      assert.equal(args['cert-tofu'], String(certificatePolicy === 'tofu'));
      assert.equal(args['disable-auth'], 'false');
    }
  }
});
