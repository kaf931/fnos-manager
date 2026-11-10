import { useMemo, useState } from 'react';
import { StorageToolbar } from './storage-toolbar.js';
import { ReactDialog } from './ui/react-dialog.js';
import { AppIcon } from './ui/icon-markup.js';
import { RecordBatchControl } from './record-batch.js';
import { NotificationRecords } from './notification-records.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
export function NotificationDeliveryDialog({
  api,
  toast,
  templateId,
  reminderId,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  templateId?: string;
  reminderId?: string;
  onClose: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [, rerender] = useState(0);
  const batch = useMemo(() => new RecordBatchControl(() => rerender((v) => v + 1), toast), [toast]);
  const filters =
    (templateId ? '&templateId=' + encodeURIComponent(templateId) : '') +
    (reminderId ? '&reminderId=' + encodeURIComponent(reminderId) : '');
  return (
    <ReactDialog
      open
      title="投递记录"
      size="large"
      layout="workspace"
      className="list-management-dialog dialog-scroll-surface"
      onClose={onClose}
    >
      <div className="task-form-body tool-page record-content">
        <StorageToolbar>
          <button
            type="button"
            className="toolbar-manage"
            aria-label="批量删除投递记录"
            title="批量删除"
            disabled={!batch.selectionCount()}
            onClick={() => void batch.manage().catch((e) => toast(errorMessage(e)))}
          >
            <AppIcon name="trash" />
            <span className="toolbar-action-label">批量删除</span>
          </button>
          <button
            type="button"
            className="toolbar-manage"
            aria-label="刷新投递记录"
            title="刷新"
            onClick={() => setRevision((v) => v + 1)}
          >
            <AppIcon name="refresh" />
            <span className="toolbar-action-label">刷新</span>
          </button>
        </StorageToolbar>
        <NotificationRecords api={api} active revision={revision} batch={batch} filters={filters} />
      </div>
    </ReactDialog>
  );
}
