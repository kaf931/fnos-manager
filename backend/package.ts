import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { entryConfig, validateEntry } from './core.js';
import type { IconEntry } from './domain/icons.js';
import { renderIcon } from './icons.js';
const exec = promisify(execFile);
export async function prepareShortcut(dir: string, entry: IconEntry, icon: Buffer) {
  const valid = validateEntry(entry);
  const config = entryConfig(entry);
  const appname = `deskicon.${entry.id}`;
  for (const name of ['app/ui/images', 'cmd', 'config', 'wizard'])
    await mkdir(path.join(dir, name), { recursive: true });
  await writeFile(
    path.join(dir, 'manifest'),
    `appname=${appname}\nversion=1.0.${Number(entry.revision) || 1}\ndisplay_name=${JSON.stringify(valid.name)}\ndesc="桌面快捷入口"\nmaintainer=kaf\nmaintainer_url=https://github.com/kaf931/fnos-manager\ndistributor=kaf\ndistributor_url=https://club.fnnas.com/home.php?mod=space&uid=91804\n${entry.menuPage ? 'install_dep_apps=deskicons\nmicro_app=true\n' : ''}source=thirdparty\nplatform=all\nos_min_version=1.1.3100\ndesktop_uidir=ui\ndesktop_applaunchname=${appname}.main\nctl_stop=true\n`,
  );
  await writeFile(
    path.join(dir, 'config/privilege'),
    JSON.stringify({ defaults: { 'run-as': 'package' } }),
  );
  await writeFile(path.join(dir, 'config/resource'), '{}');
  await writeFile(path.join(dir, 'app/ui/config'), JSON.stringify(config, null, 2));
  // Shell single quoting preserves URLs literally; httpUrl rejects CR/LF and credentials.
  const quoted = valid.url.replace(/'/g, "'\\''");
  await writeFile(
    path.join(dir, 'app/ui/index.cgi'),
    `#!/bin/sh\nprintf 'Status: 302 Found\\r\\nLocation: %s\\r\\nCache-Control: no-store\\r\\n\\r\\n' '${quoted}'\n`,
  );
  await chmod(path.join(dir, 'app/ui/index.cgi'), 0o755);
  for (const name of [
    'main',
    'install_init',
    'install_callback',
    'upgrade_init',
    'upgrade_callback',
    'uninstall_init',
    'uninstall_callback',
    'config_init',
    'config_callback',
  ]) {
    await writeFile(path.join(dir, 'cmd', name), '#!/bin/sh\nexit 0\n');
    await chmod(path.join(dir, 'cmd', name), 0o755);
  }
  for (const size of [64, 256]) {
    const png = await renderIcon(icon, size);
    await writeFile(path.join(dir, size === 64 ? 'ICON.PNG' : 'ICON_256.PNG'), png);
    await writeFile(path.join(dir, `app/ui/images/icon_${size}.png`), png);
  }
  return appname;
}
export async function buildFpk(
  dir: string,
  binary: string = process.env.FNPACK || path.resolve('tools/fnpack'),
) {
  await exec(binary, ['build', '--directory', dir], {
    cwd: dir,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const file = (await readdir(dir)).find((f) => f.endsWith('.fpk'));
  if (!file) throw new Error('打包工具没有生成 FPK');
  return path.join(dir, file);
}
