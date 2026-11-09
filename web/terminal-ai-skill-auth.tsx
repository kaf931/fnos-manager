import { PasswordField } from './password-field.js';
import { useRef, useReducer, useEffect, useId } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { Loading } from './ai-command-ui.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
export function AiSkillAuth({
  skillId,
  onClose,
  api,
  toast,
  sessionId,
}: {
  skillId: string;
  onClose: () => void;
  api: ApiClient;
  toast: Toast;
  sessionId: () => string;
}) {
  const scope = useId(),
    [, invalidate] = useReducer((n) => n + 1, 0),
    render = () => invalidate();
  const session = useRef(sessionId()).current;
  const origin = useRef(''),
    code = useRef(''),
    url = useRef(''),
    authorizationId = useRef(''),
    fileStorage = useRef(false),
    tokenSaved = useRef(false),
    connected = useRef(false),
    busy = useRef(false),
    error = useRef(''),
    serial = useRef(0),
    disposed = useRef(false);
  useEffect(
    () => () => {
      disposed.current = true;
      serial.current++;
      code.current = '';
    },
    [],
  );
  const base = () =>
    '/terminal/sessions/' + encodeURIComponent(session) + '/ai/skill-authorizations';
  async function begin() {
    if (busy.current) return;
    const t = ++serial.current;
    busy.current = true;
    error.current = '';
    render();
    try {
      const r = await api<{
        authorizationId: string;
        url: string | null;
        tokenSaved?: boolean;
        connected?: boolean;
      }>(base(), 'POST', {
        skillId,
        origin: origin.current,
        fileStorage: fileStorage.current,
      });
      if (t !== serial.current || disposed.current) return;
      authorizationId.current = r.authorizationId;
      url.current = r.url || '';
      tokenSaved.current = !!r.tokenSaved;
      connected.current = !!r.connected;
    } catch (e) {
      if (t === serial.current) error.current = errorMessage(e);
    } finally {
      if (t === serial.current) {
        busy.current = false;
        render();
      }
    }
  }
  async function exchange() {
    if (busy.current || !authorizationId.current) return;
    const t = ++serial.current;
    busy.current = true;
    error.current = '';
    const value = code.current;
    code.current = '';
    render();
    try {
      await api(base() + '/' + encodeURIComponent(authorizationId.current) + '/exchange', 'POST', {
        code: value,
      });
      if (t !== serial.current || disposed.current) return;
      toast('飞牛授权已连接');
      connected.current = true;
      tokenSaved.current = true;
      url.current = '';
    } catch (e) {
      if (t === serial.current) error.current = errorMessage(e);
    } finally {
      if (t === serial.current) {
        busy.current = false;
        render();
      }
    }
  }
  async function disconnect() {
    if (busy.current || !authorizationId.current) return;
    const t = ++serial.current;
    busy.current = true;
    error.current = '';
    render();
    try {
      await api(base() + '/' + encodeURIComponent(authorizationId.current), 'DELETE');
      if (t !== serial.current || disposed.current) return;
      authorizationId.current = '';
      url.current = '';
      code.current = '';
      tokenSaved.current = false;
      connected.current = false;
      toast('已退出本地授权');
    } catch (e) {
      if (t === serial.current) error.current = errorMessage(e);
    } finally {
      if (t === serial.current) {
        busy.current = false;
        render();
      }
    }
  }
  return (
    <ReactDialog
      open
      title="飞牛授权"
      onClose={onClose}
      busy={busy.current}
      className="terminal-dialog"
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (authorizationId.current ? exchange() : begin());
        }}
      >
        <div className="task-form-body">
          <label htmlFor={scope + '-origin'}>NAS 地址</label>
          <input
            id={scope + '-origin'}
            type="url"
            value={origin.current}
            placeholder="http://192.168.1.35:5666"
            disabled={busy.current || !!authorizationId.current}
            onChange={(e) => {
              origin.current = e.target.value;
              render();
            }}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={fileStorage.current}
              disabled={busy.current || !!authorizationId.current}
              onChange={(e) => {
                fileStorage.current = e.target.checked;
                render();
              }}
            />
            允许将登录态保存在本机受限目录
          </label>
          <p className="help">请在浏览器完成登录与授权；断开 SSH 不会撤销授权。</p>
          {authorizationId.current && (
            <p role="status">
              {connected.current
                ? '已连接'
                : tokenSaved.current
                  ? '凭据已保存，可重试验证'
                  : '等待授权'}
            </p>
          )}
          {url.current && (
            <>
              <a href={url.current} target="_blank" rel="noopener noreferrer">
                打开官方授权页面
              </a>
              <label htmlFor={scope + '-code'}>一次性授权码</label>
              <PasswordField
                id={scope + '-code'}
                label="授权码"
                value={code.current}
                autoComplete="off"
                disabled={busy.current}
                onChange={(e) => {
                  code.current = e.target.value;
                  render();
                }}
              />
            </>
          )}
          {busy.current && <Loading label="正在处理授权…" />}
          {error.current && (
            <p className="form-error" role="alert">
              {error.current}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          {authorizationId.current && (
            <button type="button" disabled={busy.current} onClick={() => void disconnect()}>
              断开授权
            </button>
          )}
          <button type="button" disabled={busy.current} onClick={() => onClose()}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy.current || (!authorizationId.current && !origin.current.trim())}
          >
            {authorizationId.current ? '验证授权' : '检查并连接'}
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
