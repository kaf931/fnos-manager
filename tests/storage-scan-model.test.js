import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScanFiles, duplicatePlan, reportCsv } from '../.web-test/storage-scan-model.js';
test('file views filter by size and modification age, sort without mutating index', () => {
  const files = [
    { name: 'b', path: '/b', size: 20 * 1024 ** 2, modifiedAt: 1 },
    { name: 'a', path: '/a', size: 1, modifiedAt: 100000000 },
  ];
  assert.equal(selectScanFiles({ catalog: files }, { minimumMiB: 10 }).length, 1);
  assert.equal(selectScanFiles({ catalog: files }, { olderDays: 1, now: 100000000 })[0].path, '/b');
  assert.equal(selectScanFiles({ catalog: files }, { sort: 'name' })[0].name, 'a');
  assert.equal(files[0].name, 'b');
  assert.equal(selectScanFiles({ largestFiles: files }, { view: 'large' }).length, 2);
});
test('duplicate plan requires a kept copy and explicit candidates, never includes keeper', () => {
  const g = { paths: ['/a', '/b', '/c'], size: 4 };
  assert.deepEqual(duplicatePlan(g, 'missing', new Set(['/b'])), []);
  assert.deepEqual(duplicatePlan(g, '/a', new Set(['/a', '/b'])), [
    { keep: '/a', path: '/b', size: 4 },
  ]);
  assert.match(reportCsv([{ keep: '=x', path: 'a"b', size: 4 }]), /"'=x","a""b","4"/);
});
