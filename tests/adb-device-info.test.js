import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { remoteFixture } from './helpers/remote-react-fixture.js';
import { deviceInfoGroups } from '../.web-test/adb-device-info-model.js';
import { AdbDeviceInfo } from '../.web-test/adb-device-info.js';

const properties = {
  'ro.product.manufacturer': ' Xiaomi ',
  'ro.product.model': 'Phone',
  'ro.product.device': 'sample',
  'ro.build.version.release': '15',
  'ro.build.version.sdk': '35',
  'ro.build.version.security_patch': '2026-10-01',
  'ro.soc.model': 'Test SoC',
  'ro.product.cpu.abilist': 'arm64-v8a,armeabi-v7a,armeabi',
  'ro.serialno': 'PRIVATE_IDENTIFIER',
  'persist.debug.long': 'value',
};
test('device properties become concise localized groups and normalized architectures', () => {
  const groups = deviceInfoGroups(properties);
  assert.deepEqual(
    groups.map((g) => g.title),
    ['设备', '系统', '硬件'],
  );
  assert.equal(groups[0].items.find((i) => i.label === '品牌').value, 'Xiaomi');
  assert.equal(groups[2].items.find((i) => i.label === 'CPU 架构').value, 'ARM64 / ARM32');
  assert.ok(!JSON.stringify(groups).includes('PRIVATE_IDENTIFIER'));
  assert.ok(!JSON.stringify(groups).includes('ro.product'));
  const fallback = deviceInfoGroups({
    'ro.product.manufacturer': 'unknown',
    'ro.product.brand': 'AOSP',
    'ro.product.vendor.model': 'Fallback',
    'ro.hardware': 'unknown',
  });
  assert.deepEqual(fallback, [
    {
      title: '设备',
      items: [
        { label: '品牌', value: 'AOSP' },
        { label: '型号', value: 'Fallback' },
      ],
    },
  ]);
});
test('adapted information is searchable without any raw property surface', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(AdbDeviceInfo, { properties, loading: false, error: '' });
  assert.doesNotMatch(ui.document.body.textContent, /原始属性|ro\.product|PRIVATE_IDENTIFIER/);
  const search = ui.document.querySelector('[aria-label="搜索设备信息"]');
  assert.ok(search);
  await act(() => {
    search.value = '安全补丁';
    Simulate.change(search);
  });
  assert.match(ui.document.body.textContent, /2026-10-01/);
  assert.doesNotMatch(ui.document.body.textContent, /Phone/);
  await act(() => {
    search.value = 'nothing';
    Simulate.change(search);
  });
  assert.match(ui.document.body.textContent, /没有匹配的设备信息/);
});
test('security, connectivity, partition builds and every init service are adapted accurately', () => {
  const groups = deviceInfoGroups({
    'ro.boot.flash.locked': '1',
    'ro.boot.verifiedbootstate': 'green',
    'sys.usb.config': 'mtp,adb',
    'ro.vendor.build.version.security_patch': '2026-09-01',
    'init.svc.adbd': 'running',
    'init.svc.vendor.long-service-name': 'stopped',
    'init.svc.unknown-state': 'future-state',
    'vendor.unexplained': 'DO_NOT_RENDER',
  });
  const text = JSON.stringify(groups);
  assert.match(text, /已锁定/);
  assert.match(text, /验证通过/);
  assert.match(text, /文件传输/);
  assert.match(text, /2026-09-01/);
  assert.match(text, /运行中/);
  assert.match(text, /已停止/);
  assert.match(text, /vendor.long-service-name/);
  assert.doesNotMatch(text, /DO_NOT_RENDER|init\.svc|future-state/);
});
test('device information gives clear loading, error and empty states without stale values', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(AdbDeviceInfo, { properties, loading: true, error: '' });
  assert.match(ui.document.body.textContent, /正在读取/);
  assert.doesNotMatch(ui.document.body.textContent, /Phone/);
  await ui.render(AdbDeviceInfo, { properties, loading: false, error: '设备离线' });
  assert.equal(ui.document.querySelector('[role=alert]').textContent, '设备离线');
  assert.equal(ui.document.querySelectorAll('h3').length, 0);
  await ui.render(AdbDeviceInfo, { properties: {}, loading: false, error: '' });
  assert.match(ui.document.body.textContent, /暂无可识别/);
  assert.equal(ui.document.querySelector('details'), null);
});

test('device aliases collapse repeated codenames but preserve different hardware variants', () => {
  const groups = deviceInfoGroups({
    'ro.product.device': 'houji',
    'ro.product.name': 'houji',
    'ro.product.board': 'houji',
    'ro.boot.hardware.sku': 'houji',
    'ro.boot.product.hardware.sku': 'houji',
  });
  assert.deepEqual(groups[0].items, [{ label: '设备代号', value: 'houji' }]);
  const different = deviceInfoGroups({
    'ro.product.device': 'houji',
    'ro.product.name': 'houji_global',
    'ro.boot.hardware.sku': 'variant-B',
  });
  assert.ok(different[0].items.some((item) => item.value === 'houji_global'));
  assert.ok(different[0].items.some((item) => item.value === 'variant-B'));
  const noCodename = deviceInfoGroups({
    'ro.product.name': 'sample',
    'ro.product.board': 'sample',
  });
  assert.deepEqual(noCodename[0].items, [{ label: '产品名称', value: 'sample' }]);
});
test('vendor patch aliases, vendor API and metadata encryption are recognized without conflating security flags', () => {
  const groups = deviceInfoGroups({
    'ro.vendor.build.security_patch': '2026-08-01',
    'ro.vendor.api_level': '202504',
    'ro.crypto.metadata.enabled': 'true',
    'ro.secure': '1',
  });
  assert.equal(
    groups.find((g) => g.title === '供应商分区').items.find((i) => i.label === '安全补丁').value,
    '2026-08-01',
  );
  assert.equal(
    groups.find((g) => g.title === '系统').items.find((i) => i.label === '供应商 API 级别').value,
    '202504',
  );
  const security = groups.find((g) => g.title === '安全与启动').items;
  assert.ok(security.some((i) => i.label === '元数据加密' && i.value === '是'));
  assert.ok(security.some((i) => i.label === 'ADB 默认降权策略' && i.value === '启用'));
  assert.doesNotMatch(JSON.stringify(groups), /安全模式构建|已获得 root/);
  const alias = deviceInfoGroups({ 'ro.vendor.build.version.security_patch': '2026-07-01' });
  assert.equal(alias[0].items[0].value, '2026-07-01');
});
test('known codes become readable while unfamiliar values remain intact', () => {
  const groups = deviceInfoGroups({
    'persist.sys.locale': 'zh_CN',
    'persist.sys.country': 'cn',
    'sys.boot.reason': 'reboot,ota,vendor_extra',
    'ro.build.version.codename': 'REL',
    'ro.build.type': 'user',
    'ro.vendor.build.type': 'userdebug',
    'ro.build.tags': 'release-keys',
    'ro.build.version.preview_sdk': '0',
    'ro.build.date.utc': '0',
    'init.svc.bad-state': 'toString',
    'ro.debuggable': 'constructor',
  });
  const text = JSON.stringify(groups);
  assert.match(text, /中文/);
  assert.match(text, /中国/);
  assert.match(text, /zh-CN/);
  assert.match(text, /重启.*系统更新.*vendor_extra/);
  assert.match(text, /正式发行版/);
  assert.match(text, /用户调试版本/);
  assert.match(text, /正式签名密钥/);
  assert.match(text, /非预览版本/);
  assert.match(text, /1970-01-01 00:00:00 UTC/);
  assert.match(text, /constructor/);
  assert.doesNotMatch(text, /bad-state/);
  assert.match(
    JSON.stringify(
      deviceInfoGroups({
        'persist.sys.locale': 'invalid_locale_@@',
        'sys.boot.reason': 'vendor_future',
      }),
    ),
    /invalid_locale_@@.*vendor_future|vendor_future.*invalid_locale_@@/,
  );
});

test('older WebViews without localized display names retain usable locale values', () => {
  const displayNames = Intl.DisplayNames;
  try {
    Intl.DisplayNames = undefined;
    const groups = deviceInfoGroups({ 'persist.sys.locale': 'zh_CN', 'persist.sys.country': 'CN' });
    assert.deepEqual(
      groups[0].items.map((item) => item.value),
      ['zh_CN', 'CN'],
    );
  } finally {
    Intl.DisplayNames = displayNames;
  }
});

test('unrecognized architecture and USB enum values remain renderable text', () => {
  const groups = deviceInfoGroups({
    'ro.product.cpu.abilist': 'constructor,arm64-v8a',
    'sys.usb.config': 'toString,adb',
  });
  assert.equal(
    groups.find((group) => group.title === '硬件').items[0].value,
    'constructor / ARM64',
  );
  assert.equal(
    groups.find((group) => group.title === '连接').items[0].value,
    'toString / ADB 调试',
  );
});
