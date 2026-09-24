'use client';

import {
  BookOpenCheck,
  ChartLine,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Server,
  Settings,
  Siren,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import type { Page, IncidentSummary } from '@/lib/types';
import { cx } from '../ui/cx';
import { LiveDot } from '../ui/marks';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Board', icon: LayoutGrid },
  { href: '/incidents', label: 'Incidents', icon: Siren },
  { href: '/services', label: 'Services', icon: Server },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/runbooks', label: 'Runbooks', icon: BookOpenCheck },
  { href: '/analytics', label: 'Analytics', icon: ChartLine },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Open escalations get a count on the Incidents entry: the one number
  // worth interrupting navigation for.
  const { data } = useSWR<Page<IncidentSummary>>('/incidents?status=escalated&pageSize=1');
  const escalated = data?.total ?? 0;
  return (
    <nav aria-label="Main" className="flex flex-col">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group relative flex h-9 items-center gap-3 px-4 text-base transition-colors duration-150',
              active
                ? 'bg-ink/[0.07] font-semibold text-ink'
                : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'absolute inset-y-1.5 left-0 w-px',
                active ? 'bg-signal' : 'bg-transparent',
              )}
            />
            <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {href === '/incidents' && escalated > 0 ? (
              <span
                className="rounded-sm bg-signal px-1.5 text-xs font-bold text-signal-ink"
                aria-label={`${escalated} escalated`}
              >
                {escalated}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer() {
  const { user, logout } = useAuth();
  const { connected } = useRealtime();
  return (
    <div className="mt-auto flex flex-col gap-2 border-t rule-strong px-4 py-3">
      <div className="flex items-center justify-between">
        <LiveDot connected={connected} />
        <ThemeToggle />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink" title={user?.email}>
            {user?.email}
          </p>
          <p className="lettering">{user?.role}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
        >
          <LogOut aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-sheet focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r rule-strong bg-sheet/80 backdrop-blur-[2px] lg:flex">
        <div className="flex h-14 items-center border-b rule-strong px-4">
          <Link href="/" aria-label="SRE.ai board">
            <Logo />
          </Link>
        </div>
        <div className="py-3">
          <Nav />
        </div>
        <Footer />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b rule-strong bg-sheet/95 px-4 lg:hidden">
          <Link href="/" aria-label="SRE.ai board">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded text-ink hover:bg-ink/[0.06]"
          >
            <Menu aria-hidden className="h-5 w-5" />
          </button>
        </div>

        {open ? (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-ground/70"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r rule-strong bg-sheet">
              <div className="flex h-14 items-center justify-between border-b rule-strong px-4">
                <Logo />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded hover:bg-ink/[0.06]"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </div>
              <div className="py-3">
                <Nav onNavigate={() => setOpen(false)} />
              </div>
              <Footer />
            </div>
          </div>
        ) : null}

        <main
          id="main"
          className="mx-auto w-full max-w-[88rem] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
