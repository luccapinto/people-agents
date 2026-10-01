import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Button, Chip } from '@/components/ui';
import { t } from '@/i18n';
import { branding } from '@/lib/branding';
import { personaIcon } from '@/lib/icons';
import { PENDING_PROMPT_KEY, SHOWCASE, type PersonaKey } from '@/lib/showcase';
import { useSession } from '@/state/session';
import { transport } from '@/transport';
import type { Persona } from '@/transport/types';

const PILLARS = [
  { title: 'login.pillarDoorTitle', body: 'login.pillarDoorBody' },
  { title: 'login.pillarDataTitle', body: 'login.pillarDataBody' },
  { title: 'login.pillarGovTitle', body: 'login.pillarGovBody' },
] as const;

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

  /** A showcase phrase is handed to the chat page through sessionStorage: it signs in as the
   *  persona and the chat sends the phrase as the first message. */
  const enter = (persona: Persona, prompt?: string): void => {
    if (prompt) {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
    }
    setBusy(persona.employee_id);
    setError(null);
    signIn(persona.employee_id).catch(() => {
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
      setError(t('login.failed'));
      setBusy(null);
    });
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[960px] flex-col gap-8 px-5 py-10">
      <header className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={34} className="shrink-0 text-text" />
            <div>
              <h1 className="text-headline font-semibold text-text">{branding.productName}</h1>
              <p className="text-ui text-text-2">{branding.tagline}</p>
            </div>
          </div>
          <Button variant="quiet" onClick={toggleTheme}>
            {theme === 'dark' ? t('nav.theme.light') : t('nav.theme.dark')}
          </Button>
        </div>

        <p className="max-w-2xl text-ui text-text-2">{t('login.thesis')}</p>

        <ul className="grid gap-3 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li key={pillar.title} className="rounded-panel border border-border bg-panel p-4">
              <p className="text-ui font-medium text-text">{t(pillar.title)}</p>
              <p className="mt-1 text-meta text-text-3">{t(pillar.body)}</p>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-meta text-text-3">
            {branding.company.name} — {t('login.fictional')}
          </p>
          {branding.repositoryUrl ? (
            <a
              href={branding.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-meta text-text-3 transition-colors hover:text-brand"
            >
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
              {t('login.source')}
            </a>
          ) : null}
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-ui font-medium text-text">{t('login.chooseProfile')}</h2>
          <p className="text-meta text-text-3">{t('login.devIdp')}</p>
        </div>
        {error ? <p className="text-ui text-bad">{error}</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {personas.map((persona) => {
            const Icon = personaIcon(persona.key);
            const phrases = SHOWCASE[persona.key as PersonaKey] ?? [];
            return (
              <li
                key={persona.employee_id}
                className="flex flex-col rounded-panel border border-border bg-panel p-4"
              >
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => enter(persona)}
                  className="rounded-card text-left transition-colors hover:text-brand disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    <Icon size={16} strokeWidth={1.75} className="text-brand" aria-hidden />
                    <span className="text-meta font-medium uppercase tracking-wide text-text-3">
                      {persona.label}
                    </span>
                  </span>
                  <span className="mt-2 block text-ui font-medium text-text">{persona.name}</span>
                  <span className="block text-meta text-text-2">{persona.title}</span>
                </button>
                <p className="mt-1.5 text-meta text-text-3">{persona.description}</p>

                {phrases.length ? (
                  <div className="mt-3">
                    <p className="text-meta font-medium uppercase tracking-wide text-text-3">
                      {t('login.showcase')}
                    </p>
                    <div className="mt-1.5 flex flex-col items-start gap-1.5">
                      {phrases.map((phrase) => (
                        <Chip key={phrase} onClick={() => enter(persona, phrase)}>
                          {phrase}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}

                {busy === persona.employee_id ? (
                  <p className="mt-2 text-meta text-brand">{t('login.entering')}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
