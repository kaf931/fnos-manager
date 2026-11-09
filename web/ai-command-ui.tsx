export function Loading({ label }: { label: string }) {
  return (
    <div className="inline-loading" role="status" aria-live="polite">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity=".2"
        />
        <path
          d="M12 3a9 9 0 0 1 9 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}
