import { createServer } from 'node:net';
import { randomBytes, createCipheriv, timingSafeEqual } from 'node:crypto';
/** Minimal RFB 3.8 test server. Real noVNC decoding/input, isolated from host desktop. */
export async function vncFixture({ password = '', width = 800, height = 450, securityTypes } = {}) {
  const clients = new Set(),
    events = [];
  const server = createServer((socket) => {
    clients.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => clients.delete(socket));
    let data = Buffer.alloc(0),
      state = 'version';
    const challenge = randomBytes(16);
    socket.write('RFB 003.008\n');
    function frame() {
      const header = Buffer.alloc(16);
      header[0] = 0;
      header.writeUInt16BE(1, 2);
      header.writeUInt16BE(width, 8);
      header.writeUInt16BE(height, 10);
      header.writeInt32BE(0, 12);
      const pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4;
          pixels[p] = y < 55 ? 70 : 185;
          pixels[p + 1] = y < 55 ? 50 : 105;
          pixels[p + 2] = y < 55 ? 40 : 35;
          if (x > 45 && x < 330 && y > 105 && y < 265) {
            pixels[p] = 242;
            pixels[p + 1] = 242;
            pixels[p + 2] = 242;
          }
        }
      socket.write(Buffer.concat([header, pixels]));
    }
    function init() {
      const name = Buffer.from('NAS Manager VNC Test'),
        b = Buffer.alloc(24);
      b.writeUInt16BE(width, 0);
      b.writeUInt16BE(height, 2);
      b[4] = 32;
      b[5] = 24;
      b[7] = 1;
      b.writeUInt16BE(255, 8);
      b.writeUInt16BE(255, 10);
      b.writeUInt16BE(255, 12);
      b[14] = 16;
      b[15] = 8;
      b.writeUInt32BE(name.length, 20);
      socket.write(Buffer.concat([b, name]));
      state = 'normal';
    }
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      for (;;) {
        if (state === 'version') {
          if (data.length < 12) return;
          data = data.subarray(12);
          const offered = securityTypes || [password ? 2 : 1];
          socket.write(Buffer.from([offered.length, ...offered]));
          state = 'security';
        } else if (state === 'security') {
          if (data.length < 1) return;
          events.push({ type: 'security', selected: data[0] });
          if (data[0] !== (password ? 2 : 1)) {
            socket.destroy();
            return;
          }
          data = data.subarray(1);
          if (password) {
            socket.write(challenge);
            state = 'challenge';
          } else {
            socket.write(Buffer.alloc(4));
            state = 'init';
          }
        } else if (state === 'challenge') {
          if (data.length < 16) return;
          const key = Buffer.alloc(8);
          for (let i = 0; i < 8; i++) {
            let c = password.charCodeAt(i) || 0,
              r = 0;
            for (let bit = 0; bit < 8; bit++) {
              r = (r << 1) | (c & 1);
              c >>= 1;
            }
            key[i] = r;
          }
          const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null);
          cipher.setAutoPadding(false);
          const expected = Buffer.concat([cipher.update(challenge), cipher.final()]);
          const ok = timingSafeEqual(data.subarray(0, 16), expected);
          data = data.subarray(16);
          events.push({ type: 'auth', ok });
          const result = Buffer.alloc(4);
          result.writeUInt32BE(ok ? 0 : 1);
          socket.write(result);
          if (!ok) {
            const reason = Buffer.from('Invalid fixture password'),
              len = Buffer.alloc(4);
            len.writeUInt32BE(reason.length);
            socket.end(Buffer.concat([len, reason]));
            return;
          }
          state = 'init';
        } else if (state === 'init') {
          if (data.length < 1) return;
          data = data.subarray(1);
          init();
        } else {
          if (!data.length) return;
          const type = data[0];
          let length;
          if (type === 0) length = 20;
          else if (type === 2) {
            if (data.length < 4) return;
            length = 4 + data.readUInt16BE(2) * 4;
          } else if (type === 3) length = 10;
          else if (type === 4) length = 8;
          else if (type === 5) length = 6;
          else if (type === 6) {
            if (data.length < 8) return;
            length = 8 + data.readUInt32BE(4);
          } else {
            socket.destroy();
            return;
          }
          if (length > 1048576) {
            socket.destroy();
            return;
          }
          if (data.length < length) return;
          const message = data.subarray(0, length);
          data = data.subarray(length);
          events.push({ type, bytes: Buffer.from(message) });
          if (type === 3 && message[1] === 0) frame();
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    events,
    close: async () => {
      for (const s of clients) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
