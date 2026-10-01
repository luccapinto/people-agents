import { FlaskConical, KeyRound, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { t } from '@/i18n';
import { branding } from '@/lib/branding';
import { DEFAULT_LIVE_MODEL, disableLive, enableLive, LIVE_CHANGED_EVENT, liveConfig } from '@/lib/liveMode';
import { LIVE_MODE_EVENT } from '@/state/actions';
import { type DemoTransport, isDemo, transport } from '@/transport';

/** Discreet strip shown on every screen of the static demo: reset, and live mode (the visitor's
 *  own OpenRouter key, kept only in this tab). */
export function DemoBanner(): JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [live, setLive] = useState(() => (isDemo ? liveConfig() : null));

  useEffect(() => {
    if (!isDemo) return undefined;
    const open = (): void => setLiveOpen(true);
    const changed = (): void => setLive(liveConfig());
    window.addEventListener(LIVE_MODE_EVENT, open);
    window.addEventListener(LIVE_CHANGED_EVENT, changed);
    return () => {
      window.removeEventListener(LIVE_MODE_EVENT, open);
      window.removeEventListener(LIVE_CHANGED_EVENT, changed);
    };
  }, []);

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
          <span className="leading-snug">{live ? t('live.on', { model: live.model }) : message}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setLiveOpen(true)}
            aria-label={t('live.open')}
            className="flex items-center gap-1 rounded-control px-1.5 py-0.5 text-text-3 transition-colors hover:text-text"
          >
            <KeyRound size={13} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{live ? t('live.short.on') : t('live.short.off')}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={t('demo.reset')}
            className="flex items-center gap-1 rounded-control px-1.5 py-0.5 text-text-3 transition-colors hover:text-text"
          >
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('demo.reset')}</span>
          </button>
        </span>
      </div>

      {liveOpen ? <LiveModeDialog onClose={() => setLiveOpen(false)} /> : null}

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

function LiveModeDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const current = liveConfig();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(current?.model ?? DEFAULT_LIVE_MODEL);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('live.title')}
    >
      <form
        className="w-full max-w-md rounded-panel border border-border bg-panel p-5 shadow-pop"
        onSubmit={(event) => {
          event.preventDefault();
          if (!key.trim()) return;
          enableLive(key, model);
          onClose();
        }}
      >
        <div className="flex items-center gap-2">
          <KeyRound size={16} strokeWidth={1.75} className="text-brand" aria-hidden />
          <h2 className="text-ui font-medium text-text">{t('live.title')}</h2>
        </div>
        <p className="mt-2 text-meta text-text-2">{t('live.body')}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-meta text-text-2">
          <li>{t('live.where')}</li>
          <li>{t('live.rules')}</li>
          <li>{t('live.cost')}</li>
        </ul>
        <label className="mt-4 block text-meta text-text-3" htmlFor="live-key">
          {t('live.keyLabel')}
        </label>
        <input
          id="live-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={current ? t('live.keyKept') : 'sk-or-...'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-ui text-text outline-none focus:border-brand"
        />
        <label className="mt-3 block text-meta text-text-3" htmlFor="live-model">
          {t('live.modelLabel')}
        </label>
        <input
          id="live-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-ui text-text outline-none focus:border-brand"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {current ? (
            <Button
              variant="danger"
              onClick={() => {
                disableLive();
                onClose();
              }}
            >
              {t('live.disable')}
            </Button>
          ) : null}
          <Button variant="quiet" onClick={onClose}>
            {t('demo.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!key.trim()}>
            {t('live.enable')}
          </Button>
        </div>
      </form>
    </div>
  );
}
