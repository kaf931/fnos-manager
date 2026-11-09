import type React from 'react';
import { errorMessage, type Toast, type ConfirmAction } from './contracts/shared.js';
import type {
  FileSessionRefs,
  SessionIdentity,
  FileListing,
  FileEntry,
  FileContext,
  FileActionBody,
  LoadDirectory,
  DirectorySize,
} from './contracts/terminal.js';
import type { createFileApi } from './terminal-file-api.js';
import { askName } from './terminal-file-name-dialog.js';
import { editArchive, editPermissions } from './terminal-file-actions.js';
import { isFileContextCurrent, validName, joinPath } from './terminal-file-model.js';

export function createFileOperations({
  busy,
  session,
  current,
  directory,
  seq,
  data,
  valid,
  confirm,
  setBusy,
  setError,
  fileApi,
  toast,
  load,
  taskEpoch,
  setOperationStatus,
  calculating,
  setCalculating,
  setSizes,
}: FileSessionRefs & {
  busy: boolean;
  session: SessionIdentity;
  data: FileListing | null;
  valid: (session: SessionIdentity) => boolean;
  confirm: ConfirmAction;
  setBusy: (value: boolean) => void;
  setError: (message: string) => void;
  fileApi: ReturnType<typeof createFileApi>;
  toast: Toast;
  load: LoadDirectory;
  taskEpoch: React.MutableRefObject<number>;
  setOperationStatus: (value: string) => void;
  calculating: string | null;
  setCalculating: (value: string | null) => void;
  setSizes: React.Dispatch<React.SetStateAction<Record<string, DirectorySize>>>;
}) {
  async function action(
    kind: 'mkdir' | 'rename' | 'delete',
    entry?: FileEntry | null,
    source?: FileContext | null,
  ) {
    if (busy || !session.connected || !data) return;
    if (source && !isFileContextCurrent(source, current.current, directory.current, seq.current))
      return;
    const s = { ...(source?.session || session) },
      path = source?.path || data.path,
      location = { session: s, path, sequence: seq.current };
    const sameDirectory = () =>
      isFileContextCurrent(location, current.current, directory.current, seq.current);
    const body: FileActionBody = { path, name: entry?.name };
    if (kind === 'mkdir' || kind === 'rename') {
      const name = await askName(kind === 'mkdir' ? '新建文件夹' : '重命名', entry?.name || '');
      if (name === null || !sameDirectory()) return;
      if (kind === 'mkdir') body.name = name;
      else body.newName = name;
    }
    if (kind === 'delete') {
      if (!entry) return;
      const yes = await confirm({
        title: '删除' + (entry.type === 'directory' ? '文件夹' : '文件'),
        text: `删除“${entry.name}”？此操作无法撤销。仅支持删除空文件夹。`,
        danger: true,
        accept: '删除',
      });
      if (!yes || !sameDirectory()) return;
    }
    setBusy(true);
    setError('');
    try {
      await fileApi.action(s, kind, body);
      if (valid(s)) {
        toast('操作已完成');
        if (sameDirectory()) await load(path, undefined, { fresh: true });
      }
    } catch (e) {
      if (valid(s)) setError(errorMessage(e));
    } finally {
      if (valid(s)) setBusy(false);
    }
  }
  async function advancedAction(
    kind: 'permissions' | 'compress' | 'extract',
    entry: FileEntry,
    source: FileContext,
  ) {
    if (
      busy ||
      !data ||
      !isFileContextCurrent(source, current.current, directory.current, seq.current)
    )
      return;
    const s = { ...source.session },
      path = source.path,
      token = ++taskEpoch.current;
    const currentTask = () => valid(s) && taskEpoch.current === token;
    setBusy(true);
    setError('');
    let changed = false;
    try {
      let options: { mode?: number; outputName?: string; format?: string } | null;
      if (kind === 'permissions') {
        setOperationStatus('正在读取权限…');
        const info = await fileApi.permissions(s, path, entry.name);
        if (!currentTask()) return;
        setOperationStatus('');
        options = await editPermissions(entry.name, info);
      } else {
        options = await editArchive(entry.name, kind === 'extract');
        while (
          options?.outputName &&
          data.entries.some((item) => item.name === options?.outputName)
        ) {
          const name = await askName(
            '同名文件或文件夹已存在，请修改输出名称',
            options.outputName ?? '',
          );
          if (name === null) {
            options = null;
            break;
          }
          options.outputName = name;
        }
      }
      if (
        !options ||
        !currentTask() ||
        !isFileContextCurrent(source, current.current, directory.current, seq.current)
      )
        return;
      if (options.outputName !== undefined && !validName(options.outputName ?? ''))
        throw Error('输出名称无效');
      setOperationStatus(
        kind === 'permissions'
          ? '正在修改权限…'
          : kind === 'compress'
            ? '正在压缩…'
            : '正在解压缩…',
      );
      await fileApi.action(s, kind, { path, name: entry.name, ...options });
      changed = true;
      if (currentTask())
        toast(
          kind === 'permissions' ? '权限已更新' : kind === 'compress' ? '压缩完成' : '解压完成',
        );
    } catch (e) {
      if (currentTask()) setError(errorMessage(e));
    } finally {
      if (
        changed &&
        currentTask() &&
        isFileContextCurrent(source, current.current, directory.current, seq.current)
      )
        await load(path, undefined, { fresh: true });
      if (currentTask()) {
        setOperationStatus('');
        setBusy(false);
      }
    }
  }

  async function calculate(entry: FileEntry) {
    if (calculating || !data || !session.connected) return;
    const s = { ...session },
      path = data.path,
      target = joinPath(path, entry.name);
    setCalculating(target);
    setError('');
    try {
      const result = await fileApi.action(s, 'size', { path, name: entry.name });
      if (valid(s)) setSizes((values) => ({ ...values, [target]: result }));
    } catch (e) {
      if (valid(s)) setError(errorMessage(e));
    } finally {
      if (valid(s)) setCalculating(null);
    }
  }

  return { action, advancedAction, calculate };
}
