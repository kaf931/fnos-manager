import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ssh2 from 'ssh2';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture } from './fixtures/ssh-server.js';
import { TerminalService } from '../server/app/terminal/terminal.service.js';
test('AI APIs enforce owner CSRF DTO and require one confirmation before real SSH execution', async (t) => {
  let execs = 0,
    turn = 0;
  const model = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: turn++
                ? { content: '完成' }
                : {
                    content: '检查当前目录',
                    tool_calls: [
                      {
                        id: 'call1',
                        type: 'function',
                        function: {
                          name: 'run_ssh_command',
                          arguments: '{"command":"pwd","explanation":"查看目录"}',
                        },
                      },
                    ],
                  },
            },
          ],
        }),
      );
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => model.close(r)));
  const ssh = await sshFixture({
    execHandler: (_cmd, s) => {
      execs++;
      s.write('/home/test');
      s.exit(0);
      s.end();
    },
  });
  t.after(() => ssh.close());
  const client = new ssh2.Client();
  t.after(() => client.destroy());
  await new Promise((r, j) =>
    client.once('ready', r).once('error', j).connect({
      host: '127.0.0.1',
      port: ssh.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const f = await appFixture();
  t.after(f.close);
  assert.equal((await f.call('/ai/settings')).status, 200);
  assert.equal(
    (
      await f.call('/ai/settings', 'PUT', {
        baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
        model: 'test',
        apiKey: 'secret-key',
      })
    ).status,
    200,
  );
  assert.equal((await (await f.call('/ai/settings')).json()).apiKey, 'secret-key');
  assert.equal(
    (await f.call('/ai/settings', 'GET', null, { 'x-trim-isadmin': 'false' })).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        '/ai/settings',
        'PUT',
        { baseUrl: 'http://host', model: 'test' },
        { 'x-deskicons-token': 'bad' },
      )
    ).status,
    403,
  );
  const transport = f.app.get(TerminalService).service;
  const saved = await (
    await f.call('/connections', 'POST', { name: 'Test', kind: 'local', username: 'test' })
  ).json();
  const session = transport.create('1000', saved, 'http://nas:5666');
  transport.connectedOwned = (owner, id) => {
    if (owner !== '1000' || id !== session.id || !transport.sessions.has(id))
      throw Object.assign(new Error('会话不存在'), { status: 404 });
    return { client, state: 'connected', closed: false };
  };
  const route = '/sessions/' + session.id + '/ai';
  assert.equal((await f.call(route + '/messages', 'POST', { text: '检查' })).status, 202);
  async function read() {
    for (let i = 0; i < 100; i++) {
      const state = await (await f.call(route + '/conversation')).json();
      if (!state.busy) return state;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.fail('timeout');
  }
  let state = await read();
  assert.equal(execs, 0);
  const id = state.proposals[0].proposalId;
  assert.equal(
    (
      await f.call(route + '/proposals/' + id + '/execute', 'POST', {
        confirmed: true,
        command: 'rm -rf /',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        route + '/proposals/' + id + '/execute',
        'POST',
        { confirmed: true },
        { 'x-trim-userid': '1001' },
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.call(route + '/proposals/' + id + '/execute', 'POST', { confirmed: true })).status,
    202,
  );
  state = await read();
  assert.equal(execs, 1);
  assert.equal(state.messages.at(-1).content, '完成');
  assert.equal(state.proposals[0].result.stdout, '/home/test');
  assert.equal(
    (await f.call(route + '/proposals/' + id + '/execute', 'POST', { confirmed: true })).status,
    409,
  );
  assert.equal(execs, 1);
  const chatId = state.chatId;
  const historyRows = await (await f.call('/ai/history')).json();
  assert.equal(historyRows.length, 1);
  assert.equal(
    (await f.call('/ai/history/' + chatId, 'GET', null, { 'x-trim-userid': '1001' })).status,
    404,
  );
  const detail = await (await f.call('/ai/history/' + chatId)).json();
  assert.equal(detail.history, undefined);
  assert.equal(detail.messages.at(-1).content, '完成');
  assert.equal((await f.call(route + '/new', 'POST', { confirmed: true })).status, 201);
  assert.equal((await (await f.call(route + '/conversation')).json()).messages.length, 0);
  assert.equal(
    (await f.call(route + '/history/' + chatId + '/restore', 'POST', { confirmed: true })).status,
    201,
  );
  assert.equal((await (await f.call(route + '/conversation')).json()).chatId, chatId);
  assert.equal(execs, 1);
  const added = await (
    await f.call('/ai/providers', 'POST', {
      name: 'Other',
      protocol: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'local',
      apiKey: 'other-key',
    })
  ).json();
  assert.equal(added.hasKey, true);
  assert.equal(added.apiKey, 'other-key');
  assert.equal(
    (await f.call('/ai/providers/' + added.id, 'DELETE', null, { 'x-trim-userid': '1001' })).status,
    404,
  );
  assert.equal((await f.call('/ai/providers/' + added.id, 'DELETE')).status, 200);
  transport.remove(session.id);
  assert.equal((await f.call(route + '/conversation')).status, 404);
  assert.equal((await (await f.call('/ai/history')).json()).length, 1);
});
