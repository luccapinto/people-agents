import { AlertTriangle, BarChart3, Bot, HelpCircle, ShieldCheck } from 'lucide-react';
import { BarChart } from '@/components/charts';
import { Badge, CardFrame, Figure, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime, number, percent, usd } from '@/lib/format';
import type { ConsoleOverview } from '@/transport/types';

const EVENT_LABELS: Record<string, string> = {
  'tool.denied': t('event.tool.denied'),
  'authz.denied': t('event.authz.denied'),
  'security.alert': t('event.security.alert'),
  'guardrail.output_blocked': t('event.guardrail.output_blocked'),
  'guardrail.injection': t('event.guardrail.injection'),
  'chat.sensitive': t('event.chat.sensitive'),
  'transcript.access': t('event.transcript.access'),
  'proposal.executed': t('event.proposal.executed'),
  'proposal.rejected': t('event.proposal.rejected'),
};

const SECURITY_ORDER = [
  'tool.denied',
  'authz.denied',
  'security.alert',
  'guardrail.output_blocked',
  'guardrail.injection',
  'chat.sensitive',
  'transcript.access',
];

const OUTCOME_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  pass: 'neutral',
  warn: 'warn',
  mask: 'warn',
  block: 'bad',
};

export function Overview({ data }: { data: ConsoleOverview }): JSX.Element {
  const totals = data.totals;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: t('overview.turns'), value: number(totals.turns) },
          { label: t('overview.people'), value: number(totals.people) },
          { label: t('overview.conversations'), value: number(totals.conversations) },
          { label: t('overview.tokens'), value: number(totals.tokens) },
          { label: t('overview.cost'), value: usd(totals.cost_usd) },
          {
            label: t('overview.resolution'),
            value: totals.resolution_rate === null ? '—' : percent(totals.resolution_rate * 100),
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-card border border-border bg-panel px-3 py-2.5">
            <p className="text-meta text-text-3">{tile.label}</p>
            <p className="tnum truncate text-headline font-medium text-text">{tile.value}</p>
          </div>
        ))}
      </div>

      <CardFrame icon={Bot} title={t('overview.byAgent')} agentName={t('console.window', { days: data.window_days })}>
        {data.by_agent.length ? (
          <ScrollArea>
            <table className="w-full min-w-[560px] border-collapse text-ui">
              <thead>
                <tr className="text-left text-meta text-text-3">
                  <th className="py-1 pr-4 font-medium">{t('overview.agent')}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t('overview.turns')}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t('overview.resolution')}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t('overview.cost')}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t('overview.tokens')}</th>
                  <th className="py-1 text-right font-medium">{t('overview.feedback')}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_agent.map((row) => (
                  <tr key={row.agent} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4 text-text-2">
                      {row.name}
                      <span className="block font-mono text-[11px] text-text-3">{row.agent}</span>
                    </td>
                    <td className="tnum py-1.5 pr-4 text-right">{number(row.turns)}</td>
                    <td className="tnum py-1.5 pr-4 text-right">
                      {row.turns ? percent((row.resolved / row.turns) * 100) : '—'}
                    </td>
                    <td className="tnum py-1.5 pr-4 text-right">{usd(row.cost_usd)}</td>
                    <td className="tnum py-1.5 pr-4 text-right">{number(row.tokens)}</td>
                    <td className="tnum py-1.5 text-right">
                      <span className={row.feedback < 0 ? 'text-bad' : row.feedback > 0 ? 'text-ok' : ''}>
                        {row.feedback > 0 ? `+${row.feedback}` : row.feedback}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <p className="text-meta text-text-3">{t('common.empty')}</p>
        )}
      </CardFrame>

      <CardFrame icon={BarChart3} title={t('overview.byUnit')}>
        {data.by_unit.length ? (
          <BarChart
            bars={data.by_unit.map((row) => ({
              label: row.unit,
              value: row.turns,
              tone: 'brand',
              title: `${row.unit}: ${number(row.turns)} interações, ${usd(row.cost_usd)}`,
            }))}
            format={number}
          />
        ) : (
          <p className="text-meta text-text-3">{t('common.empty')}</p>
        )}
      </CardFrame>

      <CardFrame icon={ShieldCheck} title={t('overview.security')}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SECURITY_ORDER.map((type) => (
            <Figure
              key={type}
              label={EVENT_LABELS[type] ?? type}
              value={number(data.security_events[type] ?? 0)}
              tone={(data.security_events[type] ?? 0) > 0 ? 'warn' : undefined}
            />
          ))}
        </div>
      </CardFrame>

      <CardFrame icon={AlertTriangle} title={t('overview.guardrails')}>
        {data.guardrails.length ? (
          <ScrollArea>
            <table className="w-full min-w-[320px] border-collapse text-ui">
              <thead>
                <tr className="text-left text-meta text-text-3">
                  <th className="py-1 pr-4 font-medium">{t('overview.guardrail')}</th>
                  <th className="py-1 pr-4 font-medium">{t('overview.outcome')}</th>
                  <th className="py-1 text-right font-medium">{t('overview.count')}</th>
                </tr>
              </thead>
              <tbody>
                {data.guardrails.map((row, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4 font-mono text-meta text-text-2">{row.name}</td>
                    <td className="py-1.5 pr-4">
                      <Badge tone={OUTCOME_TONE[row.outcome] ?? 'neutral'}>{row.outcome}</Badge>
                    </td>
                    <td className="tnum py-1.5 text-right">{number(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <p className="text-meta text-text-3">{t('common.empty')}</p>
        )}
      </CardFrame>

      <CardFrame
        icon={HelpCircle}
        title={t('overview.gaps')}
        agentName={t('overview.gapsHint')}
      >
        {data.unanswered.length ? (
          <ul className="space-y-1">
            {data.unanswered.map((row, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle py-1.5 last:border-0"
              >
                <span className="text-ui text-text-2">{row.question}</span>
                <span className="text-meta text-text-3">
                  {row.agent} · {dateTime(row.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-3">{t('common.empty')}</p>
        )}
      </CardFrame>
    </div>
  );
}
