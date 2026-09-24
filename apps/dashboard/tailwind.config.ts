import type { Config } from 'tailwindcss';

// Every colour is a CSS variable so the two drafting media — blueprint
// (night) and whiteprint (day) — are one token swap, not two stylesheets.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: v('ground'),
        sheet: v('sheet'),
        panel: v('panel'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        'ink-3': v('ink-3'),
        rule: v('rule'),
        signal: v('signal'),
        'signal-ink': v('signal-ink'),
        ok: v('ok'),
        fault: v('fault'),
        cyan: v('cyan'),
      },
      fontFamily: {
        sans: ['"Archivo Variable"', 'system-ui', 'sans-serif'],
        mono: ['"Martian Mono Variable"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        md: ['1.0625rem', { lineHeight: '1.6rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
        '2xl': ['1.875rem', { lineHeight: '2.375rem' }],
      },
      borderRadius: { DEFAULT: '2px', sm: '1px', md: '3px' },
      transitionTimingFunction: { draw: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};

export default config;
