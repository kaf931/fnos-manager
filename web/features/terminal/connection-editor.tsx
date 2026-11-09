import {
  RDP_SECURITY_LABELS,
  RDP_CERTIFICATE_LABELS,
  type RdpSecurity,
  type RdpCertificatePolicy,
} from '../../../backend/domain/rdp.js';
import { NativeSelect } from '../../native-select.js';
import { AppIcon } from '../../ui/icon-markup.js';
import { PasswordField } from '../../password-field.js';
import { usePrivateKeyFile } from '../../use-private-key-file.js';
import { useRef, useState, useEffect } from 'react';
import { ReactDialog } from '../../ui/react-dialog.js';
import { connectionPath } from '../../remote-connections.js';
import { errorMessage, type ApiClient, type Toast } from '../../contracts/shared.js';
import type { Connection } from '../../contracts/terminal.js';

interface AdbDiscoveredDevice {
  serial: string;
  status: string;
  name: string;
  transport: 'usb' | 'tcp';
}
export function ConnectionEditor({
  connection,
  folderId,
  api,
  toast,
  onClose,
  onSave,
}: {
  connection: Connection | null;
  folderId?: string | null;
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onSave: () => void;
}) {
  const [draft, setDraft] = useState({
    name: connection?.name || '',
    domain: connection?.domain || '',
    security: connection?.security ?? 'any',
    certificatePolicy: connection?.certificatePolicy ?? 'strict',
    protocol: connection?.protocol || 'ssh',
    transport: connection?.transport || (connection?.deviceType === 'usb' ? 'usb' : 'tcp'),
    serial: connection?.serial || '',
    kind: connection?.kind || 'local',
    host: connection?.host || '',
    port: connection?.port || 22,
    username: connection?.username || '',
    authMethod: connection?.authMethod || 'password',
    password: connection?.credentials?.password || '',
    privateKey: connection?.credentials?.privateKey || '',
    passphrase: connection?.credentials?.passphrase || '',
  });
  const [pairPort, setPairPort] = useState(''),
    [pairCode, setPairCode] = useState('');
  const [devices, setDevices] = useState<AdbDiscoveredDevice[]>([]),
    [discovering, setDiscovering] = useState(false),
    [discovered, setDiscovered] = useState(false);
  const deviceRequest = useRef<AbortController | null>(null),
    deviceEpoch = useRef(0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    saving = useRef(false),
    keyFile = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      epoch.current++;
      deviceEpoch.current++;
      deviceRequest.current?.abort();
    },
    [],
  );
  const close = () => {
    if (saving.current) return;
    ++epoch.current;
    cancelDiscovery();
    onClose();
  };
  const patch = (value: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...value }));
  const keyReader = usePrivateKeyFile((privateKey) => patch({ privateKey }), setError);
  const ssh = draft.protocol === 'ssh',
    key = ssh && draft.authMethod === 'privateKey';
  const saved = connection?.hasCredentials && connection.authMethod === draft.authMethod;
  function cancelDiscovery() {
    ++deviceEpoch.current;
    deviceRequest.current?.abort();
    deviceRequest.current = null;
    setDiscovering(false);
  }
  async function discoverDevices() {
    if (saving.current || discovering) return;
    const generation = ++deviceEpoch.current;
    const request = new AbortController();
    deviceRequest.current = request;
    setDiscovering(true);
    setError('');
    try {
      const result = await api<{ items: AdbDiscoveredDevice[] }>(
        '/adb/devices',
        'GET',
        undefined,
        request.signal,
      );
      if (generation !== deviceEpoch.current || request.signal.aborted) return;
      setDevices(result.items.filter((device) => device.transport === 'usb'));
      setDiscovered(true);
    } catch (error) {
      if (generation === deviceEpoch.current && !request.signal.aborted)
        setError(errorMessage(error, '发现 USB 设备失败'));
    } finally {
      if (generation === deviceEpoch.current) {
        setDiscovering(false);
        deviceRequest.current = null;
      }
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || keyReader.isReading()) return;
    saving.current = true;
    cancelDiscovery();
    const generation = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      if (draft.protocol === 'adb' && draft.transport === 'tcp' && (pairPort || pairCode)) {
        const port = Number(pairPort),
          code = pairCode.trim();
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\d{6}$/.test(code))
          throw new Error('请填写有效的配对端口和六位配对码');
        await api('/adb/pair', 'POST', { host: draft.host.trim(), port, code });
        if (generation !== epoch.current) return;
        setPairPort('');
        setPairCode('');
      }
      await api(
        connectionPath(draft) + (connection ? '/' + connection.id : ''),
        connection ? 'PUT' : 'POST',
        {
          name: draft.name,
          folderId: connection?.folderId ?? folderId ?? null,
          host: draft.host,
          port: draft.port,
          ...(draft.protocol === 'adb' ? {} : { username: draft.username }),
          ...(draft.protocol === 'adb'
            ? { protocol: 'adb', transport: draft.transport, serial: draft.serial }
            : ssh
              ? {
                  kind: draft.kind,
                  authMethod: draft.authMethod,
                  credentials: key
                    ? { privateKey: draft.privateKey, passphrase: draft.passphrase }
                    : { password: draft.password },
                }
              : {
                  protocol: draft.protocol,
                  password: draft.password,
                  ...(draft.protocol === 'rdp'
                    ? {
                        domain: draft.domain,
                        security: draft.security,
                        certificatePolicy: draft.certificatePolicy,
                      }
                    : {}),
                }),
        },
      );
      if (generation !== epoch.current) return;
      onSave();
      onClose();
      toast('连接与认证信息已保存');
    } catch (e) {
      if (generation === epoch.current) setError(errorMessage(e));
    } finally {
      saving.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      open
      onClose={close}
      title={connection ? '编辑连接' : '新增连接'}
      busy={busy}
      id="terminal-editor"
      className="terminal-dialog"
      footer={null}
    >
      <form id="terminal-connection-form" autoComplete="off" onSubmit={save}>
        <div className="task-form-body">
          <label htmlFor="terminal-name">连接名称</label>
          <input
            id="terminal-name"
            disabled={busy}
            required
            maxLength={80}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <label htmlFor="terminal-protocol">连接协议</label>
          <NativeSelect
            id="terminal-protocol"
            aria-label="连接协议"
            disabled={!!connection || busy}
            value={draft.protocol}
            onChange={(value) => {
              ++epoch.current;
              keyReader.cancel();
              cancelDiscovery();
              setDevices([]);
              setDiscovered(false);
              setError('');
              setPairPort('');
              setPairCode('');
              patch({
                protocol: value as 'ssh' | 'vnc' | 'rdp' | 'adb',
                port: value === 'ssh' ? 22 : value === 'rdp' ? 3389 : value === 'adb' ? 5555 : 5900,
                password: '',
                privateKey: '',
                passphrase: '',
                authMethod: 'password',
              });
            }}
            optionList={[
              { value: 'ssh', label: 'SSH' },
              { value: 'vnc', label: 'VNC' },
              { value: 'rdp', label: 'RDP' },
              { value: 'adb', label: 'ADB' },
            ]}
          />
          {ssh && (
            <>
              <label htmlFor="terminal-kind">连接类型</label>
              <NativeSelect
                id="terminal-kind"
                aria-label="连接类型"
                disabled={busy}
                value={draft.kind}
                onChange={(value) => patch({ kind: value as 'local' | 'remote' })}
                optionList={[
                  { value: 'local', label: 'NAS 本机' },
                  { value: 'remote', label: '远程主机' },
                ]}
              />
            </>
          )}
          {draft.protocol === 'adb' && (
            <>
              <label htmlFor="adb-transport">连接方式</label>
              <NativeSelect
                id="adb-transport"
                aria-label="ADB 连接方式"
                value={draft.transport}
                disabled={busy}
                optionList={[
                  { value: 'tcp', label: '网络调试' },
                  { value: 'usb', label: 'NAS USB 设备' },
                ]}
                onChange={(value) => {
                  cancelDiscovery();
                  setError('');
                  setPairPort('');
                  setPairCode('');
                  patch({ transport: value as 'tcp' | 'usb' });
                }}
              />
              {draft.transport === 'usb' && (
                <>
                  <label htmlFor={devices.length ? 'adb-usb-device' : 'adb-usb-serial'}>
                    USB 设备
                  </label>
                  <div className="form-input-row">
                    {devices.length ? (
                      <NativeSelect
                        id="adb-usb-device"
                        className="form-input"
                        aria-label="已发现的 USB 设备"
                        value={
                          devices.some((device) => device.serial === draft.serial)
                            ? draft.serial
                            : ''
                        }
                        disabled={busy || discovering}
                        optionList={[
                          { value: '', label: '手动输入序列号' },
                          ...devices.map((device) => ({
                            value: device.serial,
                            label:
                              (device.name || device.serial) +
                              ' · ' +
                              ({ device: '可连接', unauthorized: '待授权', offline: '离线' }[
                                device.status
                              ] || device.status),
                            disabled: device.status !== 'device',
                          })),
                        ]}
                        onChange={(value) => patch({ serial: value })}
                      />
                    ) : (
                      <input
                        id="adb-usb-serial"
                        className="form-input"
                        required
                        maxLength={128}
                        aria-label="USB 设备序列号"
                        placeholder="设备序列号"
                        value={draft.serial}
                        disabled={busy}
                        onChange={(event) => patch({ serial: event.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      aria-label="发现 NAS USB 设备"
                      title="发现 NAS USB 设备"
                      disabled={busy || discovering}
                      onClick={() => void discoverDevices()}
                    >
                      {discovering ? '正在发现…' : '发现设备'}
                    </button>
                  </div>
                  {!!devices.length &&
                    !devices.some((device) => device.serial === draft.serial) && (
                      <>
                        <label htmlFor="adb-usb-serial">设备序列号</label>
                        <input
                          id="adb-usb-serial"
                          required
                          maxLength={128}
                          aria-label="USB 设备序列号"
                          value={draft.serial}
                          disabled={busy}
                          onChange={(event) => patch({ serial: event.target.value })}
                        />
                      </>
                    )}
                  <p className="help" role="status">
                    {discovering
                      ? '正在查找 NAS USB 设备…'
                      : discovered && !devices.length
                        ? '未发现 USB 设备。请检查连接，并在设备上允许 USB 调试。'
                        : '设备需连接 NAS、开启 USB 调试并允许授权。'}
                  </p>
                </>
              )}
            </>
          )}
          {(!ssh || draft.kind === 'remote') &&
            !(draft.protocol === 'adb' && draft.transport === 'usb') && (
              <>
                <label htmlFor="terminal-host">主机地址</label>
                <input
                  id="terminal-host"
                  disabled={busy}
                  required
                  maxLength={253}
                  value={draft.host}
                  onChange={(e) => patch({ host: e.target.value })}
                />
              </>
            )}
          <label
            htmlFor="terminal-port"
            hidden={draft.protocol === 'adb' && draft.transport === 'usb'}
          >
            {draft.protocol === 'adb' ? '连接端口' : '端口'}
          </label>
          <input
            id="terminal-port"
            hidden={draft.protocol === 'adb' && draft.transport === 'usb'}
            disabled={busy}
            type="number"
            required
            min={1}
            max={65535}
            value={draft.port}
            onChange={(e) => patch({ port: Number(e.target.value) })}
          />
          {draft.protocol === 'adb' && draft.transport === 'tcp' && (
            <>
              <label htmlFor="adb-pair-port">配对端口（可选）</label>
              <input
                id="adb-pair-port"
                aria-label="配对端口"
                type="number"
                min={1}
                max={65535}
                disabled={busy}
                value={pairPort}
                onChange={(event) => setPairPort(event.target.value)}
              />
              <label htmlFor="adb-pair-code">配对码（可选）</label>
              <PasswordField
                id="adb-pair-code"
                aria-label="配对码"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                autoComplete="off"
                disabled={busy}
                value={pairCode}
                onChange={(event) => setPairCode(event.target.value)}
              />
              <p className="help">
                首次无线调试填写配对码弹窗中的端口与配对码；已授权可留空。连接端口来自无线调试首页，配对码不保存。
              </p>
            </>
          )}
          <label htmlFor="terminal-user" hidden={draft.protocol === 'adb'}>
            用户名
          </label>
          <input
            id="terminal-user"
            hidden={draft.protocol === 'adb'}
            disabled={busy}
            required={ssh || draft.protocol === 'rdp'}
            maxLength={128}
            value={draft.username}
            onChange={(e) => patch({ username: e.target.value })}
          />
          {draft.protocol === 'rdp' && (
            <>
              <label htmlFor="terminal-rdp-security">安全模式</label>
              <NativeSelect
                id="terminal-rdp-security"
                aria-label="安全模式"
                disabled={busy}
                value={draft.security}
                onChange={(value) => patch({ security: value as RdpSecurity })}
                optionList={Object.entries(RDP_SECURITY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <label htmlFor="terminal-rdp-certificate">证书策略</label>
              <NativeSelect
                id="terminal-rdp-certificate"
                aria-label="证书策略"
                disabled={busy}
                value={draft.certificatePolicy}
                onChange={(value) => patch({ certificatePolicy: value as RdpCertificatePolicy })}
                optionList={Object.entries(RDP_CERTIFICATE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              {draft.certificatePolicy !== 'strict' && (
                <p className="help">
                  {draft.certificatePolicy === 'tofu'
                    ? '首次连接自动信任并记住证书，后续证书变化将拒绝连接。'
                    : '不验证远端身份，仅用于已确认可信的设备。'}
                </p>
              )}
              <label htmlFor="terminal-domain">域（可选）</label>
              <input
                id="terminal-domain"
                disabled={busy}
                maxLength={253}
                value={draft.domain}
                onChange={(e) => patch({ domain: e.target.value })}
              />
            </>
          )}
          {ssh && (
            <fieldset className="terminal-choice-field">
              <legend>认证方式</legend>
              <div className="mode-options terminal-choice">
                {(['password', 'privateKey'] as const).map((method) => (
                  <label key={method}>
                    <input
                      type="radio"
                      name="terminal-auth-method"
                      disabled={busy}
                      checked={draft.authMethod === method}
                      onChange={() => {
                        epoch.current++;
                        keyReader.cancel();
                        setError('');
                        patch({ authMethod: method, password: '', privateKey: '', passphrase: '' });
                      }}
                    />
                    <AppIcon name={method === 'password' ? 'lock' : 'key'} />
                    <span>{method === 'password' ? '密码' : '私钥'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {draft.protocol === 'adb' ? null : key ? (
            <>
              <label htmlFor="terminal-saved-private-key">私钥内容</label>
              <textarea
                id="terminal-saved-private-key"
                disabled={busy}
                required={!saved}
                rows={6}
                maxLength={65536}
                value={draft.privateKey}
                onChange={(e) => {
                  keyReader.cancel();
                  setError('');
                  patch({ privateKey: e.target.value });
                }}
                placeholder={saved ? '私钥已保存，留空保持不变' : '粘贴 OpenSSH 或 PEM 私钥'}
              />
              <div className="terminal-key-upload">
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={keyReader.reading}
                  onClick={() => keyFile.current?.click()}
                >
                  <AppIcon name="upload" />
                  读取私钥文件
                </button>
                <input
                  ref={keyFile}
                  hidden
                  aria-label="读取私钥文件"
                  type="file"
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void keyReader.read(file);
                  }}
                />
              </div>
              <label htmlFor="terminal-saved-passphrase">私钥口令（如有）</label>
              <PasswordField
                id="terminal-saved-passphrase"
                disabled={busy}
                value={draft.passphrase}
                onChange={(e) => patch({ passphrase: e.target.value })}
              />
            </>
          ) : (
            <>
              <label htmlFor="terminal-saved-password">密码</label>
              <PasswordField
                key={draft.protocol}
                id="terminal-saved-password"
                disabled={busy}
                required={ssh && !saved}
                maxLength={4096}
                value={draft.password}
                onChange={(e) => patch({ password: e.target.value })}
                placeholder={saved ? '密码已保存，留空保持不变' : '请输入密码'}
              />
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button type="submit" className="primary" disabled={busy || keyReader.reading}>
            保存连接
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
