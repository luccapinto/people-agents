import { useEffect, useState } from 'react';
import { AppShell, type ShellTab } from '@/components/AppShell';
import { Audit } from '@/components/console/Audit';
import { Conversations } from '@/components/console/Conversations';
import { Overview } from '@/components/console/Overview';
import { Policies } from '@/components/console/Policies';
import { t } from '@/i18n';
import { transport } from '@/transport';
import type { ConsoleOverview } from '@/transport/types';

const TABS: ShellTab[] = [
  { id: 'overview', label: t('console.tab.overview') },
  { id: 'audit', label: t('console.tab.audit') },
  { id: 'policies', label: t('console.tab.policies') },
  { id: 'conversations', label: t('console.tab.conversations') },
];

export function ConsolePage(): JSX.Element {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'overview' || overview) return;
    transport
      .consoleOverview()
      .then(setOverview)
      .catch((failure: Error) => setError(failure.message));
  }, [tab, overview]);

  return (
    <AppShell
      title={t('console.title')}
      subtitle={t('console.subtitle')}
      tabs={TABS}
      active={tab}
      onTab={setTab}
    >
      {error ? <p className="text-meta text-bad">{error}</p> : null}
      {tab === 'overview' ? (
        overview ? (
          <Overview data={overview} />
        ) : (
          <p className="text-meta text-text-3">{t('common.loading')}</p>
        )
      ) : null}
      {tab === 'audit' ? <Audit /> : null}
      {tab === 'policies' ? <Policies /> : null}
      {tab === 'conversations' ? <Conversations /> : null}
    </AppShell>
  );
}
