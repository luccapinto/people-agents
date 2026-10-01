import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CardFrame, Figure } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime, number, percent, usd } from '@/lib/format';
import { transport } from '@/transport';
import type { StudioMetrics } from '@/transport/types';

export function Metrics({ agentId }: { agentId: string }): JSX.Element {
  const [metrics, setMetrics] = useState<StudioMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    transport
      .studioMetrics(agentId)
      .then(setMetrics)
      .catch((failure: Error) => setError(failure.message));
  }, [agentId]);

  if (error) return <p className="text-meta text-bad">{error}</p>;
  if (!metrics) return <p className="text-meta text-text-3">{t('common.loading')}</p>;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <CardFrame icon={Activity} title={t('studio.tab.metrics')} agentName={t('metrics.window')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label={t('metrics.turns')} value={number(metrics.turns)} />
          <Figure label={t('metrics.people')} value={number(metrics.people)} />
          <Figure
            label={t('metrics.resolution')}
            value={metrics.resolution_rate === null ? '—' : percent(metrics.resolution_rate * 100)}
            hint={metrics.turns ? t('metrics.resolved', { resolved: number(metrics.resolved), turns: number(metrics.turns) }) : undefined}
          />
          <Figure
            label={t('metrics.helpful')}
            value={number(metrics.feedback_positive)}
            tone={metrics.feedback_positive ? 'ok' : undefined}
          />
          <Figure
            label={t('metrics.unhelpful')}
            value={number(metrics.feedback_negative)}
            tone={metrics.feedback_negative ? 'bad' : undefined}
          />
          <Figure label={t('metrics.cost')} value={usd(metrics.cost_usd)} />
        </div>
      </CardFrame>

      {metrics.unanswered.length ? (
        <CardFrame icon={Activity} title={t('metrics.unanswered')}>
          <ul className="space-y-1">
            {metrics.unanswered.map((row, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle py-1.5 last:border-0"
              >
                <span className="text-ui text-text-2">{row.question}</span>
                <span className="text-meta text-text-3">{dateTime(row.at)}</span>
              </li>
            ))}
          </ul>
        </CardFrame>
      ) : null}
    </div>
  );
}
