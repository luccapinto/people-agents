import clsx from 'clsx';
import {
  BarChart3,
  CheckSquare,
  ClipboardCheck,
  GraduationCap,
  Target,
  Users,
} from 'lucide-react';
import { BarChart, ProgressBar } from '@/components/charts';
import { Badge, Button, CardFrame, Chip, Figure, KeyValue, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate, firstName, hours, number, percent } from '@/lib/format';
import { useChatActions } from '@/state/actions';
import type { CardProps } from './types';

interface CareerData {
  pending_trainings: { id: string; title: string; hours: number; due_date: string | null; days_left: number | null }[];
  completed_trainings: string[];
  cycle: { name: string | null; phases: { label: string; start: string; end: string; state: string }[] };
  learning_paths: { title: string; description: string; audience: string; steps: string[] }[];
}

export function CareerCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as CareerData;
  return (
    <CardFrame icon={GraduationCap} title="Carreira e desenvolvimento" agentName={agentName}>
      <div>
        <p className="text-meta font-medium uppercase tracking-wide text-text-3">
          {t('career.pending')}
        </p>
        {d.pending_trainings?.length ? (
          <ul className="mt-1 space-y-1">
            {d.pending_trainings.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle py-1.5 last:border-0"
              >
                <span className="text-ui text-text-2">
                  {item.title}
                  <span className="text-meta text-text-3"> · {hours(item.hours)}</span>
                </span>
                {item.due_date ? (
                  <Badge tone={(item.days_left ?? 99) < 15 ? 'bad' : 'warn'}>
                    {t('career.due', { date: fmtDate(item.due_date) })}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-3">{t('card.noItems')}</p>
        )}
      </div>

      {d.cycle?.phases?.length ? (
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-text-3">
            {d.cycle.name ?? t('career.cycle')}
          </p>
          <ol className="mt-2 space-y-2">
            {d.cycle.phases.map((phase, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={clsx(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    phase.state === 'concluída'
                      ? 'bg-[var(--ok)]'
                      : phase.state === 'em andamento'
                        ? 'bg-brand'
                        : 'bg-[var(--border)]',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-ui text-text">{phase.label}</p>
                  <p className="tnum text-meta text-text-3">
                    {fmtDate(phase.start)} – {fmtDate(phase.end)} · {phase.state}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {d.learning_paths?.length ? (
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-text-3">
            {t('career.paths')}
          </p>
          <ul className="mt-1 space-y-2">
            {d.learning_paths.map((path, i) => (
              <li key={i} className="rounded-card border border-border-subtle bg-surface/50 p-3">
                <p className="text-ui font-medium text-text">{path.title}</p>
                <p className="text-meta text-text-3">{path.description}</p>
                <p className="mt-1 text-meta text-text-2">{path.steps.join(' → ')}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CardFrame>
  );
}

interface JobsData {
  jobs: {
    id: string;
    title: string;
    unit: string;
    level: string;
    skills: string[];
    matched: string[];
    missing: string[];
    score: number;
    closes_at: string;
  }[];
  skills: string[];
  eligible: boolean;
  months_in_role: number;
  min_months: number;
  rule?: string;
}

export function JobsCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as JobsData;
  return (
    <CardFrame
      icon={Target}
      title="Vagas internas compatíveis"
      agentName={agentName}
      notes={d.rule ? [d.rule] : undefined}
    >
      {d.jobs?.length ? (
        <ul className="space-y-2">
          {d.jobs.map((job) => (
            <li key={job.id} className="rounded-card border border-border-subtle bg-surface/50 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ui font-medium text-text">{job.title}</span>
                <span className="tnum text-meta text-text-3">
                  {job.unit} · {job.level}
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar
                  value={job.score}
                  label={`${t('jobs.match')}: ${percent(job.score * 100)}`}
                />
              </div>
              <p className="mt-2 text-meta text-text-2">
                {t('jobs.matched')}: {job.matched.join(', ') || '—'}
              </p>
              {job.missing.length ? (
                <p className="text-meta text-text-3">
                  {t('jobs.missing')}: {job.missing.join(', ')}
                </p>
              ) : null}
              <p className="mt-1 text-meta text-text-3">
                {t('jobs.closes', { date: fmtDate(job.closes_at) })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-text-3">{t('jobs.none')}</p>
      )}
      <p className="text-meta text-text-3">
        {d.eligible
          ? t('jobs.eligible', { months: d.months_in_role })
          : t('jobs.notEligible', { min: d.min_months, months: d.months_in_role })}
      </p>
    </CardFrame>
  );
}

interface ChecklistData {
  items: {
    id: string;
    title: string;
    category: string;
    due_date: string;
    status: string;
    owner: string;
    overdue: boolean;
  }[];
  done: number;
  total: number;
  progress: number;
  buddy: { name: string; title: string; email: string } | null;
  start_date: string;
}

export function ChecklistCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as ChecklistData;
  return (
    <CardFrame icon={CheckSquare} title="Checklist de onboarding" agentName={agentName}>
      <ProgressBar
        value={d.progress ?? 0}
        label={t('checklist.progress', { done: d.done, total: d.total })}
      />
      <ul className="space-y-1">
        {(d.items ?? []).map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle py-1.5 last:border-0"
          >
            <span
              className={clsx(
                'text-ui',
                item.status === 'concluído' ? 'text-text-3 line-through' : 'text-text-2',
              )}
            >
              {item.title}
              <span className="text-meta text-text-3"> · {item.owner}</span>
            </span>
            <Badge tone={item.overdue ? 'bad' : item.status === 'concluído' ? 'ok' : 'neutral'}>
              {item.overdue
                ? t('checklist.overdue')
                : item.status === 'concluído'
                  ? item.status
                  : t('checklist.due', { date: fmtDate(item.due_date) })}
            </Badge>
          </li>
        ))}
      </ul>
      {d.buddy ? (
        <KeyValue
          label={t('checklist.buddy')}
          value={`${d.buddy.name} — ${d.buddy.title}`}
        />
      ) : null}
    </CardFrame>
  );
}

interface TeamMember {
  id: string;
  name: string;
  title: string;
  hire_date: string;
  tenure_months: number;
  new_member: boolean;
  work_anniversary: string | null;
  anniversary_years: number;
  vacation_balance: number;
  vacation_deadline: string | null;
  vacation_risk: string;
  days_to_deadline: number | null;
  days_since_vacation: number | null;
  pending_requests: number;
  bank_hours: number;
  overtime_last_month: number;
  mandatory_pending: number;
}

const RISK_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  ok: 'ok',
  attention: 'warn',
  critical: 'bad',
};

export function TeamTableCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    members: TeamMember[];
    highlights: {
      expiring: string[];
      long_without_vacation: string[];
      high_hours: string[];
      pending_approvals: number;
      anniversaries: string[];
      new_members: string[];
    };
    privacy_note: string;
  };
  const { send } = useChatActions();
  const members = d.members ?? [];
  return (
    <CardFrame
      icon={Users}
      title="Meu time"
      agentName={agentName}
      notes={d.privacy_note ? [d.privacy_note] : undefined}
    >
      {d.highlights?.pending_approvals ? (
        <Badge tone="warn">
          {d.highlights.pending_approvals === 1
            ? t('team.pendingApproval')
            : t('team.pendingApprovals', { count: d.highlights.pending_approvals })}
        </Badge>
      ) : null}
      <ScrollArea>
        <table className="w-full min-w-[520px] border-collapse text-ui">
          <thead>
            <tr className="text-left text-meta text-text-3">
              <th className="py-1 pr-4 font-medium">{t('team.member')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('team.vacationBalance')}</th>
              <th className="py-1 pr-4 font-medium">{t('team.deadline')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('team.sinceVacation')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('team.bankHours')}</th>
              <th className="py-1 text-right font-medium">{t('team.overtime')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-border-subtle align-top">
                <td className="py-1.5 pr-4">
                  <span className="text-text">{m.name}</span>
                  <span className="block text-meta text-text-3">{m.title}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {m.new_member ? <Badge tone="brand">{t('team.new')}</Badge> : null}
                    {m.work_anniversary ? (
                      <Badge tone="warn">
                        {t('team.anniversary')} · {fmtDate(m.work_anniversary)}
                      </Badge>
                    ) : null}
                  </span>
                </td>
                <td className="tnum py-1.5 pr-4 text-right">
                  <span className={clsx(m.vacation_risk !== 'ok' && 'text-warn')}>
                    {m.vacation_balance}
                  </span>
                </td>
                <td className="tnum py-1.5 pr-4">
                  {m.vacation_deadline ? (
                    <Badge tone={RISK_TONE[m.vacation_risk] ?? 'neutral'}>
                      {fmtDate(m.vacation_deadline)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="tnum py-1.5 pr-4 text-right">
                  {m.days_since_vacation === null ? '—' : t('team.days', { days: m.days_since_vacation })}
                </td>
                <td className="tnum py-1.5 pr-4 text-right">{hours(m.bank_hours)}</td>
                <td className="tnum py-1.5 text-right">{hours(m.overtime_last_month)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      <div className="flex flex-wrap gap-1.5">
        {members.slice(0, 6).map((m) => (
          <Chip key={m.id} onClick={() => send(t('team.quickAsk', { name: firstName(m.name) }))}>
            {t('team.quickAsk', { name: firstName(m.name) })}
          </Chip>
        ))}
      </div>
    </CardFrame>
  );
}

export function ApprovalsCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    items: {
      request_id: string;
      employee: string;
      employee_id: string;
      start: string;
      end: string;
      days: number;
      sell_days: number;
      requested_at: string;
    }[];
  };
  const { send } = useChatActions();
  const items = d.items ?? [];
  return (
    <CardFrame icon={ClipboardCheck} title={t('approvals.pending')} agentName={agentName}>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.request_id}
              className="rounded-card border border-border-subtle bg-surface/50 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ui font-medium text-text">{item.employee}</span>
                <span className="font-mono text-meta text-text-3">{item.request_id}</span>
              </div>
              <p className="tnum mt-0.5 text-meta text-text-2">
                {t('approvals.period')}: {fmtDate(item.start)} – {fmtDate(item.end)} ·{' '}
                {t('approvals.days')}: {item.days}
                {item.sell_days ? ` (+${item.sell_days} vendidos)` : ''}
              </p>
              <p className="text-meta text-text-3">
                {t('approvals.requestedAt')} {fmtDate(item.requested_at)}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => send(t('approvals.approveMessage', { id: item.request_id }))}
                >
                  {t('card.approve')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => send(t('approvals.rejectMessage', { id: item.request_id }))}
                >
                  {t('card.reject')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-text-3">{t('approvals.none')}</p>
      )}
    </CardFrame>
  );
}

interface AnalyticsData {
  metric: string;
  label: string;
  definition: string;
  group_by: string;
  unit: string;
  k: number;
  groups: { group: string; value: number | null; n: number | null; suppressed: boolean }[];
  suppressed_count: number;
  unit_suffix: string;
}

export function AnalyticsCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as AnalyticsData;
  const groups = d.groups ?? [];
  const maxValue = Math.max(1, ...groups.map((g) => g.value ?? 0));
  const format = (value: number): string => `${number(value, 0)}${d.unit_suffix ?? ''}`;
  return (
    <CardFrame
      icon={BarChart3}
      title={`${d.label} — ${d.unit}`}
      agentName={agentName}
      notes={[d.definition, t('card.kAnonymity', { k: d.k })]}
    >
      <BarChart
        bars={groups.map((g) => ({
          label: g.group,
          value: g.suppressed ? maxValue * 0.25 : (g.value ?? 0),
          tone: g.suppressed ? 'soft' : 'brand',
          hatched: g.suppressed,
          title: g.suppressed
            ? `${g.group}: ${t('card.suppressed')} (< ${d.k})`
            : `${g.group}: ${format(g.value ?? 0)} (${g.n} ${t('analytics.people')})`,
        }))}
        format={format}
      />
      <ScrollArea>
        <table className="w-full min-w-[320px] border-collapse text-ui">
          <thead>
            <tr className="text-left text-meta text-text-3">
              <th className="py-1 pr-4 font-medium">{t('analytics.group')}</th>
              <th className="py-1 pr-4 text-right font-medium">{t('analytics.value')}</th>
              <th className="py-1 text-right font-medium">{t('analytics.people')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group} className="border-t border-border-subtle">
                <td className="py-1.5 pr-4 text-text-2">{g.group}</td>
                <td className="tnum py-1.5 pr-4 text-right">
                  {g.suppressed ? (
                    <span className="hatched rounded px-2 py-0.5 text-text-3">{`< ${d.k}`}</span>
                  ) : (
                    format(g.value ?? 0)
                  )}
                </td>
                <td className="tnum py-1.5 text-right text-text-3">
                  {g.suppressed ? `< ${d.k}` : g.n}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      {d.suppressed_count ? (
        <Figure label={t('card.suppressed')} value={String(d.suppressed_count)} tone="warn" />
      ) : null}
    </CardFrame>
  );
}
