import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAiMarkdown } from '../.web-test/ai-markdown.js';
test('AI Markdown renders headings, tables and code without executable HTML or remote images', () => {
  const { window } = new JSDOM('');
  const html = renderAiMarkdown(
    '# 检查结果\n\n|项目|状态|\n|---|---|\n|SSH|正常|\n\n```sh\npwd\n```\n\n[安全](https://example.com) [不安全](javascript:alert(1))\n\n<script>alert(1)</script><img src="https://remote.invalid/pixel" onerror="alert(1)">',
    window,
  );
  const box = window.document.createElement('div');
  box.innerHTML = html;
  assert.equal(box.querySelector('h1').textContent, '检查结果');
  assert.equal(box.querySelectorAll('table tbody tr').length, 1);
  assert.equal(box.querySelector('pre code').textContent, 'pwd\n');
  assert.equal(box.querySelectorAll('script,img,iframe').length, 0);
  assert.equal(box.querySelector('[href^="javascript:"]'), null);
  assert.equal(box.querySelector('a').rel, 'noopener noreferrer');
  window.close();
});
