import { FlaskConical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { t } from '@/i18n';
import { branding } from '@/lib/branding';
import { DemoTransport, isDemo, transport } from '@/transport';

/** Discreet strip shown on every screen of the static demo, with the reset action. */
export function DemoBanner(): JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  if (!isDemo) return null;
  const message = branding.demoBanner;
  if (!message) return null;

  const reset = (): void => {
    (transport as DemoTransport).reset();
    window.location.reload();
  };

  return (
    <>
      <div
        data-testid="demo-banner"
        className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-4 py-1.5 text-meta text-text-3"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FlaskConical size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="leading-snug">{message}</span>
        </span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={t('demo.reset')}
          className="flex shrink-0 items-center gap-1 rounded-control px-1.5 py-0.5 text-text-3 transition-colors hover:text-text"
        >
          <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">{t('demo.reset')}</span>
        </button>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-panel border border-border bg-panel p-5 shadow-pop">
            <h2 className="text-ui font-medium text-text">{t('demo.resetTitle')}</h2>
            <p className="mt-2 text-meta text-text-2">{t('demo.resetBody')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)}>{t('demo.cancel')}</Button>
              <Button variant="primary" onClick={reset}>
                {t('demo.resetConfirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
