import clsx from 'clsx';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui';
import { t } from '@/i18n';

const STATUS_LABELS: Record<string, string> = {
  draft: t('studio.status.draft'),
  in_review: t('studio.status.in_review'),
  published: t('studio.status.published'),
  paused: t('studio.status.paused'),
  archived: t('studio.status.archived'),
  rejected: t('studio.status.rejected'),
  superseded: t('studio.status.superseded'),
};

const STATUS_TONES: Record<string, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'> = {
  draft: 'neutral',
  in_review: 'warn',
  published: 'ok',
  paused: 'warn',
  archived: 'neutral',
  rejected: 'bad',
  superseded: 'neutral',
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function RiskTag({ risk }: { risk: string }): JSX.Element {
  return (
    <Badge tone={risk === 'high' ? 'bad' : 'neutral'}>
      {risk === 'high' ? t('studio.risk.high') : t('studio.risk.low')}
    </Badge>
  );
}

/** Draft → Em revisão → Publicado, with the current step highlighted. */
export function LifecycleStepper({ status }: { status: string }): JSX.Element {
  const steps = [
    { id: 'draft', label: t('studio.step.draft') },
    { id: 'in_review', label: t('studio.step.review') },
    { id: 'published', label: t('studio.step.published') },
  ];
  const index = steps.findIndex((step) => step.id === status);
  const reached = status === 'paused' || status === 'archived' ? 2 : index;
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-1.5">
          <span
            className={clsx(
              'rounded-control px-2 py-0.5 text-meta',
              i < reached
                ? 'bg-surface text-text-3'
                : i === reached
                  ? 'bg-brand-soft text-brand'
                  : 'text-text-3',
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 ? <span className="text-text-3">›</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-meta font-medium text-text-2">{label}</span>
      {hint ? <span className="block text-meta text-text-3">{hint}</span> : null}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export const inputClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-ui text-text outline-none focus:border-brand placeholder:text-text-3';

/** Free-text chips: type and press Enter. */
export function ChipInput({
  values,
  onChange,
  placeholder,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label: string;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <div>
      {values.length ? (
        <ul className="mb-1 flex flex-wrap gap-1">
          {values.map((value) => (
            <li key={value}>
              <Badge>
                {value}
                <button
                  type="button"
                  aria-label={`${t('common.remove')} ${value}`}
                  onClick={() => onChange(values.filter((item) => item !== value))}
                  className="ml-0.5 text-text-3 hover:text-text"
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        aria-label={label}
        value={draft}
        placeholder={placeholder ?? t('editor.addChip')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const next = draft.trim();
          if (!next || values.includes(next)) return;
          onChange([...values, next]);
          setDraft('');
        }}
        className={inputClass}
      />
    </div>
  );
}
