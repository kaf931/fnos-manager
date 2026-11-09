import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { createApplication } from '../../server/index.js';
export async function appFixture(gateway = true) {
  const dir = await mkdtemp(os.tmpdir() + '/terminal-api-');
  const app = await createApplication({ dataDir: dir, gateway });
  const server = await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = origin + '/app/deskicons/api';
  const headers = {
    'x-trim-isadmin': 'true',
    'x-trim-userid': '1000',
    'content-type': 'application/json',
    Origin: 'http://nas:5666',
  };
  const state = await (await fetch(base + '/state', { headers })).json();
  headers['x-deskicons-token'] = state.csrfToken;
  return {
    app,
    server,
    origin,
    base,
    headers,
    call: (p, method = 'GET', body, extra = {}) =>
      fetch(base + '/terminal' + p, {
        method,
        headers: { ...headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      }),
    close: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
