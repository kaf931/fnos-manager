import {legacyNotificationSchema} from './fixtures/notification-schema.js';
import { appearanceSchema } from '../server/persistence/schema.js';
import { rdpSchema } from '../server/persistence/schema.js';
import { vncCursorSchema } from '../server/persistence/schema.js';
import { retentionSchema } from '../server/persistence/schema.js';
import { vncSchema, vncPreferencesSchema } from '../server/persistence/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createLifecycleHook } from '../scripts/lifecycle-hooks.js';
import {
  schema,
  reachabilitySchema,
  operationSchema,
  notificationSchema,
  backupSchema,
  menuEntrySchema,
  aiAttachmentsSchema,
  aiAttachmentCleanupSchema,
  aiSkillsSchema,
  aiSkillPackagesSchema,
  aiArchiveAttachmentsSchema,
} from '../server/persistence/schema.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'nas-lifecycle-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, TRIM_APPNAME: 'deskicons' };
  for (const [key, folder] of [
    ['TRIM_PKGVAR', '@appdata'],
    ['TRIM_PKGETC', '@appconf'],
    ['TRIM_PKGHOME', '@apphome'],
  ]) {
    env[key] = path.join(root, 'vol1', folder, 'deskicons');
    await mkdir(env[key], { recursive: true });
    await writeFile(path.join(env[key], 'sentinel'), folder);
  }
  const run = (action, extra = {}) =>
    spawnSync(process.execPath, ['server/lifecycle.js', action], {
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
  return { root, env, run };
}

test('uninstall defaults to keeping all application data', async (t) => {
  const { env, run } = await fixture(t);
  const result = run('uninstall');
  assert.equal(result.status, 0, result.stderr);
  for (const key of ['TRIM_PKGVAR', 'TRIM_PKGETC', 'TRIM_PKGHOME'])
    assert.ok(await readFile(path.join(env[key], 'sentinel'), 'utf8'));
});

test('explicit deletion only clears own data and never follows child symlinks', async (t) => {
  const { root, env, run } = await fixture(t);
  const outside = path.join(root, 'user-file');
  await writeFile(outside, 'untouched');
  await symlink(outside, path.join(env.TRIM_PKGVAR, 'external'));
  const result = run('uninstall', { wizard_data_action: 'delete' });
  assert.equal(result.status, 0, result.stderr);
  for (const key of ['TRIM_PKGVAR', 'TRIM_PKGETC', 'TRIM_PKGHOME'])
    await assert.rejects(readFile(path.join(env[key], 'sentinel')));
  assert.equal(await readFile(outside, 'utf8'), 'untouched');
});

test('invalid choice or redirected application data path is rejected before deletion', async (t) => {
  const { root, env, run } = await fixture(t);
  assert.notEqual(run('uninstall', { wizard_data_action: 'invalid' }).status, 0);
  assert.notEqual(run('uninstall', { wizard_data_action: 'delete', TRIM_PKGVAR: root }).status, 0);
  await rm(env.TRIM_PKGETC, { recursive: true });
  await symlink(root, env.TRIM_PKGETC);
  assert.notEqual(run('uninstall', { wizard_data_action: 'delete' }).status, 0);
  assert.equal(await readFile(path.join(env.TRIM_PKGVAR, 'sentinel'), 'utf8'), '@appdata');
});

test('install and update reuse existing SQLite records and preserve auxiliary data', async (t) => {
  const { env, run } = await fixture(t);
  assert.equal(run('install').status, 0);
  const file = path.join(env.TRIM_PKGVAR, 'nas-manager.sqlite');
  let db = new DatabaseSync(file);
  db.exec("CREATE TABLE lifecycle_test(value TEXT); INSERT INTO lifecycle_test VALUES('keep')");
  db.close();
  for (const action of ['upgrade-check', 'upgrade', 'install']) {
    const result = run(action);
    assert.equal(result.status, 0, result.stderr);
  }
  db = new DatabaseSync(file);
  assert.equal(db.prepare('SELECT value FROM lifecycle_test').get().value, 'keep');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  assert.equal(await readFile(path.join(env.TRIM_PKGVAR, 'sentinel'), 'utf8'), '@appdata');
});

test('corrupt database is rejected without replacing its contents', async (t) => {
  const { env, run } = await fixture(t);
  const file = path.join(env.TRIM_PKGVAR, 'nas-manager.sqlite');
  await writeFile(file, 'corrupt database');
  assert.notEqual(run('upgrade-check').status, 0);
  assert.notEqual(run('install').status, 0);
  assert.equal(await readFile(file, 'utf8'), 'corrupt database');
});

test('install refuses a dangling database symlink without creating the external target', async (t) => {
  const { root, env, run } = await fixture(t);
  const outside = path.join(root, 'external.sqlite');
  await symlink(outside, path.join(env.TRIM_PKGVAR, 'nas-manager.sqlite'));
  assert.notEqual(run('install').status, 0);
  await assert.rejects(readFile(outside));
});

test('upgrade migrates a schema 7 database while keeping icon records', async (t) => {
  const { env, run } = await fixture(t);
  const file = path.join(env.TRIM_PKGVAR, 'nas-manager.sqlite');
  let db = new DatabaseSync(file);
  db.exec(
    legacyNotificationSchema(schema)
      .replace(
        /CREATE TABLE text_file_versions[\s\S]*?CREATE INDEX text_file_versions_scope[^;]*;/,
        '',
      )
      .replace(/INSERT INTO schema_migrations VALUES\(18[^;]*;/, '')
      .replace(reachabilitySchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(17[^;]*;/, '')
      .replace(operationSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(16[^;]*;/, '')
      .replace(notificationSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(15[^;]*;/, '')
      .replace(backupSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(14[^;]*;/, '')
      .replace(aiArchiveAttachmentsSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(13[^;]*;/, '')
      .replace(aiSkillPackagesSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(12[^;]*;/, '')
      .replace(aiSkillsSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(11[^;]*;/, '')
      .replace(menuEntrySchema, '')
      .replace(aiAttachmentCleanupSchema, '')
      .replace(aiAttachmentsSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(9,[^;]+;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(8,[^;]+;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(10[^;]*;/, '')
      .replace(retentionSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(21[^;]*;/, '')
      .replace(vncPreferencesSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(20[^;]*;/, '')
      .replace(vncSchema, '')
      .replace(rdpSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(23[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(19[^;]*;/, '')
      .replace(vncCursorSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(22[^;]*;/, '')
      .replace(appearanceSchema, '')
      .replace(/CREATE TABLE update_settings[\s\S]*?\) STRICT;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(26[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(25[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(24[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(27[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(28[^;]*;/, '')
        .replace(/CREATE TABLE adb_connections[\s\S]*?CREATE INDEX adb_connections_owner[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(29[^;]*;/, '')
        .replace(/CREATE TABLE IF NOT EXISTS notification_options[\s\S]*?\) STRICT;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(30[^;]*;/, '')
        .replace('PRAGMA user_version=30;', 'PRAGMA user_version=7;'),
  );
  db.exec(
    "INSERT INTO icons(id,name,url,mode) VALUES('sample01','Keep','http://example.test/','iframe')",
  );
  db.close();
  assert.equal(run('upgrade-check').status, 0);
  const result = run('upgrade');
  assert.equal(result.status, 0, result.stderr);
  db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 35);
  assert.deepEqual(
    { ...db.prepare('SELECT name,menu_page FROM icons WHERE id=?').get('sample01') },
    { name: 'Keep', menu_page: null },
  );
  db.close();
});

test('generated upgrade and uninstall hooks abort when service stop fails', async (t) => {
  const { root, env } = await fixture(t);
  const cmd = path.join(root, 'cmd');
  await mkdir(cmd);
  await writeFile(path.join(cmd, 'main'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  for (const name of ['upgrade_init', 'uninstall_init']) {
    const hook = path.join(cmd, name);
    await writeFile(hook, createLifecycleHook(name), { mode: 0o755 });
    const result = spawnSync('/bin/sh', [hook], {
      env: { ...env, wizard_data_action: 'delete' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(await readFile(path.join(env.TRIM_PKGVAR, 'sentinel'), 'utf8'), '@appdata');
  }
});

test('deleting app data leaves sibling applications and linked external directories intact', async (t) => {
  const { root, env, run } = await fixture(t);
  const sibling = path.join(path.dirname(env.TRIM_PKGVAR), 'another-app');
  const outside = path.join(root, 'shared-files');
  await mkdir(sibling);
  await mkdir(outside);
  for (const dir of [sibling, outside]) await writeFile(path.join(dir, 'keep'), 'untouched');
  await symlink(outside, path.join(env.TRIM_PKGVAR, 'external-folder'));
  assert.equal(run('uninstall', { wizard_data_action: 'delete' }).status, 0);
  for (const dir of [sibling, outside])
    assert.equal(await readFile(path.join(dir, 'keep'), 'utf8'), 'untouched');
});
