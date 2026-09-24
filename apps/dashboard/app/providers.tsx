'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ToastProvider } from '@/components/ui/toast';
import { fetcher } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{ fetcher, revalidateOnFocus: true, keepPreviousData: true, errorRetryCount: 2 }}
    >
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </SWRConfig>
  );
}
