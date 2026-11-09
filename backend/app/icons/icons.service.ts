import { DatabaseService } from '../../persistence/database.service.js';
import { nasAddress } from '../../nas-address.js';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { validateEntry } from '../../core.js';
import { listContainers } from '../../docker.js';
import { DomainError, errorInfo } from '../../errors.js';
import { discoverIcon } from '../../icons.js';
import { applicationCommand, installShortcut } from '../../native.js';
import { buildFpk, prepareShortcut } from '../../package.js';
import type { DiscoverIconDto, IconDto } from './dto.js';
import { Injectable } from '@nestjs/common';
import { defaultIcon, renderIcon } from '../../icons.js';
import { Store } from '../../store.js';
import type { AppOptions } from '../common/types.js';
@Injectable()
export class IconsService {
  constructor(
    public readonly dataDir: string,
    public readonly gateway: boolean,
    public readonly csrfToken: string,
    public readonly version: string,
    private readonly store: Store,
    private readonly getEntry: (id: string) => import('../../domain/icons.js').IconEntry,
    private readonly renderEntryIcon: (image?: string) => Promise<Buffer>,
    private readonly operation: <T>(id: string, fn: () => Promise<T>) => Promise<T>,
  ) {}
  image(id: string): Buffer {
    return this.store.image(this.getEntry(id).id);
  }
  async state(hostname: string) {
    const { gateway, csrfToken, version } = this;
    let native = false;
    try {
      await access('/usr/local/bin/appcenter-cli');
      native = process.platform === 'linux';
    } catch {}
    return {
      native,
      gateway,
      csrfToken,
      version,
      hostname: native ? nasAddress(hostname) : hostname,
    };
  }
  async listEntries() {
    return this.store.entries;
  }
  async containers() {
    try {
      return await listContainers();
    } catch (e) {
      throw new DomainError(
        errorInfo(e).code === 'EACCES'
          ? '没有访问 Docker 的权限，请检查应用权限'
          : '暂时无法连接 Docker，请确认 Docker 服务已启动',
        503,
      );
    }
  }
  async discover(inputDto: DiscoverIconDto) {
    const result = await discoverIcon(inputDto.url, inputDto.iconUrl);
    return {
      image: 'data:image/png;base64,' + result.buffer.toString('base64'),
      source: result.source,
    };
  }
  async createEntry(inputDto: IconDto) {
    const { renderEntryIcon, store } = this;
    const valid = validateEntry(inputDto),
      id = randomBytes(8).toString('hex');
    const image = await renderEntryIcon(inputDto.image);
    const entry = {
      ...valid,
      id,
      revision: 1,
      appliedRevision: 0,
      iconSource: String(inputDto.iconSource || '默认图标').slice(0, 40),
      updatedAt: new Date().toISOString(),
    };
    store.save(entry, image);
    return entry;
  }
  async updateEntry(id: string, inputDto: IconDto) {
    return this.operation(id, async () => {
      const { getEntry, renderEntryIcon, store } = this;
      const old = getEntry(id),
        valid = validateEntry(inputDto);
      const image = inputDto.image ? await renderEntryIcon(inputDto.image) : undefined;
      const entry = {
        ...old,
        ...valid,
        revision: old.revision + 1,
        iconSource: String(inputDto.iconSource || old.iconSource).slice(0, 40),
        updatedAt: new Date().toISOString(),
      };
      store.save(entry, image);
      return entry;
    });
  }
  async applyEntry(id: string) {
    const { getEntry, operation, store, gateway, dataDir } = this;
    const entry = getEntry(id);
    await operation(entry.id, async () => {
      if (!gateway || process.platform !== 'linux')
        throw new DomainError('请在飞牛原生应用中使用“添加到桌面”');
      const temp = await mkdtemp(path.join(dataDir, 'install-'));
      try {
        await prepareShortcut(temp, entry, this.image(entry.id));
        const fpk = await buildFpk(temp);
        await installShortcut(entry, fpk, temp);
        const current = store.find(entry.id);
        if (current) store.save({ ...current, appliedRevision: entry.revision });
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
    return { message: '已安装桌面入口；如桌面尚未显示，请刷新飞牛桌面' };
  }
  async removeEntry(id: string) {
    const { getEntry, operation, store, gateway } = this;
    const entry = getEntry(id);
    await operation(entry.id, async () => {
      if (gateway) {
        let installed = false;
        try {
          await access(`/var/apps/deskicon.${entry.id}/manifest`);
          installed = true;
        } catch {}
        if (installed) {
          await applicationCommand(['uninstall', `deskicon.${entry.id}`]);
          try {
            await access(`/var/apps/deskicon.${entry.id}/manifest`);
            throw new DomainError('桌面入口尚未卸载，请稍后重试');
          } catch (e) {
            if (errorInfo(e).code !== 'ENOENT') throw e;
          }
        }
      }
      store.remove(entry.id);
    });
  }
  async packageEntry(id: string) {
    const entry = this.getEntry(id);
    const temp = await mkdtemp(path.join(this.dataDir, 'export-'));
    const cleanup = () => rm(temp, { recursive: true, force: true });
    try {
      await prepareShortcut(temp, entry, this.image(entry.id));
      return { file: await buildFpk(temp), name: `deskicon.${entry.id}.fpk`, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  static async create(options: AppOptions, database: DatabaseService) {
    const { dataDir, gateway, csrfToken, version } = options,
      store = new Store(dataDir, database);
    const getEntry = (id: string) => {
      if (!/^[a-z0-9]{6,32}$/.test(id))
        throw Object.assign(new Error('图标不存在'), { status: 404 });
      const entry = store.find(id);
      if (!entry) throw Object.assign(new Error('图标不存在'), { status: 404 });
      return entry;
    };
    async function renderEntryIcon(image?: string) {
      let buffer;
      if (image) {
        if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))
          throw new Error('图片格式不支持');
        buffer = Buffer.from(image.split(',')[1], 'base64');
      } else buffer = await defaultIcon();
      return renderIcon(buffer, 256);
    }
    const busy = new Set<string>();
    async function operation<T>(id: string, fn: () => Promise<T>): Promise<T> {
      if (busy.has(id))
        throw Object.assign(new Error('该图标正在处理，请稍候'), {
          status: 409,
        });
      busy.add(id);
      try {
        return await fn();
      } finally {
        busy.delete(id);
      }
    }
    return new IconsService(
      dataDir,
      gateway,
      csrfToken,
      version,
      store,
      getEntry,
      renderEntryIcon,
      operation,
    );
  }
}
