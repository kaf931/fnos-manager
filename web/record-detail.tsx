import { compactRecordDate } from './record-date.js';

/** Readable plain-text records share one scroll area rather than a nested log viewer. */
export function RecordDetail({
  title,
  content,
  createdAt,
}: {
  title: string;
  content: string;
  createdAt: string;
}) {
  return (
    <article className="record-detail" tabIndex={0} aria-label="详情内容">
      <h3>{title}</h3>
      <p className="help">
        <time dateTime={createdAt}>{compactRecordDate(createdAt)}</time>
      </p>
      <div className="record-detail-body">{content || '暂无内容'}</div>
    </article>
  );
}
