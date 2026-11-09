import type { DuplicateGroup } from './contracts/storage.js';
import React from 'react';
import SideSheet, { type SideSheetReactProps } from '@douyinfe/semi-ui/lib/es/sideSheet';
const Sheet = (props: SideSheetReactProps) => <SideSheet {...props} />;
import { formatSize } from './terminal-file-model.js';
const h = React.createElement;
export function DuplicateDetails({
  group,
  onClose,
}: {
  group: DuplicateGroup | null;
  onClose: () => void;
}) {
  const [mobile, setMobile] = React.useState(matchMedia('(max-width:620px)').matches);
  React.useEffect(() => {
    const media = matchMedia('(max-width:620px)'),
      change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return h(
    Sheet,
    {
      visible: !!group,
      title: '重复文件',
      placement: mobile ? 'bottom' : 'right',
      width: mobile ? '100vw' : 'min(680px, 100vw)',
      height: mobile ? '90dvh' : undefined,
      className: 'task-history-sheet storage-duplicate-sheet',
      maskClosable: true,
      closeOnEsc: true,
      onCancel: onClose,
    },
    group &&
      h(
        React.Fragment,
        null,
        h(
          'p',
          { className: 'help' },
          `${group.paths.length} 个文件 · ${formatSize(group.size)} / 文件`,
        ),
        h(
          'div',
          { className: 'table-wrap' },
          h(
            'table',
            { className: 'task-table storage-duplicate-path-table' },
            h('thead', null, h('tr', null, h('th', null, '文件路径'))),
            h(
              'tbody',
              null,
              ...group.paths.map((path) => h('tr', { key: path }, h('td', null, path))),
            ),
          ),
        ),
        group.pathsTruncated && h('p', { className: 'help' }, '本组仅展示部分路径。'),
      ),
  );
}
