'use client';

import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'signal' | 'ink' | 'line' | 'quiet' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

// signal = the one thing a human must do now (approve, roll back). It is
// the only filled-orange control in the product; everything else is ink.
const VARIANTS: Record<Variant, string> = {
  signal:
    'bg-signal text-signal-ink border border-signal hover:brightness-110 active:brightness-95',
  ink: 'bg-ink text-sheet border border-ink hover:bg-ink/90 active:bg-ink/80',
  line: 'bg-transparent text-ink border rule-strong hover:bg-ink/[0.06] active:bg-ink/10',
  quiet: 'bg-transparent text-ink-2 border border-transparent hover:text-ink hover:bg-ink/[0.06]',
  danger: 'bg-transparent text-fault border border-fault/60 hover:bg-fault/10 active:bg-fault/15',
};

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'line',
    size = 'md',
    loading = false,
    icon,
    children,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded font-medium',
        'transition-[background-color,color,filter,box-shadow] duration-150 ease-draw',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});
