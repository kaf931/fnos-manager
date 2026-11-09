import { useId, useState, type InputHTMLAttributes } from 'react';
export function PasswordField({
  label = '密码',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const id = props.id || generated;
  const action = (visible ? '隐藏' : '显示') + label;
  return (
    <div className="password-field">
      <input {...props} id={id} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="icon-button password-visibility"
        aria-controls={id}
        aria-label={action}
        title={action}
        aria-pressed={visible}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setVisible(!visible)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
