export interface DeviceInfoGroup {
  title: string;
  items: { label: string; value: string }[];
}
type Formatter = (value: string) => string;
type Field = readonly [label: string, keys: string, format?: Formatter];
const lookup = (values: Readonly<Record<string, string>>, value: string) =>
  Object.hasOwn(values, value) ? values[value]! : value;
const boolean: Formatter = (value) => {
  const normalized = value.toLowerCase();
  const labels: Readonly<Record<string, string>> = {
    '1': '是',
    '0': '否',
    true: '是',
    false: '否',
  };
  return Object.hasOwn(labels, normalized) ? labels[normalized]! : value;
};
const enumValue =
  (values: Readonly<Record<string, string>>): Formatter =>
  (value) =>
    lookup(values, value);
const buildType = enumValue({ user: '用户版本', userdebug: '用户调试版本', eng: '工程版本' });
const listValue =
  (format: Formatter): Formatter =>
  (value) =>
    value
      .split(',')
      .map((part) => format(part.trim()))
      .join(' / ');
const buildTags = listValue(
  enumValue({
    'release-keys': '正式签名密钥',
    'test-keys': '测试签名密钥',
    'dev-keys': '开发签名密钥',
  }),
);
const bootReason = listValue(
  enumValue({
    reboot: '重启',
    shutdown: '关机',
    cold: '冷启动',
    warm: '热启动',
    hard: '硬复位',
    kernel_panic: '内核崩溃',
    watchdog: '看门狗复位',
    recovery: '恢复模式',
    bootloader: '引导程序',
    ota: '系统更新',
    userrequested: '用户请求',
    adb: 'ADB 请求',
    thermal: '温度保护',
    battery: '电池',
    powerkey: '电源键',
  }),
);
const locale: Formatter = (value) => {
  try {
    const code = Intl.getCanonicalLocales(
      value.replace(/_/g, '-').replace(/-r([A-Z]{2})$/, '-$1'),
    )[0];
    if (!code) return value;
    const text = new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code);
    return text && text !== code ? `${text} · ${code}` : value;
  } catch {
    return value;
  }
};
const region: Formatter = (value) => {
  const code = value.toUpperCase();
  if (!/^(?:[A-Z]{2}|[0-9]{3})$/.test(code)) return value;
  try {
    const text = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code);
    return text && text !== code ? `${text} · ${code}` : value;
  } catch {
    return value;
  }
};
const buildDate: Formatter = (value) => {
  if (!/^\d+$/.test(value)) return value;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
};
const architecture: Formatter = (value) =>
  [
    ...new Set(
      value
        .split(',')
        .map((part) =>
          lookup({ 'arm64-v8a': 'ARM64', 'armeabi-v7a': 'ARM32', armeabi: 'ARM32' }, part.trim()),
        )
        .filter(Boolean),
    ),
  ].join(' / ');
const usb = listValue(
  enumValue({
    adb: 'ADB 调试',
    mtp: '文件传输',
    ptp: '照片传输',
    rndis: 'USB 网络共享',
    midi: 'MIDI',
    none: '无',
    accessory: '配件模式',
    audio_source: '音频输入',
  }),
);
const fields: readonly (readonly [string, readonly Field[]])[] = [
  [
    '设备',
    [
      ['品牌', 'ro.product.manufacturer|ro.product.brand'],
      ['型号', 'ro.product.model|ro.product.vendor.model'],
      ['设备名称', 'persist.sys.device_name'],
      ['市场名称', 'ro.product.marketname|ro.product.vendor.marketname'],
      ['设备代号', 'ro.product.device'],
      ['产品名称', 'ro.product.name'],
      ['产品品牌', 'ro.product.brand'],
      ['产品板型', 'ro.product.board'],
      ['硬件 SKU', 'ro.boot.hardware.sku'],
      ['产品 SKU', 'ro.boot.product.hardware.sku'],
    ],
  ],
  [
    '系统',
    [
      ['Android 版本', 'ro.build.version.release'],
      ['API 级别', 'ro.build.version.sdk'],
      ['安全补丁', 'ro.build.version.security_patch'],
      ['系统版本', 'ro.build.display.id|ro.build.version.incremental'],
      ['版本代号', 'ro.build.version.codename', enumValue({ REL: '正式发行版' })],
      ['构建编号', 'ro.build.id'],
      ['增量版本', 'ro.build.version.incremental'],
      ['构建类型', 'ro.build.type', buildType],
      ['构建标签', 'ro.build.tags', buildTags],
      ['构建时间', 'ro.build.date.utc|ro.build.date', buildDate],
      ['构建指纹', 'ro.build.fingerprint'],
      ['基础系统', 'ro.build.version.base_os'],
      ['首次出厂 API', 'ro.product.first_api_level'],
      ['最低目标 API', 'ro.build.version.min_supported_target_sdk'],
      ['预览 API', 'ro.build.version.preview_sdk', enumValue({ '0': '非预览版本' })],
      ['供应商 API 级别', 'ro.vendor.api_level'],
      ['芯片组 API 级别', 'ro.board.api_level'],
      ['芯片组初始 API', 'ro.board.first_api_level'],
      ['HyperOS 版本', 'ro.mi.os.version.name|ro.mi.os.version'],
      ['MIUI 版本', 'ro.miui.ui.version.name'],
    ],
  ],
  [
    '硬件',
    [
      ['处理器', 'ro.soc.model|ro.board.platform|ro.hardware'],
      ['CPU 架构', 'ro.product.cpu.abilist|ro.product.cpu.abi', architecture],
      ['处理器厂商', 'ro.soc.manufacturer'],
      ['32 位架构', 'ro.product.cpu.abilist32', architecture],
      ['64 位架构', 'ro.product.cpu.abilist64', architecture],
      ['硬件平台', 'ro.board.platform'],
      ['硬件名称', 'ro.hardware'],
      ['硬件版本', 'ro.boot.hwversion'],
      ['引导硬件', 'ro.boot.hardware'],
      ['屏幕密度（dpi）', 'ro.sf.lcd_density'],
      ['图形渲染器', 'ro.hardware.egl'],
      ['Vulkan 实现', 'ro.hardware.vulkan'],
      ['音频实现', 'ro.hardware.audio.primary'],
      ['支持最大内存页（字节）', 'ro.product.cpu.pagesize.max'],
      ['内存页（字节）', 'ro.boot.hardware.cpu.pagesize'],
      ['基带版本', 'gsm.version.baseband'],
      ['引导程序版本', 'ro.bootloader'],
    ],
  ],
  [
    '安全与启动',
    [
      ['引导程序锁定', 'ro.boot.flash.locked', enumValue({ '1': '已锁定', '0': '未锁定' })],
      [
        '验证启动',
        'ro.boot.verifiedbootstate',
        enumValue({
          green: '验证通过',
          yellow: '使用自定义信任根',
          orange: '引导程序未锁定',
          red: '验证失败',
        }),
      ],
      [
        '启动设备状态',
        'ro.boot.vbmeta.device_state',
        enumValue({ locked: '已锁定', unlocked: '未锁定' }),
      ],
      ['AVB 版本', 'ro.boot.avb_version|ro.boot.vbmeta.avb_version'],
      [
        '加密状态',
        'ro.crypto.state',
        enumValue({ encrypted: '已加密', unencrypted: '未加密', unsupported: '不支持' }),
      ],
      ['加密方式', 'ro.crypto.type', enumValue({ file: '文件级加密', block: '块设备加密' })],
      ['ADB 默认降权策略', 'ro.secure', enumValue({ '1': '启用', '0': '禁用' })],
      ['元数据加密', 'ro.crypto.metadata.enabled', boolean],
      ['允许调试构建', 'ro.debuggable', boolean],
      ['ADB 身份验证', 'ro.adb.secure', boolean],
      ['启动完成', 'sys.boot_completed', boolean],
      ['启动原因', 'sys.boot.reason|ro.boot.bootreason', bootReason],
      ['启动槽位', 'ro.boot.slot_suffix'],
      ['动态分区', 'ro.boot.dynamic_partitions', boolean],
      ['A/B 系统更新', 'ro.build.ab_update', boolean],
      ['虚拟 A/B 更新', 'ro.virtual_ab.enabled', boolean],
      ['受保护虚拟机支持', 'ro.boot.hypervisor.protected_vm.supported', boolean],
    ],
  ],
  [
    '语言与区域',
    [
      ['当前语言区域', 'persist.sys.locale', locale],
      ['出厂语言区域', 'ro.product.locale', locale],
      ['语言', 'persist.sys.language', locale],
      ['国家或地区', 'persist.sys.country', region],
      ['时区', 'persist.sys.timezone'],
      ['运营商区域', 'gsm.operator.iso-country', listValue(region)],
    ],
  ],
  [
    '连接',
    [
      ['USB 当前功能', 'sys.usb.state|sys.usb.config', usb],
      ['USB 默认功能', 'persist.sys.usb.config', usb],
      ['USB 控制器', 'sys.usb.controller|ro.boot.usbcontroller'],
      ['USB ADB 已禁用', 'sys.usb.adb.disabled', boolean],
      ['ADB TCP 端口', 'service.adb.tcp.port|persist.adb.tcp.port'],
      ['无线 ADB 已启用', 'persist.adb.tls_server.enable', boolean],
      ['无线 ADB 端口', 'service.adb.tls.port'],
      ['Wi-Fi 接口', 'wifi.interface'],
      ['Wi-Fi 国家代码', 'wifi.country|ro.boot.wificountrycode'],
      ['网络类型', 'gsm.network.type'],
      ['运营商', 'gsm.operator.alpha'],
      ['运营商代码', 'gsm.operator.numeric'],
      [
        'SIM 状态',
        'gsm.sim.state',
        (v) =>
          v
            .split(',')
            .map(
              enumValue({
                ABSENT: '未插入',
                READY: '就绪',
                LOADED: '已加载',
                NOT_READY: '未就绪',
                UNKNOWN: '未知',
                PIN_REQUIRED: '需要 PIN',
                PUK_REQUIRED: '需要 PUK',
                NETWORK_LOCKED: '网络锁定',
                CARD_IO_ERROR: 'SIM 读写错误',
              }),
            )
            .join(' / '),
      ],
      ['漫游', 'gsm.operator.isroaming', (v) => v.split(',').map(boolean).join(' / ')],
      ['热点接口', 'wifi.tethering.interface'],
    ],
  ],
  [
    '运行环境',
    [
      ['运行时实现', 'persist.sys.dalvik.vm.lib.2'],
      ['应用初始堆内存', 'dalvik.vm.heapstartsize'],
      ['应用堆增长上限', 'dalvik.vm.heapgrowthlimit'],
      ['应用最大堆内存', 'dalvik.vm.heapsize'],
      ['堆目标利用率', 'dalvik.vm.heaptargetutilization'],
      ['堆最小空闲', 'dalvik.vm.heapminfree'],
      ['堆最大空闲', 'dalvik.vm.heapmaxfree'],
      ['JIT 编译', 'dalvik.vm.usejit', boolean],
      ['JIT 配置引导', 'dalvik.vm.usejitprofiles', boolean],
      ['低内存设备标记', 'ro.config.low_ram', boolean],
      ['Zygote 模式', 'ro.zygote'],
      ['持久日志缓冲区', 'persist.logd.size'],
    ],
  ],
];
const partitionNames: Readonly<Record<string, string>> = {
  system: '系统分区',
  vendor: '供应商分区',
  product: '产品分区',
  odm: 'ODM 分区',
  system_ext: '系统扩展分区',
  bootimage: '启动镜像',
};
const services: Readonly<Record<string, string>> = {
  adbd: 'ADB 服务',
  audioserver: '音频服务',
  cameraserver: '相机服务',
  surfaceflinger: '画面合成服务',
  bootanim: '开机动画',
  netd: '网络服务',
  vold: '存储卷服务',
  zygote: '应用进程（主）',
  zygote_secondary: '应用进程（辅助）',
  logd: '日志服务',
  servicemanager: '系统服务管理',
  hwservicemanager: '硬件服务管理',
  wificond: 'Wi-Fi 服务',
  installd: '应用安装服务',
  keystore2: '密钥存储服务',
};
/** Only fields with known semantics are presented; vendor debug keys are never guessed. */
export function deviceInfoGroups(properties: Record<string, string>): DeviceInfoGroup[] {
  const value = (keys: string) =>
    keys
      .split('|')
      .map((key) => properties[key]?.trim())
      .find((text) => text && !['unknown', 'null', 'undefined'].includes(text.toLowerCase())) || '';
  const group = (title: string, definitions: readonly Field[]): DeviceInfoGroup => ({
    title,
    items: definitions.flatMap(([label, keys, format]) => {
      const text = value(keys);
      return text ? [{ label, value: format ? format(text) : text }] : [];
    }),
  });
  const groups = fields.map(([title, definitions]) => group(title, definitions));
  for (const [partition, title] of Object.entries(partitionNames)) {
    const prefix = `ro.${partition}.build.`;
    groups.push(
      group(title, [
        ['构建编号', prefix + 'id'],
        ['Android 版本', prefix + 'version.release'],
        ['API 级别', prefix + 'version.sdk'],
        ['安全补丁', prefix + 'security_patch|' + prefix + 'version.security_patch'],
        ['增量版本', prefix + 'version.incremental'],
        ['构建类型', prefix + 'type', buildType],
        ['构建标签', prefix + 'tags', buildTags],
        ['构建时间', prefix + 'date.utc|' + prefix + 'date', buildDate],
        ['构建指纹', prefix + 'fingerprint'],
      ]),
    );
  }
  const states: Readonly<Record<string, string>> = {
    running: '运行中',
    stopped: '已停止',
    restarting: '重启中',
  };
  groups.push({
    title: '系统服务',
    items: Object.entries(properties)
      .filter(([key, state]) => key.startsWith('init.svc.') && Object.hasOwn(states, state.trim()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, state]) => {
        const name = key.slice('init.svc.'.length);
        return { label: lookup(services, name), value: states[state.trim()]! };
      }),
  });
  const device = groups[0];
  if (device) {
    const aliases = new Set(['设备代号', '产品名称', '产品板型', '硬件 SKU', '产品 SKU']);
    const seen = new Set<string>();
    const brand = device.items.find((item) => item.label === '品牌')?.value.toLowerCase();
    device.items = device.items.filter((item) => {
      if (item.label === '产品品牌' && item.value.toLowerCase() === brand) return false;
      if (!aliases.has(item.label)) return true;
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
  }
  return groups.filter((entry) => entry.items.length);
}
