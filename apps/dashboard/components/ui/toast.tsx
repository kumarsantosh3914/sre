'use client';

import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './cx';

interface Toast {
  id: number;
  tone: 'ok' | 'fault';
  message: string;
}

const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number): void => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === 'fault' ? 8000 : 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex items-start gap-3 border bg-sheet px-4 py-3 text-base text-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/0.45)]',
              t.tone === 'ok' ? 'border-ok/60' : 'border-fault/60',
            )}
          >
            {t.tone === 'ok' ? (
              <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
            ) : (
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fault" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="text-ink-3 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
