import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AgentEditor } from '@/components/studio/AgentEditor';
import { RiskTag, StatusBadge } from '@/components/studio/common';
import { Badge, Button } from '@/components/ui';
import { t } from '@/i18n';
import { date as fmtDate } from '@/lib/format';
import { agentIcon } from '@/lib/icons';
import { type AgentForm, EMPTY_FORM } from '@/lib/studioSpec';
import { useSession } from '@/state/session';
import { transport } from '@/transport';
import type { AgentListItem, StudioCatalog } from '@/transport/types';

export function StudioPage({ creating = false }: { creating?: boolean }): JSX.Element {
  const { me } = useSession();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canAuthor = (me?.roles ?? []).some(
    (role) => role === 'agent_author' || role === 'governance_admin',
  );

  useEffect(() => {
    transport.studioAgents().then(setAgents).catch((failure: Error) => setError(failure.message));
    transport.studioCatalog().then(setCatalog).catch(() => undefined);
  }, []);

  if (creating) {
    return (
      <AppShell
        title={t('studio.new')}
        subtitle={t('studio.subtitle')}
        actions={
          <Button variant="quiet" onClick={() => navigate('/studio')}>
            {t('common.back')}
          </Button>
        }
      >
        {catalog ? (
          <AgentEditor
            form={form}
            onChange={setForm}
            catalog={catalog}
            busy={busy}
            error={error}
            submitLabel={t('editor.create')}
            onSubmit={(spec) => {
              setBusy(true);
              setError(null);
              transport
                .studioCreate(spec)
                .then((agent) => navigate(`/studio/${agent.id}`))
                .catch((failure: Error) => setError(failure.message))
                .finally(() => setBusy(false));
            }}
          />
        ) : (
          <p className="text-meta text-text-3">{t('common.loading')}</p>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      title={t('studio.title')}
      subtitle={t('studio.subtitle')}
      actions={
        canAuthor ? (
          <Button variant="primary" onClick={() => navigate('/studio/novo')}>
            <Plus size={14} strokeWidth={1.75} aria-hidden />
            {t('studio.new')}
          </Button>
        ) : undefined
      }
    >
      {error ? <p className="text-meta text-bad">{error}</p> : null}
      <ul className="mx-auto grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => {
          const Icon = agentIcon(agent.icon);
          return (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => navigate(`/studio/${agent.id}`)}
                className="h-full w-full rounded-card border border-border bg-panel p-4 text-left transition-colors hover:border-brand"
              >
                <div className="flex items-start gap-2">
                  <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium text-text">{agent.name}</p>
                    <p className="truncate font-mono text-[11px] text-text-3">{agent.id}</p>
                  </div>
                  {agent.mine ? <Badge tone="brand">{t('studio.mine')}</Badge> : null}
                </div>
                <p className="mt-2 line-clamp-2 text-meta text-text-2">{agent.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={agent.status} />
                  <Badge>{t('studio.version', { n: agent.latest_version })}</Badge>
                  <RiskTag risk={agent.risk} />
                  {agent.builtin ? <Badge>{t('studio.builtin')}</Badge> : null}
                </div>
                <p className="mt-2 text-meta text-text-3">
                  {t('studio.owner')}: {agent.owner_name}
                  {agent.review_due ? ` · ${t('studio.reviewDue', { date: fmtDate(agent.review_due) })}` : ''}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {agents.length === 0 ? <p className="text-meta text-text-3">{t('studio.empty')}</p> : null}
    </AppShell>
  );
}
