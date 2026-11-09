import { TaskEnabledSwitch } from './task-enabled-switch.js';
import type { TaskAction, TaskRecord, TaskTypeInfo, Schedule } from './contracts/tasks.js';
import React from 'react';
import { MobileMoreButton } from './mobile-more-button.js';
import Dropdown, { type DropdownProps } from '@douyinfe/semi-ui/lib/es/dropdown';
const Menu = (props: DropdownProps) => <Dropdown {...props} />;
const h = React.createElement;
export function MobileTaskCards({
  onAction,
  tasks,
  info,
  frequency,
  date,
  status,
  toggling = new Set<string>(),
  disabledReason = () => '',
}: {
  onAction: (action: TaskAction, id: string) => void;
  tasks: TaskRecord[];
  info: (type: string) => TaskTypeInfo | undefined;
  frequency: (schedule: Schedule) => string;
  date: (date?: string | null) => string;
  status: Record<string, string>;
  toggling?: ReadonlySet<string>;
  disabledReason?: (task: TaskRecord) => string;
}) {
  return h(
    React.Fragment,
    null,
    ...tasks.map((t) =>
      h(
        'article',
        { className: 'mobile-task-card', key: t.id },
        h(
          'div',
          { className: 'mobile-task-heading' },
          h(
            'span',
            { className: 'mobile-task-icon', 'aria-hidden': true },
            h(
              'svg',
              { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
              h('circle', { cx: 12, cy: 12, r: 9 }),
              h('path', { d: 'M12 7v5l3 2' }),
            ),
          ),
          h(
            'div',
            { className: 'mobile-task-title' },
            h('h3', null, t.name),
            t.pendingReason && h('p', { className: 'help' }, t.pendingReason),
            h(
              'p',
              null,
              h('span', { className: `mobile-status-dot ${t.enabled ? 'enabled' : ''}` }),
              t.pendingReason ? '待完善' : t.running ? '执行中' : t.enabled ? '已启用' : '已暂停',
              h('span', { className: 'mobile-task-kind' }, info(t.type)?.name || t.type),
            ),
          ),
          h(
            Menu,
            {
              trigger: 'click',
              position: 'bottomRight',
              className: 'mobile-task-menu',
              render: h(
                Dropdown.Menu,
                null,
                ...(
                  [
                    ['run', '立即执行'],
                    ['edit', '编辑任务'],
                    ['history', '执行记录'],
                    ['delete', '删除任务'],
                  ] as const
                ).map(([a, label]) =>
                  h(
                    Dropdown.Item,
                    {
                      key: a,
                      disabled:
                        toggling.has(t.id) ||
                        (!!t.running && ['run', 'edit', 'delete'].includes(a)) ||
                        (!!t.pendingReason && a === 'run'),
                      type: a === 'delete' ? 'danger' : undefined,
                      onClick: () => onAction(a, t.id),
                    },
                    label,
                  ),
                ),
              ),
            },
            h(MobileMoreButton, { 'aria-label': `${t.name}的更多操作` }),
          ),
        ),
        h(
          'div',
          { className: 'mobile-task-facts' },
          h('div', null, h('span', null, '执行计划'), h('strong', null, frequency(t.schedule))),
          h(
            'div',
            null,
            h('span', null, '上次结果'),
            h(
              'strong',
              { className: `mobile-result ${t.lastRun?.status || ''}` },
              status[t.lastRun?.status || ''] || '未执行',
            ),
          ),
        ),
        h(
          'div',
          { className: 'mobile-task-next' },
          h('span', null, '下次执行'),
          h('span', null, t.enabled ? date(t.nextRunAt) : '—'),
          h(TaskEnabledSwitch, {
            task: t,
            reason: disabledReason(t),
            busy: toggling.has(t.id),
            onToggle: () => onAction('toggle', t.id),
          }),
        ),
      ),
    ),
  );
}
