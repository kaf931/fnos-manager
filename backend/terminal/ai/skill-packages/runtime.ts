import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { SkillPackageManifest } from '../../../domain/ai-skill-packages.js';
import type { SkillPackageStore } from './store.js';
import { digest } from './archive.js';
import { executeAiCommand, type AiExecSession } from '../executor.js';
export const shellArg = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export async function skillRemoteHome(session: AiExecSession, signal: AbortSignal) {
  const r = await executeAiCommand(session, 'printf \'%s\\n\' "$HOME"; uname -s; uname -m', {
    signal,
  });
  const [home, platform, arch] = r.stdout.trim().split('\n');
  if (
    r.status !== 'success' ||
    !home?.startsWith('/') ||
    /[\r\n\x00]/.test(home) ||
    !['Linux', 'Darwin', 'FreeBSD'].includes(platform || '')
  )
    throw Error('技能运行环境需要 POSIX SSH 主机及有效 HOME');
  return { home, platform: platform!, arch: arch || '' };
}
export async function prepareSkillRuntime(
  session: AiExecSession,
  owner: string,
  manifest: SkillPackageManifest,
  store: SkillPackageStore,
  parent: AbortSignal,
) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(120000)]),
    hold = store.acquire(manifest.ref);
  let s: SFTPWrapper | undefined,
    temp = '';
  const call = <T>(fn: (done: (error: Error | undefined | null, value: T) => void) => void) =>
    new Promise<T>((resolve, reject) => {
      signal.throwIfAborted();
      let finished = false;
      const finish = (error: unknown, value?: T) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value as T);
      };
      const abort = () => finish(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try {
        fn((e, v) => finish(e, v));
      } catch (e) {
        finish(e);
      }
    });
  try {
    const environment = await skillRemoteHome(session, signal);
    if (!session.client) throw Error('SSH 连接已关闭');
    s = await call<SFTPWrapper>((done) =>
      session.client!.sftp((error, channel) => {
        if (channel) channel.on('error', () => {});
        if (signal.aborted) {
          channel?.end();
          done(signal.reason instanceof Error ? signal.reason : new Error('已取消'), channel);
          return;
        }
        done(error, channel);
      }),
    );
    s.on('error', () => {});
    const fs = s,
      root = path.posix.join(
        environment.home,
        '.local/share/nas-manager/skills',
        digest(Buffer.from(owner)),
        manifest.ref.skillId,
        manifest.ref.sha256,
      );
    const lstat = (file: string) => call<Stats>((done) => fs.lstat(file, done));
    const mkdir = async (dir: string) => {
      const pieces = dir.split('/').filter(Boolean);
      let current = '';
      for (const piece of pieces) {
        current += '/' + piece;
        let stat: Stats;
        try {
          stat = await lstat(current);
        } catch (e) {
          if ((e as { code?: number }).code !== 2) throw e;
          await call<void>((done) => fs.mkdir(current, { mode: 0o700 }, done));
          stat = await lstat(current);
        }
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw Error('远端技能目录包含链接或非目录');
        if (current.startsWith(path.posix.join(environment.home, '.local/share/nas-manager')))
          await call<void>((done) => fs.chmod(current, 0o700, done));
      }
    };
    const read = (file: string, max: number) =>
      new Promise<Buffer>((resolve, reject) => {
        signal.throwIfAborted();
        const stream = fs.createReadStream(file),
          chunks: Buffer[] = [];
        let size = 0;
        const abort = () => stream.destroy(Error('技能准备已取消'));
        signal.addEventListener('abort', abort, { once: true });
        stream.on('data', (b: Buffer) => {
          size += b.length;
          if (size > max) stream.destroy(Error('远端文件大小不匹配'));
          else chunks.push(b);
        });
        stream.on('error', reject);
        stream.on('close', () => signal.removeEventListener('abort', abort));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    await mkdir(path.posix.dirname(root));
    let exists = false;
    try {
      const a = await lstat(root);
      if (a.isSymbolicLink() || !a.isDirectory()) throw Error('远端技能目录不安全');
      exists = true;
    } catch (e) {
      if ((e as { code?: number }).code !== 2) throw e;
    }
    if (!exists) {
      temp = root + '.tmp-' + randomUUID();
      await mkdir(temp);
      for (const f of manifest.files) {
        signal.throwIfAborted();
        const file = path.posix.join(temp, f.path);
        await mkdir(path.posix.dirname(file));
        const data = store.read(manifest.ref.packageId, f.path, f.sha256);
        await call<void>((done) =>
          fs.writeFile(
            file,
            data,
            { mode: f.path.startsWith('scripts/') ? 0o700 : 0o600, flag: 'wx' },
            done,
          ),
        );
        if (digest(await read(file, f.size)) !== f.sha256) throw Error('远端技能文件摘要不匹配');
      }
      await call<void>((done) =>
        fs.writeFile(
          path.posix.join(temp, '.nas-manager-skill-complete'),
          manifest.ref.sha256,
          { mode: 0o600, flag: 'wx' },
          done,
        ),
      );
      await call<void>((done) => fs.rename(temp, root, done));
      temp = '';
    }
    const marker = path.posix.join(root, '.nas-manager-skill-complete'),
      markerStat = await lstat(marker);
    if (
      markerStat.isSymbolicLink() ||
      !markerStat.isFile() ||
      (await read(marker, 64)).toString() !== manifest.ref.sha256
    )
      throw Error('远端技能包尚未准备完成');
    for (const f of manifest.files) {
      const file = path.posix.join(root, f.path),
        stat = await lstat(file);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size !== f.size ||
        digest(await read(file, f.size)) !== f.sha256
      )
        throw Error('远端技能包校验失败，请清理后重试');
    }
    if (manifest.official) {
      const version = await executeAiCommand(
        session,
        shellArg(path.posix.join(root, 'scripts/fnos-cli')) + ' version',
        { signal, timeoutMs: 120000 },
      );
      if (version.status !== 'success' || !version.stdout.includes('0.5.1'))
        throw Error('官方 CLI 初始化失败，请检查网络及运行依赖');
    }
    return {
      root,
      platform: environment.platform,
      ...(manifest.official ? { runtimeVersion: '0.5.1' } : {}),
    };
  } finally {
    if (temp && s) {
      const clean = await executeAiCommand(session, 'rm -rf -- ' + shellArg(temp), {
        signal: AbortSignal.timeout(5000),
      });
      void clean;
    }
    s?.end();
    hold.release();
  }
}
