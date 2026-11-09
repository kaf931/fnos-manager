import { publicUpdateText } from './routes.js';
import { verifyPublishedRelease, ReleaseWithdrawn } from './releases.js';
import { waitForIdle, AutomaticUpdateCancelled } from './idle.js';
import { readFile, realpath, statfs, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { downloadWithRetry } from './download.js';
import { installRuntime } from './install.js';
import { readJob, writeJob, type UpdateSpec, type UpdatePhase } from './job.js';
const exec = promisify(execFile);
export async function runUpdate(spec: UpdateSpec): Promise<void> {
  const stateFile = path.join(spec.jobDir, 'status.json');
  const state = await readJob(stateFile);
  if (!state) throw new Error('缺少更新任务');
  state.pid = process.pid;
  const phase = async (value: UpdatePhase, message: string) => {
    if (value === 'installing') {
      await mkdir(path.join(spec.dataDir, 'updates'), { recursive: true, mode: 0o700 });
      await writeFile(path.join(spec.dataDir, 'updates', 'installing'), state.id, { mode: 0o600 });
    }
    state.phase = value;
    state.message = message;
    await writeJob(stateFile, state);
  };
  try {
    const space = await statfs(spec.jobDir);
    if (Number(space.bavail) * Number(space.bsize) < spec.asset.size * 5 + 1024 * 1024 * 1024)
      throw new Error('更新可用空间不足，请至少预留安装包五倍大小及 1 GiB 空间');
    await phase('downloading', '正在下载安装包');
    const file = path.join(spec.jobDir, 'update.fpk');
    await downloadWithRetry(
      spec.asset,
      file,
      async (received, line) => {
        state.received = received;
        state.message = `正在下载安装包（${line || 'GitHub 直连'}）`;
        await writeJob(stateFile, state);
      },
      async (_attempt, message) => {
        state.message = message;
        await writeJob(stateFile, state);
      },
      undefined,
      undefined,
      spec.downloadRoute ?? 'direct',
    );
    await phase('verifying', '正在验证版本、架构与运行文件');
    await exec(
      'python3',
      [
        fileURLToPath(new URL('./unpack.py', import.meta.url)),
        file,
        path.join(spec.jobDir, 'stage'),
        spec.version,
        spec.architecture,
      ],
      { timeout: 180000, maxBuffer: 65536 },
    );
    // Responding page must have time to receive its initial task before the service is stopped.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (spec.automatic) await waitForIdle(spec, phase);
    await verifyPublishedRelease(spec);
    await installRuntime(spec, path.join(spec.jobDir, 'stage'), phase);
  } catch (e) {
    console.error(
      '[self-update]',
      publicUpdateText(e instanceof Error ? e.stack || e.message : String(e)),
    );
    const text = publicUpdateText(e instanceof Error ? e.message : '更新失败');
    await phase(
      e instanceof AutomaticUpdateCancelled || e instanceof ReleaseWithdrawn
        ? 'cancelled'
        : 'failed',
      text.includes('python3') ? '安装包结构验证失败，请检查更新日志' : text.slice(0, 300),
    );
  } finally {
    await rm(path.join(spec.dataDir, 'updates', 'installing'), { force: true }).catch(() => {});
  }
}
if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const spec = JSON.parse(await readFile(process.argv[2], 'utf8')) as UpdateSpec;
  await runUpdate(spec);
}
