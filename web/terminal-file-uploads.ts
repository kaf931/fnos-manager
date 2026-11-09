import type React from 'react';
import { errorMessage, type Toast } from './contracts/shared.js';
import type {
  FileSessionRefs,
  SessionIdentity,
  FileListing,
  FileContext,
  UploadProgress,
  LoadDirectory,
} from './contracts/terminal.js';
import type { createFileApi } from './terminal-file-api.js';
import { askName } from './terminal-file-name-dialog.js';
import { isFileContextCurrent, validName } from './terminal-file-model.js';
import { planFolderUpload, uploadFolder, finishFolderUpload } from './terminal-folder-upload.js';

// Each handler captures the selected directory and session; refs guard late async results.
export function createFileUploadHandlers({
  busy,
  data,
  pendingUpload,
  current,
  directory,
  seq,
  upload,
  valid,
  setBusy,
  setError,
  setProgress,
  fileApi,
  toast,
  load,
}: FileSessionRefs & {
  busy: boolean;
  data: FileListing | null;
  pendingUpload: React.MutableRefObject<FileContext | null>;
  upload: React.MutableRefObject<AbortController | null>;
  valid: (session: SessionIdentity) => boolean;
  setBusy: (value: boolean) => void;
  setError: (message: string) => void;
  setProgress: (progress: UploadProgress | null) => void;
  fileApi: ReturnType<typeof createFileApi>;
  toast: Toast;
  load: LoadDirectory;
}) {
  async function selected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const source = pendingUpload.current;
    pendingUpload.current = null;
    if (
      !files.length ||
      busy ||
      !data ||
      !isFileContextCurrent(source, current.current, directory.current, seq.current)
    )
      return;
    const s = { ...source.session },
      path = source.path,
      controller = new AbortController();
    upload.current = controller;
    setBusy(true);
    setError('');
    try {
      if (files.length > 100) throw Error('每批最多上传 100 个文件');
      const planned: { file: File; name: string }[] = [];
      const names = new Set(data.entries.map((entry) => entry.name));
      for (const file of files) {
        if (!valid(s) || controller.signal.aborted) break;
        if (file.size > 256 * 1024 * 1024) throw Error('单个文件不能超过 256 MiB');
        let name: string | null = file.name;
        if (names.has(name)) {
          name = await askName('同名文件已存在，请修改上传名称', name);
          if (name === null) {
            controller.abort();
            break;
          }
        }
        if (!validName(name) || names.has(name)) throw Error('文件名称无效或重复');
        names.add(name);
        planned.push({ file, name });
      }
      const results = await Promise.allSettled(
        planned.map(async ({ file, name }) => {
          if (!valid(s) || controller.signal.aborted) return;
          setProgress({ name, percent: 0 });
          await fileApi.upload(s, path, name, file, {
            signal: controller.signal,
            onProgress: (loaded, total) => {
              if (valid(s))
                setProgress({
                  name: name!,
                  percent: Math.min(99, Math.round((loaded / (total || file.size || 1)) * 100)),
                });
            },
          });
        }),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
      if (valid(s)) {
        toast(controller.signal.aborted ? '上传已取消' : '上传完成');
        if (isFileContextCurrent(source, current.current, directory.current, seq.current))
          await load(path, undefined, { fresh: true });
      }
    } catch (e) {
      if (valid(s)) setError(errorMessage(e));
    } finally {
      if (valid(s)) {
        setBusy(false);
        setProgress(null);
      }
      if (upload.current === controller) upload.current = null;
    }
  }

  async function selectedFolder(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const source = pendingUpload.current;
    pendingUpload.current = null;
    if (
      !files.length ||
      busy ||
      !data ||
      !isFileContextCurrent(source, current.current, directory.current, seq.current)
    )
      return;
    const s = { ...source.session },
      path = source.path,
      controller = new AbortController();
    upload.current = controller;
    setBusy(true);
    setError('');
    let started = false;
    try {
      let plan = planFolderUpload(files);
      while (data.entries.some((entry) => entry.name === plan.name)) {
        const name = await askName('同名文件夹已存在，请修改上传名称', plan.name);
        if (name === null) return;
        if (!valid(s) || controller.signal.aborted || directory.current !== path) return;
        plan = planFolderUpload(files, name);
      }
      if (!valid(s) || controller.signal.aborted || directory.current !== path) return;
      started = true;
      await uploadFolder(plan, {
        path,
        signal: controller.signal,
        isCurrent: () => valid(s),
        mkdir: (parent, name) => fileApi.action(s, 'mkdir', { path: parent, name }),
        upload: (parent, name, file, options) => fileApi.upload(s, parent, name, file, options),
        onProgress: (value) => {
          if (valid(s)) setProgress(value);
        },
      });
      if (valid(s)) toast('文件夹上传完成');
    } catch (e) {
      if (valid(s))
        setError(
          (controller.signal.aborted ? '上传已取消' : errorMessage(e)) +
            (started ? '；已上传的文件和已创建的目录会保留' : ''),
        );
    } finally {
      await finishFolderUpload({
        refresh: () =>
          started && isFileContextCurrent(source, current.current, directory.current, seq.current)
            ? load(path, undefined, { fresh: true })
            : Promise.resolve(),
        isCurrent: () => valid(s) && upload.current === controller,
        finish: () => {
          setBusy(false);
          setProgress(null);
        },
      });
      if (upload.current === controller) upload.current = null;
    }
  }

  return { selected, selectedFolder };
}
