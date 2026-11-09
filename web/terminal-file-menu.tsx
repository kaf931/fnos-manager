import type {
  FileSessionRefs,
  PositionedFileContext,
  FileContext,
  FileAction,
  AdvancedFileAction,
} from './contracts/terminal.js';
import type { createFileApi } from './terminal-file-api.js';
import type { Toast } from './contracts/shared.js';
import React from 'react';
import { FileMenuSurface, FileMenuItem, FileMenuDivider } from './terminal-file-menu-surface.js';
import { copyText } from './clipboard.js';
import { isArchiveName } from './terminal-file-actions.js';
import { isFileContextCurrent, fileContextPath, joinPath } from './terminal-file-model.js';
export function FileContextMenu({
  context,
  setContext,
  current,
  directory,
  seq,
  fileApi,
  editText,
  toast,
  advancedAction,
  action,
  pendingUpload,
  input,
  folderInput,
}: FileSessionRefs & {
  context: PositionedFileContext | null;
  setContext: (value: PositionedFileContext | null) => void;
  fileApi: ReturnType<typeof createFileApi>;
  editText: (source: PositionedFileContext) => void;
  toast: Toast;
  advancedAction: AdvancedFileAction;
  action: FileAction;
  pendingUpload: React.MutableRefObject<FileContext | null>;
  input: React.RefObject<HTMLInputElement>;
  folderInput: React.RefObject<HTMLInputElement>;
}) {
  const menuItem = (
    label: string,
    fn: (source: PositionedFileContext) => unknown,
    danger = false,
  ) => (
    <FileMenuItem
      key={label}
      type={danger ? 'danger' : undefined}
      onClick={() => {
        const source = context;
        setContext(null);
        if (source && isFileContextCurrent(source, current.current, directory.current, seq.current))
          fn(source);
      }}
    >
      {label}
    </FileMenuItem>
  );
  async function copyPath(source: FileContext) {
    try {
      await copyText(fileContextPath(source));
      toast(source.entry ? '完整路径已复制' : '当前目录路径已复制');
    } catch {
      toast('复制失败，请手动选择路径复制');
    }
  }
  return (
    context && (
      <FileMenuSurface x={context.x} y={context.y}>
        {context.entry?.type === 'file' && menuItem('在线编辑', editText)}
        {menuItem(context.entry ? '复制完整路径' : '复制当前路径', copyPath)}
        {context.entry &&
          context.entry.type !== 'directory' &&
          menuItem('下载', (source) => {
            fileApi.download(source.session, joinPath(source.path, source.entry!.name));
            toast('下载已发起');
          })}
        {context.entry &&
          ['file', 'directory'].includes(context.entry.type) &&
          menuItem('压缩', (source) => advancedAction('compress', source.entry!, source))}
        {context.entry?.type === 'file' &&
          isArchiveName(context.entry.name) &&
          menuItem('解压缩', (source) => advancedAction('extract', source.entry!, source))}
        {context.entry &&
          ['file', 'directory'].includes(context.entry.type) &&
          menuItem('修改权限', (source) => advancedAction('permissions', source.entry!, source))}
        {context.entry && menuItem('重命名', (source) => action('rename', source.entry, source))}
        {context.entry &&
          menuItem('删除', (source) => action('delete', source.entry, source), true)}
        {context.entry && <FileMenuDivider />}
        {menuItem('上传文件', (source) => {
          pendingUpload.current = source;
          input.current?.click();
        })}
        {menuItem('上传文件夹', (source) => {
          pendingUpload.current = source;
          folderInput.current?.click();
        })}
        {menuItem('新建文件夹', (source) => action('mkdir', null, source))}
      </FileMenuSurface>
    )
  );
}
