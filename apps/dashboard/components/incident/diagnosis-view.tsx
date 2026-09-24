'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { SOURCE_LABEL } from '@/lib/format';
import type { CitationCheck, Diagnosis, Evidence } from '@/lib/types';
import { cx } from '../ui/cx';

const INLINE_TAG = /\[SOURCE:\s*([a-z_]+)\s*,\s*([^\]]+?)\s*\]/gi;

function normalize(text: string): string {
  return text
    .trim()
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/^\[[LMDHS]\d+\]\s*/, '')
    .replace(/\s+/g, ' ');
}

const REASON: Record<string, string> = {
  not_found: 'Not found in the context the model saw',
  source_mismatch: 'Quote exists, but in a different source',
  too_short: 'Too short to verify',
  unknown_source: 'Unknown source type',
};

export interface EvidenceRow extends Evidence {
  n: number;
  check: CitationCheck | null;
  verified: boolean;
}

export function evidenceRows(d: Diagnosis): EvidenceRow[] {
  const failures = new Set(d.citationFailures.map((f) => `${f.source}|${normalize(f.reference)}`));
  return d.evidence.map((e, i) => {
    const check =
      d.citationChecks.find(
        (c) =>
          c.origin === 'evidence' &&
          c.source === e.source &&
          normalize(c.reference) === normalize(e.reference),
      ) ?? null;
    const verified = check ? check.valid : !failures.has(`${e.source}|${normalize(e.reference)}`);
    return { ...e, n: i + 1, check, verified };
  });
}

function Balloon({
  n,
  verified,
  active,
  onActivate,
  label,
}: {
  n: number | '?';
  verified: boolean;
  active: boolean;
  onActivate: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onClick={() => {
        onActivate();
        document
          .getElementById(`evidence-${n}`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
      aria-label={label}
      data-balloon={n}
      className={cx(
        'ml-1 mr-0.5 inline-flex h-[1.35rem] min-w-[1.35rem] -translate-y-[0.1em] items-center justify-center rounded-full px-1 align-middle text-xs font-bold tabular-nums',
        'transition-[background-color,color,border-color] duration-150',
        verified
          ? 'border-[1.5px] border-ink/70 text-ink'
          : 'border-[1.5px] border-dashed border-fault text-fault',
        active && (verified ? 'border-signal bg-signal text-signal-ink' : 'bg-fault/15'),
      )}
    >
      {n}
    </button>
  );
}

// Inline tags may quote a shorter slice of the evidence line than the
// schedule row carries, so a containment match in either direction counts.
function matchRow(rows: EvidenceRow[], ref: string): EvidenceRow | undefined {
  if (!ref) return undefined;
  return rows.find((r) => {
    const own = normalize(r.reference);
    return own === ref || own.includes(ref) || ref.includes(own);
  });
}

type Segment = string | { word: string; marks: ReactNode[] };

// The hypothesis with its inline [SOURCE: …] tags turned into numbered
// balloons that point at rows of the evidence schedule below.
export function Hypothesis({
  diagnosis,
  rows,
  active,
  setActive,
}: {
  diagnosis: Diagnosis;
  rows: EvidenceRow[];
  active: number | null;
  setActive: (n: number | null) => void;
}) {
  const segments = useMemo(() => {
    // Each balloon is bound to the word before it (and the sentence's full
    // stop to the last balloon) so a line break never strands a balloon on
    // its own line.
    const segs: Segment[] = [];
    const bind = (before: string, mark: ReactNode): void => {
      const split = before.replace(/\s+$/, '').match(/^([\s\S]*?)(\S*)$/);
      const head = split?.[1] ?? '';
      const word = split?.[2] ?? '';
      const prev = segs[segs.length - 1];
      if (!word && !head && prev && typeof prev !== 'string') {
        prev.marks.push(mark);
        return;
      }
      if (head) segs.push(head);
      segs.push({ word, marks: [mark] });
    };
    const balloonFor = (r: EvidenceRow, verified: boolean, k: string): ReactNode => (
      <Balloon
        key={k}
        n={r.n}
        verified={verified}
        active={active === r.n}
        onActivate={() => setActive(r.n)}
        label={`Evidence ${r.n}: ${r.claim}${verified ? '' : ' (unverified)'}`}
      />
    );

    const cited = new Set<number>();
    let last = 0;
    let key = 0;
    const text = diagnosis.hypothesis;
    for (const match of text.matchAll(INLINE_TAG)) {
      const start = match.index ?? 0;
      const ref = normalize(match[2]);
      const row = matchRow(rows, ref);
      if (row) cited.add(row.n);
      const inline = diagnosis.citationChecks.find(
        (c) => c.origin === 'inline' && normalize(c.reference) === ref,
      );
      const verified = inline ? inline.valid : (row?.verified ?? false);
      bind(
        text.slice(last, start),
        row ? (
          balloonFor(row, verified, `b${key++}`)
        ) : (
          <Balloon
            key={`b${key++}`}
            n="?"
            verified={false}
            active={false}
            onActivate={() => setActive(null)}
            label={`Unverified citation: ${match[2]}`}
          />
        ),
      );
      last = start + match[0].length;
    }
    // Evidence rows the hypothesis doesn't tag inline get their balloons at
    // the end — before the full stop, so they read as part of the sentence —
    // and every row is reachable from the sentence exactly once.
    const tail = text.slice(last).match(/^([\s\S]*?)([.!?…]?)\s*$/);
    let body = tail?.[1] ?? text.slice(last);
    for (const r of rows.filter((row) => !cited.has(row.n))) {
      bind(body, balloonFor(r, r.verified, `u${r.n}`));
      body = '';
    }
    if (body) segs.push(body.replace(/\s+$/, ''));
    const terminal = tail?.[2] ?? '';
    const prev = segs[segs.length - 1];
    if (terminal && prev && typeof prev !== 'string') prev.marks.push(terminal);
    else if (terminal) segs.push(terminal);
    return segs;
  }, [diagnosis, rows, active, setActive]);

  return (
    <div className="flex flex-col gap-3">
      <p
        className="measure text-lg leading-[1.7] text-ink lg:text-xl lg:leading-[1.65]"
        style={{ textWrap: 'pretty' }}
      >
        {segments.map((seg, i) =>
          typeof seg === 'string' ? (
            seg
          ) : (
            <span key={`s${i}`} className="whitespace-nowrap">
              {seg.word}
              {seg.marks}
            </span>
          ),
        )}
      </p>
    </div>
  );
}

// The signature: a drafting leader from the active balloon down to its row
// in the evidence schedule, plotted in when a balloon or row is hovered or
// focused. Only where both sit in one column (lg and up); on a phone the
// action cell sits between them and the row highlight carries the link.
export function LeaderLine({
  container,
  active,
}: {
  container: RefObject<HTMLElement>;
  active: number | null;
}) {
  const [geo, setGeo] = useState<{ d: string; w: number; h: number; end: [number, number] } | null>(
    null,
  );
  useLayoutEffect(() => {
    const root = container.current;
    if (!root || active === null) {
      setGeo(null);
      return;
    }
    const measure = (): void => {
      const balloon = root.querySelector<HTMLElement>(`[data-balloon="${active}"]`);
      const mark = root.querySelector<HTMLElement>(`#evidence-${active} [data-mark]`);
      if (!window.matchMedia('(min-width: 1024px)').matches || !balloon || !mark) {
        setGeo(null);
        return;
      }
      const r = root.getBoundingClientRect();
      const b = balloon.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      // Route through the left margin, like a drafting leader clearing the
      // linework: drop into the leading under the balloon, run out to the
      // gutter, down, and in to the evidence mark.
      const bx = Math.round(b.left + b.width / 2 - r.left) + 0.5;
      const by = Math.round(b.bottom - r.top) + 2;
      const drop = by + 7;
      const gutter = -14.5;
      const my = Math.round(m.top + m.height / 2 - r.top) + 0.5;
      const mx = Math.round(m.left - r.left) - 3;
      setGeo({
        d: `M ${bx} ${by} V ${drop} H ${gutter} V ${my} H ${mx}`,
        w: r.width,
        h: r.height,
        end: [mx, my],
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [container, active]);

  if (!geo) return null;
  return (
    <svg
      aria-hidden
      width={geo.w}
      height={geo.h}
      className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
    >
      <path
        key={geo.d}
        d={geo.d}
        pathLength={1}
        fill="none"
        stroke="rgb(var(--signal))"
        strokeWidth={1}
        className="leader"
      />
      <path
        d={`M ${geo.end[0] - 6} ${geo.end[1] - 3.5} L ${geo.end[0]} ${geo.end[1]} L ${geo.end[0] - 6} ${geo.end[1] + 3.5}`}
        fill="none"
        stroke="rgb(var(--signal))"
        strokeWidth={1}
        className="leader-head"
      />
    </svg>
  );
}

// Evidence schedule: every claim, its source, and the verbatim line it
// cites — with the verification verdict SRE.ai reached for it.
export function EvidenceSchedule({
  rows,
  active,
  setActive,
}: {
  rows: EvidenceRow[];
  active: number | null;
  setActive: (n: number | null) => void;
}) {
  return (
    <ol className="flex flex-col" onMouseLeave={() => setActive(null)}>
      {rows.map((r) => {
        const on = active === r.n;
        return (
          <li
            key={r.n}
            id={`evidence-${r.n}`}
            onMouseEnter={() => setActive(r.n)}
            className={cx(
              'relative grid grid-cols-[2rem_1fr] gap-x-3 gap-y-1.5 border-b rule py-3 pl-1 pr-2 transition-colors duration-150 sm:grid-cols-[2rem_minmax(0,1fr)_7rem]',
              on && 'bg-signal/[0.07]',
            )}
          >
            {on ? (
              <span
                aria-hidden
                className="absolute left-[1.9rem] top-[1.3rem] h-px w-5 bg-signal animate-[draw-x_220ms_ease-out_both]"
              />
            ) : null}
            <span
              data-mark
              className={cx(
                'mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                r.verified
                  ? 'border-[1.5px] border-ink/70 text-ink'
                  : 'border-[1.5px] border-dashed border-fault text-fault',
                on && r.verified && 'border-signal bg-signal text-signal-ink',
              )}
            >
              {r.n}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-base text-ink">{r.claim}</p>
              <blockquote className="border-l rule-strong pl-3">
                <code className="block whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-2">
                  {r.reference}
                </code>
              </blockquote>
              {!r.verified ? (
                <p className="flex items-center gap-1.5 text-sm text-fault">
                  <CircleAlert aria-hidden className="h-3.5 w-3.5" />
                  {REASON[r.check?.reason ?? 'not_found']}
                  {r.check?.foundIn ? ` (${r.check.foundIn})` : ''}
                </p>
              ) : null}
            </div>
            <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:flex-col sm:items-end sm:gap-1">
              <span className="lettering">{SOURCE_LABEL[r.source] ?? r.source}</span>
              {r.verified ? (
                <span className="flex items-center gap-1 text-sm text-ok">
                  <CircleCheck aria-hidden className="h-3.5 w-3.5" /> Verified
                </span>
              ) : (
                <span className="text-sm font-medium text-fault">Unverified</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function useEvidence(diagnosis: Diagnosis) {
  const rows = useMemo(() => evidenceRows(diagnosis), [diagnosis]);
  const [active, setActive] = useState<number | null>(null);
  return { rows, active, setActive };
}
