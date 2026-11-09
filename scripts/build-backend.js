import { rm, mkdir, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
await rm('server', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'], {
  stdio: 'inherit',
});
async function assets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await assets(file);
    else if (entry.name.endsWith('.py')) {
      const target = file.replace(/^backend/, 'server');
      await mkdir(path.dirname(target), { recursive: true });
      await cp(file, target);
    }
  }
}
await assets('backend');
