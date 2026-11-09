import { chmodSync, lstatSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from './persistence/database.service.js';

/** Lifecycle hooks only touch the three system-managed directories of this package. */
function dataDirectories(env: NodeJS.ProcessEnv): string[] {
  const name = env.TRIM_APPNAME;
  if (!name || !/^[a-z][a-z0-9._-]{0,63}$/.test(name)) throw Error('应用名称无效');
  const data = env.TRIM_PKGVAR;
  if (!data || !path.isAbsolute(data)) throw Error('应用数据目录缺失');
  const volume = path.dirname(path.dirname(data));
  if (!/^vol\d+$/.test(path.basename(volume))) throw Error('应用存储空间无效');
  return [
    ['TRIM_PKGVAR', '@appdata'],
    ['TRIM_PKGETC', '@appconf'],
    ['TRIM_PKGHOME', '@apphome'],
  ].map(([key, parent]) => {
    const dir = env[key];
    if (!dir || dir !== path.join(volume, parent, name)) throw Error('应用数据路径不匹配');
    if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir)
      throw Error('应用数据目录不能重定向或使用符号链接');
    return dir;
  });
}

function checkDatabase(dir: string): void {
  const file = path.join(dir, 'nas-manager.sqlite');
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isFile() || realpathSync(file) !== file)
    throw Error('数据库必须为应用目录内的普通文件');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw Error('数据库完整性检查失败');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('数据库外键检查失败');
  } finally {
    db.close();
  }
}

function run(action: string | undefined): void {
  const env = process.env;
  const dirs = dataDirectories(env);
  if (action === 'uninstall') {
    const choice = env.wizard_data_action || 'keep';
    if (choice !== 'keep' && choice !== 'delete') throw Error('卸载数据选项无效');
    if (choice === 'delete') {
      for (const dir of dirs)
        for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { recursive: true });
    }
    return;
  }
  if (!['install', 'upgrade-check', 'upgrade'].includes(action || ''))
    throw Error('未知生命周期操作');
  checkDatabase(dirs[0]);
  if (action !== 'upgrade-check') {
    const db = new DatabaseService(dirs[0]);
    db.close();
    checkDatabase(dirs[0]);
    chmodSync(dirs[0], 0o700);
  }
}

try {
  run(process.argv[2]);
} catch {
  const message = '应用数据检查或处理失败，已停止操作。请检查数据库、目录权限及卸载选项。';
  console.error(message);
  if (process.env.TRIM_TEMP_LOGFILE) {
    try {
      writeFileSync(process.env.TRIM_TEMP_LOGFILE, message + '\n');
    } catch {
      // Preserve the original failure even if the platform log cannot be written.
    }
  }
  process.exitCode = 1;
}
