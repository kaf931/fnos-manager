import { listenPort } from './app/common/config.js';
import { randomBytes } from 'node:crypto';
import { chmod, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication as bootstrap } from './app/bootstrap.js';
import type { AppOptions } from './app/common/types.js';
import { errorInfo } from './errors.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
export async function createApplication({
  dataDir = process.env.DATA_DIR || path.join(root, 'data'),
  gateway = !!process.env.APP_SOCKET,
  startScheduler = false,
  storageRoots,
  storageLimits,
}: Partial<Omit<AppOptions, 'root' | 'version' | 'csrfToken'>> = {}) {
  return bootstrap({
    root,
    version,
    dataDir,
    gateway,
    startScheduler,
    storageRoots,
    storageLimits,
    csrfToken: randomBytes(24).toString('hex'),
  });
}
export { IconsService } from './app/icons/icons.service.js';
export { StorageService } from './app/storage/storage.service.js';
export { TasksService } from './app/tasks/tasks.service.js';
export { TerminalService } from './app/terminal/terminal.service.js';
export { WakeService } from './app/wake/wake.service.js';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const socket = process.env.APP_SOCKET,
    port = listenPort(socket ? undefined : process.env.PORT);
  const app = await createApplication({ startScheduler: true });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await app.close();
      if (socket) await rm(socket, { force: true });
      process.exit(0);
    } catch (error) {
      console.error('应用关闭失败', errorInfo(error).message);
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  if (socket) {
    await rm(socket, { force: true });
    await app.listen(socket);
    await chmod(socket, 0o600);
    console.log('NAS 管家 NestJS listening on gateway socket');
  } else {
    await app.listen(port, '127.0.0.1');
    console.log('NAS 管家 NestJS: http://127.0.0.1:' + port + '/app/deskicons/');
  }
}
