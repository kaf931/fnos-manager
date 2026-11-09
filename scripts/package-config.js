import { packageTarget } from './package-target.js';
export function createPackageConfig(pkg, arch = 'x64') {
  const target = packageTarget(arch);
  const runtime = {
    name: 'deskicons-runtime',
    version: pkg.version,
    type: 'module',
    dependencies: {
      ...Object.fromEntries(
        [
          '@yume-chan/adb',
          '@yume-chan/adb-server-node-tcp',
          '@yume-chan/adb-scrcpy',
          '@yume-chan/scrcpy',
          '@yume-chan/stream-extra',
        ].map((name) => [name, pkg.dependencies[name]]),
      ),
      'class-validator': pkg.dependencies['class-validator'],
      'class-transformer': pkg.dependencies['class-transformer'],
      '@nestjs/common': pkg.dependencies['@nestjs/common'],
      '@nestjs/core': pkg.dependencies['@nestjs/core'],
      '@nestjs/platform-express': pkg.dependencies['@nestjs/platform-express'],
      'reflect-metadata': pkg.dependencies['reflect-metadata'],
      rxjs: pkg.dependencies.rxjs,
      express: '5.2.1',
      sharp: '0.35.5',
      ssh2: pkg.dependencies.ssh2,
      ws: pkg.dependencies.ws,
      yaml: pkg.dependencies.yaml,
      nodemailer: pkg.dependencies.nodemailer,
      'iconv-lite': pkg.dependencies['iconv-lite'],
      yauzl: pkg.dependencies.yauzl,
    },
  };
  const manifest = `appname=deskicons\nversion=${pkg.version}\ndisplay_name=NAS 管家\ndesc=集桌面图标、计划任务、远程连接、存储管理与网络唤醒于一体的 NAS 管理工具。支持管家菜单独立桌面入口、SSH/VNC/RDP/ADB 多标签连接、文件传输、常用命令与 AI 助手，以及空间分析、重复文件检查、批量改名和设备批量唤醒。适配 PC 与移动端。\nmaintainer=kaf\nmaintainer_url=https://github.com/kaf931/fnos-manager\ndistributor=kaf\ndistributor_url=https://club.fnnas.com/home.php?mod=space&uid=91804\nsource=thirdparty\nplatform=${target.platform}\ninstall_dep_apps=nodejs_v22\n${arch === 'arm64' ? '' : 'os_min_version=1.2.0800\n'}desktop_uidir=ui\ndesktop_applaunchname=deskicons.main\nmicro_app=true\nctl_stop=true\n`;
  return { runtime, manifest };
}
