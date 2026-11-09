import { seedPowerConnections } from './fixtures/power-connections.js';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { WakePower, powerCommand } from '../server/wake-power.js';
import { WakeService } from '../server/wol.js';
import { TerminalStore } from '../server/terminal/store.js';
import { sshFixture } from './fixtures/ssh-server.js';
test('power commands are fixed, platform-specific and never force-close applications', () => {
  assert.equal(powerCommand('linux', 'shutdown', 'root'), 'systemctl poweroff');
  assert.equal(powerCommand('linux', 'reboot', 'user'), 'sudo -n -- systemctl reboot');
  assert.equal(powerCommand('windows', 'shutdown', 'admin'), 'shutdown.exe /s /t 0');
  assert.equal(powerCommand('macos', 'reboot', 'admin'), 'sudo -n -- /sbin/shutdown -r now');
  assert.throws(() => powerCommand('linux', 'echo bad', 'root'));
});
test('SSH power requires trusted host and saved credentials; fixture receives only fixed command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'power-ssh-')),
    commands = [],
    fixture = await sshFixture({
      execHandler: (command, stream) => {
        commands.push(command);
        stream.exit(command.includes('poweroff') ? 1 : 0);
        stream.end();
      },
    });
  let power;
  try {
    const store = await new TerminalStore(dir).init(),
      c = await store.save('a', {
        name: 'test',
        kind: 'remote',
        host: '127.0.0.1',
        port: fixture.port,
        username: 'tester',
        authMethod: 'password',
        credentials: { password: 'fixture-password' },
      }),
      device = { connectionId: c.id, system: 'linux' };
    power = new WakePower(store);
    await assert.rejects(power.execute('a', device, 'reboot'), /指纹/);
    assert.equal(commands.length, 0);
    const key = ssh2.utils.parseKey(fixture.hostKey);
    await store.trustHostKey('a', {
      host: c.host,
      port: c.port,
      algorithm: key.type,
      key: key.getPublicSSH().toString('base64'),
    });
    await power.execute('a', device, 'reboot');
    assert.deepEqual(commands, ['sudo -n -- systemctl reboot']);
    await assert.rejects(power.execute('a', device, 'shutdown'), /权限/);
    assert.throws(() => power.prepare('b', device, 'reboot'), { status: 404 });
    const privateC = await store.save('a', {
      name: 'key-test',
      kind: 'remote',
      host: c.host,
      port: c.port,
      username: 'tester',
      authMethod: 'privateKey',
      credentials: { privateKey: fixture.userKey },
    });
    await power.execute('a', { ...device, connectionId: privateC.id }, 'reboot');
    assert.equal(commands.length, 3);
  } finally {
    power?.close();
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('power batch validates confirmation and every target before executing; preserves partial result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'power-batch-'));
  let executions = 0;
  const power = {
    prepare: (_owner, row) => {
      if (!row.connectionId) throw Error('未关联');
      return { connection: { host: '192.168.1.20', port: 22, username: 'root' } };
    },
    execute: async (_owner, row) => {
      executions++;
      if (row.name === 'fail') throw Error('denied');
    },
    close() {},
  };
  try {
    seedPowerConnections(dir, { ['a'.repeat(24)]: {} }, 'a');
    const service = await new WakeService({
        dataDir: dir,
        power,
        terminalStore: { get: () => ({ kind: 'remote', hasCredentials: true }) },
      }).init(),
      input = {
        name: 'ok',
        mac: '02:11:22:33:44:55',
        address: '192.168.1.255',
        connectionId: 'a'.repeat(24),
      },
      a = await service.save('a', input),
      b = await service.save('a', { ...input, name: 'fail' }),
      c = await service.save('a', { ...input, name: 'missing', connectionId: null });
    await assert.rejects(service.controlMany('a', { ids: [a.id], action: 'reboot' }), /确认/);
    await assert.rejects(
      service.controlMany('a', { ids: [a.id, c.id], action: 'reboot', confirmed: true }),
      /未关联/,
    );
    assert.equal(executions, 0);
    await assert.rejects(
      service.controlMany('a', {
        ids: [a.id],
        action: 'reboot',
        confirmed: true,
        targets: [
          {
            id: a.id,
            connectionId: a.connectionId,
            system: 'linux',
            host: '192.168.1.21',
            port: 22,
            username: 'root',
          },
        ],
      }),
      /目标已变化/,
    );
    assert.equal(executions, 0);
    const result = await service.controlMany('a', {
      ids: [a.id, b.id],
      action: 'shutdown',
      confirmed: true,
    });
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.equal(service.get('a', a.id).lastControl.action, 'shutdown');
    assert.equal(service.get('a', b.id).lastControl, undefined);
    assert.equal(service.active.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('timed out or closed power client cannot start a command after late ready', async () => {
  class Client extends EventEmitter {
    connect() {}
    destroy() {}
    exec() {
      this.commands = (this.commands || 0) + 1;
    }
  }
  const client = new Client(),
    power = new WakePower(null, { clientFactory: () => client, timeout: 5 }),
    prepared = {
      connection: { host: 'test', port: 22, username: 'root' },
      credentials: { method: 'password', password: 'test' },
      command: 'systemctl reboot',
    };
  await assert.rejects(power.execute('a', {}, 'reboot', prepared), /超时/);
  client.emit('ready');
  assert.equal(client.commands || 0, 0);
  power.close();
  await assert.rejects(power.execute('a', {}, 'reboot', prepared), /已关闭/);
});
test('scheduler abort prevents a pending SSH command from running after ready', async () => {
  class Client extends EventEmitter {
    connect() {}
    destroy() {}
    exec() {
      this.commands = (this.commands || 0) + 1;
    }
  }
  const client = new Client(),
    power = new WakePower(null, { clientFactory: () => client }),
    abort = new AbortController(),
    prepared = {
      connection: { host: 'test', port: 22, username: 'root' },
      credentials: { method: 'password', password: 'test' },
      command: 'systemctl reboot',
    },
    pending = power.execute('a', {}, 'reboot', prepared, { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, /中断/);
  client.emit('ready');
  assert.equal(client.commands || 0, 0);
  power.close();
});
