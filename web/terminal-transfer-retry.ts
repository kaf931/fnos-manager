import type { TransferRecord } from '../backend/domain/transfers.js';
import type { SessionIdentity, UploadOptions } from './contracts/terminal.js';
interface RetainedUpload {
  sessionId: string;
  run: () => Promise<void>;
  running: boolean;
  controller?: AbortController;
  record: TransferRecord;
}
const retained = new Map<string, RetainedUpload>();
const tails = new Map<string, Promise<void>>();
const activeStatus = (record: TransferRecord) => ['queued', 'running'].includes(record.status);
/** Original Files and pending upload requests live only in this page and SSH session. */
export function retainUpload(
  session: SessionIdentity,
  path: string,
  name: string,
  file: File,
  options: UploadOptions,
  run: (options: UploadOptions, clientId: string) => Promise<void>,
) {
  const sessionId = session.id || '';
  const sessionEntries = [...retained.entries()].filter(
    ([, entry]) => entry.sessionId === sessionId,
  );
  if (sessionEntries.filter(([, entry]) => entry.running).length >= 100)
    return Promise.reject(Error('当前会话上传队列已满，请稍后重试'));
  if (sessionEntries.length >= 100) {
    const oldest = sessionEntries.find(([, entry]) => !entry.running);
    if (oldest) retained.delete(oldest[0]);
  }
  // getRandomValues also works on NAS HTTP pages, where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const clientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const entry: RetainedUpload = {
    sessionId,
    running: false,
    run: () => perform(false),
    record: {
      id: 'local:' + clientId,
      clientId,
      connectionName: '',
      direction: 'upload',
      path: path.replace(/\/$/, '') + '/' + name,
      size: file.size,
      transferred: 0,
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: 0,
      finishedAt: null,
    },
  };
  async function perform(initial: boolean): Promise<void> {
    if (!retained.has(clientId)) throw Error('请重新选择原文件上传');
    if (entry.running) throw Error('该文件正在上传或排队');
    entry.running = true;
    const controller = (entry.controller = new AbortController());
    const record = entry.record;
    Object.assign(record, {
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: 0,
      finishedAt: null,
      transferred: 0,
    });
    const signal = initial ? options.signal : undefined;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const predecessor = tails.get(sessionId) || Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => slot);
    tails.set(sessionId, tail);
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(Error('上传已取消'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    // An abort may arrive while the network request settles; always consume rejection.
    void aborted.catch(() => {});
    try {
      await Promise.race([predecessor, aborted]);
      if (controller.signal.aborted) throw Error('上传已取消');
      record.status = 'running';
      record.startedAt = Date.now();
      // One outstanding binary request per SSH session leaves HTTP slots for controls.
      await run(
        { signal: controller.signal, onProgress: initial ? options.onProgress : undefined },
        clientId,
      );
      retained.delete(clientId);
    } catch (error) {
      record.status = controller.signal.aborted ? 'cancelled' : 'failed';
      record.finishedAt = Date.now();
      throw error;
    } finally {
      release();
      if (tails.get(sessionId) === tail)
        void tail.then(() => {
          if (tails.get(sessionId) === tail) tails.delete(sessionId);
        });
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAbort);
      entry.running = false;
      entry.controller = undefined;
    }
  }
  retained.set(clientId, entry);
  return perform(true);
}
export function canRetryUpload(sessionId: string, clientId?: string) {
  return !!clientId && retained.get(clientId)?.sessionId === sessionId;
}
export function retryUpload(sessionId: string, clientId: string) {
  const entry = retained.get(clientId);
  if (!entry || entry.sessionId !== sessionId) return Promise.reject(Error('请重新选择原文件上传'));
  return entry.run();
}
export function cancelPendingUpload(sessionId: string, clientId?: string) {
  const entry = clientId ? retained.get(clientId) : undefined;
  if (!entry || entry.sessionId !== sessionId || !entry.running) return false;
  entry.controller?.abort();
  return true;
}
export function mergePendingUploads(sessionId: string, items: TransferRecord[]) {
  const pending = [...retained.values()]
    .filter((entry) => entry.sessionId === sessionId)
    .map((entry) => entry.record)
    .filter(
      (local) =>
        !items.some(
          (server) =>
            server.clientId === local.clientId && (!activeStatus(local) || activeStatus(server)),
        ),
    );
  return [...pending, ...items].sort(
    (a, b) => (b.queuedAt || b.startedAt) - (a.queuedAt || a.startedAt),
  );
}
export function clearRetainedUploads(sessionId: string) {
  for (const [id, item] of retained)
    if (item.sessionId === sessionId) {
      item.controller?.abort();
      retained.delete(id);
    }
  tails.delete(sessionId);
}
