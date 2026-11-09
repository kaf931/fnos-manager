import { rm } from 'node:fs/promises';
import path from 'node:path';
import { localRequest } from './install.js';
import type { UpdatePhase, UpdateSpec } from './job.js';
export class AutomaticUpdateCancelled extends Error {}
export async function waitForIdle(
  spec: UpdateSpec,
  phase: (value: UpdatePhase, message: string) => Promise<void>,
  request = localRequest,
  pause = () => new Promise<void>((r) => setTimeout(r, 5000)),
): Promise<void> {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = (await request(spec, '/updates/status')) as { mode?: string; idle?: boolean };
    if (status.mode !== 'auto') throw new AutomaticUpdateCancelled('已关闭自动更新，本次未安装');
    if (status.idle) {
      // Block new mutations before the final idle check, closing the session-start race.
      await phase('installing', '空闲检查通过，正在准备安装');
      const final = (await request(spec, '/updates/status')) as { mode?: string; idle?: boolean };
      if (final.mode === 'auto' && final.idle) return;
      await rm(path.join(spec.dataDir, 'updates', 'installing'), { force: true });
      if (final.mode !== 'auto') throw new AutomaticUpdateCancelled('已关闭自动更新，本次未安装');
    }
    await phase('waiting', '安装包已下载，等待远程连接及后台任务结束');
    await pause();
  }
  throw new Error('等待空闲超时，本次未安装，将稍后重试');
}
