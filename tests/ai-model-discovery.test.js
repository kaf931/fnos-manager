import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiModelDiscovery, aiModelChoice } from '../.web-test/terminal-ai-model-discovery.js';
test('provider model discovery rejects stale profiles and model lists after settings changes', async () => {
  const requests = [],
    updates = [];
  const d = createAiModelDiscovery(
    (path) => new Promise((resolve) => requests.push({ path, resolve })),
    (x) => updates.push(x),
  );
  const first = d.refresh(),
    second = d.refresh();
  requests[1].resolve([{ id: 'new', name: 'New', model: 'm' }]);
  await Promise.resolve();
  requests[0].resolve([{ id: 'old', name: 'Old', model: 'm' }]);
  await first;
  assert.equal(updates.length, 1);
  assert.equal(updates[0].models[0].value, aiModelChoice('new', 'm'));
  const third = d.refresh();
  requests[3].resolve([{ id: 'latest', name: 'Latest', model: 'z' }]);
  await Promise.resolve();
  requests[2].resolve(['obsolete']);
  await second;
  assert.equal(updates.at(-1).providers[0].id, 'latest');
  requests[4].resolve(['z', 'y']);
  await third;
  assert.equal(updates.at(-1).models.length, 2);
  const last = d.refresh();
  d.dispose();
  requests[5].resolve([]);
  await last;
  assert.equal(updates.at(-1).models.length, 2);
});

test('model labels omit provider names while choices keep provider identity and full model IDs', async () => {
  let latest;
  const providers = [
    { id: 'a', name: 'First provider', model: 'org/model' },
    { id: 'b', name: 'Second provider', model: 'org/model' },
  ];
  const discovery = createAiModelDiscovery(
    async (path) => (path.endsWith('/providers') ? providers : ['org/model']),
    (value) => (latest = value),
  );
  await discovery.refresh();
  assert.deepEqual(
    latest.models.map((option) => option.label),
    ['org/model', 'org/model'],
  );
  assert.deepEqual(
    latest.models.map((option) => option.value),
    [aiModelChoice('a', 'org/model'), aiModelChoice('b', 'org/model')],
  );
  discovery.dispose();
});
