import { useCallback, useRef } from 'react';
import ConfigProvider from '@douyinfe/semi-ui/lib/es/configProvider';
import { resolvePopupContainer } from './ui/popup-container.js';
import Pagination from '@douyinfe/semi-ui/lib/es/pagination';
export interface TaskPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
  showQuickJumper?: boolean;
}
export function TaskPagination({
  page,
  pageSize,
  total,
  onChange,
  showQuickJumper = false,
}: TaskPaginationProps) {
  const host = useRef<HTMLDivElement>(null);
  const popupContainer = useCallback(() => resolvePopupContainer(host.current), []);
  return (
    <ConfigProvider getPopupContainer={popupContainer}>
      <div ref={host} className="task-pagination-inner">
        <span className="pagination-total">共 {total} 项</span>
        <Pagination
          total={total}
          currentPage={page}
          pageSize={pageSize}
          pageSizeOpts={[10, 20, 50]}
          showSizeChanger
          showQuickJumper={showQuickJumper}
          onChange={onChange}
          popoverPosition="topRight"
        />
      </div>
    </ConfigProvider>
  );
}
