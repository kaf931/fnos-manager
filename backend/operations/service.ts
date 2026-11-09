import { OperationRejected } from './outcome.js';
import type { OperationAction, OperationStatus } from '../domain/operations.js';
import { OperationRepository } from '../persistence/operation.repository.js';
export class OperationService {
  constructor(readonly repository: OperationRepository) {}
  list(...args: Parameters<OperationRepository['list']>) {
    return this.repository.list(...args);
  }
  settings(owner: string) {
    return this.repository.settings(owner);
  }
  saveSettings(...args: Parameters<OperationRepository['saveSettings']>) {
    return this.repository.saveSettings(...args);
  }
  begin(owner: string, action: OperationAction, target: string) {
    return this.repository.begin(owner, action, target);
  }
  finish(id: string, owner: string, status: Exclude<OperationStatus, 'running'>, summary?: string) {
    try {
      this.repository.finish(
        id,
        owner,
        status,
        summary ??
          {
            success: '操作已完成',
            partial: '部分操作完成',
            failed: '操作失败',
            interrupted: '操作中断，实际结果未知，请先核实',
          }[status],
      );
    } catch {
      console.error('操作记录结束状态保存失败，请核实实际结果');
    }
  }
  async run<T>(
    owner: string,
    action: OperationAction,
    target: string,
    work: () => Promise<T>,
    result: (value: T) => Exclude<OperationStatus, 'running'> = () => 'success',
  ): Promise<T> {
    const id = this.begin(owner, action, target);
    let value: T;
    try {
      value = await work();
    } catch (error) {
      this.finish(id, owner, error instanceof OperationRejected ? 'failed' : 'interrupted');
      throw error;
    }
    this.finish(id, owner, result(value));
    return value;
  }
}
