import { AppIcon } from './ui/icon-markup.js';
export function EmptyState({
  subject,
  total,
  onAdd,
  title,
  description,
  icon,
  id,
  hidden,
  buttonId,
  disabled,
}: {
  subject: string;
  total: number;
  onAdd: () => void;
  title?: string;
  description?: string;
  icon?: string;
  id?: string;
  hidden?: boolean;
  buttonId?: string;
  disabled?: boolean;
}) {
  return (
    <div id={id} hidden={hidden} className="empty empty-onboarding">
      {icon && (
        <div className="empty-symbol">
          <AppIcon name={icon} />
        </div>
      )}
      <h2>{total ? `没有匹配的${subject}` : title || `还没有${subject}`}</h2>
      {(total || description) && <p>{total ? '请调整搜索关键词或筛选条件。' : description}</p>}
      {!total && (
        <button id={buttonId} type="button" className="primary" disabled={disabled} onClick={onAdd}>
          <AppIcon name="plus" />
          新增第一个{subject}
        </button>
      )}
    </div>
  );
}
