import React, { useState, createContext, useContext } from 'react';
import { requestRemoteDialog } from './features/terminal/dialogs.js';
import { ReactDialog } from './ui/react-dialog.js';
import { NativeSelect } from './native-select.js';
import { errorMessage } from './contracts/shared.js';
import { validName } from './terminal-file-model.js';
import type { PermissionsInfo } from './contracts/terminal.js';
const bits = {
  owner: { read: 0o400, write: 0o200, execute: 0o100 },
  group: { read: 0o40, write: 0o20, execute: 0o10 },
  other: { read: 0o4, write: 0o2, execute: 0o1 },
};
type PermissionWho = keyof typeof bits;
type PermissionFlag = keyof typeof bits.owner;
export const permissionRows = (mode: number) =>
  (Object.keys(bits) as PermissionWho[]).map((key) => ({
    key,
    read: !!(mode & bits[key].read),
    write: !!(mode & bits[key].write),
    execute: !!(mode & bits[key].execute),
  }));
export const togglePermission = (
  mode: number,
  who: PermissionWho,
  permission: PermissionFlag,
  checked: boolean,
) => (checked ? mode | bits[who][permission] : mode & ~bits[who][permission]);
export function parsePermission(value: string) {
  if (!/^[0-7]{3,4}$/.test(value)) throw Error('请输入 3 或 4 位八进制权限值');
  return parseInt(value, 8);
}
export const formatPermission = (mode: number) => mode.toString(8).padStart(4, '0');
export const isArchiveName = (name: string) =>
  /\.(?:zip|tar|tgz|tar\.gz|tar\.bz2|tbz2|tar\.xz|txz)$/i.test(name);
export const extractionName = (name: string) =>
  name.replace(/\.(?:tar\.gz|tar\.bz2|tar\.xz|zip|tar|tgz|tbz2|txz)$/i, '') || '解压文件';
const CancelFileAction = createContext<() => void>(() => {});
let serial = 0;
function editor<T>(
  title: string,
  build: (props: {
    prefix: string;
    header: React.ReactNode;
    error: string;
    submit: (value: T) => void;
    setError: (value: string) => void;
  }) => React.ReactNode,
): Promise<T | null> {
  const prefix = 'file-action-' + ++serial;
  return requestRemoteDialog<T>((finish) => (
    <FileActionDialog title={title} render={build} prefix={prefix} finish={finish} />
  ));
}
function FileActionDialog<T>({
  title,
  render,
  prefix,
  finish,
}: {
  title: string;
  prefix: string;
  finish: (value: T | null) => void;
  render: (props: {
    prefix: string;
    header: React.ReactNode;
    error: string;
    submit: (value: T) => void;
    setError: (error: string) => void;
  }) => React.ReactNode;
}) {
  const [error, setError] = useState('');
  return (
    <ReactDialog
      size="small"
      open
      title={title}
      onClose={() => finish(null)}
      className="terminal-dialog file-action-dialog"
      footer={null}
    >
      <CancelFileAction.Provider value={() => finish(null)}>
        {render({ prefix, header: null, error, setError, submit: finish })}
      </CancelFileAction.Provider>
    </ReactDialog>
  );
}

function Footer() {
  const cancel = useContext(CancelFileAction);
  return (
    <div className="dialog-footer">
      <span />
      <button type="button" onClick={cancel}>
        取消
      </button>
      <button type="submit" className="primary">
        确定
      </button>
    </div>
  );
}
export interface ArchiveOptions {
  outputName: string;
  format?: string;
}
export const editArchive = (name: string, extract = false): Promise<ArchiveOptions | null> =>
  editor<ArchiveOptions>(extract ? '解压缩' : '压缩', (props) => (
    <ArchiveEditor {...props} name={name} extract={extract} />
  ));
function ArchiveEditor({
  name,
  extract,
  prefix,
  submit,
  header,
  error,
  setError,
}: {
  name: string;
  extract: boolean;
  prefix: string;
  header: React.ReactNode;
  submit: (value: ArchiveOptions) => void;
  error: string;
  setError: (error: string) => void;
}) {
  const [format, setFormat] = useState('zip'),
    [outputName, setOutputName] = useState(extract ? extractionName(name) : name + '.zip');
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validName(outputName)) {
          setError('请输入有效名称，不含路径分隔符或控制字符');
          return;
        }
        submit({ outputName, ...(!extract ? { format } : {}) });
      }}
    >
      {header}
      <div className="task-form-body">
        <p className="help">
          {extract ? '解压到新文件夹，不覆盖原文件。' : '在当前目录创建压缩包，不覆盖原文件。'}
        </p>
        {!extract && (
          <>
            <label id={prefix + '-format-label'}>压缩格式</label>
            <NativeSelect
              id={prefix + '-format'}
              aria-labelledby={prefix + '-format-label'}
              value={format}
              optionList={[
                { value: 'zip', label: 'ZIP (.zip)' },
                { value: 'tar.gz', label: 'tar.gz' },
              ]}
              onChange={(next) => {
                if (outputName.endsWith('.' + format))
                  setOutputName(outputName.slice(0, -(format.length + 1)) + '.' + next);
                setFormat(next);
              }}
            />
          </>
        )}
        <label htmlFor={prefix + '-name'}>{extract ? '输出文件夹名称' : '压缩文件名称'}</label>
        <input
          id={prefix + '-name'}
          type="text"
          required
          maxLength={255}
          value={outputName}
          onChange={(e) => {
            setOutputName(e.currentTarget.value);
            setError('');
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Footer />
    </form>
  );
}
export const editPermissions = (
  name: string,
  info: PermissionsInfo,
): Promise<{ mode: number } | null> =>
  editor('修改权限', (props) => <PermissionsEditor {...props} name={name} info={info} />);
function PermissionsEditor({
  name,
  info,
  prefix,
  submit,
  setError,
  header,
  error,
}: {
  name: string;
  info: PermissionsInfo;
  prefix: string;
  header: React.ReactNode;
  error: string;
  submit: (value: { mode: number }) => void;
  setError: (value: string) => void;
}) {
  const [mode, setMode] = useState(info.mode),
    [number, setNumber] = useState(formatPermission(info.mode));
  const initialSpecial = !!(info.mode & 0o7000);
  const whoLabels: [PermissionWho, string][] = [
    ['owner', '所有者'],
    ['group', '用户组'],
    ['other', '其他人'],
  ];
  const flagLabels: [PermissionFlag, string][] = [
    ['read', '读取'],
    ['write', '写入'],
    ['execute', '执行'],
  ];
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          submit({ mode: parsePermission(number) });
        } catch (error) {
          setError(errorMessage(error));
        }
      }}
    >
      {header}
      <div className="task-form-body">
        <p className="help">
          {name} · UID {info.uid} / GID {info.gid} · 仅修改当前项
        </p>
        <table className="file-permission-matrix">
          <caption>访问权限</caption>
          <thead>
            <tr>
              {['对象', '读取', '写入', '执行'].map((text) => (
                <th key={text}>{text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {whoLabels.map(([who, label]) => (
              <tr key={who}>
                <th scope="row">{label}</th>
                {flagLabels.map(([permission, flagLabel]) => (
                  <td key={permission}>
                    <input
                      type="checkbox"
                      aria-label={label + ' ' + flagLabel}
                      checked={!!(mode & bits[who][permission])}
                      onChange={(e) => {
                        const next = togglePermission(
                          mode,
                          who,
                          permission,
                          e.currentTarget.checked,
                        );
                        setMode(next);
                        setNumber(formatPermission(next));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <label htmlFor={prefix + '-mode'}>数字权限（八进制）</label>
        <input
          id={prefix + '-mode'}
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={number}
          onChange={(e) => {
            setNumber(e.currentTarget.value);
            try {
              setMode(parsePermission(e.currentTarget.value));
            } catch {}
          }}
        />
        <p className="help">
          {initialSpecial ? '特殊权限位保留，可通过数字权限修改。' : '目录执行权限用于进入目录。'}
        </p>
        {error && <p className="notice error file-action-error">{error}</p>}
      </div>
      <Footer />
    </form>
  );
}
