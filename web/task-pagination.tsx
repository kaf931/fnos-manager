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
  return (
    <div className="task-pagination-inner">
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
  );
}
