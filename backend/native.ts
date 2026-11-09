import { execFile } from 'node:child_process';
import { access, cp, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { entryConfig } from './core.js';
import type { IconEntry } from './domain/icons.js';
import { DomainError, errorInfo } from './errors.js';
import { buildFpk } from './package.js';
const exec = promisify(execFile);
type CommandRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;
export async function resolveShortcutVolume(
  target = process.env.TRIM_APPDEST || '/var/apps/deskicons/target',
  resolve: (value: string) => Promise<string> = realpath,
) {
  let location: string;
  try {
    location = await resolve(target);
  } catch {
    throw new DomainError('无法确定应用安装存储卷，请检查 NAS 管家安装位置', 503);
  }
  const match = location.match(/^\/vol([1-9]\d*)\/@appcenter\//);
  const volume = Number(match?.[1]);
  if (!Number.isSafeInteger(volume) || volume < 1 || volume > 2147483647)
    throw new DomainError('无法确定应用安装存储卷，请检查 NAS 管家安装位置', 503);
  return volume;
}
export async function applicationCommand(args: string[], run: CommandRunner = exec) {
  let result: { stdout: string; stderr: string };
  try {
    result = await run('/usr/local/bin/appcenter-cli', args, {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    console.error('[appcenter]', args[0], errorInfo(error).code || 'PROCESS_FAILED');
    const code = errorInfo(error).code;
    throw new DomainError(
      code === 'EACCES' || code === 'EPERM'
        ? '没有执行应用安装操作的权限，请检查 NAS 管家权限'
        : code === 'ENOENT'
          ? '飞牛应用安装工具不存在，请检查系统版本'
          : '系统应用操作失败，请查看应用日志后重试',
      503,
    );
  }
  if (/\[Error\]/.test(result.stdout + '\n' + result.stderr)) {
    console.error('[appcenter]', args[0], result.stdout, result.stderr);
    const missingVolume = /--volume|default-volume/.test(result.stdout + '\n' + result.stderr);
    throw new DomainError(
      missingVolume
        ? '未指定应用安装存储卷，请更新 NAS 管家或配置 CLI 默认卷后重试'
        : '飞牛应用中心未完成操作，请查看应用日志后重试',
      503,
    );
  }
  return result;
}
export async function installShortcut(entry: IconEntry, fpk: string, temp: string) {
  entryConfig(entry);
  const appname = `deskicon.${entry.id}`,
    installed = path.join('/var/apps', appname);
  let exists = false,
    backup;
  try {
    await access(path.join(installed, 'manifest'));
    exists = true;
  } catch (e) {
    if (errorInfo(e).code !== 'ENOENT') throw e;
  }
  // Resolve before uninstalling an existing shortcut; rollback must use its original volume.
  const volume = await resolveShortcutVolume(exists ? path.join(installed, 'target') : undefined);
  if (exists) {
    // The current device's CLI skips already-installed app names, even at a newer version.
    // Build a restorable copy before uninstalling only our own generated shortcut.
    const snapshot = path.join(temp, 'previous');
    await mkdir(snapshot, { recursive: true });
    for (const name of ['manifest', 'ICON.PNG', 'ICON_256.PNG', 'cmd', 'config'])
      await cp(path.join(installed, name), path.join(snapshot, name), {
        recursive: true,
        dereference: true,
      });
    await mkdir(path.join(snapshot, 'wizard'), { recursive: true });
    await cp(path.join(installed, 'target'), path.join(snapshot, 'app'), {
      recursive: true,
      dereference: true,
    });
    backup = await buildFpk(snapshot);
    await applicationCommand(['uninstall', appname]);
    try {
      await access(path.join(installed, 'manifest'));
      throw new DomainError('旧入口未卸载，已停止更新', 503);
    } catch (e) {
      if (errorInfo(e).code !== 'ENOENT') throw e;
    }
  }
  try {
    await applicationCommand(['install-fpk', fpk, '--volume', String(volume)]);
    const manifest = await readFile(path.join(installed, 'manifest'), 'utf8');
    const version = manifest.match(/^version\s*=\s*(.+)$/m)?.[1]?.trim();
    if (version !== `1.0.${Number(entry.revision) || 1}`)
      throw new DomainError('系统未安装预期版本，更新未完成', 503);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await applicationCommand(['status', appname]);
      if (state.stdout.trim() === 'running') {
        ready = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) throw new DomainError('入口尚未进入运行状态，请稍后重试', 503);
  } catch (error) {
    if (backup) {
      try {
        try {
          await access(path.join(installed, 'manifest'));
          await applicationCommand(['uninstall', appname]);
        } catch (e) {
          if (errorInfo(e).code !== 'ENOENT') throw e;
        }
        await applicationCommand(['install-fpk', backup, '--volume', String(volume)]);
      } catch {
        throw new DomainError('新入口安装失败，旧入口自动恢复也失败，请通过应用中心检查', 503);
      }
    }
    throw error;
  }
}
