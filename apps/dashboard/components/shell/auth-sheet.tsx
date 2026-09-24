import type { ReactNode } from 'react';

// Auth forms sit on a single drawing sheet with a title block footer.
export function AuthSheet({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section className="sheet registered w-full max-w-[26rem]" aria-labelledby="auth-title">
      <div className="flex flex-col gap-2 px-6 pb-2 pt-6">
        <h1 id="auth-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="text-base text-ink-2">{lede}</p>
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
      <div className="border-t rule-strong px-6 py-3 text-sm text-ink-2">{footer}</div>
    </section>
  );
}
