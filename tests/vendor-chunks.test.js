import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../vite.config.js';

test('React core vendor excludes scoped React integrations to avoid a UI vendor initialization cycle', () => {
  const chunk = config.build.rollupOptions.output.manualChunks;
  assert.equal(chunk('/project/node_modules/react/index.js'), 'react-vendor');
  assert.equal(chunk('/project/node_modules/react-dom/client.js'), 'react-vendor');
  assert.equal(chunk('/project/node_modules/scheduler/index.js'), 'react-vendor');
  assert.equal(
    chunk('/project/node_modules/.pnpm/react@18/node_modules/react/index.js'),
    'react-vendor',
  );
  assert.equal(chunk('/project/node_modules/@dnd-kit/react/index.js'), 'ui-vendor');
  assert.equal(chunk('/project/node_modules/@dnd-kit/react/sortable.js'), 'ui-vendor');
  assert.equal(chunk('/project/node_modules/@dnd-kit/dom/index.js'), 'ui-vendor');
  assert.equal(chunk('/project/web/notifications.tsx'), undefined);
});
