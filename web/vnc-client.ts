import RFB from '@novnc/novnc';
export { initLogging as configureVncLogging } from '@novnc/novnc/core/util/logging.js';

/** noVNC 1.7's isolated security-selection hook: Apple account auth needs a username.
 * Keep all other security decisions in upstream noVNC; never replace browser crypto.
 */
export default class VncClient extends RFB {
  private readonly appleAccount: boolean;
  private firstFrame = false;
  private updates = 0;
  setViewOnly(value: boolean) {
    // noVNC sets its input guard before ungrab(), dropping the resulting keyups.
    // Release while input is still writable, then let upstream change modes.
    if (value && !this.viewOnly) this._keyboard.ungrab();
    this.viewOnly = value;
  }
  takeUpdateCount() {
    const count = this.updates;
    this.updates = 0;
    return count;
  }
  constructor(...args: ConstructorParameters<typeof RFB>) {
    const appleAccount = !!args[2]?.credentials?.username;
    if (appleAccount && !globalThis.crypto?.subtle)
      throw new Error(
        'Apple 账户认证需要 HTTPS，请使用 HTTPS 打开 NAS 或改用专用 VNC 密码并留空用户名',
      );
    super(...args);
    this.appleAccount = appleAccount;
  }
  protected override _isSupportedSecurityType(type: number): boolean {
    if (type === 30 && !this.appleAccount) return false;
    const supported = super._isSupportedSecurityType(type);
    if (supported)
      this.dispatchEvent(new CustomEvent('authenticationselected', { detail: { type } }));
    return supported;
  }
  protected override _framebufferUpdate(): boolean {
    const complete = super._framebufferUpdate();
    if (complete) this.updates++;
    if (complete && !this.firstFrame) {
      this.firstFrame = true;
      this.dispatchEvent(new CustomEvent('firstframe'));
    }
    return complete;
  }
}
