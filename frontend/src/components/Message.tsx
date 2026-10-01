import clsx from 'clsx';
import { AlertCircle, Paperclip, PanelRightOpen, Quote, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { CardView } from '@/components/CardView';
import { ProposalCard } from '@/components/ProposalCard';
import { Badge, Chip, IconButton } from '@/components/ui';
import { t } from '@/i18n';
import { agentIcon } from '@/lib/icons';
import { Markdown } from '@/lib/markdown';
import { useChatActions } from '@/state/actions';
import type { ChatMessage } from '@/state/chat';
import { transport } from '@/transport';
import type { AgentInfo, Citation } from '@/transport/types';

export function UserMessage({ message }: { message: ChatMessage }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1">
        <div className="rounded-panel rounded-br-sm bg-brand-soft px-4 py-2.5 text-chat text-text">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {message.attachments.length ? (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((file) => (
              <li key={file.upload_id}>
                <Badge>
                  <Paperclip size={11} strokeWidth={2} aria-hidden />
                  {file.filename}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function CitationChip({ citation }: { citation: Citation }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-control border border-border bg-panel px-2 py-1 text-meta text-text-2 transition-colors hover:border-brand hover:text-brand"
      >
        <Quote size={11} strokeWidth={2} aria-hidden />
        {citation.document}
        <span className="text-text-3">· {citation.section}</span>
      </button>
      {open ? (
        <span className="absolute bottom-full left-0 z-30 mb-2 block w-[min(420px,80vw)] rounded-card border border-border bg-panel p-3 text-meta text-text-2 shadow-pop">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-3">
            {t('citation.source')}: {citation.kb}
          </span>
          <span className="mt-1 block whitespace-pre-wrap">{citation.snippet}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 text-meta text-brand"
          >
            {t('citation.close')}
          </button>
        </span>
      ) : null}
    </span>
  );
}

export function AssistantMessage({
  message,
  agents,
  selected,
  onInspect,
  readOnly,
}: {
  message: ChatMessage;
  agents: AgentInfo[];
  selected: boolean;
  onInspect: () => void;
  /** Audited transcript view: no feedback, no inspector, just the answer as it was given. */
  readOnly?: boolean;
}): JSX.Element {
  const { send } = useChatActions();
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const hasTrace =
    message.trace.route !== null ||
    message.trace.tools.length > 0 ||
    message.trace.guardrails.length > 0;

  return (
    <article
      className={clsx(
        'space-y-3 rounded-panel border px-4 py-3 transition-colors',
        selected ? 'border-brand/50 bg-panel' : 'border-transparent',
      )}
    >
      {message.agents.length ? (
        <div className="flex flex-wrap gap-1.5">
          {message.agents.map((agent) => {
            const Icon = agentIcon(byId.get(agent.id)?.icon);
            return (
              <Badge key={agent.id} tone="brand">
                <Icon size={11} strokeWidth={2} aria-hidden />
                {agent.name}
              </Badge>
            );
          })}
        </div>
      ) : null}

      {message.content ? (
        <Markdown text={message.content} />
      ) : message.streaming ? (
        <p className="text-chat text-text-3">{t('chat.thinking')}</p>
      ) : null}

      {/* The life-event summary arrives last (after its steps) but reads best first. */}
      {[...message.cards].sort((a, b) => Number(b.type === 'life_event') - Number(a.type === 'life_event')).map((card, i) => (
        <CardView
          key={`${card.type}-${i}`}
          card={card}
          agentName={card.agent_id ? byId.get(card.agent_id)?.name : undefined}
        />
      ))}

      {message.proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}

      {message.citations.length ? (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((citation) => (
            <CitationChip key={citation.id} citation={citation} />
          ))}
        </div>
      ) : null}

      {message.suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {message.suggestions.map((item, i) => (
            <Chip key={i} onClick={() => send(item)}>
              {item}
            </Chip>
          ))}
        </div>
      ) : null}

      {message.error ? (
        <p className="flex items-start gap-2 rounded-card border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-ui text-bad">
          <AlertCircle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-medium">{t('chat.errorTitle')}: </strong>
            {message.error.message}
          </span>
        </p>
      ) : null}

      {!readOnly && !message.streaming && (hasTrace || message.serverId) ? (
        <footer className="flex items-center gap-1 pt-1">
          {hasTrace ? (
            <button
              type="button"
              onClick={onInspect}
              className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-meta text-text-3 transition-colors hover:bg-surface hover:text-text"
            >
              <PanelRightOpen size={14} strokeWidth={1.75} aria-hidden />
              {t('chat.inside')}
            </button>
          ) : null}
          {message.serverId ? (
            <>
              <IconButton
                icon={ThumbsUp}
                label={t('chat.feedbackUp')}
                active={rating === 1}
                onClick={() => {
                  setRating(1);
                  void transport.feedback(message.serverId!, 1, message.agents[0]?.id);
                }}
              />
              <IconButton
                icon={ThumbsDown}
                label={t('chat.feedbackDown')}
                active={rating === -1}
                onClick={() => {
                  setRating(-1);
                  void transport.feedback(message.serverId!, -1, message.agents[0]?.id);
                }}
              />
            </>
          ) : null}
          {rating ? <span className="text-meta text-text-3">{t('chat.feedbackThanks')}</span> : null}
        </footer>
      ) : null}
    </article>
  );
}
