import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi, tick } from './fixtures/react-ui.js';
test('update dialog shows architecture download and notes using public dialog controls', async (t) => {
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url, method) =>
      url === '/updates/status'
        ? { supported: true, job: null }
        : url === '/updates/install'
          ? {
              id: 'test',
              version: '0.3.5',
              phase: 'downloading',
              received: 20,
              total: 100,
              message: '正在下载安装包',
            }
          : {
              current: '0.3.4',
              latest: 'v0.3.5',
              hasUpdate: true,
              architecture: 'arm64',
              notes: '### 新增\n\n- **修复问题**\n\n<script>alert(1)</script>',
              url: 'https://github.com/kaf931/fnos-manager/releases/tag/v0.3.5',
              asset: {
                name: '0.3.5-arm64.fpk',
                url: 'https://github.com/kaf931/fnos-manager/releases/download/v0.3.5/0.3.5-arm64.fpk',
                size: 100,
                sha256: 'a'.repeat(64),
              },
            },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  assert.equal(ui.get('dialog').getAttribute('data-dialog-layout'), 'fixed');
  assert.match(ui.get('dialog').textContent, /发现新版本 v0.3.5/);
  assert.match(ui.get('.dialog-footer').textContent, /立即更新/);
  assert.equal(ui.get('.ai-markdown h3').textContent, '新增');
  assert.equal(ui.get('.ai-markdown li strong').textContent, '修复问题');
  assert.equal(document.querySelector('.ai-markdown script'), null);
  assert.equal(document.querySelector('.output-box'), null);
  await act(async () => {
    [...document.querySelectorAll('.dialog-footer button')]
      .find((b) => b.textContent === '立即更新')
      .click();
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /正在下载安装包/);
  assert.match(ui.get('.dialog-footer').textContent, /更新中…/);
  assert.ok(ui.get('[aria-label="安装包下载进度"]'));
});

test('current release cannot be installed again', async (t) => {
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url) =>
      url === '/updates/status'
        ? { supported: true, job: null }
        : {
            current: '0.3.4',
            latest: '0.3.4',
            hasUpdate: false,
            notes: '',
            asset: { sha256: 'a'.repeat(64) },
          },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  const button = [...document.querySelectorAll('.dialog-footer button')].find(
    (x) => x.textContent === '已是最新版本',
  );
  assert.ok(button);
  assert.equal(button.disabled, true);
  assert.doesNotMatch(ui.get('.dialog-footer').textContent, /立即更新|下载安装包/);
});

test('old rollback does not block a newer release and focusing the open dialog refreshes release information', async (t) => {
  let latest = '0.3.5';
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url) =>
      url === '/updates/status'
        ? {
            supported: true,
            job: { version: '0.3.4', phase: 'rolled-back', message: '数据库版本不兼容' },
          }
        : {
            current: '0.3.3',
            latest,
            hasUpdate: true,
            notes: 'release',
            url: 'https://github.com/kaf931/fnos-manager/releases',
            asset: { sha256: 'a'.repeat(64) },
          },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /任务版本 0.3.4.*数据库版本不兼容/);
  assert.match(ui.get('.dialog-footer').textContent, /立即更新/);
  assert.doesNotMatch(ui.get('.dialog-footer').textContent, /刷新应用/);
  assert.match(ui.get('.dialog-footer').textContent, /重新检查/);
  latest = '0.3.6';
  await act(async () => {
    window.dispatchEvent(new window.Event('focus'));
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /发现新版本 0.3.6/);
});

test('failed recheck retains the visible release and reads the task independently', async (t) => {
  let offline = false;
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url) => {
      if (url === '/updates/status')
        return {
          supported: true,
          job: { version: '0.3.4', phase: 'rolled-back', message: '数据库不兼容' },
        };
      if (offline) throw new Error('连接超时');
      return {
        current: '0.3.3',
        latest: '0.3.6',
        hasUpdate: true,
        notes: '',
        warning: '显示上次检查结果',
        asset: { sha256: 'a'.repeat(64) },
      };
    },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /显示上次检查结果/);
  offline = true;
  await act(async () => {
    [...document.querySelectorAll('.dialog-footer button')]
      .find((e) => e.textContent === '重新检查')
      .click();
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /连接超时/);
  assert.match(ui.get('dialog').textContent, /发现新版本 0.3.6/);
  assert.match(ui.get('dialog').textContent, /数据库不兼容/);
  assert.match(ui.get('.dialog-footer').textContent, /立即更新/);
});

for (const current of ['0.3.6', '0.3.8']) {
  test(`completed historical update does not block release 0.3.8 when current is ${current}`, async (t) => {
    const installs = [];
    const ui = await mountUi(t, 'app-update', 'AppUpdate', {
      api: async (url, method, body) => {
        if (url === '/updates/status')
          return {
            supported: true,
            job: { version: '0.3.6', phase: 'completed', message: '更新完成，请刷新页面' },
          };
        if (url === '/updates/install') {
          installs.push(body);
          return {
            version: '0.3.8',
            phase: 'downloading',
            message: '正在下载',
            received: 0,
            total: 100,
          };
        }
        return {
          current,
          latest: 'v0.3.8',
          hasUpdate: current !== '0.3.8',
          notes: '',
          asset: { sha256: 'a'.repeat(64) },
        };
      },
    });
    await act(async () => {
      ui.get('button').click();
      await tick();
    });
    assert.doesNotMatch(ui.get('dialog').textContent, /任务版本 0.3.6|刷新应用/);
    if (current === '0.3.6') {
      assert.match(ui.get('dialog').textContent, /更新将保留数据/);
      await act(async () => {
        [...document.querySelectorAll('.dialog-footer button')]
          .find((b) => b.textContent === '立即更新')
          .click();
        await tick();
      });
      assert.deepEqual(installs, [{ version: 'v0.3.8' }]);
      assert.match(ui.get('.dialog-footer').textContent, /更新中/);
    } else assert.match(ui.get('.dialog-footer').textContent, /已是最新版本/);
  });
}

test('just completed selected release retains refresh action until current version catches up', async (t) => {
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url) =>
      url === '/updates/status'
        ? {
            supported: true,
            job: { version: '0.3.8', phase: 'completed', message: '更新完成，请刷新页面' },
          }
        : {
            current: '0.3.6',
            latest: 'v0.3.8',
            hasUpdate: true,
            notes: '',
            asset: { sha256: 'a'.repeat(64) },
          },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  assert.match(ui.get('.dialog-footer').textContent, /刷新应用/);
  assert.doesNotMatch(ui.get('.dialog-footer').textContent, /立即更新/);
});

test('active task can be stopped without showing unrelated older release notes', async (t) => {
  const calls = [];
  let job = {
    id: '40b7896f-40d5-46a3-a879-b29457a8d61b',
    version: '0.3.9',
    phase: 'downloading',
    message: '正在下载',
    received: 48,
    total: 100,
  };
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url, method, body) => {
      if (url === '/updates/status') return { supported: true, job };
      if (url === '/updates/cancel') {
        calls.push(body);
        job = { ...job, phase: 'cancelled', message: '更新已停止，下载缓存已保留' };
        return job;
      }
      return {
        current: '0.3.6',
        latest: '0.3.6',
        hasUpdate: false,
        notes: 'OLD_RELEASE_NOTES',
        asset: { sha256: 'a'.repeat(64) },
      };
    },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  assert.doesNotMatch(ui.get('dialog').textContent, /OLD_RELEASE_NOTES|当前版本 v0.3.6，最新发布/);
  const stop = [...document.querySelectorAll('.dialog-footer button')].find(
    (b) => b.textContent === '停止更新',
  );
  assert.ok(stop);
  await act(async () => {
    stop.click();
    await tick();
  });
  assert.deepEqual(calls, [{ id: job.id }]);
  assert.match(ui.get('dialog').textContent, /更新已停止/);
});

test('a delayed background check cannot revive an update after it is stopped', async (t) => {
  const release = {
    current: '0.3.8',
    latest: '0.3.9',
    hasUpdate: true,
    notes: '',
    asset: { sha256: 'a'.repeat(64) },
  };
  const job = {
    id: 'test-job',
    version: '0.3.9',
    phase: 'downloading',
    message: '正在下载',
    received: 1,
    total: 10,
  };
  let reads = 0,
    finishStatus;
  const ui = await mountUi(t, 'app-update', 'AppUpdate', {
    api: async (url) => {
      if (url === '/updates/status') {
        if (++reads === 1) return { supported: true, job };
        return new Promise((resolve) => {
          finishStatus = resolve;
        });
      }
      if (url === '/updates/cancel') return { ...job, phase: 'cancelled', message: '更新已停止' };
      return release;
    },
  });
  await act(async () => {
    ui.get('button').click();
    await tick();
  });
  await act(async () => {
    window.dispatchEvent(new window.Event('focus'));
    await tick();
  });
  await act(async () => {
    [...document.querySelectorAll('.dialog-footer button')]
      .find((b) => b.textContent === '停止更新')
      .click();
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /更新已停止/);
  await act(async () => {
    finishStatus({ supported: true, job });
    await tick();
  });
  assert.match(ui.get('dialog').textContent, /更新已停止/);
  assert.doesNotMatch(ui.get('.dialog-footer').textContent, /更新中|停止更新/);
});
