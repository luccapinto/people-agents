import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { t } from '@/i18n';
import { transport } from '@/transport';

/** Second-factor confirmation for sensitive proposals. The dev IdP returns the code so the
 *  demo is self-contained; a real IdP would push it to the person's authenticator. */
export function StepUpModal({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [challenge, setChallenge] = useState<{ code?: string; message: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    transport
      .stepUpChallenge()
      .then(setChallenge)
      .catch(() => setError(t('stepUp.invalid')));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('stepUp.title')}
    >
      <div className="w-full max-w-sm rounded-panel border border-border bg-panel p-5 shadow-pop">
        <div className="flex items-center gap-2">
          <KeyRound size={16} strokeWidth={1.75} className="text-brand" aria-hidden />
          <h2 className="text-ui font-medium text-text">{t('stepUp.title')}</h2>
        </div>
        {challenge ? (
          <p className="mt-2 text-meta text-text-2">{challenge.message}</p>
        ) : null}
        {challenge?.code ? (
          <p className="mt-1 font-mono text-ui text-brand">
            {t('stepUp.devCode', { code: challenge.code })}
          </p>
        ) : null}
        <label className="mt-4 block text-meta text-text-3" htmlFor="step-up-code">
          {t('stepUp.codeLabel')}
        </label>
        <input
          id="step-up-code"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="tnum mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-[18px] tracking-[0.3em] text-text outline-none focus:border-brand"
        />
        {error ? <p className="mt-2 text-meta text-bad">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {t('stepUp.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={code.length !== 6 || busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              transport
                .stepUp(code)
                .then(onDone)
                .catch(() => setError(t('stepUp.invalid')))
                .finally(() => setBusy(false));
            }}
          >
            {t('stepUp.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
