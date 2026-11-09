import type { ReactNode } from 'react';

/** Shared key/value and grouping surface for workspace information panels. */
export function DetailRow({
  label,
  value,
  className = '',
}: {
  label: string;
  value?: ReactNode;
  className?: string;
}) {
  return (
    <div className={'terminal-monitor-kv' + (className ? ' ' + className : '')}>
      <span>{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );
}
export function DetailSection({
  title,
  children,
  collapsible = false,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (collapsible)
    return (
      <details className="terminal-monitor-card" open={defaultOpen}>
        <summary className="terminal-monitor-section-title">{title}</summary>
        {children}
      </details>
    );
  return (
    <section className="terminal-monitor-card">
      <h3 className="terminal-monitor-section-title">{title}</h3>
      {children}
    </section>
  );
}
