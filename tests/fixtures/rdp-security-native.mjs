// Standalone Linux acceptance: node rdp-security-native.mjs /var/apps/deskicons/target
// Uses the real packaged guacd/FreeRDP, a disposable TLS negotiation peer, and no saved app connections.
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { TLSSocket, createSecureContext } from 'node:tls';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
if (!root) throw new Error('Pass the installed application root');
const { GuacdRuntime } = await import(pathToFileURL(path.join(root, 'server/rdp/runtime.js')));
const { GuacamoleParser, instruction, rdpArguments } = await import(
  pathToFileURL(path.join(root, 'server/rdp/protocol.js'))
);
const data = await mkdtemp(path.join(tmpdir(), 'rdp-native-trust-'));
const sockets = new Set();
let context,
  accepted = 0,
  runtime;
const peer = createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  socket.once('data', () => {
    // TPKT + X.224 Connection Confirm + RDP_NEG_RSP selecting HYBRID (NLA).
    socket.write(Buffer.from('030000130ed000001234000200080002000000', 'hex'));
    const tls = new TLSSocket(socket, { isServer: true, secureContext: context });
    tls.on('error', () => {});
    tls.on('secure', () => setTimeout(() => tls.destroy(), 500));
    // FreeRDP validates the certificate after TLS completes; only subsequent NLA
    // traffic proves it accepted the certificate.
    tls.once('data', () => {
      accepted++;
      tls.destroy();
    });
  });
});
const listen = async (server) => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
};
async function certificate(name) {
  const key = path.join(data, name + '.key'),
    cert = path.join(data, name + '.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  return createSecureContext({ key: await readFile(key), cert: await readFile(cert) });
}
async function files(dir) {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}
try {
  context = await certificate('first');
  const targetPort = await listen(peer),
    probe = createServer();
  const enginePort = await listen(probe);
  await new Promise((r) => probe.close(r));
  runtime = new GuacdRuntime(root, enginePort, data);
  await runtime.ensure();
  async function attempt(certificatePolicy) {
    const before = accepted;
    const error = await new Promise((resolve, reject) => {
      const socket = connect(enginePort, '127.0.0.1');
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('native peer timeout'));
      }, 8000);
      const done = (value) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(value);
      };
      const parser = new GuacamoleParser(([op, ...args]) => {
        if (op === 'args') {
          const values = rdpArguments(
            {
              host: '127.0.0.1',
              port: targetPort,
              username: 'test-only',
              password: 'test-only',
              domain: '',
              security: 'any',
              certificatePolicy,
            },
            800,
            600,
          );
          socket.write(
            instruction('size', '800', '600', '96') +
              instruction('audio') +
              instruction('video') +
              instruction('image', 'image/png') +
              instruction(
                'connect',
                ...args.map((key) => (key.startsWith('VERSION_') ? key : (values[key] ?? ''))),
              ),
          );
        } else if (op === 'error') done(args[0]);
      });
      socket.on('connect', () => socket.write(instruction('select', 'rdp')));
      socket.on('data', (b) => {
        try {
          parser.push(b);
        } catch (e) {
          clearTimeout(timer);
          socket.destroy();
          reject(e);
        }
      });
      socket.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    return { tlsAccepted: accepted > before, error };
  }
  assert.equal((await attempt('strict')).tlsAccepted, false);
  console.log('strict: self-signed certificate rejected');
  const first = await attempt('tofu');
  assert.equal(first.tlsAccepted, true, first.error);
  const trust = (await files(path.join(data, 'rdp'))).filter((p) => /known_hosts|\.pem$/.test(p));
  assert.ok(trust.length, 'FreeRDP must persist trust material');
  console.log('tofu: first certificate accepted and persisted');
  await runtime.close();
  runtime = new GuacdRuntime(root, enginePort, data);
  await runtime.ensure();
  const repeat = await attempt('tofu');
  assert.equal(repeat.tlsAccepted, true, repeat.error);
  console.log('tofu: same certificate accepted after engine restart');
  context = await certificate('changed');
  assert.equal((await attempt('tofu')).tlsAccepted, false);
  console.log('tofu: changed certificate rejected');
  const ignored = await attempt('ignore');
  assert.equal(ignored.tlsAccepted, true, ignored.error);
  console.log('ignore: explicit policy permits changed self-signed certificate');
} finally {
  await runtime?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((r) => peer.close(r));
  await rm(data, { recursive: true, force: true });
}
