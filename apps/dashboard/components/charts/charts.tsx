'use client';

import { useState } from 'react';
import { SERIES, Tooltip, niceCountMax, niceMax, useWidth } from './chart-frame';

const PAD = { top: 16, right: 12, bottom: 26, left: 44 };

function Axis({
  width,
  height,
  max,
  format,
}: {
  width: number;
  height: number;
  max: number;
  format: (v: number) => string;
}) {
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const plotH = height - PAD.top - PAD.bottom;
  return (
    <g aria-hidden>
      {ticks.map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y}
              y2={y}
              stroke="rgb(var(--rule) / var(--rule-alpha))"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill="rgb(var(--ink-3))"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function xLabels(labels: string[], x: (i: number) => number, height: number, every: number) {
  return labels.map((l, i) =>
    i % every === 0 || i === labels.length - 1 ? (
      <text
        key={l + i}
        x={x(i)}
        y={height - 8}
        textAnchor="middle"
        fontSize={11}
        fill="rgb(var(--ink-3))"
      >
        {l}
      </text>
    ) : null,
  );
}

// Single-series line with a crosshair tooltip; end value labelled.
export function LineChart({
  points,
  format,
  scale = niceMax,
  height = 200,
  label,
}: {
  points: { x: string; y: number }[];
  format: (v: number) => string;
  scale?: (max: number) => number;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = scale(Math.max(...points.map((p) => p.y), 1));
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number): number =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number): number => PAD.top + plotH - (v / max) * plotH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.y)}`).join(' ');
  const last = points[points.length - 1];

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && points.length ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}. Latest ${format(last.y)} on ${last.x}.`}
          onPointerMove={(e) => {
            const rx = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const i = Math.round(((rx - PAD.left) / plotW) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <Axis width={width} height={height} max={max} format={format} />
          <path
            d={`${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
            fill={SERIES.p2}
            opacity={0.1}
          />
          <path
            d={path}
            fill="none"
            stroke={SERIES.p2}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {xLabels(
            points.map((p) => p.x.slice(5)),
            x,
            height,
            Math.ceil(points.length / 6),
          )}
          <circle
            cx={x(points.length - 1)}
            cy={y(last.y)}
            r={4}
            fill={SERIES.p2}
            stroke="rgb(var(--sheet))"
            strokeWidth={2}
          />
          {hover !== null ? (
            <g aria-hidden>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="rgb(var(--ink-3))"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(points[hover].y)}
                r={5}
                fill={SERIES.p2}
                stroke="rgb(var(--sheet))"
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
      ) : null}
      {hover !== null && width ? (
        <Tooltip x={x(hover)} y={y(points[hover].y)} width={width}>
          <span className="text-ink-3">{points[hover].x}</span>{' '}
          <span className="font-semibold">{format(points[hover].y)}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

type Key = 'p1' | 'p2' | 'p3';

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// Stacked columns (P1 bottom), ≤24px wide, 2px surface gaps between
// segments, 4px rounded data-end on the top segment only.
export function StackedColumns({
  rows,
  height = 220,
}: {
  rows: { x: string; p1: number; p2: number; p3: number }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = rows.map((r) => r.p1 + r.p2 + r.p3);
  const max = niceCountMax(Math.max(...totals, 1));
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(rows.length, 1);
  const barW = Math.min(24, band * 0.7);
  const cx = (i: number): number => PAD.left + band * i + band / 2;
  const h = (v: number): number => (v / max) * plotH;
  const keys: Key[] = ['p1', 'p2', 'p3'];

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Incidents per day by severity"
          onPointerLeave={() => setHover(null)}
        >
          <Axis width={width} height={height} max={max} format={(v) => String(Math.round(v))} />
          {rows.map((r, i) => {
            let base = PAD.top + plotH;
            const present = keys.filter((k) => r[k] > 0);
            return (
              <g key={r.x} onPointerEnter={() => setHover(i)}>
                <rect
                  x={cx(i) - band / 2}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                {present.map((k, j) => {
                  const segH = Math.max(0, h(r[k]) - (j < present.length - 1 ? 2 : 0));
                  const y = base - h(r[k]);
                  base = y;
                  const top = j === present.length - 1;
                  return top ? (
                    <path
                      key={k}
                      d={roundedTop(cx(i) - barW / 2, y, barW, segH, 4)}
                      fill={SERIES[k]}
                    />
                  ) : (
                    <rect
                      key={k}
                      x={cx(i) - barW / 2}
                      y={y + 2}
                      width={barW}
                      height={segH}
                      fill={SERIES[k]}
                    />
                  );
                })}
              </g>
            );
          })}
          {xLabels(
            rows.map((r) => r.x.slice(5)),
            cx,
            height,
            Math.ceil(rows.length / 7),
          )}
        </svg>
      ) : null}
      {hover !== null && width ? (
        <Tooltip x={cx(hover)} y={PAD.top + plotH - h(totals[hover])} width={width}>
          <span className="block text-ink-3">{rows[hover].x}</span>
          {keys.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-[2px]"
                style={{ background: SERIES[k] }}
              />
              {k.toUpperCase()} <span className="ml-auto pl-3 font-semibold">{rows[hover][k]}</span>
            </span>
          ))}
        </Tooltip>
      ) : null}
    </div>
  );
}

// Single-hue histogram with datum lines for the routing thresholds.
export function Histogram({
  buckets,
  markers,
  height = 200,
}: {
  buckets: { bucket: string; count: number }[];
  markers: { at: number; label: string }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceCountMax(Math.max(...buckets.map((b) => b.count), 1));
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / buckets.length;
  const barW = Math.min(24, band - 2);
  const h = (v: number): number => (v / max) * plotH;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Diagnoses by confidence"
          onPointerLeave={() => setHover(null)}
        >
          <Axis width={width} height={height} max={max} format={(v) => String(Math.round(v))} />
          {buckets.map((b, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            return (
              <g key={b.bucket} onPointerEnter={() => setHover(i)}>
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                {b.count > 0 ? (
                  <path
                    d={roundedTop(x, PAD.top + plotH - h(b.count), barW, h(b.count), 4)}
                    fill={SERIES.p2}
                  />
                ) : null}
              </g>
            );
          })}
          {markers.map((m) => {
            const x = PAD.left + m.at * plotW;
            return (
              <g key={m.label} aria-hidden>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD.top - 6}
                  y2={PAD.top + plotH}
                  stroke="rgb(var(--ink))"
                  strokeWidth={1}
                />
                <text x={x + 4} y={PAD.top} fontSize={11} fill="rgb(var(--ink-2))">
                  {m.label}
                </text>
              </g>
            );
          })}
          {[0, 50, 100].map((v) => (
            <text
              key={v}
              x={PAD.left + (v / 100) * plotW}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="rgb(var(--ink-3))"
            >
              {v}%
            </text>
          ))}
        </svg>
      ) : null}
      {hover !== null && width ? (
        <Tooltip
          x={PAD.left + band * hover + band / 2}
          y={PAD.top + plotH - h(buckets[hover].count)}
          width={width}
        >
          <span className="text-ink-3">{buckets[hover].bucket}</span>{' '}
          <span className="font-semibold">{buckets[hover].count}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

// Sorted horizontal bars with the value at the tip; labels on the left.
export function HBars({
  rows,
  format,
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (v: number) => string;
}) {
  const max = niceMax(Math.max(...rows.map((r) => r.value), 1));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
          <span className="truncate text-sm text-ink" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-3.5 rounded-r-[4px]"
              style={{
                width: `${Math.max(1, (r.value / max) * 100)}%`,
                maxWidth: 'calc(100% - 5rem)',
                background: SERIES.p2,
              }}
            />
            <span className="whitespace-nowrap text-sm tabular-nums text-ink-2">
              {format(r.value)}
              {r.note ? <span className="text-ink-3"> · {r.note}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
