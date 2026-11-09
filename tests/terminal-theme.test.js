import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('SSH and ADB terminals share the same live appearance binding', async () => {
  for (const file of ['web/terminal-view.tsx', 'web/adb-terminal.tsx']) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /bindTerminalTheme\(term(?:inal)?\)/);
  }
});
