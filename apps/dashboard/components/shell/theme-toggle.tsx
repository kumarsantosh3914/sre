'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'blueprint' | 'whiteprint';

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'blueprint' || set === 'whiteprint') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'blueprint' : 'whiteprint';
}

// Blueprint (night) / whiteprint (day). The choice is a per-viewer
// convenience, so localStorage is the right home for it.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);

  const flip = (): void => {
    const next: Theme = current() === 'blueprint' ? 'whiteprint' : 'blueprint';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sreai-theme', next);
    } catch {
      // Private mode: the choice just won't persist.
    }
    setTheme(next);
  };

  const label =
    theme === 'blueprint' ? 'Switch to whiteprint (day)' : 'Switch to blueprint (night)';
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
    >
      {theme === 'blueprint' ? (
        <Sun aria-hidden className="h-4 w-4" />
      ) : (
        <Moon aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}
