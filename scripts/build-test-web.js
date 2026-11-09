import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
const output = '.web-test';
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts')) files.push(file);
  }
}
await collect('web');
await rm(output, { recursive: true, force: true });
await build({
  entryPoints: files,
  outbase: 'web',
  outdir: output,
  bundle: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
});

// Semi's browser ESM uses extensionless dependency imports. Bundle the shared
// select for Node-based UI tests while retaining the same React instance.
for (const name of ['native-select', 'vnc-controls'])
  await build({
    entryPoints: ['web/' + name + '.tsx'],
    outfile: output + '/' + name + '.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/*'],
  });
