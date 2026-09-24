'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cx } from './cx';

// A value meant to be pasted somewhere else (webhook URL, API key, config).
export function CopyField({
  value,
  label,
  secret,
  className,
}: {
  value: string;
  label: string;
  secret?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className={cx('flex min-w-0 items-stretch border rule-strong bg-panel/60', className)}>
      <code
        className={cx(
          'min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 font-mono text-xs text-ink',
          secret && 'text-signal',
        )}
        aria-label={label}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex shrink-0 items-center gap-1.5 border-l rule-strong px-3 text-sm text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check aria-hidden className="h-4 w-4 text-ok" />
        ) : (
          <Copy aria-hidden className="h-4 w-4" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative border rule-strong bg-panel/60">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="absolute right-2 top-2 flex items-center gap-1.5 border rule-strong bg-sheet px-2 py-1 text-xs text-ink-2 hover:text-ink"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-ok" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed text-ink"
        aria-label={label}
      >
        {code}
      </pre>
    </div>
  );
}
