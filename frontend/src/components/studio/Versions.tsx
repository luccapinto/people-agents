import { History } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/studio/common';
import { Button, CardFrame, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { transport } from '@/transport';
import type { AgentDetail } from '@/transport/types';

export function Versions({
  agent,
  canRollback,
  onChanged,
}: {
  agent: AgentDetail;
  canRollback: boolean;
  onChanged: (next: AgentDetail) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <CardFrame icon={History} title={t('studio.tab.versions')}>
        {error ? <p className="text-meta text-bad">{error}</p> : null}
        <ScrollArea>
          <table className="w-full min-w-[560px] border-collapse text-ui">
            <thead>
              <tr className="text-left text-meta text-text-3">
                <th className="py-1 pr-4 font-medium">{t('versions.version')}</th>
                <th className="py-1 pr-4 font-medium">{t('overview.outcome')}</th>
                <th className="py-1 pr-4 font-medium">{t('versions.evaluation')}</th>
                <th className="py-1 pr-4 font-medium">{t('versions.reviewer')}</th>
                <th className="py-1 pr-4 font-medium">{t('versions.note')}</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {agent.versions.map((version) => (
                <tr key={version.version} className="border-t border-border-subtle align-top">
                  <td className="tnum py-1.5 pr-4">
                    {version.version}
                    <span className="block text-meta text-text-3">{dateTime(version.created_at)}</span>
                  </td>
                  <td className="py-1.5 pr-4">
                    <StatusBadge status={version.status} />
                  </td>
                  <td className="tnum py-1.5 pr-4 text-text-2">
                    {version.eval_result
                      ? `${version.eval_result.passed}/${version.eval_result.total}`
                      : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-text-2">
                    <span className={version.reviewed_by_name ? 'text-meta' : 'font-mono text-meta'}>{version.reviewed_by_name ?? version.reviewed_by ?? '—'}</span>
                    {version.reviewed_at ? (
                      <span className="block text-meta text-text-3">{dateTime(version.reviewed_at)}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-4 text-meta text-text-3">{version.review_note ?? '—'}</td>
                  <td className="py-1.5 text-right">
                    {canRollback &&
                    (version.status === 'superseded' ||
                      (version.status === 'published' && agent.published_version !== version.version)) ? (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          setError(null);
                          transport
                            .studioRollback(agent.id, version.version)
                            .then(onChanged)
                            .catch((failure: Error) => setError(failure.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {t('versions.restore')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardFrame>
    </div>
  );
}
