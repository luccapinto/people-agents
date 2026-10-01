import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell, type ShellTab } from '@/components/AppShell';
import { AgentEditor } from '@/components/studio/AgentEditor';
import { LifecycleStepper, RiskTag, StatusBadge } from '@/components/studio/common';
import { Documents } from '@/components/studio/Documents';
import { Evaluation } from '@/components/studio/Evaluation';
import { Metrics } from '@/components/studio/Metrics';
import { Playground } from '@/components/studio/Playground';
import { Review } from '@/components/studio/Review';
import { Versions } from '@/components/studio/Versions';
import { Button } from '@/components/ui';
import { t } from '@/i18n';
import { type AgentForm, EMPTY_FORM, formFromSpec } from '@/lib/studioSpec';
import { useSession } from '@/state/session';
import { transport } from '@/transport';
import type { AgentDetail, StudioCatalog } from '@/transport/types';

export function StudioAgentPage(): JSX.Element {
  const { agentId = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [tab, setTab] = useState('config');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isGovernance = (me?.roles ?? []).includes('governance_admin');

  const apply = (next: AgentDetail): void => {
    setAgent(next);
    setForm(formFromSpec(next.versions[0].spec));
  };

  useEffect(() => {
    transport.studioAgent(agentId).then(apply).catch((failure: Error) => setError(failure.message));
    transport.studioCatalog().then(setCatalog).catch(() => undefined);
  }, [agentId]);

  const tabs = useMemo<ShellTab[]>(() => {
    const list: ShellTab[] = [
      { id: 'config', label: t('studio.tab.config') },
      { id: 'knowledge', label: t('studio.tab.knowledge') },
      { id: 'evaluation', label: t('studio.tab.evaluation') },
    ];
    if (agent?.mine) list.push({ id: 'playground', label: t('studio.tab.playground') });
    list.push(
      { id: 'review', label: t('studio.tab.review') },
      { id: 'versions', label: t('studio.tab.versions') },
      { id: 'metrics', label: t('studio.tab.metrics') },
    );
    return list;
  }, [agent?.mine]);

  if (!agent) {
    return (
      <AppShell title={t('studio.title')}>
        <p className="text-meta text-text-3">{error ?? t('common.loading')}</p>
      </AppShell>
    );
  }

  const latest = agent.versions[0];
  const editable = agent.mine && !agent.builtin;
  const statusAction = (status: 'paused' | 'published' | 'archived'): void => {
    setBusy(true);
    setError(null);
    transport
      .studioStatus(agent.id, status)
      .then(apply)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };

  return (
    <AppShell
      title={latest.spec.name}
      subtitle={agent.id}
      tabs={tabs}
      active={tab}
      onTab={setTab}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={agent.status} />
          <RiskTag risk={latest.spec.risk ?? 'low'} />
          {editable || isGovernance ? (
            <>
              {agent.status === 'published' ? (
                <Button disabled={busy} onClick={() => statusAction('paused')}>
                  {t('studio.action.pause')}
                </Button>
              ) : null}
              {agent.status === 'paused' ? (
                <Button disabled={busy} onClick={() => statusAction('published')}>
                  {t('studio.action.resume')}
                </Button>
              ) : null}
              {agent.status !== 'archived' ? (
                <Button variant="danger" disabled={busy} onClick={() => statusAction('archived')}>
                  {t('studio.action.archive')}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="quiet" onClick={() => navigate('/studio')}>
            {t('common.back')}
          </Button>
        </div>
      }
    >
      <div className="mx-auto mb-4 w-full max-w-3xl">
        <LifecycleStepper status={agent.status} />
      </div>
      {error ? <p className="mx-auto mb-3 w-full max-w-3xl text-meta text-bad">{error}</p> : null}

      {tab === 'config' ? (
        catalog ? (
          <AgentEditor
            form={form}
            onChange={setForm}
            catalog={catalog}
            busy={busy}
            error={error}
            disabled={!editable}
            submitLabel={t('common.save')}
            onSubmit={(spec) => {
              setBusy(true);
              setError(null);
              transport
                .studioUpdate(agent.id, spec)
                .then(apply)
                .catch((failure: Error) => setError(failure.message))
                .finally(() => setBusy(false));
            }}
          />
        ) : (
          <p className="text-meta text-text-3">{t('common.loading')}</p>
        )
      ) : null}

      {tab === 'knowledge' ? <Documents agentId={agent.id} canEdit={editable} /> : null}
      {tab === 'evaluation' ? (
        <Evaluation
          agentId={agent.id}
          stored={latest.eval_result}
          canRun={editable}
          draft={latest.status === 'draft'}
          onResult={() => transport.studioAgent(agent.id).then(apply)}
        />
      ) : null}
      {tab === 'playground' && agent.mine ? (
        <Playground agentId={agent.id} agentName={latest.spec.name} />
      ) : null}
      {tab === 'review' ? <Review agent={agent} isGovernance={isGovernance} onChanged={apply} /> : null}
      {tab === 'versions' ? (
        <Versions agent={agent} canRollback={editable || isGovernance} onChanged={apply} />
      ) : null}
      {tab === 'metrics' ? <Metrics agentId={agent.id} /> : null}
    </AppShell>
  );
}
