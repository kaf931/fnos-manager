import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  openSync,
  writeSync,
  closeSync,
  symlinkSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { ServiceLog } from '../server/maintenance/service-log.js';
test('service log rotation is bounded and an existing append descriptor keeps working', (t) => {
  const dir = mkdtempSync(tmpdir() + '/service-rotate-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(dir + '/service.log', Buffer.alloc(3 * 1024 * 1024, 65));
  const fd = openSync(dir + '/service.log', 'a'),
    log = new ServiceLog(dir);
  try {
    log.enforce(1024 * 1024);
    assert.equal(statSync(dir + '/service.log').size, 0);
    assert.equal(statSync(dir + '/service.log.1').size, 1024 * 1024);
    writeSync(fd, 'still writing');
    assert.equal(readFileSync(dir + '/service.log', 'utf8'), 'still writing');
    log.enforce(128);
    assert.equal(statSync(dir + '/service.log.1').size, 128);
    assert.equal(log.clear(), 2);
    writeSync(fd, 'after clear');
    assert.equal(readFileSync(dir + '/service.log', 'utf8'), 'after clear');
  } finally {
    closeSync(fd);
  }
});
test('service log cleanup never follows a symlink', (t) => {
  const dir = mkdtempSync(tmpdir() + '/service-link-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(dir + '/keep', 'keep');
  symlinkSync(dir + '/keep', dir + '/service.log');
  assert.throws(() => new ServiceLog(dir).clear());
  assert.equal(readFileSync(dir + '/keep', 'utf8'), 'keep');
});
