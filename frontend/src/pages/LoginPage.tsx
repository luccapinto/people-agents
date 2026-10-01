import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { t } from '@/i18n';
import { branding } from '@/lib/branding';
import { personaIcon } from '@/lib/icons';
import { useSession } from '@/state/session';
import { transport } from '@/transport';
import type { Persona } from '@/transport/types';

export function LoginPage(): JSX.Element {
  const { signIn, theme, toggleTheme } = useSession();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    transport
      .personas()
      .then(setPersonas)
      .catch(() => setError(t('login.failed')));
  }, []);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-8 px-5 py-12">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-card bg-brand text-[15px] font-semibold text-white">
              {branding.productName.slice(0, 1)}
            </span>
            <div>
              <h1 className="text-headline font-semibold text-text">{branding.productName}</h1>
              <p className="text-ui text-text-2">{branding.tagline}</p>
            </div>
          </div>
          <Button variant="quiet" onClick={toggleTheme}>
            {theme === 'dark' ? t('nav.theme.light') : t('nav.theme.dark')}
          </Button>
        </div>
        <p className="text-meta text-text-3">
          {branding.company.name} — {t('login.fictional')}
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-ui font-medium text-text">{t('login.chooseProfile')}</h2>
          <p className="text-meta text-text-3">{t('login.devIdp')}</p>
        </div>
        {error ? <p className="text-ui text-bad">{error}</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {personas.map((persona) => {
            const Icon = personaIcon(persona.key);
            return (
              <li key={persona.employee_id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(persona.employee_id);
                    setError(null);
                    signIn(persona.employee_id).catch(() => {
                      setError(t('login.failed'));
                      setBusy(null);
                    });
                  }}
                  className="h-full w-full rounded-panel border border-border bg-panel p-4 text-left transition-colors hover:border-brand disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} strokeWidth={1.75} className="text-brand" aria-hidden />
                    <span className="text-meta font-medium uppercase tracking-wide text-text-3">
                      {persona.label}
                    </span>
                  </div>
                  <p className="mt-2 text-ui font-medium text-text">{persona.name}</p>
                  <p className="text-meta text-text-2">{persona.title}</p>
                  <p className="mt-1.5 text-meta text-text-3">{persona.description}</p>
                  {busy === persona.employee_id ? (
                    <p className="mt-2 text-meta text-brand">{t('login.entering')}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
