import type { ReactNode } from 'react';

/** Feature gateways share the same card geometry as the storage overview. */
export function FeatureEntryCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="storage-entry-card shared-mobile-card">
      <div className="storage-entry-symbol">{icon}</div>
      <h2>{title}</h2>
      <p className="help">{description}</p>
      {children}
    </article>
  );
}
