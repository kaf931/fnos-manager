import { DatabaseService } from '../../persistence/database.service.js';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskRecord } from '../../domain/tasks.js';
import { DomainError, errorInfo } from '../../errors.js';
import { TaskEngine } from '../../tasks/engine.js';
import { DEVICE_TASK_ACTIONS, TYPE_INFO } from '../../tasks/model.js';
import {
  checkConfirmedTargets,
  resolveTaskTargets,
  deviceTaskOptions,
} from '../../tasks/network.js';
import { OfficialClient } from '../../tasks/official.js';
import { createRunner, describeAction } from '../../tasks/runner.js';
import { requestOwner } from '../../terminal/transport.js';
import { Resources } from '../common/resources.js';
import type { ApiRequest, AppOptions } from '../common/types.js';
import { WakeService } from '../wake/wake.service.js';
import type { AuthorizeDto, ConfirmDto, ExchangeDto, TaskDto } from './dto.js';

const taskRevision = (task: unknown) =>
  createHash('sha256').update(JSON.stringify(task)).digest('hex');
@Injectable()
export class TasksService {
  constructor(
    private readonly engine: TaskEngine,
    private readonly official: OfficialClient,
    private readonly native: boolean,
    private readonly owner: (req: ApiRequest) => string,
    private readonly visible: (task: TaskRecord, uid: string) => boolean,
    private readonly ownedTask: (req: ApiRequest, id: string) => TaskRecord,
    private readonly checkTask: (input: TaskDto | TaskRecord, req: ApiRequest) => Promise<unknown>,
    private readonly wake: import('../../wol.js').WakeService,
    private readonly root: string,
  ) {}
  async deviceOptions(req: ApiRequest) {
    const { owner, wake } = this;
    return deviceTaskOptions(
      wake,
      owner(req),
      typeof req.query.type === 'string' ? req.query.type : '',
    );
  }
  async capabilities(req: ApiRequest) {
    const { official, native, wake } = this;
    const connection = await official.state();
    return {
      timezone: 'Asia/Shanghai',
      native,
      connection,
      types: TYPE_INFO.map((t) => ({
        ...t,
        available:
          (t.support === 'device' && !!wake) ||
          t.support === 'script' ||
          (t.support === 'native' && native) ||
          (t.support === 'oauth' && connection.installed),
        ready:
          (t.support === 'device' && !!wake) ||
          t.support === 'script' ||
          (t.support === 'native' && native) ||
          (t.support === 'oauth' && connection.connected),
      })),
    };
  }
  async programs(req: ApiRequest) {
    const { native } = this;
    if (!native) return [];
    const apps: { id: string; name: string }[] = [];
    for (const name of await readdir('/var/apps')) {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name) ||
        ['deskicons', 'nodejs_v22'].includes(name)
      )
        continue;
      try {
        const text = await readFile(path.join('/var/apps', name, 'manifest'), 'utf8');
        if (/^ctl_stop\s*=\s*false\s*$/m.test(text)) continue;
        const title =
          text
            .match(/^display_name\s*=\s*(.+)$/m)?.[1]
            ?.trim()
            .replace(/^"|"$/g, '') || name;
        apps.push({ id: name, name: title });
      } catch {}
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  async listTasks(req: ApiRequest) {
    const { engine, owner, visible } = this;
    return engine.list().filter((task) => visible(task, owner(req)));
  }
  async listRuns(req: ApiRequest) {
    const { engine, owner, visible } = this;
    return engine.history().filter((run) => {
      const task = engine.state.tasks.find((task) => task.id === run.taskId);
      return task && visible(task, owner(req));
    });
  }
  async createTask(req: ApiRequest, inputDto: TaskDto) {
    const { engine, checkTask } = this;
    if (
      TYPE_INFO.find((t) => t.id === inputDto.type)?.support === 'oauth' &&
      !(await this.official.state()).connected
    )
      throw new DomainError('请先完成官方授权，再创建此任务');
    const body = await checkTask(inputDto, req);
    return await engine.create(body);
  }
  async updateTask(req: ApiRequest, inputDto: TaskDto) {
    const { engine, owner, ownedTask, checkTask } = this;
    const old = ownedTask(req, req.params.id),
      input = inputDto;
    if (
      old.pendingReason &&
      TYPE_INFO.find((t) => t.id === old.type)?.support === 'oauth' &&
      !(await this.official.state()).connected
    )
      throw new DomainError('恢复的任务需先重新完成官方授权，再编辑确认');
    const pausing =
      !old.pendingReason &&
      DEVICE_TASK_ACTIONS[old.type] &&
      input?.type === old.type &&
      input.enabled === false &&
      Array.isArray(input.deviceIds) &&
      JSON.stringify([...input.deviceIds].sort()) ===
        JSON.stringify([...(old.deviceIds ?? [])].sort());
    const body = pausing
      ? { ...input, ownerUid: owner(req), deviceTargets: old.deviceTargets }
      : await checkTask(input, req);
    return await engine.update(req.params.id, body);
  }
  async removeTask(req: ApiRequest) {
    const { engine, ownedTask } = this;
    ownedTask(req, req.params.id);
    await engine.remove(req.params.id);
  }
  async runTask(req: ApiRequest, inputDto: ConfirmDto) {
    const { engine, ownedTask, checkTask } = this;
    const task = ownedTask(req, req.params.id);
    const expectedRevision = inputDto?.expectedRevision ?? taskRevision(task);
    if (task.pendingReason) throw new DomainError('任务待完善：' + task.pendingReason, 409);
    if (!DEVICE_TASK_ACTIONS[task.type]) await checkTask({ ...task, enabled: true }, req);
    if (TYPE_INFO.find((t) => t.id === task.type)?.dangerous && inputDto?.confirmed !== true)
      throw new DomainError('请确认立即执行此操作');
    if (taskRevision(ownedTask(req, task.id)) !== expectedRevision)
      throw new DomainError('任务配置已变化，请重新查看执行预览', 409);
    return await engine.run(task.id);
  }
  async previewTask(req: ApiRequest) {
    const { ownedTask } = this;
    const task = ownedTask(req, req.params.id);
    return {
      dryRun: true,
      revision: taskRevision(task),
      retryCount: task.retryCount ?? 0,
      missedPolicy: task.missedPolicy ?? 'skip',
      timeoutSeconds: task.timeoutSeconds,
      timezone: 'Asia/Shanghai',
      plan: describeAction(task),
      notice: TYPE_INFO.find((t) => t.id === task.type)?.notice || '',
      willExecute: false,
    };
  }
  async taskRuns(req: ApiRequest) {
    const { engine, ownedTask } = this;
    ownedTask(req, req.params.id);
    return engine.history(req.params.id);
  }
  async officialStatus(req: ApiRequest) {
    const { official } = this;
    return await official.state();
  }
  async authorizeOfficial(req: ApiRequest, inputDto: AuthorizeDto) {
    const { official, native } = this;
    if (!native) throw new DomainError('请在飞牛原生应用中连接官方授权');
    return await official.authorize(inputDto?.origin, inputDto?.fileStorage);
  }
  async exchangeOfficial(req: ApiRequest, inputDto: ExchangeDto) {
    const { official } = this;
    try {
      return await official.exchange(inputDto?.code);
    } catch (e) {
      throw new DomainError(errorInfo(e).message);
    }
  }
  async disconnectOfficial(req: ApiRequest) {
    const { official } = this;
    await official.disconnect();
    return { connected: false };
  }
  async officialLogModules(req: ApiRequest) {
    const { official } = this;
    return await official.modules();
  }
  static async create(
    { dataDir, root, gateway, startScheduler }: AppOptions,
    wakeProvider: WakeService,
    resources: Resources,
    database: DatabaseService,
  ) {
    const wake = wakeProvider.service;
    let native = false;
    try {
      await access('/usr/local/bin/appcenter-cli');
      native = process.platform === 'linux' && gateway;
    } catch {}
    const official = await new OfficialClient(
      dataDir,
      process.env.FNOS_CLI_BINARY || path.join(root, 'tools/fnos-cli'),
      database,
    ).init();
    const engine = await new TaskEngine(dataDir, {
      runner: createRunner({ official, native, wake }),
      database: database,
    }).init();
    const owner = (req: ApiRequest) => requestOwner(req, gateway),
      visible = (task: TaskRecord, uid: string) =>
        !DEVICE_TASK_ACTIONS[task.type] || task.ownerUid === uid;
    const ownedTask = (req: ApiRequest, id: string) => {
      const task = engine.find(id);
      if (!visible(task, owner(req))) throw Object.assign(Error('任务不存在'), { status: 404 });
      return task;
    };
    const checkTask = async (input: TaskDto | TaskRecord, req: ApiRequest) => {
      const type = TYPE_INFO.find((t) => t.id === input?.type);
      if (type?.support === 'native' && !native)
        throw new DomainError('此任务需安装飞牛原生版后创建');
      if (
        type?.support === 'oauth' &&
        input?.enabled === true &&
        !(await official.state()).connected
      )
        throw new DomainError('请先完成官方授权，再启用任务');
      if (DEVICE_TASK_ACTIONS[input?.type]) {
        if (!wake) throw new DomainError('网络设备服务不可用');
        const limit = input.type === 'device-wake' ? 50 : 10;
        if (
          !Array.isArray(input.deviceIds) ||
          !input.deviceIds.length ||
          input.deviceIds.length > limit
        )
          throw new DomainError(`请选择 1–${limit} 台设备`);
        const uid = owner(req),
          rows = resolveTaskTargets(wake, uid, input.deviceIds, input.type);
        if (input.type !== 'device-wake' && input.deviceTargets)
          checkConfirmedTargets(input.deviceTargets, rows);
        return {
          ...input,
          ownerUid: uid,
          ...(input.type !== 'device-wake' ? { deviceTargets: rows.map((row) => row.target) } : {}),
        };
      }
      return input;
    };
    resources.add('taskEngine', engine);
    resources.scheduler(startScheduler);
    return new TasksService(
      engine,
      official,
      native,
      owner,
      visible,
      ownedTask,
      checkTask,
      wake,
      root,
    );
  }
}
