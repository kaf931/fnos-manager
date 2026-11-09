import { cp, mkdir, rename, rm, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { UpdatePhase, UpdateSpec } from './job.js';
const exec = promisify(execFile);
const parts = ['dist', 'server', 'tools', 'node_modules', 'package.json', 'package-lock.json'];
const dbFiles = ['nas-manager.sqlite', 'nas-manager.sqlite-wal', 'nas-manager.sqlite-shm'];
export async function service(spec: UpdateSpec, action: 'start' | 'stop'): Promise<void> {
  await exec(spec.serviceScript, [action], {
    timeout: 45000,
    maxBuffer: 65536,
    env: { ...process.env, TRIM_PKGVAR: spec.dataDir, TRIM_APPDEST: spec.root },
  });
}
export function checkDatabase(file: string): void {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (
      Object.values(db.prepare('PRAGMA integrity_check').get() || {})[0] !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('数据库完整性检查失败');
  } finally {
    db.close();
  }
}
export function configurationCounts(file: string): Record<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const counts: Record<string, number> = {};
    for (const name of [
      'icons',
      'tasks',
      'ssh_connections',
      'vnc_connections',
      'rdp_connections',
      'wake_devices',
    ]) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
        counts[name] = Number(db.prepare('SELECT count(*) n FROM ' + name).get()?.n);
    }
    return counts;
  } finally {
    db.close();
  }
}
export async function localRequest(spec: UpdateSpec, route: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: path.join(spec.root, 'app.sock'),
        path: '/app/deskicons/api' + route,
        headers: { 'x-trim-userid': '1000', 'x-trim-isadmin': 'true', Host: 'localhost' },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          text += c;
          if (text.length > 2 * 1024 * 1024) req.destroy(new Error('验收响应过大'));
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200)
              throw new Error(`关键接口 ${route} 返回 HTTP ${res.statusCode}`);
            resolve(JSON.parse(text));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(3000, () => req.destroy(new Error('启动验收超时')));
    req.on('error', reject);
    req.end();
  });
}
export async function health(spec: UpdateSpec, expected: string): Promise<void> {
  const deadline = Date.now() + 60000;
  let lastError = '应用未响应';
  while (Date.now() < deadline) {
    try {
      const state = (await localRequest(spec, '/state')) as { version?: string };
      if (state.version !== expected)
        throw new Error(`运行版本不匹配：预期 ${expected}，实际 ${state.version || '未知'}`);
      for (const route of [
        '/preferences',
        '/entries',
        '/tasks',
        '/terminal/connections',
        '/storage/cleanup',
      ])
        await localRequest(spec, route);
      checkDatabase(path.join(spec.dataDir, 'nas-manager.sqlite'));
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : '应用未响应';
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('更新后的应用未通过启动验收：' + lastError);
}
export async function validateDatabaseCompatibility(
  spec: UpdateSpec,
  stage: string,
): Promise<void> {
  let schema: string;
  try {
    schema = await readFile(path.join(stage, 'server/persistence/schema.js'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  const match = /\bSCHEMA_VERSION\s*=\s*(\d+)/.exec(schema);
  if (!match) throw new Error('无法识别安装包的数据库版本');
  const db = new DatabaseSync(path.join(spec.dataDir, 'nas-manager.sqlite'), { readOnly: true });
  try {
    const current = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    const target = Number(match[1]);
    if (target < current)
      throw new Error(
        `安装包 ${spec.version} 支持的数据库版本为 ${target}，低于当前数据库版本 ${current}，无法安装此旧代码包；请发布兼容当前数据库的新安装包`,
      );
  } finally {
    db.close();
  }
}
interface InstallDependencies {
  service: typeof service;
  health: typeof health;
  checkDatabase: typeof checkDatabase;
  counts: typeof configurationCounts;
}
export async function installRuntime(
  spec: UpdateSpec,
  stage: string,
  phase: (value: UpdatePhase, message: string) => Promise<void>,
  deps: InstallDependencies = { service, health, checkDatabase, counts: configurationCounts },
): Promise<void> {
  await validateDatabaseCompatibility(spec, stage);
  const previous = path.join(spec.jobDir, 'previous');
  const database = path.join(spec.jobDir, 'database');
  await mkdir(previous);
  await mkdir(database);
  if ((await stat(spec.root)).dev !== (await stat(spec.jobDir)).dev)
    throw new Error('更新暂不支持运行目录与数据目录位于不同文件系统');
  const moved: string[] = [],
    installed: string[] = [];
  let stopped = false,
    backupReady = false;
  try {
    await phase('installing', '正在停止服务并保留数据');
    await deps.service(spec, 'stop');
    stopped = true;
    deps.checkDatabase(path.join(spec.dataDir, dbFiles[0]));
    const counts = deps.counts(path.join(spec.dataDir, dbFiles[0]));
    for (const file of dbFiles) {
      try {
        await cp(path.join(spec.dataDir, file), path.join(database, file));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    backupReady = true;
    await phase('installing', '正在替换运行文件');
    for (const part of parts) {
      const source = path.join(stage, part),
        destination = path.join(spec.root, part);
      try {
        await rename(destination, path.join(previous, part));
        moved.push(part);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      try {
        await rename(source, destination);
        installed.push(part);
      } catch (e) {
        if (part !== 'package-lock.json' || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    await phase('restarting', '正在重启并验证新版本');
    await deps.service(spec, 'start');
    await deps.health(spec, spec.version);
    if (JSON.stringify(deps.counts(path.join(spec.dataDir, dbFiles[0]))) !== JSON.stringify(counts))
      throw new Error('更新后配置数量发生变化');
    await rm(path.join(spec.jobDir, 'update.fpk'), { force: true }).catch(() => {});
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    await phase('completed', '更新完成，请刷新页面；应用中心登记版本保持不变');
  } catch (error) {
    console.error('[self-update] 安装失败，准备回滚', error);
    if (!stopped) {
      await deps.service(spec, 'start').catch(() => {});
      throw error;
    }
    // Never alter files while either old or new service is still running.
    await deps.service(spec, 'stop');
    for (const part of installed)
      await rm(path.join(spec.root, part), { recursive: true, force: true });
    for (const part of moved) await rename(path.join(previous, part), path.join(spec.root, part));
    if (backupReady)
      for (const file of dbFiles) {
        await rm(path.join(spec.dataDir, file), { force: true });
        try {
          await cp(path.join(database, file), path.join(spec.dataDir, file));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
    await deps.service(spec, 'start');
    await deps.health(spec, spec.previousVersion);
    await phase(
      'rolled-back',
      `更新失败：${error instanceof Error ? error.message.slice(0, 300) : '未知错误'}。已恢复原运行版本与数据库，可重新检查更新。`,
    );
  }
}
