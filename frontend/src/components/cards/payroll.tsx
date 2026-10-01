import clsx from 'clsx';
import { Calculator, Download, FileText, PiggyBank, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { BarChart } from '@/components/charts';
import { Badge, Button, CardFrame, Figure, KeyValue, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate, money, monthLabel } from '@/lib/format';
import { transport } from '@/transport';
import type { CardProps } from './types';

interface BreakdownData {
  title?: string;
  salary?: number;
  lines: { label: string; value: number; kind: 'earning' | 'deduction' | string }[];
  gross: number;
  deductions: number;
  net: number;
  notes?: string[];
}

export function BreakdownCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as BreakdownData;
  return (
    <CardFrame
      icon={Calculator}
      title={d.title ?? t('breakdown.net')}
      agentName={agentName}
      notes={d.notes}
    >
      <div className="space-y-1">
        {(d.lines ?? []).map((line, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-1.5 last:border-0"
          >
            <span className="flex items-center gap-2 text-ui text-text-2">
              <span
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  line.kind === 'deduction' ? 'bg-[var(--bad)]' : 'bg-[var(--ok)]',
                )}
                aria-hidden
              />
              {line.label}
            </span>
            <span
              className={clsx('tnum text-ui', line.kind === 'deduction' ? 'text-bad' : 'text-text')}
            >
              {line.kind === 'deduction' ? '-' : ''}
              {money(line.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-6 border-t border-border pt-3">
        <Figure label={t('breakdown.gross')} value={money(d.gross)} />
        <Figure label={t('breakdown.deductions')} value={money(d.deductions)} tone="bad" />
        <Figure label={t('breakdown.net')} value={money(d.net)} tone="brand" />
      </div>
    </CardFrame>
  );
}

interface PayslipData {
  id: string;
  month: string;
  month_label: string;
  kind: string;
  lines: { code: string; label: string; earning?: number; deduction?: number }[];
  gross: number;
  deductions: number;
  net: number;
  inss_base: number;
  irrf_base: number;
  fgts: number;
  paid_on: string;
  pdf_url: string;
}

export function PayslipCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as PayslipData;
  return (
    <CardFrame
      icon={FileText}
      title={`Holerite — ${d.month_label ?? monthLabel(d.month)}`}
      agentName={agentName}
      action={<DownloadPdfButton url={d.pdf_url} filename={`holerite-${d.month}.pdf`} />}
    >
      <ScrollArea>
        <table className="w-full min-w-[420px] border-collapse text-ui">
          <thead>
            <tr className="text-left text-meta text-text-3">
              <th className="py-1 pr-3 font-medium">{t('payslip.code')}</th>
              <th className="py-1 pr-3 font-medium">{t('payslip.description')}</th>
              <th className="py-1 pr-3 text-right font-medium">{t('payslip.gross')}</th>
              <th className="py-1 text-right font-medium">{t('payslip.deductions')}</th>
            </tr>
          </thead>
          <tbody>
            {(d.lines ?? []).map((line, i) => (
              <tr key={i} className="border-t border-border-subtle">
                <td className="py-1.5 pr-3 font-mono text-meta text-text-3">{line.code}</td>
                <td className="py-1.5 pr-3 text-text-2">{line.label}</td>
                <td className="tnum py-1.5 pr-3 text-right">
                  {line.earning ? money(line.earning) : ''}
                </td>
                <td className="tnum py-1.5 text-right text-bad">
                  {line.deduction ? money(line.deduction) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      <div className="flex flex-wrap gap-6 border-t border-border pt-3">
        <Figure label={t('payslip.gross')} value={money(d.gross)} />
        <Figure label={t('payslip.deductions')} value={money(d.deductions)} tone="bad" />
        <Figure label={t('payslip.net')} value={money(d.net)} tone="brand" />
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyValue label={t('payslip.inssBase')} value={money(d.inss_base)} />
        <KeyValue label={t('payslip.irrfBase')} value={money(d.irrf_base)} />
        <KeyValue label={t('payslip.fgts')} value={money(d.fgts)} />
        <KeyValue label={t('payslip.paidOn')} value={fmtDate(d.paid_on)} />
      </div>
    </CardFrame>
  );
}

export function DownloadPdfButton({
  url,
  filename,
}: {
  url: string;
  filename: string;
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  return (
    <Button
      onClick={() => {
        setState('busy');
        transport
          .download(url, filename)
          .then(() => setState('idle'))
          .catch(() => setState('error'));
      }}
      disabled={state === 'busy'}
    >
      <Download size={14} strokeWidth={1.75} aria-hidden />
      {state === 'busy'
        ? t('card.downloading')
        : state === 'error'
          ? t('card.downloadFailed')
          : t('card.downloadPdf')}
    </Button>
  );
}

interface ProjectionData {
  year: number;
  salary: number;
  months: { month: string; label: string; gross: number; net: number; kind: 'actual' | 'projected' | string }[];
  items: Record<string, number>;
  thirteenth: { gross: number; first: number; second_net: number; inss: number; irrf: number };
  total_gross: number;
  total_net: number;
  notes?: string[];
}

const ITEM_KEYS = [
  'salaries',
  'overtime',
  'vacation',
  'vacation_third',
  'thirteenth',
  'plr',
] as const;

const ITEM_LABELS: Record<string, string> = {
  salaries: t('projection.item.salaries'),
  overtime: t('projection.item.overtime'),
  vacation: t('projection.item.vacation'),
  vacation_third: t('projection.item.vacation_third'),
  thirteenth: t('projection.item.thirteenth'),
  plr: t('projection.item.plr'),
};

export function AnnualProjectionCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as ProjectionData;
  const months = d.months ?? [];
  return (
    <CardFrame
      icon={TrendingUp}
      title={`Projeção anual ${d.year}`}
      agentName={agentName}
      notes={d.notes}
    >
      <div className="flex flex-wrap gap-6">
        <Figure label={t('projection.totalGross')} value={money(d.total_gross)} />
        <Figure label={t('projection.totalNet')} value={money(d.total_net)} tone="brand" />
      </div>
      <BarChart
        bars={months.map((m) => ({
          label: m.label,
          value: m.gross,
          secondary: m.net,
          tone: 'soft',
          hatched: m.kind !== 'actual',
          title: `${m.label}: ${money(m.gross)} bruto, ${money(m.net)} líquido (${
            m.kind === 'actual' ? t('projection.actual') : t('projection.projected')
          })`,
        }))}
        format={money}
        secondaryLabel={`Barra externa: bruto · barra interna: líquido · hachurado: ${t('projection.projected').toLowerCase()}`}
      />
      <div>
        <p className="text-meta font-medium uppercase tracking-wide text-text-3">
          {t('projection.items')}
        </p>
        <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
          {ITEM_KEYS.filter((key) => (d.items?.[key] ?? 0) !== 0).map((key) => (
            <KeyValue key={key} label={ITEM_LABELS[key]} value={money(d.items[key])} />
          ))}
        </div>
      </div>
    </CardFrame>
  );
}

interface PgblData {
  year: number;
  taxable_income: number;
  limit: number;
  contribution: number;
  monthly_contribution: number;
  tax_saving: number;
  eligible: boolean;
  tax_without_pgbl: number;
  tax_with_pgbl: number;
  best_model_without_pgbl: string;
  scenarios: { percent: number; contribution: number; tax: number; saving: number }[];
  recommendation: string;
  assumptions?: string[];
}

export function PgblSimulationCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as PgblData;
  const scenarios = d.scenarios ?? [];
  return (
    <CardFrame
      icon={PiggyBank}
      title={`PGBL — economia de IR em ${d.year}`}
      agentName={agentName}
      notes={d.assumptions}
    >
      <div className="flex flex-wrap gap-6">
        <Figure label={t('pgbl.saving')} value={money(d.tax_saving)} tone="ok" />
        <Figure label={t('pgbl.contribution')} value={money(d.contribution)} />
        <Figure label={t('pgbl.monthly')} value={money(d.monthly_contribution)} />
      </div>
      <BarChart
        bars={scenarios.map((s) => ({
          label: `${s.percent.toFixed(0)}%`,
          value: s.tax,
          tone: s.contribution > 0 ? 'brand' : 'soft',
          title: `Contribuindo ${s.percent.toFixed(0)}% (${money(s.contribution)}): imposto de ${money(
            s.tax,
          )}, economia de ${money(s.saving)}`,
        }))}
        format={money}
        secondaryLabel="Imposto anual estimado por percentual de contribuição"
      />
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyValue label={t('pgbl.taxWithout')} value={money(d.tax_without_pgbl)} />
        <KeyValue label={t('pgbl.taxWith')} value={money(d.tax_with_pgbl)} />
        <KeyValue label={t('pgbl.limit')} value={money(d.limit)} />
        <KeyValue
          label="Renda tributável"
          value={money(d.taxable_income)}
        />
      </div>
      {d.recommendation ? (
        <p className="rounded-card bg-brand-soft px-3 py-2 text-ui text-text-2">
          {d.recommendation}
        </p>
      ) : null}
      {!d.eligible ? <Badge tone="warn">Fora do perfil de dedução</Badge> : null}
    </CardFrame>
  );
}
