import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permissionRows,
  togglePermission,
  parsePermission,
  formatPermission,
  isArchiveName,
} from '../.web-test/terminal-file-actions.js';
test('permission matrix and octal value stay in sync without losing special bits', () => {
  assert.equal(permissionRows(0o640)[0].read, true);
  assert.equal(permissionRows(0o640)[1].write, false);
  assert.equal(togglePermission(0o4640, 'other', 'execute', true), 0o4641);
  assert.equal(formatPermission(parsePermission('0755')), '0755');
  assert.throws(() => parsePermission('888'));
  assert.equal(isArchiveName('中文.TAR.GZ'), true);
  assert.equal(isArchiveName('file.txt'), false);
});
