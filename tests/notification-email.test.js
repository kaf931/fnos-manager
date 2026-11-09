import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendEmailNotification } from '../server/notifications/email.js';
import { DEFAULT_NOTIFICATION_OPTIONS } from '../server/domain/notifications.js';
const job = {
  id: 'one',
  owner: 'a',
  revision: 1,
  attempts: 1,
  url: '',
  token: 'PRIVATE',
  payload: JSON.stringify({ name: 'Backup', status: 'failed', eventType: 'test' }),
  options: {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    channel: 'email',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUser: 'sender@example.com',
    smtpFrom: 'sender@example.com',
    smtpTo: 'one@example.com,two@example.com',
  },
};
test('SMTP uses TLS verification, forbids remote content, and confirms every recipient', async () => {
  let options,
    message,
    closed = 0;
  const factory = (o) => {
    options = o;
    return {
      close() {
        closed++;
      },
      async sendMail(m) {
        message = m;
        return { accepted: ['one@example.com', 'two@example.com'], rejected: [] };
      },
    };
  };
  const r = await sendEmailNotification(job, new AbortController().signal, factory);
  assert.equal(r.error, undefined);
  assert.equal(r.httpStatus, 200);
  assert.equal(options.requireTLS, true);
  assert.equal(options.secure, false);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.disableFileAccess, true);
  assert.deepEqual(message.to, ['one@example.com', 'two@example.com']);
  assert.match(message.text, /Backup/);
  assert.equal(closed, 1);
  const partial = await sendEmailNotification(job, new AbortController().signal, () => ({
    close() {},
    async sendMail() {
      return { accepted: ['one@example.com'], rejected: ['two@example.com'] };
    },
  }));
  assert.ok(partial.error);
  assert.equal(partial.retryable, false);
});
test('SMTP errors classify authentication, certificates and temporary errors without leaking server text', async () => {
  for (const [error, text, retry] of [
    [{ code: 'EAUTH', response: 'PRIVATE' }, '认证', false],
    [{ code: 'ESOCKET', message: 'certificate PRIVATE', reason: 'CERT_HAS_EXPIRED' }, '连接', true],
    [{ responseCode: 450, response: 'PRIVATE' }, '暂时', true],
  ]) {
    const r = await sendEmailNotification(job, new AbortController().signal, () => ({
      close() {},
      async sendMail() {
        throw error;
      },
    }));
    assert.match(r.error, new RegExp(text));
    assert.doesNotMatch(r.error, /PRIVATE/);
    assert.equal(r.retryable, retry);
  }
});
test('SMTP can deliver a complete text message to a local protocol receiver', async (t) => {
  let message = '';
  let reading = false;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 local ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const i = buffer.indexOf('\r\n'),
          line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (reading) {
          if (line === '.') {
            reading = false;
            socket.write('250 queued\r\n');
          } else message += line + '\n';
          continue;
        }
        if (line.startsWith('EHLO')) socket.write('250 local\r\n');
        else if (line.startsWith('DATA')) {
          reading = true;
          socket.write('354 go\r\n');
        } else if (line.startsWith('QUIT')) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    for (const s of sockets) s.destroy();
    server.close();
  });
  const r = await sendEmailNotification(
    {
      ...job,
      token: '',
      options: {
        ...job.options,
        smtpHost: '127.0.0.1',
        smtpPort: server.address().port,
        smtpSecurity: 'none',
        smtpUser: '',
      },
    },
    new AbortController().signal,
  );
  assert.equal(r.httpStatus, 200);
  assert.equal(r.error, undefined);
  assert.match(message, /Subject:/);
  assert.match(message, /Backup/);
});
