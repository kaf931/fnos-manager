import type { ConfirmAction } from './contracts/shared.js';
interface DialogItem {
  key: string;
  run: () => boolean | Promise<boolean>;
  cancel: () => void;
  resolve: (value: boolean) => void;
  cancelled?: boolean;
  done?: boolean;
}
export function createDialogQueue() {
  let active: DialogItem | null | undefined;
  const waiting: DialogItem[] = [];
  function pump() {
    if (active || !waiting.length) return;
    const item = (active = waiting.shift()!);
    Promise.resolve()
      .then(() => (item.cancelled ? false : item.run()))
      .then(
        (value) => finish(item, value),
        () => finish(item, false),
      );
  }
  function finish(item: DialogItem, value: boolean) {
    if (item.done) return;
    item.done = true;
    item.resolve(value);
    if (active === item) active = null;
    pump();
  }
  return {
    enqueue(key: string, run: () => boolean | Promise<boolean>, cancel: () => void = () => {}) {
      return new Promise<boolean>((resolve) => {
        waiting.push({ key, run, cancel, resolve });
        pump();
      });
    },
    cancel(key: string) {
      for (let i = waiting.length - 1; i >= 0; i--)
        if (waiting[i].key === key) {
          const [item] = waiting.splice(i, 1);
          item.cancelled = true;
          finish(item, false);
        }
      if (active?.key === key) {
        const item = active;
        item.cancelled = true;
        item.cancel();
        finish(item, false);
      }
    },
  };
}
export async function sendCommandSafely(
  text: string,
  {
    connected,
    send,
    confirm,
  }: { connected: () => boolean; send: (text: string) => void; confirm: ConfirmAction },
) {
  if (
    typeof text !== 'string' ||
    new TextEncoder().encode(text).length > 16384 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)
  )
    throw Error('指令包含不支持的控制字符或超过 16 KiB');
  if (!connected()) return false;
  if (
    /[\r\n]/.test(text) &&
    !(await confirm({
      title: '发送多行指令',
      text: '内容含换行，可能立即执行其中的命令。确认发送到当前连接？',
      accept: '发送',
      danger: true,
    }))
  )
    return false;
  if (!connected()) return false;
  send(text.replace(/[\r\n]+$/, '') + '\r');
  return true;
}
