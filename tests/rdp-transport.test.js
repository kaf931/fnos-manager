import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { TerminalService } from '../server/terminal/transport.js';
import { VncTransport } from '../server/vnc/transport.js';
import { RdpTransport } from '../server/rdp/transport.js';
import { GuacamoleParser, instruction } from '../server/rdp/protocol.js';
test('RDP negotiates server-only credentials and rejects client handshake injection', async () => {
  const received = [];
  const engine = createServer((socket) => {
    const parser = new GuacamoleParser((values) => {
      received.push(values);
      if (values[0] === 'select')
        socket.write(
          instruction(
            'args',
            'VERSION_1_5_0',
            'hostname',
            'username',
            'password',
            'security',
            'ignore-cert',
          ),
        );
      if (values[0] === 'connect')
        socket.write(instruction('ready', 'remote-id') + instruction('sync', '1'));
    });
    socket.on('data', (b) => parser.push(b));
  });
  await new Promise((r) => engine.listen(0, '127.0.0.1', r));
  const server = httpServer();
  const ssh = new TerminalService({ store: {}, gateway: false });
  const vnc = new VncTransport(false);
  ssh.attach(server);
  vnc.attach(server);
  const transport = new RdpTransport(false, engine.address().port);
  transport.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Non-gateway mode uses the local owner and request Origin, as in the existing VNC relay.
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { id, ticket } = transport.create(
    'development',
    {
      id: 'r1',
      name: 'Windows',
      protocol: 'rdp',
      host: 'fixed-host',
      port: 3389,
      username: 'alice',
      password: 'private-secret',
      domain: '',
      ownerUid: 'development',
      folderId: null,
    },
    origin,
  );
  const ws = new WebSocket(
    origin.replace('http', 'ws') + '/app/deskicons/rdp/ws?ticket=' + ticket,
    'guacamole',
    { headers: { Origin: origin } },
  );
  try {
    const messages = [];
    ws.on('message', (data) => messages.push(data.toString()));
    await once(ws, 'open');
    for (let n = 0; n < 100 && !received.some((v) => v[0] === 'connect'); n++)
      await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(
      received.find((v) => v[0] === 'connect'),
      ['connect', 'VERSION_1_5_0', 'fixed-host', 'alice', 'private-secret', 'nla', 'false'],
    );
    assert.doesNotMatch(messages.join(''), /private-secret|alice/);
    assert.throws(() => transport.closeOwned('other', id));
    ws.send(instruction('connect', 'evil-target'));
    await once(ws, 'close');
    assert.equal(transport.sessions.size, 0);
    assert.doesNotMatch(JSON.stringify(transport.logs.read('development', id)), /private-secret/);
  } finally {
    ws.terminate();
    transport.close();
    vnc.close();
    await ssh.close();
    await new Promise((r) => server.close(r));
    await new Promise((r) => engine.close(r));
  }
});

test('RDP rejects foreign origins and replayed tickets before engine connection', async () => {
  const server = httpServer(),
    transport = new RdpTransport(false, 1);
  transport.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const connection = {
    id: 'r',
    name: 'R',
    protocol: 'rdp',
    host: 'localhost',
    port: 3389,
    username: 'u',
    password: 'p',
    domain: '',
    ownerUid: 'development',
    folderId: null,
  };
  const created = transport.create('development', connection, origin);
  const denied = async (ticket, requestOrigin) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(
        origin.replace('http', 'ws') + '/app/deskicons/rdp/ws?ticket=' + ticket,
        'guacamole',
        { headers: { Origin: requestOrigin } },
      );
      ws.on('unexpected-response', (_, response) => {
        assert.equal(response.statusCode, 403);
        response.resume();
        ws.terminate();
        resolve();
      });
      ws.on('error', () => {});
      ws.on('open', () => {
        ws.terminate();
        reject(new Error('unexpected upgrade'));
      });
    });
  try {
    await denied(created.ticket, 'http://foreign.invalid');
    transport.vault.consume(created.ticket, 'development', origin);
    await denied(created.ticket, origin);
    assert.equal(transport.sessions.get(created.id).socket, undefined);
    for (let n = 0; n < 3; n++)
      transport.create('development', { ...connection, id: 'r' + n }, origin);
    assert.throws(() => transport.create('development', connection, origin), /已满/);
  } finally {
    transport.close();
    await new Promise((r) => server.close(r));
  }
});

test(
  'RDP gateway readiness followed by authentication failure never logs desktop success',
  { timeout: 5000 },
  async () => {
    const engine = createServer((socket) => {
      const parser = new GuacamoleParser((values) => {
        if (values[0] === 'select') socket.write(instruction('args', 'VERSION_1_5_0', 'hostname'));
        if (values[0] === 'connect')
          socket.write(
            instruction('ready', 'gateway-only') +
              instruction('error', 'Authentication failed', '769'),
          );
      });
      socket.on('data', (b) => parser.push(b));
    });
    await new Promise((r) => engine.listen(0, '127.0.0.1', r));
    const server = httpServer(),
      transport = new RdpTransport(false, engine.address().port);
    transport.attach(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`,
      session = transport.create(
        'development',
        {
          id: 'qa',
          ownerUid: 'development',
          protocol: 'rdp',
          name: 'qa',
          host: '127.0.0.1',
          port: 3389,
          username: 'qa',
          password: 'test-only',
          domain: '',
          folderId: null,
        },
        origin,
      );
    const ws = new WebSocket(
      origin.replace('http', 'ws') + '/app/deskicons/rdp/ws?ticket=' + session.ticket,
      'guacamole',
      { headers: { Origin: origin } },
    );
    try {
      await once(ws, 'close');
      const entries = transport.logs.read('development', session.id);
      assert.equal(
        entries.some((e) => e.stage === 'desktop' && e.level === 'success'),
        false,
      );
      assert.ok(
        entries.some(
          (e) => e.stage === 'protocol' && e.level === 'info' && e.message.includes('等待远程桌面'),
        ),
      );
      assert.ok(entries.some((e) => e.level === 'error' && e.message.includes('769')));
    } finally {
      ws.terminate();
      transport.close();
      await new Promise((r) => server.close(r));
      await new Promise((r) => engine.close(r));
    }
  },
);

for (const handshakeComplete of [false, true])
  test(
    `RDP preserves engine status and detail ${handshakeComplete ? 'after' : 'before'} ready`,
    { timeout: 5000 },
    async (t) => {
      const serviceErrors = [];
      t.mock.method(console, 'error', (...values) => serviceErrors.push(values.join(' ')));
      const engine = createServer((socket) => {
        const parser = new GuacamoleParser((values) => {
          if (values[0] === 'select') socket.write(instruction('args', 'hostname', 'password'));
          if (values[0] === 'connect')
            socket.write(
              (handshakeComplete ? instruction('ready', 'engine-id') : '') +
                instruction(
                  'error',
                  'SSL/TLS connection failed (untrusted/self-signed certificate?) synthetic-password',
                  '519',
                ),
            );
        });
        socket.on('data', (b) => parser.push(b));
        socket.on('error', () => {});
      });
      await new Promise((r) => engine.listen(0, '127.0.0.1', r));
      const server = httpServer(),
        transport = new RdpTransport(false, engine.address().port);
      transport.attach(server);
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const { id, ticket } = transport.create(
        'development',
        {
          id: 'rdp',
          ownerUid: 'development',
          name: 'Windows',
          protocol: 'rdp',
          host: 'windows.test',
          port: 3389,
          username: 'alice',
          password: 'synthetic-password',
          domain: '',
          folderId: null,
        },
        origin,
      );
      const ws = new WebSocket(
        origin.replace('http', 'ws') + '/app/deskicons/rdp/ws?ticket=' + ticket,
        'guacamole',
        { headers: { Origin: origin } },
      );
      t.after(async () => {
        ws.terminate();
        transport.close();
        await new Promise((r) => server.close(r));
        await new Promise((r) => engine.close(r));
      });
      const errors = [],
        parser = new GuacamoleParser((values) => {
          if (values[0] === 'error') errors.push(values);
        });
      ws.on('message', (b) => parser.push(Buffer.from(b)));
      await once(ws, 'close');
      assert.equal(errors.length, 1);
      assert.equal(errors[0][2], '519');
      assert.match(errors[0][1], /SSL\/TLS/);
      assert.doesNotMatch(errors[0][1], /synthetic-password/);
      const log = JSON.stringify(transport.logs.read('development', id));
      assert.match(log, /SSL\/TLS/);
      assert.match(log, /证书/);
      assert.match(log, /windows.test:3389/);
      assert.doesNotMatch(log, /synthetic-password/);
      assert.equal(serviceErrors.length, 1);
      const serviceError = JSON.parse(serviceErrors[0]);
      assert.equal(serviceError.event, 'rdp_connection_failed');
      assert.equal(serviceError.code, '519');
      assert.equal(serviceError.sessionId, id);
      assert.match(serviceError.message, /SSL\/TLS/);
      assert.doesNotMatch(serviceErrors[0], /synthetic-password/);
    },
  );
