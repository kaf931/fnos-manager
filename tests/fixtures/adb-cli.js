#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('nodaemon')) {
  if (args.includes('-a') || !/^tcp:\d+$/.test(args[args.indexOf('-L') + 1] ?? '')) {
    console.error('listening on specified hostname currently unsupported');
    process.exit(1);
  }
  const endpoint = args[args.indexOf('-L') + 1],
    port = Number(endpoint.split(':').pop());
  const encoded = (value) => {
    const b = Buffer.from(value);
    return Buffer.concat([Buffer.from(b.length.toString(16).padStart(4, '0')), b]);
  };
  const frame = (id, data) => {
    const h = Buffer.alloc(5);
    h[0] = id;
    h.writeUInt32LE(data.length, 1);
    return Buffer.concat([h, data]);
  };
  net
    .createServer((socket) => {
      let buffer = Buffer.alloc(0),
        pty = false;
      socket.on('error', () => {});
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= (pty ? 5 : 4)) {
          const len = pty ? buffer.readUInt32LE(1) : parseInt(buffer.subarray(0, 4).toString(), 16);
          if (!Number.isFinite(len)) {
            socket.destroy();
            return;
          }
          if (buffer.length < len + (pty ? 5 : 4)) return;
          const id = buffer[0],
            request = buffer.subarray(pty ? 5 : 4, (pty ? 5 : 4) + len);
          buffer = buffer.subarray((pty ? 5 : 4) + len);
          if (pty) {
            if (id === 0) socket.write(frame(1, request));
            else if (id === 5 && !request.toString().startsWith('24x80'))
              socket.write(
                frame(1, Buffer.from('RESIZE:' + request.toString().replace(/\0/g, ''))),
              );
            continue;
          }
          const text = request.toString();
          socket.write('OKAY');
          if (text === 'host:version') socket.write(encoded('0029'));
          else if (text.startsWith('host:tport:')) {
            const tid = Buffer.alloc(8);
            tid.writeBigUInt64LE(1n);
            socket.write(tid);
          } else if (text === 'host:features') socket.write(encoded('shell_v2'));
          else if (text === 'host:devices-l')
            socket.write(encoded('phone.local:5555 device model:Fixture_Phone transport_id:1\n'));
          else if (text.startsWith('shell,v2,pty')) pty = true;
        }
      });
    })
    .listen(port, '127.0.0.1');
} else {
  const command = args.slice(4),
    serial = command[0] === '-s' ? command[1] : '';
  const cmd = serial ? command.slice(2) : command;
  if (cmd[0] === 'connect') console.log('connected to ' + cmd[1]);
  else if (cmd[0] === 'get-state') {
    if (serial.includes('unauthorized')) {
      console.error('device unauthorized');
      process.exitCode = 1;
    } else console.log('device');
  } else if (cmd[0] === 'devices')
    console.log('List of devices attached\nUSB123 device product:fixture model:Fixture_Phone');
  else if (cmd[0] === 'pair') {
    let input = '';
    process.stdin.on('data', (b) => (input += b));
    process.stdin.on('end', () =>
      console.log(input.trim() === '123456' ? 'Successfully paired' : 'Failed: wrong pairing code'),
    );
  } else if (cmd[0] === 'shell' && cmd[1] === 'getprop')
    console.log('[ro.product.model]: [Fixture Phone]');
  else if (cmd[0] === 'shell' && cmd[1] === '-tt') process.stdin.pipe(process.stdout);
  else if (cmd[0] === 'shell' && cmd[1].startsWith('find -H '))
    console.log('81a4\t5\t1700000000\t/sdcard/file.txt\n41ed\t4096\t1700000000\t/sdcard/DCIM');
  else if (cmd[0] === 'shell' && (cmd[1].startsWith('stat ') || cmd[1].startsWith('test -f ')))
    console.log('5');
  else if (cmd[0] === 'shell' && cmd[1].startsWith('if [ -e '))
    console.log(
      cmd[1].includes('/sdcard/existing.txt') || cmd[1].includes('/sdcard/dangling-link')
        ? 'ADB_TARGET_EXISTS'
        : cmd[1].includes('mv -n')
          ? 'ADB_RENAMED'
          : cmd[1].includes('set -C')
            ? 'ADB_UPLOADED'
            : 'ADB_TARGET_ABSENT',
    );
  else if (cmd[0] === 'shell' && cmd[1] === 'timeout') setTimeout(() => console.log('late'), 60000);
  else if (cmd[0] === 'shell') console.log(cmd[1]);
  else if (cmd[0] === 'exec-out') process.stdout.write('hello');
  else if (cmd[0] === 'install') {
    if (fs.readFileSync(cmd.at(-1)).toString() === 'invalid') console.log('Failure [INVALID_APK]');
    else console.log('Success');
  } else if (cmd[0] === 'push') console.log('1 file pushed');
  else if (cmd[0] === 'disconnect') console.log('disconnected');
  else {
    console.error('unexpected fixture argv');
    process.exitCode = 2;
  }
}
