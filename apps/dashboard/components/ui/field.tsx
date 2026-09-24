'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

const control =
  'w-full rounded border rule-strong bg-sheet px-3 text-base text-ink placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-ink/40 ' +
  'focus:outline-none focus-visible:border-signal focus-visible:shadow-[0_0_0_3px_rgb(var(--signal)/0.18)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-fault';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(control, 'h-9', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(control, 'min-h-[6rem] py-2', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(control, 'h-9 pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
  className?: string;
}

// Label above, hint or error below; the error replaces the hint and is
// announced via aria-describedby.
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="lettering">
        {label}
      </label>
      {children({
        id,
        ...(hint || error ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {error ? (
        <p id={noteId} className="text-sm text-fault">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        'flex items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-sm border transition-colors duration-150',
          checked ? 'border-ink bg-ink' : 'rule-strong bg-sheet',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'absolute top-[2px] h-3.5 w-3.5 rounded-[1px] transition-[left,background-color] duration-150 ease-draw',
            checked ? 'left-[18px] bg-sheet' : 'left-[2px] bg-ink-3',
          )}
        />
      </button>
      <span className="flex flex-col">
        <span className="text-base text-ink">{label}</span>
        {description ? <span className="text-sm text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}
