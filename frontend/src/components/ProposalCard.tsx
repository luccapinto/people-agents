import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react';
import { useState } from 'react';
import { CardView } from '@/components/CardView';
import { StepUpModal } from '@/components/StepUpModal';
import { Badge, Button, KeyValue, RiskBadge } from '@/components/ui';
import { t } from '@/i18n';
import { untilLabel } from '@/lib/format';
import { transport } from '@/transport';
import { type Proposal, type ProposalResult, TransportError } from '@/transport/types';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: t('proposal.error.invalid_token'),
  already_used: t('proposal.error.already_used'),
  expired: t('proposal.error.expired'),
  denied: t('proposal.error.denied'),
  not_found: t('proposal.error.not_found'),
  failed: t('proposal.error.failed'),
};

type State = 'idle' | 'working' | 'executed' | 'cancelled';

/** The confirmation token never reaches the screen: it is kept in the proposal payload and
 *  sent straight back to the API when the person confirms. */
export function ProposalCard({ proposal }: { proposal: Proposal }): JSX.Element {
  const [state, setState] = useState<State>(
    proposal.status === 'executed' ? 'executed' : proposal.status === 'cancelled' ? 'cancelled' : 'idle',
  );
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const readOnly = !proposal.token;

  const submit = async (): Promise<void> => {
    if (!proposal.token) return;
    setState('working');
    setError(null);
    try {
      const outcome = await transport.confirmProposal(proposal.id, proposal.token);
      setResult(outcome);
      setState('executed');
    } catch (failure) {
      // The server is the authority: an expired or missing step-up still comes back here.
      if (failure instanceof TransportError && failure.code === 'step_up_required') {
        setStepUp(true);
        setState('idle');
        return;
      }
      const code = failure instanceof TransportError ? failure.code : 'failed';
      setError(ERROR_MESSAGES[code] ?? t('proposal.error.generic'));
      setState('idle');
    }
  };

  // Sensitive proposals announce the step-up requirement: ask for the code first instead of
  // provoking a 401 round trip. The server enforces it either way.
  const confirm = (): void => {
    if (proposal.step_up_required) setStepUp(true);
    else void submit();
  };

  return (
    <section className="overflow-hidden rounded-card border border-brand/40 bg-brand-soft/40">
      <header className="flex items-start gap-2 border-b border-border-subtle px-4 py-3">
        <ShieldQuestion size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-ui font-medium text-text">{proposal.summary}</h3>
          <p className="text-meta text-text-3">
            {proposal.title ?? proposal.tool} · {t('proposal.title')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <RiskBadge risk={proposal.risk} />
          {state === 'executed' ? (
            <Badge tone="ok">
              <CheckCircle2 size={12} strokeWidth={2} aria-hidden />
              {t('proposal.executed')}
            </Badge>
          ) : null}
          {state === 'cancelled' ? (
            <Badge tone="neutral">
              <XCircle size={12} strokeWidth={2} aria-hidden />
              {t('proposal.cancelled')}
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3">
        <div>
          {(proposal.details ?? []).map((detail, i) => (
            <KeyValue key={i} label={detail.label} value={detail.value} />
          ))}
        </div>

        {proposal.step_up_required && state === 'idle' ? (
          <p className="text-meta text-warn">{t('proposal.stepUpNeeded')}</p>
        ) : null}
        {error ? <p className="text-meta text-bad">{error}</p> : null}

        {result?.summary ? (
          <p className="rounded-card border border-border-subtle bg-panel px-3 py-2 text-ui text-text-2">
            {result.summary}
          </p>
        ) : null}
        {result?.card ? <CardView card={result.card} /> : null}

        {state === 'idle' && !readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={confirm}>
              {t('proposal.confirm')}
            </Button>
            <Button
              onClick={() => {
                transport
                  .cancelProposal(proposal.id)
                  .then(() => setState('cancelled'))
                  .catch(() => setError(t('proposal.error.generic')));
              }}
            >
              {t('proposal.cancel')}
            </Button>
            <span className="text-meta text-text-3">
              {t('proposal.expires', { time: untilLabel(proposal.expires_at) })}
            </span>
          </div>
        ) : null}
        {state === 'idle' && readOnly ? (
          <p className="text-meta text-text-3">{t('proposal.archived')}</p>
        ) : null}
        {state === 'working' ? <p className="text-meta text-text-3">{t('proposal.working')}</p> : null}
      </div>

      {stepUp ? (
        <StepUpModal
          onCancel={() => setStepUp(false)}
          onDone={() => {
            setStepUp(false);
            void submit();
          }}
        />
      ) : null}
    </section>
  );
}
