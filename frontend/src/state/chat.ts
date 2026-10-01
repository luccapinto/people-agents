import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { transport } from '@/transport';
import type {
  Card,
  Citation,
  ConversationSummary,
  MessageTrace,
  Proposal,
  StoredMessage,
  Usage,
} from '@/transport/types';

export interface AgentRef {
  id: string;
  name: string;
}

export interface ChatMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: { upload_id: string; filename: string }[];
  agents: AgentRef[];
  cards: Card[];
  citations: Citation[];
  proposals: Proposal[];
  suggestions: string[];
  trace: MessageTrace;
  usage: Usage | null;
  error: { code: string; message: string } | null;
  streaming: boolean;
  serverId: string | null;
}

function emptyTrace(): MessageTrace {
  return { guardrails: [], route: null, authz: null, tools: [], agents: [] };
}

function blankAssistant(key: string): ChatMessage {
  return {
    key,
    role: 'assistant',
    content: '',
    attachments: [],
    agents: [],
    cards: [],
    citations: [],
    proposals: [],
    suggestions: [],
    trace: emptyTrace(),
    usage: null,
    error: null,
    streaming: true,
    serverId: null,
  };
}

/** Rebuild the rendered view of a past conversation from stored message payloads. */
export function fromStored(messages: StoredMessage[], agentName: (id: string) => string): ChatMessage[] {
  return messages.map((message) => {
    const payload = message.payload ?? {};
    if (message.role === 'user') {
      return {
        ...blankAssistant(message.id),
        role: 'user' as const,
        content: message.content,
        attachments: payload.attachments ?? [],
        streaming: false,
        serverId: message.id,
      };
    }
    const trace = payload.trace ?? emptyTrace();
    return {
      key: message.id,
      role: 'assistant' as const,
      content: message.content,
      attachments: [],
      agents: (payload.agents ?? trace.agents ?? []).map((id) => ({ id, name: agentName(id) })),
      cards: payload.cards ?? [],
      citations: payload.citations ?? [],
      proposals: payload.proposals ?? [],
      suggestions: payload.suggestions ?? [],
      trace: {
        guardrails: trace.guardrails ?? [],
        route: trace.route ?? null,
        authz: trace.authz ?? null,
        tools: trace.tools ?? [],
        agents: trace.agents ?? [],
      },
      usage: payload.usage ?? null,
      error: null,
      streaming: false,
      serverId: message.id,
    };
  });
}

export interface SendOptions {
  attachments?: { upload_id: string; filename: string }[];
}

/** `playgroundAgent` pins every turn to one Studio draft (Agent Studio playground). */
export function useChat(agentName: (id: string) => string, playgroundAgent?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);

  const refreshConversations = useCallback(() => {
    transport
      .conversations()
      .then(setConversations)
      .catch(() => undefined);
  }, []);

  useEffect(refreshConversations, [refreshConversations]);

  const patchLast = useCallback((apply: (message: ChatMessage) => ChatMessage) => {
    setMessages((current) => {
      if (!current.length) return current;
      const next = current.slice();
      next[next.length - 1] = apply(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string, options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      const stamp = `${Date.now()}`;
      setMessages((current) => [
        ...current,
        {
          ...blankAssistant(`u-${stamp}`),
          role: 'user',
          content: trimmed,
          attachments: options.attachments ?? [],
          streaming: false,
        },
        blankAssistant(`a-${stamp}`),
      ]);
      try {
        const stream = transport.chat(
          {
            message: trimmed,
            conversation_id: conversationRef.current ?? undefined,
            attachments: options.attachments?.map((a) => a.upload_id),
            playground_agent: playgroundAgent,
          },
          controller.signal,
        );
        for await (const event of stream) {
          switch (event.event) {
            case 'message.start':
              conversationRef.current = event.data.conversation_id;
              setConversationId(event.data.conversation_id);
              break;
            case 'trace.guardrail':
              patchLast((m) => ({
                ...m,
                trace: { ...m.trace, guardrails: [...m.trace.guardrails, event.data] },
              }));
              break;
            case 'trace.route':
              patchLast((m) => ({ ...m, trace: { ...m.trace, route: event.data } }));
              break;
            case 'trace.authz':
              patchLast((m) => ({ ...m, trace: { ...m.trace, authz: event.data } }));
              break;
            case 'agent.start':
              patchLast((m) => ({
                ...m,
                agents: m.agents.some((a) => a.id === event.data.agent_id)
                  ? m.agents
                  : [...m.agents, { id: event.data.agent_id, name: event.data.agent_name }],
                trace: { ...m.trace, agents: [...m.trace.agents, event.data.agent_id] },
              }));
              break;
            case 'trace.tool':
              patchLast((m) => ({
                ...m,
                trace: { ...m.trace, tools: [...m.trace.tools, event.data] },
              }));
              break;
            case 'card':
              patchLast((m) => ({
                ...m,
                cards: [...m.cards, { ...event.data.card, agent_id: event.data.agent_id }],
              }));
              break;
            case 'citation':
              patchLast((m) => ({
                ...m,
                citations: m.citations.some((c) => c.id === event.data.id)
                  ? m.citations
                  : [...m.citations, event.data],
              }));
              break;
            case 'proposal':
              patchLast((m) => ({ ...m, proposals: [...m.proposals, event.data] }));
              break;
            case 'text.delta':
              patchLast((m) => ({ ...m, content: m.content + event.data.delta }));
              break;
            case 'suggestions':
              patchLast((m) => ({ ...m, suggestions: event.data.items }));
              break;
            case 'usage':
              patchLast((m) => ({ ...m, usage: event.data }));
              break;
            case 'message.end':
              patchLast((m) => ({ ...m, serverId: event.data.message_id, streaming: false }));
              break;
            case 'error':
              patchLast((m) => ({ ...m, error: event.data, streaming: false }));
              break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          patchLast((m) => ({
            ...m,
            error: {
              code: 'transport',
              message: error instanceof Error ? error.message : t('chat.errorTitle'),
            },
            streaming: false,
          }));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        patchLast((m) => (m.streaming ? { ...m, streaming: false } : m));
        refreshConversations();
      }
    },
    [patchLast, refreshConversations, playgroundAgent],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    patchLast((m) => (m.streaming ? { ...m, streaming: false } : m));
  }, [patchLast]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      conversationRef.current = id;
      setConversationId(id);
      const stored = await transport.messages(id);
      setMessages(fromStored(stored, agentName));
    },
    [agentName],
  );

  return {
    messages,
    conversationId,
    conversations,
    streaming,
    send,
    stop,
    newConversation,
    openConversation,
    refreshConversations,
  };
}
