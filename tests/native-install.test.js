import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShortcutVolume, applicationCommand } from '../server/native.js';
import { errorResponse } from '../server/app/common/errors.js';
test('shortcut volume follows the resolved application target, including a previous shortcut volume', async () => {
  assert.equal(
    await resolveShortcutVolume(
      '/var/apps/deskicons/target',
      async () => '/vol1/@appcenter/deskicons',
    ),
    1,
  );
  assert.equal(
    await resolveShortcutVolume(
      '/var/apps/deskicon.test/target',
      async () => '/vol3/@appcenter/deskicon.test',
    ),
    3,
  );
  await assert.rejects(
    () => resolveShortcutVolume('/invalid', async () => '/tmp/vol1/@appcenter/deskicons'),
    /安装存储卷/,
  );
  await assert.rejects(
    () =>
      resolveShortcutVolume('/missing', async () => {
        throw Error('secret path');
      }),
    /安装存储卷/,
  );
});
test('native application failures preserve a safe actionable error instead of generic 500', async () => {
  await assert.rejects(
    () =>
      applicationCommand(['install-fpk', 'fixture.fpk'], async () => ({
        stdout: '[Error]Use --volume to specify the volume index',
        stderr: '',
      })),
    (e) => {
      const response = errorResponse(e);
      assert.equal(response.status, 503);
      assert.match(response.error, /存储卷/);
      return true;
    },
  );
  await assert.rejects(
    () =>
      applicationCommand(['install-fpk', 'fixture.fpk'], async () => {
        throw Object.assign(Error('Command failed: private'), { code: 'EACCES' });
      }),
    (e) => {
      assert.match(errorResponse(e).error, /权限/);
      assert.doesNotMatch(errorResponse(e).error, /private/);
      return true;
    },
  );
});
