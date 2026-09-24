'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { Logo } from '@/components/shell/logo';
import { useAuth } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        role="status"
        aria-label="Loading"
      >
        <Logo className="animate-[skeleton_1.6s_ease-in-out_infinite]" />
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <AppShell>{children}</AppShell>
    </RealtimeProvider>
  );
}
