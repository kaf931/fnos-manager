import type { ReactNode } from 'react';

/** A bounded horizontal collection; cards keep their size on narrow screens. */
export function CompactCardStrip({ children }: { children: ReactNode }) {
  return (
    <div className="compact-card-strip" data-scroll-inset>
      {children}
    </div>
  );
}

export function CompactCard({
  title,
  description,
  icon,
  control,
  actions,
  onOpen,
  disabled,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  control: ReactNode;
  actions: ReactNode;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <article className="card compact-card">
      <button
        type="button"
        className="compact-card-open"
        aria-label={'编辑 ' + title}
        title={'编辑 ' + title}
        onClick={onOpen}
        disabled={disabled}
      >
        <span className="terminal-card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="card-info">
          <strong title={title}>{title}</strong>
          <span className="card-url">{description}</span>
        </span>
      </button>
      <div className="compact-card-controls">
        {control}
        {actions}
      </div>
    </article>
  );
}
