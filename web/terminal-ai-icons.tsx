import React from 'react';
const paths = {
  skills: <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" />,
  attachment: <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M6 15l8-8" />,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  settings: (
    <>
      <path d="m9 3 1-1h4l1 1 .5 2 2 .8 1.9-.5 2 3.4-.6 1.9L20 12l.8 1.4.6 1.9-2 3.4-1.9-.5-2 .8L15 21l-1 1h-4l-1-1-.5-2-2-.8-1.9.5-2-3.4.6-1.9L4 12l-.8-1.4-.6-1.9 2-3.4 1.9.5 2-.8L9 3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  new: <path d="M12 5v14M5 12h14" />,
  history: <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />,
};
export type AiIconName = keyof typeof paths;
export function AiIcon({ icon }: { icon: AiIconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[icon]}
    </svg>
  );
}
export const AiIconButton = React.forwardRef<
  HTMLButtonElement,
  { label: string; icon: AiIconName } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function AiIconButton({ label, icon, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      <AiIcon icon={icon} />
    </button>
  );
});
