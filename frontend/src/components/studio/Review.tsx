import { GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/studio/common';
import { Button, CardFrame, KeyValue } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { transport } from '@/transport';
import type { AgentDetail } from '@/transport/types';

export function Review({
  agent,
  isGovernance,
  onChanged,
}: {
  agent: AgentDetail;
  isGovernance: boolean;
  onChanged: (next: AgentDetail) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = agent.versions[0];
  const pending = agent.versions.find((version) => version.status === 'in_review') ?? null;
  const decided = agent.versions.find((version) => version.reviewed_at) ?? null;
  const evaluationOk = latest?.eval_result?.ok ?? false;

  const run = (action: Promise<AgentDetail>): void => {
    setBusy(true);
    setError(null);
    action
      .then(onChanged)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <CardFrame icon={GitPullRequest} title={t('studio.tab.review')}>
        {pending ? (
          <p className="text-ui text-text-2">{t('review.pending', { n: pending.version })}</p>
        ) : (
          <p className="text-meta text-text-3">{t('review.none')}</p>
        )}

        {agent.mine && !pending ? (
          <>
            <p className={evaluationOk ? 'text-meta text-ok' : 'text-meta text-warn'}>
              {evaluationOk ? t('evaluation.gateOpen') : t('evaluation.gateClosed')}
            </p>
            <Button
              variant="primary"
              disabled={busy || !evaluationOk || latest?.status !== 'draft'}
              onClick={() => run(transport.studioSubmit(agent.id))}
            >
              {busy ? t('review.submitting') : t('review.submit')}
            </Button>
          </>
        ) : null}

        {pending && isGovernance ? (
          <div className="space-y-2">
            <label className="block text-meta text-text-3" htmlFor="review-note">
              {t('review.note')}
            </label>
            <textarea
              id="review-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full resize-y rounded-control border border-border bg-surface px-3 py-2 text-ui text-text outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => run(transport.studioReview(agent.id, 'approve', note))}
              >
                {t('review.approve')}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => run(transport.studioReview(agent.id, 'reject', note))}
              >
                {t('review.reject')}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-meta text-bad">{error}</p> : null}

        {decided ? (
          <div className="rounded-card border border-border-subtle bg-surface/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={decided.status} />
              <span className="text-meta text-text-3">
                {t('review.decided', { date: dateTime(decided.reviewed_at) })}{' '}
                <span className={decided.reviewed_by_name ? undefined : 'font-mono'}>{decided.reviewed_by_name ?? decided.reviewed_by ?? '—'}</span>
              </span>
            </div>
            {decided.review_note ? (
              <KeyValue label={t('versions.note')} value={decided.review_note} />
            ) : null}
          </div>
        ) : null}
      </CardFrame>
    </div>
  );
}
