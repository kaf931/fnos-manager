import { useMemo, useState } from 'react';
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
    <ReactDialog open title="投递记录" size="large" layout="workspace" onClose={onClose}>
      <div className="task-form-body tool-page record-content">
        <header className="toolbar task-toolbar">
          <div className="toolbar-actions">
            <button
              type="button"
              disabled={!batch.selectionCount()}
              onClick={() => void batch.manage().catch((e) => toast(errorMessage(e)))}
            >
              <AppIcon name="trash" />
              批量删除
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="刷新投递记录"
              onClick={() => setRevision((v) => v + 1)}
            >
              <AppIcon name="refresh" />
            </button>
          </div>
        </header>
        <NotificationRecords api={api} active revision={revision} batch={batch} filters={filters} />
      </div>
    </ReactDialog>
  );
}
