import http from 'node:http';
import { normalizeContainer } from './core.js';
export function listContainers(
  socketPath: string = process.env.DOCKER_SOCKET || '/var/run/docker.sock',
) {
  return new Promise<ReturnType<typeof normalizeContainer>[]>((resolve, reject) => {
    const req = http.get({ socketPath, path: '/containers/json?all=1', timeout: 6000 }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => {
        text += chunk;
        if (text.length > 5 * 1024 * 1024) req.destroy(new Error('容器列表过大'));
      });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('Docker 返回错误');
          const data: unknown = JSON.parse(text);
          if (!Array.isArray(data)) throw new Error('Docker 容器列表格式无效');
          resolve(data.map(normalizeContainer));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker 连接超时')));
    req.on('error', reject);
  });
}
