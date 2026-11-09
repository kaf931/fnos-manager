import type { UploadOptions, UploadProgress } from './contracts/terminal.js';
export interface FolderFile {
  size: number;
  webkitRelativePath: string;
}
export interface FolderPlan<F extends FolderFile = File> {
  name: string;
  bytes: number;
  directories: string[];
  files: { file: F; relativePath: string }[];
}
import { validName, joinPath } from './terminal-file-model.js';
export function planFolderUpload<F extends FolderFile>(
  files: F[],
  rootName?: string,
): FolderPlan<F> {
  if (!files.length || files.length > 10000)
    throw Error('请选择包含文件的文件夹，最多 10000 个文件');
  let original: string | undefined;
  const names = new Set<string>(),
    directories = new Set<string>(),
    planned: FolderPlan<F>['files'] = [];
  let bytes = 0;
  for (const file of files) {
    const parts = file.webkitRelativePath?.split('/');
    if (!parts || parts.length < 2 || parts.length > 65 || !parts.every(validName))
      throw Error('文件夹路径无效或层级超过 64 层');
    original ??= parts[0];
    if (parts[0] !== original) throw Error('一次只能上传一个文件夹');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 256 * 1024 * 1024)
      throw Error('单个文件不能超过 256 MiB');
    const root = rootName ?? original;
    if (!validName(root)) throw Error('文件夹名称无效');
    parts[0] = root;
    const relativePath = parts.join('/');
    if (names.has(relativePath)) throw Error('文件夹包含重复的文件路径');
    names.add(relativePath);
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    bytes += file.size;
    planned.push({ file, relativePath });
  }
  if ([...directories].some((p) => names.has(p))) throw Error('文件和文件夹路径冲突');
  if (directories.size + planned.length > 10000) throw Error('文件夹条目超过 10000 项');
  return {
    name: rootName ?? original!,
    bytes,
    directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length),
    files: planned,
  };
}
export async function uploadFolder(
  plan: FolderPlan,
  {
    path,
    signal,
    isCurrent,
    mkdir,
    upload,
    onProgress,
  }: {
    path: string;
    signal?: AbortSignal;
    isCurrent: () => boolean;
    mkdir: (path: string, name: string) => Promise<unknown>;
    upload: (path: string, name: string, file: File, options: UploadOptions) => Promise<void>;
    onProgress?: (progress: UploadProgress) => void;
  },
) {
  const check = () => {
    if (signal?.aborted || !isCurrent()) throw Error('上传已取消或连接已变化');
  };
  if (plan.files.some((f) => joinPath(path, f.relativePath).length > 4096))
    throw Error('目标路径超过长度上限');
  let completed = 0,
    index = 0;
  check();
  for (const relative of plan.directories) {
    check();
    const parts = relative.split('/'),
      name = parts.pop()!,
      parent = parts.length ? joinPath(path, parts.join('/')) : path;
    onProgress?.({
      name: '创建文件夹：' + relative,
      percent: plan.bytes ? Math.min(99, Math.round((completed / plan.bytes) * 100)) : 0,
    });
    await mkdir(parent, name);
  }
  for (const { file, relativePath } of plan.files) {
    check();
    const parts = relativePath.split('/'),
      name = parts.pop()!,
      parent = joinPath(path, parts.join('/'));
    index++;
    const report = (loaded: number) =>
      onProgress?.({
        name: `${index}/${plan.files.length} ${relativePath}`,
        percent: Math.min(
          99,
          Math.round(
            (plan.bytes
              ? (completed + Math.min(file.size, loaded)) / plan.bytes
              : (index - 1) / plan.files.length) * 100,
          ),
        ),
      });
    report(0);
    await upload(parent, name, file, {
      signal,
      onProgress: (loaded) => {
        if (isCurrent() && !signal?.aborted) report(loaded);
      },
    });
    completed += file.size;
    check();
  }
}
export async function finishFolderUpload({
  refresh,
  isCurrent,
  finish,
}: {
  refresh: () => Promise<void>;
  isCurrent: () => boolean;
  finish: () => void;
}) {
  if (!isCurrent()) return;
  try {
    await refresh();
  } finally {
    if (isCurrent()) finish();
  }
}
