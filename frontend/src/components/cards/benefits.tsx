import clsx from 'clsx';
import { HeartPulse, LayoutList, Scale } from 'lucide-react';
import { Badge, CardFrame, Figure, KeyValue } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate, money } from '@/lib/format';
import type { CardProps } from './types';

interface EnrolledPlan {
  kind: string;
  plan_id: string;
  name: string;
  operator: string;
  since: string;
  accommodation?: string;
  coverage?: string;
  copay?: string;
  dependents: string[];
  monthly_cost: number;
}

interface SummaryData {
  plans: EnrolledPlan[];
  meal_card_monthly?: number;
  food_card_monthly?: number;
  flex_balance?: number;
  daycare_children?: number;
  daycare_monthly_per_child?: number;
  life_insurance_coverage?: number;
  life_insurance_multiple?: number;
  wellness?: string;
  transport_voucher?: boolean;
}

export function BenefitsSummaryCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as SummaryData;
  return (
    <CardFrame icon={HeartPulse} title="Meus benefícios" agentName={agentName}>
      <div className="space-y-2">
        {(d.plans ?? []).map((plan) => (
          <div key={plan.plan_id} className="rounded-card border border-border-subtle bg-surface/50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-ui font-medium text-text">{plan.name}</span>
              <span className="tnum text-ui text-text-2">
                {money(plan.monthly_cost)}
                <span className="text-meta text-text-3"> /mês</span>
              </span>
            </div>
            <p className="text-meta text-text-3">
              {plan.operator} · {t('benefits.since')} {fmtDate(plan.since)}
            </p>
            <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
              {plan.accommodation ? (
                <KeyValue label={t('benefits.accommodation')} value={plan.accommodation} />
              ) : null}
              {plan.coverage ? <KeyValue label={t('benefits.coverage')} value={plan.coverage} /> : null}
              {plan.copay ? <KeyValue label={t('benefits.copay')} value={plan.copay} /> : null}
              <KeyValue
                label={t('benefits.dependents')}
                value={plan.dependents.length ? plan.dependents.join(', ') : '—'}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {d.meal_card_monthly !== undefined ? (
          <KeyValue label={t('benefits.mealCard')} value={money(d.meal_card_monthly)} />
        ) : null}
        {d.food_card_monthly !== undefined ? (
          <KeyValue label={t('benefits.foodCard')} value={money(d.food_card_monthly)} />
        ) : null}
        {d.flex_balance !== undefined ? (
          <KeyValue label={t('benefits.flex')} value={money(d.flex_balance)} />
        ) : null}
        {d.life_insurance_coverage !== undefined ? (
          <KeyValue
            label={t('benefits.lifeInsurance')}
            value={`${money(d.life_insurance_coverage)} (${d.life_insurance_multiple}x)`}
          />
        ) : null}
        {d.daycare_children ? (
          <KeyValue
            label={t('benefits.daycare')}
            value={`${d.daycare_children} × ${money(d.daycare_monthly_per_child)}`}
          />
        ) : null}
        {d.wellness ? <KeyValue label={t('benefits.wellness')} value={d.wellness} /> : null}
        {d.transport_voucher !== undefined ? (
          <KeyValue label={t('benefits.transport')} value={d.transport_voucher ? 'sim' : 'não'} />
        ) : null}
      </div>
    </CardFrame>
  );
}

interface ComparisonPlan {
  plan_id: string;
  name: string;
  accommodation?: string;
  coverage?: string;
  copay?: string;
  reimbursement?: string;
  highlights?: string[];
  monthly_cost: number;
  annual_cost: number;
  difference: number;
  current: boolean;
}

export function PlanComparisonCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as { kind: string; dependents_on_plan: number; plans: ComparisonPlan[]; rules: string[] };
  return (
    <CardFrame
      icon={Scale}
      title={d.kind === 'dental' ? 'Planos odontológicos' : 'Planos de saúde'}
      agentName={agentName}
      notes={d.rules}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(d.plans ?? []).map((plan) => (
          <div
            key={plan.plan_id}
            className={clsx(
              'rounded-card border p-3',
              plan.current ? 'border-brand bg-brand-soft' : 'border-border-subtle bg-surface/50',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-ui font-medium text-text">{plan.name}</span>
              {plan.current ? <Badge tone="brand">{t('benefits.current')}</Badge> : null}
            </div>
            <p className="tnum mt-1 text-headline font-medium text-text">
              {money(plan.monthly_cost)}
            </p>
            <p
              className={clsx(
                'tnum text-meta',
                plan.difference > 0 ? 'text-warn' : plan.difference < 0 ? 'text-ok' : 'text-text-3',
              )}
            >
              {plan.current
                ? t('benefits.monthlyCost')
                : `${t('benefits.difference')}: ${plan.difference > 0 ? '+' : ''}${money(plan.difference)}`}
            </p>
            <dl className="mt-2 space-y-1 text-meta text-text-3">
              {plan.accommodation ? <div>{plan.accommodation}</div> : null}
              {plan.coverage ? <div>{plan.coverage}</div> : null}
              {plan.copay ? <div>{t('benefits.copay')}: {plan.copay}</div> : null}
              {plan.reimbursement ? <div>{t('benefits.reimbursement')}: {plan.reimbursement}</div> : null}
            </dl>
            {plan.highlights?.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-meta text-text-3">
                {plan.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-meta text-text-3">
        {t('benefits.dependents')}: {d.dependents_on_plan}
      </p>
    </CardFrame>
  );
}

export function KvCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as { title?: string; items: { label: string; value: string }[] };
  return (
    <CardFrame icon={LayoutList} title={d.title ?? t('generic.data')} agentName={agentName}>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {(d.items ?? []).map((item, i) => (
          <KeyValue key={i} label={item.label} value={item.value} />
        ))}
      </div>
    </CardFrame>
  );
}

export function SectionsCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    title?: string;
    sections: { title: string; items: { label: string; value: string }[] }[];
  };
  return (
    <CardFrame icon={LayoutList} title={d.title ?? t('generic.data')} agentName={agentName}>
      <div className="grid gap-4 sm:grid-cols-2">
        {(d.sections ?? []).map((section, i) => (
          <div key={i}>
            <p className="text-meta font-medium uppercase tracking-wide text-text-3">
              {section.title}
            </p>
            <div className="mt-1">
              {section.items.map((item, j) => (
                <KeyValue key={j} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}

export function LifeEventCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    event: string;
    title: string;
    date: string;
    steps: { agent: string; summaries: string[] }[];
  };
  return (
    <CardFrame icon={HeartPulse} title={d.title} agentName={agentName}>
      <Figure label="Data do evento" value={fmtDate(d.date)} tone="brand" />
      <div>
        <p className="text-meta font-medium uppercase tracking-wide text-text-3">
          {t('lifeEvent.steps')}
        </p>
        <ol className="mt-2 space-y-2">
          {(d.steps ?? []).map((step, i) => (
            <li key={i} className="border-l-2 border-brand-soft pl-3">
              <p className="text-ui font-medium text-text">{step.agent}</p>
              <ul className="mt-0.5 space-y-0.5 text-meta text-text-2">
                {step.summaries.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </CardFrame>
  );
}
