import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function archiveExec(root) {
  return (command, stream) => {
    let request;
    try {
      request = JSON.parse(Buffer.from(command.split(' ').at(-1), 'base64').toString());
      request.path = path.join(root, path.posix.normalize(request.path));
    } catch {
      stream.exit(1);
      stream.end();
      return;
    }
    const child = spawn('python3', [
      fileURLToPath(new URL('../../server/terminal/archive-worker.py', import.meta.url)),
      Buffer.from(JSON.stringify(request)).toString('base64'),
    ]);
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream.stderr, { end: false });
    child.on('error', () => {
      stream.exit(1);
      stream.end();
    });
    child.on('close', (code) => {
      stream.exit(code ?? 1);
      stream.end();
    });
    stream.once('close', () => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
  };
}
