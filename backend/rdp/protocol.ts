import type { RdpConnection } from '../domain/rdp.js';
import { StringDecoder } from 'node:string_decoder';
/** Guacamole lengths count Unicode code points, not UTF-8 bytes. */
export function instruction(...values: string[]): string {
  return values.map((v) => `${Array.from(v).length}.${v}`).join(',') + ';';
}
export class GuacamoleParser {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private elements: string[] = [];
  private instructionSize = 0;
  constructor(private readonly receive: (values: string[]) => void) {}
  push(bytes: Buffer) {
    this.buffer += this.decoder.write(bytes);
    if (this.buffer.length > 8 * 1024 * 1024) throw new Error('Guacamole instruction too large');
    while (this.buffer) {
      const dot = this.buffer.indexOf('.');
      if (dot < 0) {
        if (!/^\d{0,7}$/.test(this.buffer)) throw new Error('Invalid Guacamole length');
        return;
      }
      const prefix = this.buffer.slice(0, dot);
      if (!/^\d{1,7}$/.test(prefix)) throw new Error('Invalid Guacamole length');
      const length = Number(prefix);
      if (length > 4 * 1024 * 1024) throw new Error('Guacamole element too large');
      let end = dot + 1;
      for (let count = 0; count < length; count++) {
        if (end >= this.buffer.length) return;
        const code = this.buffer.codePointAt(end)!;
        end += code > 65535 ? 2 : 1;
      }
      if (end >= this.buffer.length) return;
      const separator = this.buffer[end];
      if (separator !== ',' && separator !== ';') throw new Error('Invalid Guacamole separator');
      this.instructionSize += end + 1;
      if (this.instructionSize > 8 * 1024 * 1024)
        throw new Error('Guacamole instruction too large');
      this.elements.push(this.buffer.slice(dot + 1, end));
      if (this.elements.length > 256) throw new Error('Too many Guacamole elements');
      this.buffer = this.buffer.slice(end + 1);
      if (separator === ';') {
        const values = this.elements;
        this.elements = [];
        this.instructionSize = 0;
        this.receive(values);
      }
    }
  }
}
export function rdpArguments(
  connection: Pick<RdpConnection, 'host' | 'port' | 'username' | 'password' | 'domain'> &
    Partial<Pick<RdpConnection, 'security' | 'certificatePolicy'>>,
  width: number,
  height: number,
): Record<string, string> {
  return {
    hostname: connection.host,
    port: String(connection.port),
    username: connection.username,
    password: connection.password,
    domain: connection.domain,
    security: connection.security ?? 'nla',
    'ignore-cert': String(connection.certificatePolicy === 'ignore'),
    'cert-tofu': String(connection.certificatePolicy === 'tofu'),
    'disable-auth': 'false',
    'enable-drive': 'false',
    'enable-printing': 'false',
    'enable-audio-input': 'false',
    'disable-audio': 'true',
    width: String(width),
    height: String(height),
    dpi: '96',
    'resize-method': 'display-update',
    'color-depth': '24',
  };
}
