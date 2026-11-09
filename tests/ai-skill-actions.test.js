import test from 'node:test';
import assert from 'node:assert/strict';
import { AiConversationService } from '../server/terminal/ai/conversation.js';
test('runtime tool waits for approval and resource reads retain protocol names', async () => {
  const { parseAiCall, splitAiCalls } = await import('../server/terminal/ai/tools.js');
  const split = splitAiCalls([
    parseAiCall('r', 'read_skill_resource', {
      name: 'example',
      revision: 1,
      path: 'reference/a.md',
      offset: 0,
    }),
    parseAiCall('p', 'prepare_skill_runtime', {
      name: 'example',
      revision: 1,
      explanation: '准备',
    }),
  ]);
  assert.equal(split.skillCalls[0].action, 'read_skill_resource');
  assert.equal(split.toolCalls[0].kind, 'prepare_skill_runtime');
  let turns = 0,
    prepares = 0;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        baseUrl: 'http://fixture',
        model: 'test',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    skillActions: {
      bind: () => ({ skillId: 'x', packageId: 'p', revision: 1, sha256: 'a'.repeat(64) }),
      read: async () => ({ text: 'reference' }),
      execute: async () => {
        prepares++;
        return { stdout: 'ready', stderr: '', exitCode: 0, status: 'success', truncated: false };
      },
    },
    provider: {
      complete: async (_s, m) => {
        turns++;
        if (turns === 1) return { content: '', ...split };
        assert.ok(m.some((x) => x.role === 'tool' && x.content.includes('ready')));
        return { content: 'done', toolCalls: [] };
      },
    },
  });
  service.message('a', 'ssh', 'use package');
  while (service.snapshot('a', 'ssh').busy) await new Promise((r) => setTimeout(r, 2));
  assert.equal(prepares, 0);
  const p = service.snapshot('a', 'ssh').proposals[0];
  service.execute('a', 'ssh', p.proposalId);
  while (service.snapshot('a', 'ssh').busy) await new Promise((r) => setTimeout(r, 2));
  assert.equal(prepares, 1);
  await service.close();
});
test('new resource and runtime tools serialize and pair across all native protocol adapters', async () => {
  const { AI_TOOLS, parseAiCall, protocolAiCalls } = await import('../server/terminal/ai/tools.js');
  const calls = ['list_skill_resources', 'read_skill_resource', 'prepare_skill_runtime'];
  for (const name of calls) assert.ok(AI_TOOLS.some((t) => t.function.name === name));
  assert.throws(() =>
    parseAiCall('bad', 'read_skill_resource', {
      name: 'example',
      revision: 0,
      path: 'a',
      offset: 0,
    }),
  );
  assert.throws(() =>
    parseAiCall('bad', 'prepare_skill_runtime', {
      name: 'example',
      revision: 1,
      explanation: 'ready',
      owner: 'other',
    }),
  );
  const mapped = protocolAiCalls([
    parseAiCall('r', 'read_skill_resource', { name: 'example', revision: 1, path: 'a', offset: 0 }),
  ]);
  assert.equal(mapped[0].function.name, 'read_skill_resource');
  assert.deepEqual(JSON.parse(mapped[0].function.arguments), {
    name: 'example',
    revision: 1,
    path: 'a',
    offset: 0,
  });
});
test('SSH command proposals derived from a package expire when that package changes', async () => {
  let revision = 1,
    execs = 0;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        baseUrl: 'http://fixture',
        model: 'test',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    skillActions: {
      capture: () => [{ skillId: 'skill', packageId: 'pkg', revision: 1, sha256: 'a'.repeat(64) }],
      validate: (_owner, refs) => {
        if (refs[0].revision !== revision) throw Error('changed');
      },
      bind: () => {
        throw Error();
      },
      read: async () => {},
      execute: async () => {
        throw Error();
      },
    },
    provider: {
      complete: async () => ({
        content: 'check',
        toolCalls: [{ id: 'p', command: 'echo hello', explanation: 'check' }],
      }),
    },
    execute: async () => {
      execs++;
      return { stdout: '', stderr: '', exitCode: 0, status: 'success', truncated: false };
    },
  });
  service.message('owner', 'ssh', 'check');
  while (service.snapshot('owner', 'ssh').busy) await new Promise((r) => setTimeout(r, 2));
  revision = 2;
  const proposal = service.snapshot('owner', 'ssh').proposals[0];
  service.execute('owner', 'ssh', proposal.proposalId);
  while (service.snapshot('owner', 'ssh').busy) await new Promise((r) => setTimeout(r, 2));
  assert.equal(execs, 0);
  await service.close();
});
