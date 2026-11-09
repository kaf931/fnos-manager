import { hostname, networkInterfaces } from 'node:os';
import type { ContainerPort, ContainerSummary } from './domain/docker.js';
import { menuPages, type IconEntry } from './domain/icons.js';
import { DomainError, inputRecord } from './errors.js';
export function httpUrl(value: unknown) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value) || value.length > 2048)
    throw new DomainError('请输入有效的 HTTP 或 HTTPS 地址');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new DomainError('仅支持不含账号密码的 HTTP / HTTPS 地址');
  return url.href;
}
export function validateEntry(
  value: unknown,
): Pick<IconEntry, 'name' | 'url' | 'mode' | 'containerId' | 'menuPage'> {
  const input = inputRecord(value);
  const name = String(input.name || '').trim();
  if (!name || name.length > 40 || /[\x00-\x1f]/.test(name))
    throw new DomainError('名称需为 1–40 个字符');
  if (input.menuPage != null) {
    if (!menuPages.includes(input.menuPage as never))
      throw new DomainError('请选择有效的 NAS 管家功能');
    const menuPage = input.menuPage as NonNullable<IconEntry['menuPage']>;
    return {
      name,
      menuPage,
      url: `/app/deskicons/?page=${menuPage}&standalone=1`,
      mode: 'iframe',
      containerId: null,
    };
  }
  return {
    name,
    menuPage: null,
    url: httpUrl(input.url),
    mode: input.mode === 'iframe' ? ('iframe' as const) : ('url' as const),
    containerId: typeof input.containerId === 'string' ? input.containerId.slice(0, 128) : null,
  };
}
function containerString(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('Docker 容器信息格式无效');
  return value;
}
export function normalizeContainer(value: unknown): ContainerSummary {
  const c = inputRecord(value, 'Docker 容器信息格式无效');
  const labels = c.Labels ? inputRecord(c.Labels, 'Docker 标签格式无效') : {};
  const label = (key: string) => (labels[key] == null ? '' : containerString(labels[key]));
  const rawPorts = c.Ports ?? [];
  if (!Array.isArray(rawPorts)) throw new DomainError('Docker 端口格式无效');
  const ports: ContainerPort[] = [];
  for (const value of rawPorts) {
    const port = inputRecord(value, 'Docker 端口格式无效');
    if (!port.PublicPort || port.Type !== 'tcp') continue;
    if (typeof port.PublicPort !== 'number' || typeof port.PrivatePort !== 'number')
      throw new DomainError('Docker 端口格式无效');
    ports.push({
      hostPort: port.PublicPort,
      containerPort: port.PrivatePort,
      hostIp: port.IP ? containerString(port.IP) : '0.0.0.0',
    });
  }
  const id = containerString(c.Id),
    names = c.Names;
  if (names != null && (!Array.isArray(names) || names.some((name) => typeof name !== 'string')))
    throw new DomainError('Docker 容器名称格式无效');
  const firstName = Array.isArray(names) && names.length ? containerString(names[0]) : '';
  const iconUrl = label('net.unraid.docker.icon') || label('homepage.icon') || label('dash.icon');
  return {
    id,
    name: (firstName || id.slice(0, 12)).replace(/^\//, ''),
    image: containerString(c.Image),
    state: containerString(c.State),
    ports,
    iconUrl: /^https?:\/\//i.test(iconUrl) ? iconUrl : '',
    serviceUrl: label('homepage.href') || label('net.unraid.docker.webui'),
  };
}
export function entryConfig(
  entry: Pick<IconEntry, 'id' | 'name' | 'url' | 'mode'> &
    Partial<Pick<IconEntry, 'containerId' | 'menuPage'>>,
  {
    serviceHosts = [
      hostname(),
      'localhost',
      ...Object.values(networkInterfaces())
        .flatMap((rows) => rows || [])
        .map((row) => row.address),
    ],
  }: { serviceHosts?: string[] } = {},
) {
  if (!/^[a-z0-9]{6,32}$/.test(entry.id)) throw new DomainError('无效图标 ID');
  const appname = `deskicon.${entry.id}`;
  if (entry.menuPage) {
    const valid = validateEntry(entry);
    return {
      '.url': {
        [`${appname}.main`]: {
          title: valid.name,
          icon: 'images/icon_{0}.png',
          type: 'iframe',
          protocol: '',
          url: valid.url,
          allUsers: false,
          control: { accessPerm: 'readonly' },
        },
      },
    };
  }
  const target = new URL(httpUrl(entry.url));
  const localService =
    !!entry.containerId && serviceHosts.includes(target.hostname.replace(/^\[|\]$/g, ''));
  const route = localService
    ? {
        protocol: target.protocol.slice(0, -1),
        port: target.port || (target.protocol === 'https:' ? '443' : '80'),
        url: target.pathname + target.search + target.hash,
      }
    : { protocol: '', url: `/cgi/ThirdParty/${appname}/index.cgi/` };
  return {
    '.url': {
      [`${appname}.main`]: {
        title: entry.name,
        icon: 'images/icon_{0}.png',
        type: entry.mode,
        ...route,
        allUsers: true,
      },
    },
  };
}
