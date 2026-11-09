import type { AriaAttributes } from 'react';

export function SortableHeader({
  label,
  direction = 'none',
  onSort,
  sortKey,
  ariaLabel = '按' + label + '排序',
}: {
  label: string;
  direction?: AriaAttributes['aria-sort'];
  onSort: () => void;
  sortKey?: string;
  ariaLabel?: string;
}) {
  return (
    <th scope="col" aria-sort={direction}>
      <button
        type="button"
        className="table-sort-header"
        data-sort={sortKey}
        aria-label={ariaLabel}
        onClick={onSort}
      >
        {label}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="m4 10 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </th>
  );
}
