import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, validateMove } from '../.web-test/terminal-tree-model.js';
test('legacy connections stay root and folders nest with sorted children', () => {
  const tree = buildTree(
    [
      { id: 'f', kind: 'folder', scope: 'assets', name: 'Z', parentId: null },
      { id: 'g', kind: 'folder', scope: 'assets', name: 'A', parentId: 'f' },
    ],
    [
      { id: 'old', name: 'Old' },
      { id: 'c', name: 'B', folderId: 'g' },
    ],
  );
  assert.equal(tree[0].id, 'f');
  assert.equal(tree[0].children[0].children[0].id, 'c');
  assert.equal(tree[1].id, 'old');
});
test('moving rejects missing parents and cycles but permits root and sibling moves', () => {
  const rows = [
    { id: 'a', kind: 'folder', scope: 'assets' },
    { id: 'b', kind: 'folder', scope: 'assets', parentId: 'a' },
  ];
  assert.throws(() => validateMove(rows, 'a', 'b', 'assets'));
  assert.throws(() => validateMove(rows, 'a', 'missing', 'assets'));
  assert.equal(validateMove(rows, 'b', null, 'assets'), null);
});
test('asset nodes retain local and remote fields when passed to connection editor', () => {
  for (const kind of ['local', 'remote']) {
    const [node] = buildTree(
      [],
      [
        {
          id: kind,
          name: kind,
          kind,
          host: 'example.test',
          port: 2222,
          username: 'user',
          hasCredentials: true,
          authMethod: 'password',
        },
      ],
    );
    assert.equal(node.kind, kind);
    assert.equal(node.host, 'example.test');
    assert.equal(node.nodeType, 'connection');
  }
});
import { planTreeMove } from '../.web-test/terminal-tree-model.js';
test('drag plans move only parent metadata for connections, folders and commands', () => {
  const items = [
      { id: 'a', kind: 'folder', scope: 'assets', name: 'A', parentId: null },
      { id: 'b', kind: 'folder', scope: 'assets', name: 'B', parentId: 'a' },
    ],
    connections = [{ id: 'c', folderId: null, host: 'nas' }];
  assert.deepEqual(planTreeMove({ items, connections, scope: 'assets', id: 'c', parentId: 'b' }), {
    path: '/terminal/connections/c/folder',
    body: { folderId: 'b' },
  });
  assert.equal(
    planTreeMove({ items, connections, scope: 'assets', id: 'c', parentId: null }),
    null,
  );
  assert.throws(() => planTreeMove({ items, scope: 'assets', id: 'a', parentId: 'b' }));
  assert.throws(() => planTreeMove({ items, scope: 'commands', id: 'a', parentId: null }));
  const commands = [
    { id: 'f', kind: 'folder', scope: 'commands', parentId: null },
    { id: 'q', kind: 'command', scope: 'commands', parentId: 'f', content: 'pwd' },
  ];
  assert.deepEqual(planTreeMove({ items: commands, scope: 'commands', id: 'q', parentId: null }), {
    path: '/terminal/workspace/q',
    body: { parentId: null },
  });
});
