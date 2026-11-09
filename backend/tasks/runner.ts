import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { TaskDefinition } from '../domain/tasks.js';
import type { WakeService } from '../wol.js';
import { DEVICE_TASK_ACTIONS } from './model.js';
import { runDeviceTask } from './network.js';
import type { OfficialClient } from './official.js';
export interface ProcessOptions {
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated?: boolean;
}
type ActionPlan =
  | { deviceAction: 'wake' | 'reboot' | 'shutdown'; deviceIds?: string[] }
  | { official: true; args: string[] }
  | { command: string; args: string[]; script?: boolean; then?: string[] };
export function executeProcess(
  command: string,
  args: string[],
  { input, timeoutMs = 300000, signal, env, cwd }: ProcessOptions = {},
) {
  return new Promise<ProcessResult>((resolve) => {
    let stdout = '',
      stderr = '',
      bytes = 0,
      truncated = false,
      timedOut = false,
      done = false;
    const child = spawn(command, args, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env || process.env,
      cwd,
    });
    const append = (name: 'stdout' | 'stderr', buffer: Buffer) => {
      const remaining = Math.max(0, 65536 - bytes);
      if (buffer.length > remaining) truncated = true;
      const value = buffer.subarray(0, remaining).toString();
      bytes += Math.min(remaining, buffer.length);
      if (name === 'stdout') stdout += value;
      else stderr += value;
    };
    child.stdout.on('data', (b: Buffer) => append('stdout', b));
    child.stderr.on('data', (b: Buffer) => append('stderr', b));
    child.stdin.on('error', () => {});
    let force: NodeJS.Timeout | null = null,
      pending: [number | null, Error | undefined] | undefined;
    const kill = () => {
      if (done || !child.pid) return;
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {}
      force = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {}
        force = null;
        if (pending) finish(...pending);
      }, 800);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const abort = () => kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) kill();
    const finish = (code: number | null, error?: Error) => {
      if (done) return;
      if (force) {
        pending = [code, error];
        return;
      }
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({
        code: code ?? -1,
        stdout,
        stderr: error ? String(error.message) : stderr,
        timedOut,
        truncated,
      });
    };
    child.once('error', (e: Error) => finish(127, e));
    child.once('close', (code: number | null) => finish(code));
    child.stdin.end(input || '');
  });
}
function applicationArgs(task: TaskDefinition): [string, string] {
  if (!task.action || !task.target) throw new Error('任务缺少程序操作或目标');
  return [task.action, task.target];
}
export function describeAction(task: TaskDefinition): ActionPlan {
  const deviceAction = DEVICE_TASK_ACTIONS[task.type];
  if (deviceAction)
    return {
      deviceAction,
      deviceIds: task.deviceIds,
    };
  if (task.type === 'script') return { command: '/bin/bash', args: ['-s'], script: true };
  if (task.type === 'docker') return { command: '/usr/bin/docker', args: applicationArgs(task) };
  if (task.type === 'app') {
    const [action, target] = applicationArgs(task);
    return {
      command: '/usr/local/bin/appcenter-cli',
      args: action === 'restart' ? ['stop', target] : [action, target],
      then: action === 'restart' ? ['start', target] : undefined,
    };
  }
  if (task.type === 'reboot') return { official: true, args: ['power', 'reboot', '--yes'] };
  if (task.type === 'trash-clear')
    return { official: true, args: ['file', 'trash', 'clear', '--yes'] };
  if (task.type === 'log-clear') {
    const { level, module } = task;
    if (typeof level !== 'number' || typeof module !== 'number')
      throw new Error('请选择有效的日志模块和级别');
    return {
      official: true,
      args: [
        'logger',
        'clear',
        ...(level < 0 ? ['--level=' + level] : ['--level', String(level)]),
        ...(module < 0 ? ['--module=' + module] : ['--module', String(module)]),
        '--yes',
      ],
    };
  }
  throw new Error('未确认此类型的官方调用方式');
}
export function createRunner({
  official,
  native = false,
  wake,
}: {
  official: OfficialClient;
  native?: boolean;
  wake?: WakeService;
}) {
  return async (task: TaskDefinition, { signal }: { signal?: AbortSignal } = {}) => {
    if (DEVICE_TASK_ACTIONS[task.type]) {
      if (!wake) throw Error('网络设备服务不可用');
      return runDeviceTask(task, { wake, signal });
    }
    const plan = describeAction(task);
    if ('deviceAction' in plan) throw new Error('网络设备服务不可用');
    if ('official' in plan)
      return official.execute(plan.args, {
        signal,
        timeoutMs: task.timeoutSeconds * 1000,
      });
    if (!plan.script && !native) throw new Error('请在飞牛原生应用中执行系统任务');
    if (task.type === 'app')
      await access(path.join('/var/apps', applicationArgs(task)[1], 'manifest'));
    const result = await executeProcess(plan.command, plan.args, {
      input: plan.script ? task.script : undefined,
      timeoutMs: task.timeoutSeconds * 1000,
      signal,
    });
    if (/\[Error\]/.test(result.stdout + '\n' + result.stderr)) result.code = result.code || 1;
    if (result.code === 0 && plan.then) {
      const next = await executeProcess(plan.command, plan.then, {
        timeoutMs: task.timeoutSeconds * 1000,
        signal,
      });
      if (/\[Error\]/.test(next.stdout + '\n' + next.stderr)) next.code = next.code || 1;
      return { ...next, stdout: result.stdout + '\n' + next.stdout };
    }
    return result;
  };
}
