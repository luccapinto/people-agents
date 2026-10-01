import clsx from 'clsx';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, CardFrame } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate } from '@/lib/format';
import { transport } from '@/transport';
import type { EvaluationResult } from '@/transport/types';

const KIND_LABELS: Record<string, string> = {
  routing: t('editor.kind.routing'),
  citation: t('editor.kind.citation'),
  refusal: t('editor.kind.refusal'),
};

export function Evaluation({
  agentId,
  stored,
  canRun,
  draft,
  onResult,
}: {
  agentId: string;
  stored: EvaluationResult | null;
  canRun: boolean;
  /** Only a draft can still be sent to review; past that the gate result is a record. */
  draft: boolean;
  onResult: (result: EvaluationResult) => void;
}): JSX.Element {
  const [result, setResult] = useState<EvaluationResult | null>(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <CardFrame
        icon={FlaskConical}
        title={t('studio.tab.evaluation')}
        agentName={
          result ? t('evaluation.ranAt', { date: fmtDate(result.ran_at), version: result.version }) : undefined
        }
        action={
          canRun ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                transport
                  .studioEvaluate(agentId)
                  .then((next) => {
                    setResult(next);
                    onResult(next);
                  })
                  .catch((failure: Error) => setError(failure.message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t('evaluation.running') : t('evaluation.run')}
            </Button>
          ) : undefined
        }
      >
        {error ? <p className="text-meta text-bad">{error}</p> : null}
        {result ? (
          <>
            <p
              className={clsx(
                'rounded-card border px-3 py-2 text-ui',
                result.ok
                  ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-ok'
                  : 'border-[var(--warn)]/40 bg-[var(--warn)]/10 text-warn',
              )}
            >
              {t('evaluation.result', { passed: result.passed, total: result.total })} ·{' '}
              {result.ok ? t(draft ? 'evaluation.gateOpen' : 'evaluation.gatePassed') : t('evaluation.gateClosed')}
            </p>
            <ul className="space-y-2">
              {result.results.map((row, i) => (
                <li key={i} className="rounded-card border border-border-subtle bg-surface/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.passed ? (
                      <CheckCircle2 size={14} strokeWidth={2} className="shrink-0 text-ok" aria-hidden />
                    ) : (
                      <XCircle size={14} strokeWidth={2} className="shrink-0 text-bad" aria-hidden />
                    )}
                    <Badge>{KIND_LABELS[row.kind] ?? row.kind}</Badge>
                    <Badge tone={row.passed ? 'ok' : 'bad'}>
                      {row.passed ? t('evaluation.pass') : t('evaluation.fail')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-ui text-text">{row.question}</p>
                  {row.detail ? (
                    <p className="text-meta text-text-3">
                      {t('evaluation.detail')}: {row.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-meta text-text-3">{t('evaluation.never')}</p>
        )}
      </CardFrame>
    </div>
  );
}
