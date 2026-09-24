import { cx } from '../ui/cx';

interface Props {
  confidence: number;
  llmConfidence: number | null;
  auto: number;
  draft: number;
  citationsPassed: boolean;
  capped: boolean;
}

// A tolerance scale, drafted: 0–100 with ticks every 10, datum marks at the
// draft and auto thresholds, zones labelled with what each band triggers,
// the final (verified) confidence as the pointer and the model's own claim
// as a ghost mark — so a hallucinating model's gap is visible, not hidden.
export function ConfidenceGauge({
  confidence,
  llmConfidence,
  auto,
  draft,
  citationsPassed,
  capped,
}: Props) {
  const pos = (v: number): string => `${Math.max(0, Math.min(1, v)) * 100}%`;
  const zone =
    confidence > auto
      ? 'Auto-execute'
      : confidence >= draft
        ? 'Needs approval'
        : 'Escalate to a human';
  const showGhost = llmConfidence !== null && Math.abs(llmConfidence - confidence) >= 0.02;

  return (
    <figure
      className="flex flex-col gap-3"
      aria-label={`Confidence ${Math.round(confidence * 100)} percent: ${zone}`}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-ink">
            {Math.round(confidence * 100)}%
          </span>
          <span className="text-base text-ink-2">confidence · {zone}</span>
        </span>
        <span className={cx('text-sm font-medium', citationsPassed ? 'text-ok' : 'text-fault')}>
          {citationsPassed
            ? 'Citations verified'
            : capped
              ? 'Citation check failed — capped at 35%'
              : 'Citation check failed'}
        </span>
      </figcaption>

      <div className="relative pb-7 pt-5">
        {/* zones */}
        <div className="relative h-3 border rule-strong">
          <div
            className="absolute inset-y-0 left-0 bg-signal/[0.14]"
            style={{ width: pos(draft) }}
          />
          <div
            className="absolute inset-y-0 bg-ink/[0.07]"
            style={{ left: pos(draft), width: `calc(${pos(auto)} - ${pos(draft)})` }}
          />
          <div className="absolute inset-y-0 right-0 bg-ok/[0.16]" style={{ left: pos(auto) }} />
          {/* value bar, plotted in once per value */}
          <div
            key={confidence}
            className="absolute inset-y-[3px] left-0 bg-ink animate-[draw-x_600ms_cubic-bezier(0.16,1,0.3,1)_both]"
            style={{ width: pos(confidence) }}
          />
        </div>

        {/* ticks every 10 */}
        <div aria-hidden className="absolute inset-x-0 top-[calc(1.25rem+0.75rem)] h-1.5">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className="absolute top-0 h-full w-px bg-ink/40"
              style={{ left: `${i * 10}%` }}
            />
          ))}
        </div>

        {/* datum marks */}
        {[
          { v: draft, label: `Draft ${Math.round(draft * 100)}` },
          { v: auto, label: `Auto ${Math.round(auto * 100)}` },
        ].map((d) => (
          <div
            key={d.label}
            aria-hidden
            className="absolute top-2 flex -translate-x-1/2 flex-col items-center"
            style={{ left: pos(d.v) }}
          >
            <span className="h-[1.6rem] w-px bg-ink" />
            <span className="lettering mt-5 whitespace-nowrap">{d.label}</span>
          </div>
        ))}

        {/* model's own claim (ghost) */}
        {showGhost && llmConfidence !== null ? (
          <div
            aria-hidden
            className="absolute top-0 -translate-x-1/2"
            style={{ left: pos(llmConfidence) }}
            title={`Model claimed ${Math.round(llmConfidence * 100)}%`}
          >
            <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-ink-3/70" />
          </div>
        ) : null}

        {/* verified pointer */}
        <div
          aria-hidden
          className="absolute top-0 -translate-x-1/2 transition-[left] duration-500 ease-draw"
          style={{ left: pos(confidence) }}
        >
          <span className="block h-0 w-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-signal" />
        </div>
      </div>

      {showGhost && llmConfidence !== null ? (
        <p className="text-sm text-ink-3">
          The model claimed {Math.round(llmConfidence * 100)}% (hollow mark); SRE.ai adjusted it for
          evidence quality.
        </p>
      ) : null}
    </figure>
  );
}
