import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
const icons = await import('../server/icons.js').catch(() => ({}));
const pack = await import('../server/package.js').catch(() => ({}));
test('normalizes uploaded images to official dimensions and rejects junk', async () => {
  assert.equal(typeof icons.renderIcon, 'function');
  const src = await sharp({
    create: { width: 600, height: 300, channels: 4, background: '#457de5' },
  })
    .png()
    .toBuffer();
  for (const size of [64, 256]) {
    const out = await icons.renderIcon(src, size);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
    assert.equal(meta.format, 'png');
    assert.ok(out.length < 1024 * 1024);
  }
  await assert.rejects(() => icons.renderIcon(Buffer.from('not an image'), 64));
});
test('creates native shortcut package with executable CGI and correct URL', async () => {
  assert.equal(typeof pack.prepareShortcut, 'function');
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-test-');
  try {
    const entry = {
      id: 'abc123',
      name: '影视 "工具"',
      url: 'http://192.168.1.35:8096/?a=1&b=2',
      mode: 'iframe',
      revision: 2,
    };
    await pack.prepareShortcut(dir, entry, await icons.defaultIcon());
    const manifest = await readFile(dir + '/manifest', 'utf8');
    assert.match(manifest, /version=1.0.2/);
    assert.match(manifest, /ctl_stop=true/);
    const config = JSON.parse(await readFile(dir + '/app/ui/config', 'utf8'));
    assert.equal(config['.url']['deskicon.abc123.main'].title, entry.name);
    const cgi = await readFile(dir + '/app/ui/index.cgi', 'utf8');
    assert.match(cgi, /Status: 302/);
    assert.ok(cgi.includes(entry.url));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('discovers a declared webpage icon through real HTTP', async () => {
  const { createServer } = await import('node:http');
  const png = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#40b88a' } })
    .png()
    .toBuffer();
  const server = createServer((req, res) => {
    if (req.url === '/icon.png') {
      res.setHeader('content-type', 'image/png');
      res.end(png);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<link rel="icon" href="/icon.png">');
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const r = await icons.discoverIcon(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(r.source, '应用网页');
    assert.equal((await sharp(r.buffer).metadata()).width, 256);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('icon normalization does not accumulate transparent padding through discovery, storage and packaging', async () => {
  async function bounds(png) {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let left = info.width,
      top = info.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[(y * info.width + x) * 4 + 3] >= 8) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    return { width: right - left + 1, height: bottom - top + 1 };
  }
  let png = await icons.defaultIcon();
  for (let i = 0; i < 4; i++) {
    png = await icons.renderIcon(png, 256);
    assert.deepEqual(await bounds(png), { width: 256, height: 256 });
  }
  const small = await icons.renderIcon(png, 64);
  assert.deepEqual(await bounds(small), { width: 64, height: 64 });
});
