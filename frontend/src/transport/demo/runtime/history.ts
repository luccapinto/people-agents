/** Synthetic usage history of the last 30 days (shared/generated/usage-history.json), seeded the way
 *  backend/atrium/seed/history.py seeds it: each record at its day and minute offset before now, so a
 *  freshly opened demo has a console to govern. Everything is fictional and marked (model name
 *  `historico-sintetico`, `synthetic: true` on audit events, "Histórico sintético" titles); what the
 *  visitor does adds on top. Audit events are appended now, the hash chain only grows forward, and
 *  their payload says when they stand for. */
import type { Services } from './services';

/** The model name the synthetic usage rows carry (atrium.seed.history.MODEL). */
export const SYNTHETIC_MODEL = 'historico-sintetico';

export interface UsageHistory {
  note: string;
  model: string;
  days: number;
  usage: {
    days_ago: number;
    minute: number;
    employee_id: string;
    unit_id: string;
    conversation_id: string;
    agent_ids: string[];
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    resolved: boolean;
  }[];
  feedback: { days_ago: number; message_id: string; employee_id: string; agent_id: string; rating: number }[];
  unanswered: { days_ago: number; agent_id: string; question: string }[];
  transcripts: {
    conversation_id: string;
    owner_id: string;
    title: string;
    days_ago: number;
    messages: { role: 'user' | 'assistant'; content: string }[];
    grantee_id: string;
    justification: string;
  }[];
  events: { days_ago: number; type: string; actor: string; conversation?: string; payload: Record<string, unknown> }[];
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export function seedHistory(s: Services, h: UsageHistory, now: Date = new Date()): void {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (daysAgo: number, minute = 12 * 60): Date => new Date(midnight - daysAgo * DAY_MS + minute * MINUTE_MS);
  const store = s.conversations;
  for (const u of h.usage) {
    const { days_ago: daysAgo, minute, ...row } = u;
    store.importUsage({ ...row, ts: at(daysAgo, minute).toISOString() });
  }
  for (const f of h.feedback) {
    store.feedback.push({ message_id: f.message_id, employee_id: f.employee_id, agent_id: f.agent_id, rating: f.rating,
      created_at: at(f.days_ago).toISOString() });
  }
  for (const u of h.unanswered) store.unanswered.push({ agent_id: u.agent_id, question: u.question, created_at: at(u.days_ago).toISOString() });
  for (const t of h.transcripts) {
    const created = at(t.days_ago, 10 * 60);
    store.conversations.push({ id: t.conversation_id, owner_id: t.owner_id, title: t.title, playground_agent: null, sensitive: false,
      created_at: created.toISOString(), updated_at: created.toISOString() });
    t.messages.forEach((m, k) => {
      store.messages.push({ id: `${t.conversation_id}-${k}`, conversation_id: t.conversation_id, owner_id: t.owner_id, role: m.role,
        content: m.content, redacted: false, payload: {}, created_at: new Date(created.getTime() + k * MINUTE_MS).toISOString() });
    });
    const granted = at(t.days_ago - 1, 15 * 60);
    s.transcriptGrants.push({ conversation_id: t.conversation_id, grantee_id: t.grantee_id, justification: t.justification,
      expires_at: granted.getTime() + 60 * MINUTE_MS });
  }
  for (const ev of h.events) {
    s.audit.append(ev.type, { actor: ev.actor, conversation: ev.conversation ?? null,
      payload: { ...ev.payload, synthetic: true, occurred_at: at(ev.days_ago).toISOString().slice(0, 10) } });
  }
}
