import clsx from 'clsx';
import { useId } from 'react';

export interface Bar {
  label: string;
  value: number;
  /** Optional solid series drawn inside the main bar (e.g. net inside gross). */
  secondary?: number;
  tone?: 'brand' | 'soft' | 'warn' | 'ok' | 'muted';
  /** Diagonal hatching: projected months, suppressed groups. */
  hatched?: boolean;
  title?: string;
}

const FILL = {
  brand: 'var(--brand)',
  soft: 'var(--brand-soft)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  muted: 'var(--surface)',
} as const;

/**
 * Small dependency-free bar chart. Heights are computed in pixels so the bars keep their
 * proportions, while the horizontal axis stretches with the card.
 */
export function BarChart({
  bars,
  format,
  height = 140,
  secondaryLabel,
}: {
  bars: Bar[];
  format: (value: number) => string;
  height?: number;
  secondaryLabel?: string;
}): JSX.Element {
  const patternId = `hatch-${useId().replace(/:/g, '')}`;
  const max = Math.max(1, ...bars.map((b) => Math.max(b.value, b.secondary ?? 0)));
  const baseline = height - 6;
  const usable = height - 14;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--brand-soft)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--brand)" strokeWidth="1.6" opacity="0.5" />
          </pattern>
        </defs>
        <line
          x1="0"
          x2="100"
          y1={baseline}
          y2={baseline}
          stroke="var(--border)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        {bars.map((bar, i) => {
          const slot = 100 / Math.max(bars.length, 1);
          const width = slot * 0.64;
          const x = i * slot + (slot - width) / 2;
          const h = Math.max(2, (bar.value / max) * usable);
          const inner = bar.secondary === undefined ? 0 : Math.max(2, (bar.secondary / max) * usable);
          return (
            <g key={i}>
              <rect
                x={x}
                y={baseline - h}
                width={width}
                height={h}
                fill={bar.hatched ? `url(#${patternId})` : FILL[bar.tone ?? 'brand']}
                stroke="var(--brand)"
                strokeOpacity={bar.tone === 'soft' || bar.hatched ? 0.35 : 0}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              >
                {bar.title ? <title>{bar.title}</title> : null}
              </rect>
              {inner ? (
                <rect
                  x={x + width * 0.22}
                  y={baseline - inner}
                  width={width * 0.56}
                  height={inner}
                  fill="var(--brand)"
                >
                  {bar.title ? <title>{bar.title}</title> : null}
                </rect>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div
        className="mt-1 grid gap-0.5 text-center text-[10px] text-text-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}
      >
        {bars.map((bar, i) => (
          <span
            key={i}
            className="truncate"
            title={bar.title ?? `${bar.label}: ${format(bar.value)}`}
          >
            {bar.label}
          </span>
        ))}
      </div>
      {secondaryLabel ? (
        <figcaption className="mt-1 text-meta text-text-3">{secondaryLabel}</figcaption>
      ) : null}
    </figure>
  );
}

export function ProgressBar({
  value,
  tone = 'brand',
  label,
}: {
  value: number;
  tone?: 'brand' | 'ok' | 'warn' | 'bad';
  label?: string;
}): JSX.Element {
  const tones = {
    brand: 'bg-brand',
    ok: 'bg-[var(--ok)]',
    warn: 'bg-[var(--warn)]',
    bad: 'bg-[var(--bad)]',
  };
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className={clsx('h-full rounded-full', tones[tone])}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
      {label ? <p className="mt-1 text-meta text-text-3">{label}</p> : null}
    </div>
  );
}
