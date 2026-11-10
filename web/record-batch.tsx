import React, { useEffect, useRef, useState } from 'react';
import { confirmAction } from './confirmation.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import type { BatchRecordKind } from '../backend/domain/maintenance.js';
export const RECORD_BATCH_LIMIT = 200;
const protectedStatuses = new Set(['running', 'pending', 'sending', 'protected', 'in-use']);
export const canSelectRecord = (row: { status: string }) => !protectedStatuses.has(row.status);
export class RecordBatchControl {
  private count = 0;
  private action: () => Promise<void> = async () => {};
  constructor(
    private changed: () => void = () => {},
    private notify: Toast = () => {},
  ) {}
  report(message: string) {
    this.notify(message);
  }
  selectionCount() {
    return this.count;
  }
  manage() {
    return this.action();
  }
  publish(count: number, action: () => Promise<void>) {
    this.action = action;
    if (this.count !== count) {
      this.count = count;
      this.changed();
    }
  }
}
export interface RecordSelection {
  allLabel?: string;
  limit?: number;
  selected: ReadonlySet<string>;
  eligible: ReadonlySet<string>;
  busy: boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
}
export function useRecordBatch({
  api,
  kind,
  items,
  active,
  scope,
  control,
  refresh,
}: {
  api: ApiClient;
  kind: BatchRecordKind;
  items: { id: string; status: string }[];
  active: boolean;
  scope: string;
  control: RecordBatchControl;
  refresh: () => void;
}): RecordSelection {
  const [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const eligible = new Set(items.filter(canSelectRecord).map((row) => row.id)),
    selected = new Set(ids.filter((id) => eligible.has(id)));
  const live = useRef({ active, scope, eligible });
  live.current = { active, scope, eligible };
  const working = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    setIds([]);
  }, [active, scope]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      live.current.active = false;
    };
  }, []);
  useEffect(() => {
    setIds((old) => {
      const next = old.filter((id) => eligible.has(id));
      return next.length === old.length ? old : next;
    });
  }, [items]);
  async function manage() {
    if (!active || working.current || !selected.size) return;
    const snapshot = [...selected],
      ticket = scope;
    await confirmAction({
      title: '批量管理',
      text:
        kind === 'appMessages'
          ? '删除所选应用消息，未读消息也会移除。'
          : kind === 'completedReminders'
            ? '删除所选已完成的单次提醒，待办和重复提醒会保留。'
            : kind === 'aiHistory'
              ? '删除所选对话及其附件，使用中的对话不能删除。'
              : kind === 'updateCache'
                ? '清理所选更新缓存及回滚备份，之后重试可能需要重新下载。进行中的更新不能清理。'
                : kind === 'serviceLog'
                  ? '清理所选日志文件。当前日志会继续记录，未选择的日志保持不变。'
                  : '仅删除所选历史记录，不影响实际文件或应用配置。',
      accept: kind === 'serviceLog' ? '清理日志' : '删除记录',
      danger: true,
      onAccept: async () => {
        if (
          !live.current.active ||
          live.current.scope !== ticket ||
          snapshot.some((id) => !live.current.eligible.has(id))
        )
          throw new Error('所选记录已变化，请关闭弹窗后重新选择');
        if (working.current) return;
        working.current = true;
        setBusy(true);
        try {
          const result = await api<{ cleanupPending?: boolean }>(
            '/storage/cleanup/records/' + kind + '/delete',
            'POST',
            { ids: snapshot, confirmed: true },
          );
          if (live.current.active && live.current.scope === ticket) {
            setIds([]);
            refresh();
          }
          if (live.current.active)
            control.report(
              result.cleanupPending
                ? '记录已删除，部分附件文件将在后续清理时重试'
                : '所选记录已清理',
            );
        } finally {
          working.current = false;
          if (mounted.current) setBusy(false);
        }
      },
    });
  }
  useEffect(() => {
    control.publish(active && !busy ? selected.size : 0, manage);
  });
  return {
    limit: RECORD_BATCH_LIMIT,
    selected,
    eligible,
    busy,
    toggle(id) {
      if (busy || !eligible.has(id)) return;
      if (!selected.has(id) && selected.size >= RECORD_BATCH_LIMIT) {
        control.report(`每次最多选择 ${RECORD_BATCH_LIMIT} 条记录`);
        return;
      }
      setIds((old) => {
        const current = old.filter((value) => eligible.has(value));
        return current.includes(id)
          ? current.filter((value) => value !== id)
          : current.length < RECORD_BATCH_LIMIT
            ? [...current, id]
            : current;
      });
    },
    toggleAll() {
      if (busy) return;
      if (allRecordsSelected({ selected, eligible, limit: RECORD_BATCH_LIMIT })) {
        setIds([]);
      } else {
        setIds([...eligible].slice(0, RECORD_BATCH_LIMIT));
        if (eligible.size > RECORD_BATCH_LIMIT)
          control.report(
            `每次最多选择 ${RECORD_BATCH_LIMIT} 条记录，已选择前 ${RECORD_BATCH_LIMIT} 条`,
          );
      }
    },
  };
}
function allRecordsSelected(selection: Pick<RecordSelection, 'selected' | 'eligible' | 'limit'>) {
  const count = [...selection.selected].filter((id) => selection.eligible.has(id)).length;
  return (
    selection.eligible.size > 0 &&
    count === Math.min(selection.eligible.size, selection.limit ?? RECORD_BATCH_LIMIT)
  );
}
export function RecordSelectAll({ selection }: { selection: RecordSelection }) {
  return (
    <input
      type="checkbox"
      aria-label={selection.allLabel ?? '选择本页可清理记录'}
      checked={allRecordsSelected(selection)}
      title={selection.allLabel ?? `每次最多选择 ${selection.limit ?? RECORD_BATCH_LIMIT} 条记录`}
      disabled={selection.busy || !selection.eligible.size}
      onChange={selection.toggleAll}
    />
  );
}
export function RecordSelect({
  selection,
  id,
  name,
}: {
  selection: RecordSelection;
  id: string;
  name: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={'选择 ' + name}
      checked={selection.selected.has(id)}
      disabled={selection.busy || !selection.eligible.has(id)}
      onChange={() => selection.toggle(id)}
    />
  );
}
