import { attachSftp } from './sftp-server.js';
import ssh2 from 'ssh2';
const { Server, utils } = ssh2;
import { generateKeyPairSync } from 'node:crypto';
export function keypair(encrypted = false) {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
      ...(encrypted ? { cipher: 'aes-256-cbc', passphrase: 'fixture-passphrase' } : {}),
    },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}
export async function sshFixture({ sftpRoot, execOutput, execHandler } = {}) {
  const hostKey = keypair(),
    userKey = keypair(),
    encryptedKey = keypair(true),
    allowed = [utils.parseKey(userKey), utils.parseKey(encryptedKey, 'fixture-passphrase')];
  const clients = new Set(),
    auth = [],
    windows = [];
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      auth.push(ctx.method);
      if (ctx.username !== 'tester') return ctx.reject();
      if (ctx.method === 'password' && ctx.password === 'fixture-password') return ctx.accept();
      if (ctx.method === 'publickey') {
        const key = allowed.find((k) => k.getPublicSSH().equals(ctx.key.data));
        if (key && (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true))
          return ctx.accept();
      }
      ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        if (execHandler)
          session.on('exec', (accept, _, info) => execHandler(info.command, accept()));
        else if (execOutput)
          session.on('exec', (accept, _, info) => {
            const stream = accept();
            stream.end(execOutput(info.command));
          });
        if (sftpRoot) attachSftp(session, sftpRoot);
        session.on('pty', (accept, _, info) => {
          windows.push(info);
          accept();
        });
        session.on('window-change', (accept, _, info) => {
          windows.push(info);
          accept?.();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write('fixture-ready\r\n');
          stream.on('data', (data) => {
            const text = data.toString();
            if (text.includes('flood')) stream.write(Buffer.alloc(1100000, 'x'));
            else if (text.includes('exit')) {
              stream.exit(0);
              stream.end();
            } else stream.write('echo:' + text);
          });
        });
      }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    hostKey,
    userKey,
    encryptedKey,
    auth,
    windows,
    close: async () => {
      for (const c of clients) c.end();
      await new Promise((r) => server.close(r));
    },
  };
}
export function events() {
  const items = [],
    waiters = [];
  return {
    items,
    emit: (e) => {
      items.push(e);
      for (const w of [...waiters])
        if (w.p(e)) {
          waiters.splice(waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(e);
        }
    },
    wait(p) {
      const found = items.find(p);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = {
          p,
          resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1);
            reject(
              new Error(
                'event timeout ' +
                  items.map((e) => e.type + ':' + (e.state || e.code || '')).join(','),
              ),
            );
          }, 5000),
        };
        waiters.push(w);
      });
    },
  };
}
