import { FileSearch, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AssistantMessage, UserMessage } from '@/components/Message';
import { Badge, Button, IconButton, ScrollArea } from '@/components/ui';
import { t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { fromStored } from '@/state/chat';
import { useSession } from '@/state/session';
import { transport } from '@/transport';
import type { ConsoleConversation, TranscriptAccess } from '@/transport/types';

export function Conversations(): JSX.Element {
  const [rows, setRows] = useState<ConsoleConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ConsoleConversation | null>(null);
  const { me } = useSession();
  const names = new Map((me?.agents ?? []).map((agent) => [agent.id, agent.name]));

  useEffect(() => {
    transport
      .consoleConversations()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-meta text-text-3">{t('common.loading')}</p>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <p className="text-meta text-text-3">{t('conversations.ownerHidden')}</p>
      <div className="overflow-hidden rounded-card border border-border bg-panel">
        <ScrollArea>
          <table className="w-full min-w-[620px] border-collapse text-ui">
            <thead>
              <tr className="text-left text-meta text-text-3">
                <th className="px-3 py-2 font-medium">{t('conversations.date')}</th>
                <th className="px-3 py-2 font-medium">{t('conversations.unit')}</th>
                <th className="px-3 py-2 font-medium">{t('conversations.agents')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('conversations.messages')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="tnum px-3 py-2 text-text-2">{dateTime(row.updated_at)}</td>
                  <td className="px-3 py-2 text-text-2">{row.unit}</td>
                  <td className="px-3 py-2 text-meta text-text-3">
                    {row.agents.length ? row.agents.map((id) => names.get(id) ?? id).join(', ') : '—'}
                    {row.sensitive ? (
                      <Badge tone="warn" className="ml-1.5">
                        <Lock size={11} strokeWidth={2} aria-hidden />
                        {t('conversations.sensitive')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{row.messages}</td>
                  <td className="px-3 py-2 text-right">
                    <Button onClick={() => setTarget(row)}>
                      <FileSearch size={14} strokeWidth={1.75} aria-hidden />
                      {t('conversations.access')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
        {rows.length === 0 ? <p className="px-3 py-3 text-meta text-text-3">{t('common.empty')}</p> : null}
      </div>

      {target ? <TranscriptDialog conversation={target} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}

function TranscriptDialog({
  conversation,
  onClose,
}: {
  conversation: ConsoleConversation;
  onClose: () => void;
}): JSX.Element {
  const { me } = useSession();
  const [justification, setJustification] = useState('');
  const [granted, setGranted] = useState<TranscriptAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const agents = me?.agents ?? [];
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('transcript.title')}
    >
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-panel border border-border bg-panel shadow-pop">
        <header className="flex items-start gap-2 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-ui font-medium text-text">{t('transcript.title')}</h2>
            <p className="mt-0.5 text-meta text-text-3">
              {conversation.unit} · {dateTime(conversation.updated_at)}
            </p>
          </div>
          <IconButton icon={X} label={t('nav.close')} onClick={onClose} />
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {granted ? (
            <div className="space-y-4">
              <div className="rounded-card border border-border-subtle bg-surface px-3 py-2">
                <p className="text-ui text-text">{t('transcript.owner', { name: granted.owner })}</p>
                <p className="text-meta text-text-3">
                  {t('transcript.expires', { minutes: granted.expires_in_minutes })}
                </p>
              </div>
              {fromStored(granted.messages, agentName).map((message) =>
                message.role === 'user' ? (
                  <UserMessage key={message.key} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.key}
                    message={message}
                    agents={agents}
                    selected={false}
                    onInspect={() => undefined}
                    readOnly
                  />
                ),
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-ui text-text-2">{t('transcript.explain')}</p>
              <label className="block text-meta text-text-3" htmlFor="justification">
                {t('transcript.justification')}
              </label>
              <textarea
                id="justification"
                rows={3}
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                className="w-full resize-y rounded-control border border-border bg-surface px-3 py-2 text-ui text-text outline-none focus:border-brand"
              />
              {error ? <p className="text-meta text-bad">{error}</p> : null}
            </div>
          )}
        </div>

        {granted ? null : (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="quiet" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (justification.trim().length < 20) {
                  setError(t('transcript.tooShort'));
                  return;
                }
                setBusy(true);
                setError(null);
                transport
                  .consoleTranscript(conversation.id, justification.trim())
                  .then(setGranted)
                  .catch((failure: Error) => setError(failure.message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t('common.loading') : t('transcript.open')}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
