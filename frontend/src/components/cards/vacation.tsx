import clsx from 'clsx';
import { CalendarDays, CalendarRange, Palmtree, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Badge, CardFrame, Figure, KeyValue, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate, dayMonth, isoDay, monthName, toDate } from '@/lib/format';
import type { CardProps } from './types';

interface Period {
  id: string;
  status: string;
  label: string;
  acquisition_start: string;
  acquisition_end: string;
  concession_end: string;
  entitled_days: number;
  taken_days: number;
  scheduled_days: number;
  pending_days: number;
  sold_days: number;
  balance_days: number;
  days_to_deadline: number;
  risk: 'ok' | 'attention' | 'critical' | string;
}

interface BalanceData {
  available_days: number;
  periods: Period[];
  accruing_days: number;
  next_deadline: string | null;
}

const RISK_TONE = { ok: 'ok', attention: 'warn', critical: 'bad' } as const;

export function VacationBalanceCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as BalanceData;
  const periods = d.periods ?? [];
  const worst = periods.reduce<Period | null>(
    (acc, p) => (p.risk === 'critical' ? p : acc?.risk === 'critical' ? acc : p.risk === 'attention' ? p : acc),
    null,
  );
  return (
    <CardFrame icon={Palmtree} title={t('vacation.available')} agentName={agentName}>
      <div className="flex flex-wrap items-end gap-6">
        <Figure
          label={t('vacation.available')}
          value={String(d.available_days ?? 0)}
          tone={worst && worst.risk !== 'ok' ? RISK_TONE[worst.risk as 'attention'] : 'brand'}
        />
        {d.accruing_days ? (
          <Figure
            label={t('vacation.accruingDays')}
            value={String(d.accruing_days)}
          />
        ) : null}
        {d.next_deadline ? (
          <Figure label={t('vacation.deadline')} value={fmtDate(d.next_deadline)} />
        ) : null}
      </div>
      <div className="space-y-2">
        {periods.map((p) => (
          <div key={p.id} className="rounded-card border border-border-subtle bg-surface/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ui font-medium text-text">{p.label}</span>
              <div className="flex items-center gap-2">
                <Badge>{p.status === 'accruing' ? t('vacation.accruing') : t('vacation.open')}</Badge>
                {p.status === 'open' ? (
                  <Badge tone={RISK_TONE[p.risk as 'ok'] ?? 'neutral'}>
                    {p.days_to_deadline >= 0
                      ? t('vacation.daysLeft', { days: p.days_to_deadline })
                      : t('vacation.overdue')}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <KeyValue label={t('vacation.balance')} value={p.balance_days} />
              <KeyValue label={t('vacation.entitled')} value={p.entitled_days} />
              <KeyValue label={t('vacation.taken')} value={p.taken_days} />
              <KeyValue label={t('vacation.scheduled')} value={p.scheduled_days} />
              <KeyValue label={t('vacation.pending')} value={p.pending_days} />
              <KeyValue label={t('vacation.sold')} value={p.sold_days} />
            </div>
            <p className="mt-2 text-meta text-text-3">
              {t('vacation.deadline')}: {fmtDate(p.concession_end)}
            </p>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}

interface HolidayItem {
  date: string;
  name: string;
  scope: string;
  weekday?: number;
}

export function HolidayCalendarCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as { year: number; location: string; holidays: HolidayItem[] };
  const items = d.holidays ?? [];
  const byMonth = new Map<number, HolidayItem[]>();
  for (const h of items) {
    const parsed = toDate(h.date);
    if (!parsed) continue;
    const list = byMonth.get(parsed.getMonth()) ?? [];
    list.push(h);
    byMonth.set(parsed.getMonth(), list);
  }
  return (
    <CardFrame
      icon={CalendarDays}
      title={t('holiday.count', { count: items.length, year: d.year })}
      agentName={agentName}
      notes={d.location ? [d.location] : undefined}
    >
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {[...byMonth.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([month, list]) => (
            <div key={month}>
              <p className="text-meta font-medium uppercase tracking-wide text-text-3">
                {monthName(month)}
              </p>
              <ul className="mt-1 space-y-1">
                {list.map((h) => {
                  const weekday = toDate(h.date)?.getDay() ?? 0;
                  const isWeekday = weekday >= 1 && weekday <= 5;
                  return (
                    <li key={h.date + h.name} className="flex items-baseline gap-2">
                      <span className="tnum w-12 shrink-0 text-meta text-text-3">
                        {dayMonth(h.date)}
                      </span>
                      <span className="flex-1 text-ui text-text-2">{h.name}</span>
                      {isWeekday ? <Badge tone="warn">{t('holiday.weekday')}</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
      </div>
    </CardFrame>
  );
}

interface WindowItem {
  start: string;
  end: string;
  days: number;
  rest_start: string;
  rest_end: string;
  rest_days: number;
  bonus_days: number;
  efficiency: number;
  holidays_bridged: string[];
  holidays_inside: string[];
}

interface CalendarData {
  period: string;
  balance_days: number;
  deadline: string;
  earliest_start: string;
  latest_end: string;
  windows: WindowItem[];
  plans: { fractions: WindowItem[]; used_days: number; rest_days: number; bonus_days: number }[];
  holidays: HolidayItem[];
}

const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function monthsBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    out.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export function VacationCalendarCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as CalendarData;
  const windows = d.windows ?? [];
  const [selected, setSelected] = useState(0);
  const active = windows[selected];
  const holidays = new Map((d.holidays ?? []).map((h) => [h.date, h.name]));

  const vacationDays = new Set<string>();
  const bonusDays = new Set<string>();
  if (active) {
    const start = toDate(active.start);
    const end = toDate(active.end);
    const restStart = toDate(active.rest_start);
    const restEnd = toDate(active.rest_end);
    if (restStart && restEnd) {
      for (const day = new Date(restStart); day <= restEnd; day.setDate(day.getDate() + 1)) {
        bonusDays.add(isoDay(day));
      }
    }
    if (start && end) {
      for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        vacationDays.add(isoDay(day));
      }
    }
  }

  const first = toDate(d.earliest_start);
  const last = toDate(d.latest_end);
  const months = first && last ? monthsBetween(first, last) : [];

  return (
    <CardFrame
      icon={CalendarRange}
      title={t('vacation.windows')}
      agentName={agentName}
      notes={[
        `${t('vacation.period')}: ${d.period} · ${t('vacation.balance')}: ${d.balance_days} · ${t(
          'vacation.deadline',
        )}: ${fmtDate(d.deadline)}`,
      ]}
    >
      <ul className="space-y-1.5">
        {windows.map((w, i) => (
          <li key={w.start + w.days}>
            <button
              type="button"
              onClick={() => setSelected(i)}
              className={clsx(
                'w-full rounded-card border px-3 py-2 text-left transition-colors',
                i === selected
                  ? 'border-brand bg-brand-soft'
                  : 'border-border-subtle bg-surface/50 hover:border-brand',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="tnum text-ui font-medium text-text">
                  {dayMonth(w.start)} – {dayMonth(w.end)}
                </span>
                <span className="tnum text-meta text-text-2">
                  {t('vacation.windowLine', { days: w.days, rest: w.rest_days })}
                </span>
              </div>
              {w.holidays_bridged.length || w.holidays_inside.length ? (
                <p className="mt-0.5 text-meta text-text-3">
                  {t('vacation.bridged')}: {[...w.holidays_bridged, ...w.holidays_inside].join(', ')}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <ScrollArea>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((month) => (
            <MonthGrid
              key={`${month.getFullYear()}-${month.getMonth()}`}
              month={month}
              holidays={holidays}
              vacationDays={vacationDays}
              bonusDays={bonusDays}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-wrap gap-3 text-meta text-text-3">
        <Legend className="bg-surface" label={t('vacation.legend.weekend')} />
        <Legend className="bg-[var(--warn)]/25 text-warn" label={t('vacation.legend.holiday')} />
        <Legend className="bg-brand" label={t('vacation.legend.vacation')} />
        <Legend className="bg-brand-soft" label={t('vacation.legend.bonus')} />
      </div>

      {d.plans?.length ? (
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-text-3">
            {t('vacation.plans')}
          </p>
          <ul className="mt-1 space-y-1">
            {d.plans.map((plan, i) => (
              <li key={i} className="rounded-card border border-border-subtle bg-surface/50 px-3 py-2">
                <p className="tnum text-ui text-text">
                  {plan.fractions.map((f) => `${dayMonth(f.start)}–${dayMonth(f.end)}`).join(' + ')}
                </p>
                <p className="text-meta text-text-3">
                  {t('vacation.planLine', { used: plan.used_days, rest: plan.rest_days })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CardFrame>
  );
}

function Legend({ className, label }: { className: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('h-3 w-3 rounded-[3px] border border-border', className)} />
      {label}
    </span>
  );
}

function MonthGrid({
  month,
  holidays,
  vacationDays,
  bonusDays,
}: {
  month: Date;
  holidays: Map<string, string>;
  vacationDays: Set<string>;
  bonusDays: Set<string>;
}): JSX.Element {
  const year = month.getFullYear();
  const index = month.getMonth();
  const firstWeekday = new Date(year, index, 1).getDay();
  const days = new Date(year, index + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(new Date(year, index, day));

  return (
    <div className="min-w-[164px]">
      <p className="mb-1 text-meta font-medium capitalize text-text-2">
        {monthName(index)} {year}
      </p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-text-3">
        {WEEKDAY_INITIALS.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`empty-${i}`} />;
          const iso = isoDay(day);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const holiday = holidays.get(iso);
          const isVacation = vacationDays.has(iso);
          const isBonus = !isVacation && bonusDays.has(iso);
          return (
            <span
              key={iso}
              title={holiday ?? undefined}
              className={clsx(
                'tnum rounded-[3px] py-0.5 leading-4',
                isVacation
                  ? 'bg-brand font-medium text-white'
                  : isBonus
                    ? 'bg-brand-soft text-brand'
                    : holiday
                      ? 'bg-[var(--warn)]/20 text-warn'
                      : weekend
                        ? 'bg-surface text-text-3'
                        : 'text-text-2',
              )}
            >
              {day.getDate()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function LeaveCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as { kind: string; start: string; end: string; days: number };
  return (
    <CardFrame icon={UserMinus} title={d.kind.charAt(0).toUpperCase() + d.kind.slice(1)} agentName={agentName}>
      <div className="flex flex-wrap gap-6">
        <Figure label="Dias" value={String(d.days)} tone="brand" />
        <Figure label="Início" value={fmtDate(d.start)} />
        <Figure label="Fim" value={fmtDate(d.end)} />
      </div>
    </CardFrame>
  );
}
