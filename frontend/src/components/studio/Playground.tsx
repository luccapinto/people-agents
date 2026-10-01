import { useCallback, useEffect, useRef } from 'react';
import { Composer } from '@/components/Composer';
import { AssistantMessage, UserMessage } from '@/components/Message';
import { t } from '@/i18n';
import { ChatActionsContext } from '@/state/actions';
import { useChat } from '@/state/chat';
import { useSession } from '@/state/session';

/** The author's test conversation: every turn is pinned to this draft agent. */
export function Playground({ agentId, agentName }: { agentId: string; agentName: string }): JSX.Element {
  const { me } = useSession();
  const agents = me?.agents ?? [];
  const resolveName = useCallback(
    (id: string) => (id === agentId ? agentName : agents.find((agent) => agent.id === id)?.name ?? id),
    [agentId, agentName, agents],
  );
  const chat = useChat(resolveName, agentId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages]);

  const send = useCallback((text: string) => void chat.send(text), [chat]);

  return (
    <ChatActionsContext.Provider value={{ send }}>
      <div className="mx-auto flex h-full w-full max-w-chat flex-col gap-3">
        <p className="rounded-card border border-border-subtle bg-surface px-3 py-2 text-meta text-text-3">
          {t('playground.hint')}
        </p>
        <div className="min-h-[220px] flex-1 space-y-4">
          {chat.messages.map((message) =>
            message.role === 'user' ? (
              <UserMessage key={message.key} message={message} />
            ) : (
              <AssistantMessage
                key={message.key}
                message={message}
                agents={[...agents, { id: agentId, name: agentName, description: '', icon: 'bot' }]}
                selected={false}
                onInspect={() => undefined}
                readOnly
              />
            ),
          )}
          <div ref={bottomRef} />
        </div>
        <Composer streaming={chat.streaming} onSend={(text) => send(text)} onStop={chat.stop} />
      </div>
    </ChatActionsContext.Provider>
  );
}
