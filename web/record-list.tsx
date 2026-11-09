import { AutoScrollName } from './auto-scroll-name.js';
import { RecordSelectAll, RecordSelect, type RecordSelection } from './record-batch.js';
import React, { useEffect, useRef, useState } from 'react';
import { TaskPagination } from './task-pagination.js';
import { errorMessage, type ApiClient } from './contracts/shared.js';

interface Identified {
  id: string;
}
interface PageResult<T> {
  items: T[];
  total: number;
}
export interface RecordPageModel<T extends Identified> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  mobile: boolean;
  loading: boolean;
  error: string;
  changePage: (page: number, size: number) => void;
  loadMore: () => void;
  refresh: () => void;
}
export function useRecordPage<T extends Identified>({
  api,
  path,
  active,
  revision,
  filters = '',
}: {
  api: ApiClient;
  path: string;
  active: boolean;
  revision: number;
  filters?: string;
}): RecordPageModel<T> {
  const [mobile, setMobile] = useState(matchMedia('(max-width:620px)').matches);
  const [query, setQuery] = useState({ page: 1, pageSize: 10, tick: 0, reset: 0 });
  const [items, setItems] = useState<T[]>([]),
    [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const scope = useRef(''),
    wasActive = useRef(false),
    loadedPage = useRef(0);
  const pages = useRef(new Map<number, T[]>());
  useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const change = () => setMobile(media.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, []);
  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      return;
    }
    const key = `${path}|${filters}|${revision}|${mobile}|${query.reset}`;
    if (scope.current !== key || !wasActive.current) {
      scope.current = key;
      wasActive.current = true;
      loadedPage.current = 0;
      pages.current.clear();
      setItems([]);
      setError('');
      if (query.page !== 1) {
        setQuery((q) => ({ ...q, page: 1 }));
        return;
      }
    }
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      setLoading(true);
      try {
        const result = await api<PageResult<T>>(
          `${path}?page=${query.page}&pageSize=${query.pageSize}${filters}`,
        );
        if (cancelled) return;
        const last = Math.max(1, Math.ceil(result.total / query.pageSize));
        if (query.page > last) {
          if (mobile) {
            pages.current.clear();
            loadedPage.current = 0;
            setItems([]);
            setTotal(result.total);
          }
          setQuery((q) => ({ ...q, page: mobile ? 1 : last }));
          return;
        }
        if (mobile) {
          pages.current.set(query.page, result.items);
          const merged = new Map<string, T>();
          for (const [, rows] of [...pages.current].sort(([a], [b]) => a - b))
            for (const row of rows) if (!merged.has(row.id)) merged.set(row.id, row);
          setItems([...merged.values()]);
        } else setItems(result.items);
        loadedPage.current = query.page;
        setTotal(result.total);
        setError('');
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (!mobile) timer = setTimeout(() => void load(), 5000);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    api,
    path,
    active,
    revision,
    filters,
    mobile,
    query.page,
    query.pageSize,
    query.tick,
    query.reset,
  ]);
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    mobile,
    loading,
    error,
    changePage: (page, size) =>
      setQuery((q) => ({ ...q, page: size !== q.pageSize ? 1 : page, pageSize: size })),
    refresh: () =>
      setQuery((q) => ({
        ...q,
        page: mobile ? 1 : q.page,
        reset: q.reset + (mobile ? 1 : 0),
        tick: q.tick + 1,
      })),
    loadMore: () => setQuery((q) => ({ ...q, page: loadedPage.current + 1, tick: q.tick + 1 })),
  };
}
export function RecordFooter({
  model,
  label,
}: {
  model: RecordPageModel<Identified>;
  label: string;
}) {
  if (model.mobile)
    return model.items.length < model.total || model.error ? (
      <button
        type="button"
        className="text-button storage-history-load-more"
        disabled={model.loading}
        onClick={model.loadMore}
      >
        {model.error ? '重试加载' : '加载更多'}
      </button>
    ) : null;
  return (
    <div className="task-pagination native-pagination history-pagination" aria-label={label}>
      <TaskPagination
        page={model.page}
        pageSize={model.pageSize}
        total={model.total}
        onChange={model.changePage}
      />
    </div>
  );
}
export function RecordList({
  entries,
  loading,
  empty,
  selection,
}: {
  entries: {
    id: string;
    title: string;
    status: string;
    statusLabel: string;
    meta: string;
    detail: string;
    onOpen?: () => void;
    selects?: boolean;
  }[];
  loading: boolean;
  empty: string;
  selection?: RecordSelection;
}) {
  return (
    <div className="history-compact-list">
      {selection && (
        <label className="checkbox-label history-compact-row history-compact-select-all">
          <RecordSelectAll selection={selection} />
          <span className="muted">全选</span>
        </label>
      )}
      {entries.length ? (
        entries.map((row) => (
          <div className="history-compact-row" key={row.id}>
            {selection && <RecordSelect selection={selection} id={row.id} name={row.title} />}
            <AutoScrollName title={[row.title, row.detail].filter(Boolean).join(' · ')}>
              {row.onOpen ? (
                <button
                  type="button"
                  className="text-button"
                  title={[row.title, row.detail].filter(Boolean).join(' · ')}
                  aria-label={row.selects ? '选择记录 ' + row.title : undefined}
                  aria-pressed={row.selects ? selection?.selected.has(row.id) : undefined}
                  disabled={row.selects && (selection?.busy || !selection?.eligible.has(row.id))}
                  onClick={row.onOpen}
                >
                  {row.title}
                </button>
              ) : (
                [row.title, row.detail].filter(Boolean).join(' · ')
              )}
            </AutoScrollName>
            {row.statusLabel && (
              <span className={'state-badge ' + row.status}>{row.statusLabel}</span>
            )}
            {row.meta && (
              <span className="history-compact-meta muted" title={row.meta}>
                {row.meta}
              </span>
            )}
          </div>
        ))
      ) : !loading ? (
        <p className="help">{empty}</p>
      ) : null}
    </div>
  );
}
