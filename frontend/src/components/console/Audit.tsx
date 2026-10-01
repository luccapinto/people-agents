import clsx from 'clsx';
import { CheckCircle2, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Chip, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime, number } from '@/lib/format';
import { transport } from '@/transport';
import type { AuditEvent, ChainVerification } from '@/transport/types';

function toneFor(type: string): 'neutral' | 'warn' | 'bad' | 'ok' {
  if (type.endsWith('.denied') || type.includes('blocked') || type === 'security.alert') return 'bad';
  if (type.includes('injection') || type.includes('sensitive') || type === 'transcript.access') return 'warn';
  if (type.startsWith('studio.') || type.startsWith('proposal.')) return 'ok';
  return 'neutral';
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 10) : '—';
}

export function Audit(): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [types, setTypes] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [chain, setChain] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    transport
      .consoleAudit({ type: filter ?? undefined })
      .then((page) => {
        setEvents(page.events);
        setTypes(page.types);
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setLoading(false));
  }, [filter]);

  const loadMore = (): void => {
    const last = events[events.length - 1];
    if (!last) return;
    transport
      .consoleAudit({ type: filter ?? undefined, before: last.id })
      .then((page) => setEvents((current) => [...current, ...page.events]))
      .catch((failure: Error) => setError(failure.message));
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setVerifying(true);
            transport
              .consoleVerify()
              .then(setChain)
              .catch((failure: Error) => setError(failure.message))
              .finally(() => setVerifying(false));
          }}
          disabled={verifying}
        >
          <ShieldAlert size={14} strokeWidth={1.75} aria-hidden />
          {verifying ? t('audit.verifying') : t('audit.verify')}
        </Button>
        {chain ? (
          <p
            className={clsx(
              'flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-meta',
              chain.ok
                ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-ok'
                : 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-bad',
            )}
          >
            {chain.ok ? <CheckCircle2 size={14} strokeWidth={2} aria-hidden /> : null}
            {chain.ok
              ? t('audit.intact', { count: number(chain.checked) })
              : t('audit.broken', { id: chain.broken_at ?? '?', reason: chain.reason })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={filter === null} onClick={() => setFilter(null)}>
          {t('audit.all')}
        </Chip>
        {Object.entries(types)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <Chip key={type} active={filter === type} onClick={() => setFilter(type)}>
              <span className="font-mono">{type}</span> <span className="tnum text-text-3">{count}</span>
            </Chip>
          ))}
      </div>

      {error ? <p className="text-meta text-bad">{error}</p> : null}
      {loading ? <p className="text-meta text-text-3">{t('common.loading')}</p> : null}

      <ul className="space-y-1.5">
        {events.map((event) => {
          const open = expanded === event.id;
          return (
            <li key={event.id} className="overflow-hidden rounded-card border border-border bg-panel">
              <button
                type="button"
                aria-label={`${t('audit.expand')} #${event.id} ${event.type}`}
                onClick={() => setExpanded(open ? null : event.id)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface"
              >
                {open ? (
                  <ChevronDown size={14} strokeWidth={2} className="mt-1 shrink-0 text-text-3" aria-hidden />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} className="mt-1 shrink-0 text-text-3" aria-hidden />
                )}
                <span className="tnum w-12 shrink-0 font-mono text-meta text-text-3">#{event.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneFor(event.type)}>
                      <span className="font-mono">{event.type}</span>
                    </Badge>
                    <span className="text-meta text-text-3">{dateTime(event.ts)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-meta text-text-2">
                    {event.actor_name ? `${t('audit.actor')}: ${event.actor_name}` : ''}
                    {event.subject_name ? ` · ${t('audit.subject')}: ${event.subject_name}` : ''}
                  </span>
                </span>
              </button>
              {open ? (
                <div className="space-y-2 border-t border-border-subtle px-3 py-2">
                  <p className="font-mono text-[11px] text-text-3">
                    {t('audit.hash')} {short(event.hash)} · {t('audit.prevHash')} {short(event.prev_hash)}
                  </p>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-text-3">{t('audit.payload')}</p>
                    <ScrollArea>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-text-2">
                        {JSON.stringify(event.payload, null, 1)}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {events.length ? (
        <Button onClick={loadMore}>{t('audit.loadMore')}</Button>
      ) : !loading ? (
        <p className="text-meta text-text-3">{t('common.empty')}</p>
      ) : null}
    </div>
  );
}
