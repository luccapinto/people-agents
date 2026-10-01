import clsx from 'clsx';
import {
  AlertTriangle,
  Clock,
  FileCheck2,
  LifeBuoy,
  Receipt,
  ShieldAlert,
  Table as TableIcon,
} from 'lucide-react';
import { BarChart } from '@/components/charts';
import { Badge, CardFrame, Figure, KeyValue, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate, hours, money, monthLabel } from '@/lib/format';
import { DownloadPdfButton } from './payroll';
import { asRecord, type CardProps } from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function TableCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    title?: string;
    columns: string[];
    rows: (string | number | null)[][];
    money_columns?: number[];
  };
  const moneyColumns = new Set(d.money_columns ?? []);
  return (
    <CardFrame icon={TableIcon} title={d.title ?? t('generic.data')} agentName={agentName}>
      {d.rows?.length ? (
        <ScrollArea>
          <table className="w-full min-w-[360px] border-collapse text-ui">
            <thead>
              <tr className="text-left text-meta text-text-3">
                {(d.columns ?? []).map((column, i) => (
                  <th
                    key={i}
                    className={clsx('py-1 pr-4 font-medium', moneyColumns.has(i) && 'text-right')}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((row, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={clsx(
                        'tnum py-1.5 pr-4 text-text-2',
                        moneyColumns.has(j) && 'text-right',
                      )}
                    >
                      {moneyColumns.has(j)
                        ? money(Number(cell))
                        : typeof cell === 'string' && ISO_DATE.test(cell)
                          ? fmtDate(cell)
                          : String(cell ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      ) : (
        <p className="text-meta text-text-3">{t('card.noItems')}</p>
      )}
    </CardFrame>
  );
}

interface Issue {
  code?: string;
  message: string;
  severity: 'error' | 'warning' | 'info' | string;
}

const SEVERITY_TONE = { error: 'bad', warning: 'warn', info: 'neutral' } as const;
const SEVERITY_LABEL: Record<string, string> = {
  error: t('severity.error'),
  warning: t('severity.warning'),
  info: t('severity.info'),
};

function IssueList({ issues }: { issues: Issue[] }): JSX.Element {
  return (
    <ul className="space-y-1.5">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-2">
          <Badge tone={SEVERITY_TONE[issue.severity as 'error'] ?? 'neutral'}>
            {SEVERITY_LABEL[issue.severity] ?? issue.severity}
          </Badge>
          <span className="flex-1 text-ui text-text-2">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function ValidationCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as { issues: Issue[] };
  return (
    <CardFrame icon={AlertTriangle} title={t('validation.issues')} agentName={agentName}>
      <IssueList issues={d.issues ?? []} />
    </CardFrame>
  );
}

export function ReceiptExtractionCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    filename: string;
    fields: {
      amount: number | null;
      date: string | null;
      cnpj: string | null;
      merchant: string | null;
      category: string | null;
      items_flagged?: string[];
      injection_signals?: string[];
    };
    issues: Issue[];
    valid: boolean;
  };
  const f = d.fields ?? {};
  return (
    <CardFrame icon={Receipt} title={d.filename ?? t('receipt.fields')} agentName={agentName}>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyValue label={t('receipt.amount')} value={money(f.amount)} />
        <KeyValue label={t('receipt.date')} value={fmtDate(f.date)} />
        <KeyValue label={t('receipt.merchant')} value={f.merchant ?? '—'} />
        <KeyValue label={t('receipt.cnpj')} value={f.cnpj ?? '—'} />
        <KeyValue label={t('receipt.category')} value={f.category ?? '—'} />
      </div>
      {f.injection_signals?.length ? (
        <p className="flex items-start gap-2 rounded-card border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-ui text-bad">
          <ShieldAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          {t('receipt.injection')}
        </p>
      ) : null}
      {d.issues?.length ? (
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-text-3">
            {t('receipt.issues')}
          </p>
          <div className="mt-1">
            <IssueList issues={d.issues} />
          </div>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function TimeBankCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    months: { month: string; label: string; expected: number; worked: number; overtime: number; bank_delta: number; bank_balance: number }[];
    bank_balance: number;
    last_month: string;
    overtime_last_month: number;
    overtime_year: number;
    limit: number;
  };
  const months = d.months ?? [];
  const overLimit = Math.abs(d.bank_balance) >= d.limit;
  return (
    <CardFrame icon={Clock} title="Banco de horas" agentName={agentName}>
      <div className="flex flex-wrap gap-6">
        <Figure
          label={t('timebank.balance')}
          value={hours(d.bank_balance)}
          tone={overLimit ? 'warn' : 'brand'}
          hint={`${t('timebank.limit')}: ${hours(d.limit)}`}
        />
        <Figure label={t('timebank.overtimeMonth')} value={hours(d.overtime_last_month)} />
        <Figure label={t('timebank.overtimeYear')} value={hours(d.overtime_year)} />
      </div>
      <BarChart
        bars={months.map((m) => ({
          label: m.label,
          value: Math.abs(m.bank_balance),
          tone: m.bank_balance < 0 ? 'warn' : 'brand',
          title: `${monthLabel(m.month)}: saldo ${hours(m.bank_balance)}, extras ${hours(m.overtime)}`,
        }))}
        format={hours}
        secondaryLabel={`${t('timebank.limit')}: ${hours(d.limit)}`}
      />
    </CardFrame>
  );
}

export function DocumentCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    document_id: string;
    kind: string;
    title: string;
    verification_code: string;
    issued_on: string;
    pdf_url: string;
    figures?: Record<string, number | string>;
  };
  return (
    <CardFrame
      icon={FileCheck2}
      title={d.title}
      agentName={agentName}
      action={<DownloadPdfButton url={d.pdf_url} filename={`${d.kind}-${d.document_id}.pdf`} />}
    >
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyValue label={t('card.issuedOn')} value={fmtDate(d.issued_on)} />
        <KeyValue
          label={t('card.verification')}
          value={<span className="font-mono text-meta">{d.verification_code}</span>}
        />
      </div>
      {d.figures ? (
        <div className="grid gap-x-6 sm:grid-cols-2">
          {Object.entries(d.figures)
            .filter(([, value]) => typeof value === 'number')
            .map(([key, value]) => (
              <KeyValue key={key} label={key.replace(/_/g, ' ')} value={money(Number(value))} />
            ))}
        </div>
      ) : null}
    </CardFrame>
  );
}

export function SupportChannelsCard({ data, agentName }: CardProps): JSX.Element {
  const d = data as {
    channels: { kind: string; name: string; url?: string; phone?: string; description: string }[];
  };
  return (
    <CardFrame icon={LifeBuoy} title={t('support.channels')} agentName={agentName}>
      <ul className="space-y-2">
        {(d.channels ?? []).map((channel, i) => (
          <li key={i} className="rounded-card border border-border-subtle bg-surface/50 p-3">
            <p className="text-ui font-medium text-text">{channel.name}</p>
            <p className="text-meta text-text-2">{channel.description}</p>
            <p className="mt-1 text-meta text-text-3">
              {[channel.phone, channel.url].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </CardFrame>
  );
}

/** Fallback for card types this build does not know yet: a readable key/value dump. */
export function GenericCard({ data, agentName }: CardProps): JSX.Element {
  const entries = Object.entries(asRecord(data));
  return (
    <CardFrame icon={TableIcon} title={t('generic.data')} agentName={agentName}>
      <dl className="space-y-1">
        {entries.map(([key, value]) => (
          <KeyValue
            key={key}
            label={key.replace(/_/g, ' ')}
            value={
              typeof value === 'object' && value !== null ? (
                <span className="font-mono text-meta text-text-3">{JSON.stringify(value)}</span>
              ) : (
                String(value)
              )
            }
          />
        ))}
      </dl>
    </CardFrame>
  );
}
