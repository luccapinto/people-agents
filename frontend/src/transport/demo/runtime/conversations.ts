/** Conversation persistence (owner only, mirroring the RLS policies on app.conversations). */
import { maskPii, maskStructure } from '../guardrails/pii';
import { uuid } from '../data/store';

export interface ConversationRow {
  id: string;
  owner_id: string;
  title: string;
  playground_agent: string | null;
  sensitive: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  owner_id: string;
  role: 'user' | 'assistant';
  content: string;
  redacted: boolean;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface UsageRow {
  id: number;
  ts: string;
  employee_id: string;
  unit_id: string;
  conversation_id: string;
  agent_ids: string[];
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  resolved: boolean;
}

export interface FeedbackRow {
  message_id: string;
  employee_id: string;
  agent_id: string | null;
  rating: number;
  created_at: string;
}

export interface UnansweredRow {
  agent_id: string | null;
  question: string;
  created_at: string;
}

export class ConversationStore {
  readonly conversations: ConversationRow[] = [];
  readonly messages: MessageRow[] = [];
  readonly usage: UsageRow[] = [];
  readonly feedback: FeedbackRow[] = [];
  readonly unanswered: UnansweredRow[] = [];
  private usageSeq = 0;

  ensure(owner: string, conversationId: string | null, playground: string | null = null): [string, boolean] {
    if (conversationId) {
      const row = this.conversations.find((c) => c.id === conversationId && c.owner_id === owner);
      if (row) return [row.id, false];
    }
    const now = new Date().toISOString();
    const row: ConversationRow = {
      id: uuid(),
      owner_id: owner,
      title: 'Nova conversa',
      playground_agent: playground,
      sensitive: false,
      created_at: now,
      updated_at: now,
    };
    this.conversations.push(row);
    return [row.id, true];
  }

  add(
    owner: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    payload: Record<string, unknown> | null = null,
    redacted = false,
  ): string {
    const [stored] = maskPii(content);
    const row: MessageRow = {
      id: uuid(),
      conversation_id: conversationId,
      owner_id: owner,
      role,
      content: stored,
      redacted: redacted || stored !== content,
      payload: maskStructure(payload ?? {}),
      created_at: new Date().toISOString(),
    };
    this.messages.push(row);
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (conv) conv.updated_at = row.created_at;
    return row.id;
  }

  setTitle(owner: string, conversationId: string, title: string, sensitive = false): void {
    const conv = this.conversations.find((c) => c.id === conversationId && c.owner_id === owner);
    if (!conv) return;
    conv.title = title.slice(0, 80);
    conv.sensitive = conv.sensitive || sensitive;
  }

  history(owner: string, conversationId: string, limit = 8): { role: string; content: string }[] {
    const rows = this.messages.filter((m) => m.conversation_id === conversationId && m.owner_id === owner);
    return rows.slice(-limit).map((m) => ({ role: m.role, content: m.content }));
  }

  /** Specialists that answered the previous assistant turn (for follow-up questions). */
  lastAgents(owner: string, conversationId: string): string[] {
    const rows = this.messages.filter(
      (m) => m.conversation_id === conversationId && m.owner_id === owner && m.role === 'assistant',
    );
    const payload = rows.length ? rows[rows.length - 1].payload : {};
    return [...((payload.agents as string[] | undefined) ?? [])];
  }

  list(owner: string): ConversationRow[] {
    return this.conversations
      .filter((c) => c.owner_id === owner)
      .slice()
      .sort((a, b) => (a.updated_at > b.updated_at ? -1 : a.updated_at < b.updated_at ? 1 : 0))
      .slice(0, 50);
  }

  messagesOf(conversationId: string): MessageRow[] {
    return this.messages
      .filter((m) => m.conversation_id === conversationId)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }

  recentUserMessages(owner: string, seconds = 60): number {
    const cutoff = Date.now() - seconds * 1000;
    return this.messages.filter((m) => m.owner_id === owner && m.role === 'user' && Date.parse(m.created_at) > cutoff)
      .length;
  }

  tokensToday(owner: string): number {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.usage
      .filter((u) => u.employee_id === owner && Date.parse(u.ts) > startOfDay.getTime())
      .reduce((sum, u) => sum + u.prompt_tokens + u.completion_tokens, 0);
  }

  recordUsage(
    owner: string,
    unit: string,
    conversationId: string,
    agents: string[],
    usage: { model: string; prompt_tokens: number; completion_tokens: number; cost_usd: number },
    resolved: boolean,
  ): void {
    this.usageSeq += 1;
    this.usage.push({
      id: this.usageSeq,
      ts: new Date().toISOString(),
      employee_id: owner,
      unit_id: unit,
      conversation_id: conversationId,
      agent_ids: agents,
      model: usage.model || 'none',
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cost_usd: usage.cost_usd,
      resolved,
    });
  }

  /** A usage row of the synthetic history (runtime/history.ts), with its own timestamp. */
  importUsage(row: Omit<UsageRow, 'id'>): void {
    this.usageSeq += 1;
    this.usage.push({ id: this.usageSeq, ...row });
  }

  recordUnanswered(_owner: string, agentId: string, question: string): void {
    this.unanswered.push({
      agent_id: agentId,
      question: maskPii(question)[0].slice(0, 500),
      created_at: new Date().toISOString(),
    });
  }

  recordFeedback(messageId: string, employeeId: string, agentId: string | null, rating: number): void {
    this.feedback.push({
      message_id: messageId,
      employee_id: employeeId,
      agent_id: agentId,
      rating,
      created_at: new Date().toISOString(),
    });
  }

  reset(): void {
    this.conversations.length = 0;
    this.messages.length = 0;
    this.usage.length = 0;
    this.feedback.length = 0;
    this.unanswered.length = 0;
    this.usageSeq = 0;
  }
}
