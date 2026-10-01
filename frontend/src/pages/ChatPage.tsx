import { ChevronDown, ChevronUp, Menu, PanelRight, Shield, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Attachment, Composer } from '@/components/Composer';
import { InsideContent, InsidePanel } from '@/components/InsidePanel';
import { AssistantMessage, UserMessage } from '@/components/Message';
import { Sidebar } from '@/components/Sidebar';
import { Button, Chip, IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { firstName } from '@/lib/format';
import { agentIcon } from '@/lib/icons';
import { PENDING_PROMPT_KEY } from '@/lib/showcase';
import { useTurnScroll } from '@/lib/turnScroll';
import { ChatActionsContext } from '@/state/actions';
import { useChat } from '@/state/chat';
import { useSession } from '@/state/session';

export function ChatPage(): JSX.Element {
  const { me, theme, toggleTheme, signOut } = useSession();
  const identity = me!;
  const agentName = useCallback(
    (id: string) => identity.agents.find((agent) => agent.id === id)?.name ?? id,
    [identity.agents],
  );
  const chat = useChat(agentName);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [insideOpen, setInsideOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const noticeKey = `atrium.notice.${identity.employee_id}`;
  const [noticeOpen, setNoticeOpen] = useState(() => !localStorage.getItem(noticeKey));
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => {
    const picked = chat.messages.find((message) => message.key === selectedKey);
    if (picked) return picked;
    // Opened from the header: show the latest assistant answer instead of an empty panel.
    return [...chat.messages].reverse().find((message) => message.role === 'assistant') ?? null;
  }, [chat.messages, selectedKey]);

  useTurnScroll(threadRef, chat.messages);

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      setDrawerOpen(false);
      void chat.send(text, {
        attachments: attachments.map((file) => ({
          upload_id: file.upload_id,
          filename: file.filename,
        })),
      });
    },
    [chat],
  );

  const actions = useMemo(() => ({ send }), [send]);

  /** A phrase picked on the landing arrives through sessionStorage and is sent once.
   *  The ref keeps React StrictMode's double effect from sending it twice. */
  const pendingSent = useRef(false);
  useEffect(() => {
    if (pendingSent.current) return;
    pendingSent.current = true;
    const pending = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    send(pending);
  }, [send]);

  const sidebar = (onClose?: () => void): JSX.Element => (
    <Sidebar
      me={identity}
      conversations={chat.conversations}
      currentId={chat.conversationId}
      theme={theme}
      onSelect={(id) => {
        setSelectedKey(null);
        setInsideOpen(false);
        onClose?.();
        void chat.openConversation(id);
      }}
      onNew={() => {
        setSelectedKey(null);
        setInsideOpen(false);
        onClose?.();
        chat.newConversation();
      }}
      onSwitchPersona={signOut}
      onToggleTheme={toggleTheme}
      onShowPrivacy={() => {
        setNoticeOpen(true);
        onClose?.();
      }}
      onClose={onClose}
    />
  );

  return (
    <ChatActionsContext.Provider value={actions}>
      <div className="flex h-full overflow-hidden">
        <div className="hidden lg:flex">{sidebar()}</div>

        {drawerOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0">{sidebar(() => setDrawerOpen(false))}</div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="lg:hidden">
                <IconButton icon={Menu} label={t('nav.menu')} onClick={() => setDrawerOpen(true)} />
              </span>
              <span className="truncate text-meta text-text-3">{identity.branding.productName}</span>
            </div>
            <IconButton
              icon={PanelRight}
              label={t('chat.inside')}
              active={insideOpen}
              onClick={() => setInsideOpen((value) => !value)}
            />
          </header>

          {noticeOpen ? (
            <div className="border-b border-border bg-surface px-3 py-2 sm:px-4 sm:py-3">
              <div className="mx-auto flex max-w-chat items-start gap-2">
                <Shield size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium text-text sm:whitespace-normal">
                    {t('notice.transparencyTitle')}
                  </p>
                  {/* Phones get a one-line summary; the full policy text is one tap away. */}
                  <p className="mt-0.5 text-meta text-text-2 sm:hidden">
                    {noticeExpanded ? identity.transparency_notice : t('notice.transparencySummary')}{' '}
                    <button
                      type="button"
                      className="whitespace-nowrap text-brand"
                      onClick={() => setNoticeExpanded((value) => !value)}
                    >
                      {t('notice.details')}
                      {noticeExpanded ? (
                        <ChevronUp size={12} strokeWidth={2} className="inline" aria-hidden />
                      ) : (
                        <ChevronDown size={12} strokeWidth={2} className="inline" aria-hidden />
                      )}
                    </button>
                  </p>
                  <p className="mt-0.5 hidden text-meta text-text-2 sm:block">
                    {identity.transparency_notice}
                  </p>
                </div>
                <Button
                  variant="quiet"
                  className="shrink-0"
                  onClick={() => {
                    localStorage.setItem(noticeKey, '1');
                    setNoticeOpen(false);
                  }}
                >
                  {t('notice.dismiss')}
                </Button>
              </div>
            </div>
          ) : null}

          <main className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <div ref={threadRef} className="mx-auto w-full max-w-chat space-y-5">
              {chat.messages.length === 0 ? (
                <EmptyState
                  name={firstName(identity.name)}
                  starters={identity.starters}
                  agents={identity.agents}
                  onPick={(text) => send(text)}
                />
              ) : (
                chat.messages.map((message) =>
                  message.role === 'user' ? (
                    <UserMessage key={message.key} message={message} />
                  ) : (
                    <AssistantMessage
                      key={message.key}
                      message={message}
                      agents={identity.agents}
                      selected={selectedKey === message.key}
                      onInspect={() => {
                        setSelectedKey(message.key);
                        setInsideOpen(true);
                      }}
                    />
                  ),
                )
              )}
            </div>
          </main>

          <div className="border-t border-border px-4 py-3">
            <div className="mx-auto w-full max-w-chat">
              <Composer streaming={chat.streaming} onSend={send} onStop={chat.stop} />
            </div>
          </div>
        </div>

        {insideOpen ? (
          <div className="hidden lg:flex">
            <InsidePanel message={selected} onClose={() => setInsideOpen(false)} />
          </div>
        ) : null}

        {insideOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setInsideOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[78%] overflow-hidden rounded-t-panel border-t border-border bg-panel">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-ui font-medium text-text">{t('inside.title')}</h2>
                <IconButton icon={X} label={t('inside.close')} onClick={() => setInsideOpen(false)} />
              </div>
              <div className="scroll-thin max-h-[calc(78vh-52px)] overflow-y-auto">
                <InsideContent message={selected} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ChatActionsContext.Provider>
  );
}

function EmptyState({
  name,
  starters,
  agents,
  onPick,
}: {
  name: string;
  starters: string[];
  agents: { id: string; name: string; description: string; icon: string }[];
  onPick: (text: string) => void;
}): JSX.Element {
  return (
    <section className="space-y-6 pt-6">
      <div>
        <h1 className="text-headline font-semibold text-text">{t('chat.greeting', { name })}</h1>
        <p className="text-chat text-text-2">{t('chat.greetingSub')}</p>
      </div>

      {starters.length ? (
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-text-3">
            {t('chat.starters')}
          </p>
          <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
            {starters.map((starter) => (
              <Chip key={starter} onClick={() => onPick(starter)}>
                {starter}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-meta font-medium uppercase tracking-wide text-text-3">
          {t('chat.agents')}
        </p>
        <ul className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {agents.map((agent) => {
            const Icon = agentIcon(agent.icon);
            return (
              <li key={agent.id} className="flex items-start gap-2">
                <Icon size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-meta text-text-2">{agent.name}</span>
                  <span className="line-clamp-2 block text-[11px] leading-4 text-text-3">
                    {agent.description}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
