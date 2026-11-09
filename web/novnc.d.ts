/// <reference types="novnc__novnc" />
declare module '@novnc/novnc/core/util/logging.js' {
  export function initLogging(level: 'error' | 'warn' | 'info' | 'debug'): void;
}
/** noVNC 1.7 ESM root; community declarations retain the older lib entry. */
declare module '@novnc/novnc' {
  import RFB from '@novnc/novnc/lib/rfb';
  export default class Client extends RFB {
    approveServer(): void;
    /** Internal hook used only by the pinned 1.7 authentication adapter. */
    protected _isSupportedSecurityType(type: number): boolean;
    protected _framebufferUpdate(): boolean;
    /** Pinned noVNC input hook used to release keys before entering read-only mode. */
    protected _keyboard: { ungrab(): void };
  }
}
