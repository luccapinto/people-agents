import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n';

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'bad';
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const tones = {
    neutral: 'bg-surface text-text-3 border-border',
    brand: 'bg-brand-soft text-brand border-transparent',
    ok: 'bg-transparent text-ok border-current/30',
    warn: 'bg-transparent text-warn border-current/30',
    bad: 'bg-transparent text-bad border-current/30',
  } as const;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-control border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: string }): JSX.Element {
  const tone = risk === 'sensitive' ? 'bad' : risk === 'write' ? 'warn' : 'neutral';
  const label =
    risk === 'sensitive' ? t('risk.sensitive') : risk === 'write' ? t('risk.write') : t('risk.read');
  return <Badge tone={tone}>{label}</Badge>;
}

export function Chip({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx(
        'rounded-control border px-2.5 py-1.5 text-left text-meta transition-colors',
        active
          ? 'border-transparent bg-brand-soft text-brand'
          : 'border-border bg-panel text-text-2 hover:border-brand hover:text-brand',
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  className,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-control border border-transparent text-text-3 transition-colors',
        'hover:bg-surface hover:text-text disabled:opacity-40',
        active && 'border-border bg-surface text-text',
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}): JSX.Element {
  const variants = {
    primary: 'bg-brand text-white border-transparent hover:opacity-90',
    secondary: 'bg-panel text-text border-border hover:border-brand hover:text-brand',
    quiet: 'bg-transparent text-text-3 border-transparent hover:text-text',
    danger: 'bg-transparent text-bad border-border hover:border-bad',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-control border px-3 py-1.5 text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CardFrame({
  icon: Icon,
  title,
  agentName,
  children,
  notes,
  action,
}: {
  icon: LucideIcon;
  title: string;
  agentName?: string;
  children: ReactNode;
  notes?: string[];
  action?: ReactNode;
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-panel">
      <header className="flex items-start gap-2 border-b border-border-subtle px-4 py-3">
        <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-ui font-medium text-text">{title}</h3>
          {agentName ? <p className="truncate text-meta text-text-3">{agentName}</p> : null}
        </div>
        {action}
      </header>
      <div className="space-y-3 px-4 py-3 text-ui text-text-2">{children}</div>
      {notes && notes.length > 0 ? (
        <footer className="border-t border-border-subtle bg-surface/60 px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
            {t('card.notes')}
          </p>
          <ul className="mt-1 space-y-1 text-meta text-text-3">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </footer>
      ) : null}
    </section>
  );
}

export function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'ok' | 'warn' | 'bad';
  hint?: string;
}): JSX.Element {
  const tones = { brand: 'text-brand', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };
  return (
    <div className="min-w-0">
      <p className="text-meta text-text-3">{label}</p>
      <p className={clsx('tnum text-figure font-medium', tone ? tones[tone] : 'text-text')}>
        {value}
      </p>
      {hint ? <p className="text-meta text-text-3">{hint}</p> : null}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5 last:border-0">
      <span className="shrink-0 text-meta text-text-3">{label}</span>
      <span className="tnum min-w-0 break-words text-right text-ui text-text">{value}</span>
    </div>
  );
}

/** Tables always scroll inside their own card so nothing overflows the layout. */
export function ScrollArea({ children }: { children: ReactNode }): JSX.Element {
  return <div className="scroll-thin -mx-1 overflow-x-auto px-1">{children}</div>;
}
