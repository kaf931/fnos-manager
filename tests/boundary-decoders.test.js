import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScanProgress, decodeScanResult } from '../server/storage/messages.js';
import { decodeStoredCredentials } from '../server/domain/terminal.js';

test('scan boundary rejects malformed counters and nested results', () => {
  assert.throws(() => decodeScanProgress({ files: '1', directories: 0, bytes: 0, hashedBytes: 0 }));
  assert.throws(() => decodeScanProgress({ files: NaN, directories: 0, bytes: 0, hashedBytes: 0 }));
  assert.deepEqual(decodeScanProgress({ files: 1, directories: 0, bytes: 1, hashedBytes: 0 }), {
    files: 1,
    directories: 0,
    bytes: 1,
    hashedBytes: 0,
  });
  const valid = {
    files: 0,
    directories: 0,
    bytes: 0,
    hashedBytes: 0,
    skippedLinks: 0,
    skippedMounts: 0,
    errors: 0,
    groupCount: 0,
    reclaimable: 0,
    catalogTruncated: false,
    truncated: false,
    catalog: [],
    largestFiles: [],
    entries: [],
    extensions: [],
    groups: [],
  };
  assert.deepEqual(decodeScanResult(valid), valid);
  assert.throws(() => decodeScanResult({ ...valid, groups: [{ size: 1, paths: [42] }] }));
  assert.throws(() => decodeScanResult({ ...valid, catalog: [{ path: 9 }] }));
});
test('stored SSH credentials are decoded by method and reject malformed values', () => {
  assert.deepEqual(
    decodeStoredCredentials('password', { method: 'password', password: 'secret' }),
    { method: 'password', password: 'secret' },
  );
  assert.throws(() => decodeStoredCredentials('password', { method: 'password', password: 3 }));
  assert.throws(() =>
    decodeStoredCredentials('password', {
      method: 'privateKey',
      privateKey: 'key',
      passphrase: '',
    }),
  );
  assert.throws(() =>
    decodeStoredCredentials('privateKey', {
      method: 'privateKey',
      privateKey: 'key',
      passphrase: {},
    }),
  );
});
