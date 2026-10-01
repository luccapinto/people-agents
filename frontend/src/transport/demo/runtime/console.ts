/** Governance console data, built from the demo's own audit log, usage records and policies. */
import { type IdentityContext, isGovernance } from '../authz/identity';
import { K_ANONYMITY_FLOOR } from '../authz/policy';
import { SYNTHETIC_MODEL } from './history';
import type { Services } from './services';

export class ConsoleError extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = 'ConsoleError';
  }
}

export const POLICY_RULES: Record<string, ['enabled' | 'value', 'boolean' | 'number' | 'string' | 'list']> = {
  manager_can_view_team_compensation: ['enabled', 'boolean'],
  k_anonymity_min: ['value', 'number'],
  retention_days: ['value', 'number'],
  dlp_secrets_mode: ['value', 'string'],
  dlp_customer_data_mode: ['value', 'string'],
  blocked_topics: ['value', 'list'],
  user_daily_token_budget: ['value', 'number'],
  user_rate_limit_per_minute: ['value', 'number'],
  transcript_grant_minutes: ['value', 'number'],
};

const SECURITY_TYPES = [
  'tool.denied',
  'authz.denied',
  'security.alert',
  'guardrail.output_blocked',
  'guardrail.injection',
  'chat.sensitive',
  'proposal.executed',
  'proposal.rejected',
  'transcript.access',
];

function requireGovernance(identity: IdentityContext): void {
  if (!isGovernance(identity)) throw new ConsoleError('Requer o papel de administração de governança.');
}

export class ConsoleService {
  constructor(private readonly s: Services) {}

  overview(identity: IdentityContext): Record<string, unknown> {
    requireGovernance(identity);
    const usage = this.s.conversations.usage;
    const turns = usage.length;
    const resolved = usage.filter((u) => u.resolved).length;
    const units = new Map(this.s.store.units.map((u) => [u.id, u.name]));
    const agentNames = new Map<string, string>();
    for (const a of this.s.agents.agents) {
      const v = this.s.agents.latestVersion(a.id);
      if (v) agentNames.set(a.id, v.spec.name);
    }
    const byAgent = new Map<string, { turns: number; resolved: number; cost: number; tokens: number }>();
    for (const u of usage) {
      for (const a of u.agent_ids) {
        const row = byAgent.get(a) ?? { turns: 0, resolved: 0, cost: 0, tokens: 0 };
        row.turns += 1;
        if (u.resolved) row.resolved += 1;
        row.cost += u.cost_usd;
        row.tokens += u.prompt_tokens + u.completion_tokens;
        byAgent.set(a, row);
      }
    }
    const byUnit = new Map<string, { turns: number; cost: number }>();
    for (const u of usage) {
      const row = byUnit.get(u.unit_id) ?? { turns: 0, cost: 0 };
      row.turns += 1;
      row.cost += u.cost_usd;
      byUnit.set(u.unit_id, row);
    }
    const feedback = new Map<string, number>();
    for (const f of this.s.conversations.feedback) {
      if (f.agent_id) feedback.set(f.agent_id, (feedback.get(f.agent_id) ?? 0) + f.rating);
    }
    const securityEvents: Record<string, number> = {};
    for (const e of this.s.audit.events) {
      if (SECURITY_TYPES.includes(e.type)) securityEvents[e.type] = (securityEvents[e.type] ?? 0) + 1;
    }
    const guardrails = new Map<string, number>();
    for (const e of this.s.audit.events) {
      if (e.type !== 'guardrail.input') continue;
      for (const o of (e.payload.outcomes as { name: string; outcome: string }[] | undefined) ?? []) {
        const key = `${o.name}|${o.outcome}`;
        guardrails.set(key, (guardrails.get(key) ?? 0) + 1);
      }
    }
    return {
      window_days: 30,
      synthetic_turns: usage.filter((u) => u.model === SYNTHETIC_MODEL).length,
      totals: {
        turns,
        people: new Set(usage.map((u) => u.employee_id)).size,
        conversations: new Set(usage.map((u) => u.conversation_id)).size,
        tokens: usage.reduce((sum, u) => sum + u.prompt_tokens + u.completion_tokens, 0),
        cost_usd: usage.reduce((sum, u) => sum + u.cost_usd, 0),
        resolution_rate: turns ? Math.round((resolved / turns) * 1000) / 1000 : null,
      },
      by_agent: [...byAgent.entries()]
        .sort((a, b) => b[1].turns - a[1].turns)
        .map(([agent, r]) => ({
          agent,
          name: agentNames.get(agent) ?? agent,
          turns: r.turns,
          resolved: r.resolved,
          cost_usd: r.cost,
          tokens: r.tokens,
          feedback: feedback.get(agent) ?? 0,
        })),
      by_unit: [...byUnit.entries()]
        .sort((a, b) => b[1].turns - a[1].turns)
        .map(([unit, r]) => ({ unit: units.get(unit) ?? unit, turns: r.turns, cost_usd: r.cost })),
      security_events: securityEvents,
      guardrails: [...guardrails.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => {
          const [name, outcome] = key.split('|');
          return { name, outcome, count };
        }),
      unanswered: this.s.conversations.unanswered
        .slice()
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
        .slice(0, 15)
        .map((u) => ({ agent: agentNames.get(u.agent_id ?? '') ?? u.agent_id ?? '', question: u.question, at: u.created_at })),
    };
  }

  audit(identity: IdentityContext, q: { type?: string; before?: number }): Record<string, unknown> {
    requireGovernance(identity);
    const names = this.s.directory();
    const types: Record<string, number> = {};
    for (const e of this.s.audit.events) types[e.type] = (types[e.type] ?? 0) + 1;
    const events = this.s.audit.events
      .filter((e) => (!q.type || e.type.startsWith(q.type)) && (!q.before || e.id < q.before))
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        ts: e.ts,
        type: e.type,
        actor: e.actor_id,
        actor_name: e.actor_id ? (names.get(e.actor_id) ?? null) : null,
        subject: e.subject_id,
        subject_name: e.subject_id ? (names.get(e.subject_id) ?? null) : null,
        conversation: e.conversation_id,
        request: e.request_id,
        payload: e.payload,
        hash: e.hash,
        prev_hash: e.prev_hash,
      }));
    return { events, types };
  }

  async verify(identity: IdentityContext): Promise<Record<string, unknown>> {
    requireGovernance(identity);
    const result = await this.s.audit.verify();
    this.s.audit.append('audit.verified', { actor: identity.employeeId, payload: { ...result } });
    await this.s.audit.flush();
    return result;
  }

  policies(identity: IdentityContext): Record<string, unknown>[] {
    requireGovernance(identity);
    const names = this.s.directory();
    return this.s.store.policyStore.all().map((p) => ({
      key: p.key,
      value: p.value,
      description: p.description,
      updated_by: p.updated_by ? (names.get(p.updated_by) ?? null) : null,
      updated_at: p.updated_at,
    }));
  }

  updatePolicy(identity: IdentityContext, key: string, value: unknown): Record<string, unknown> {
    requireGovernance(identity);
    const rule = POLICY_RULES[key];
    if (!rule) throw new ConsoleError('unknown policy', 404);
    const [field, kind] = rule;
    const typeOk =
      (kind === 'boolean' && typeof value === 'boolean') ||
      (kind === 'number' && typeof value === 'number' && Number.isInteger(value)) ||
      (kind === 'string' && typeof value === 'string') ||
      (kind === 'list' && Array.isArray(value));
    if (!typeOk) throw new ConsoleError(`${key} expects ${kind}`, 422);
    if (key === 'k_anonymity_min' && (value as number) < K_ANONYMITY_FLOOR) {
      throw new ConsoleError(`k-anonimato não pode ser menor que ${K_ANONYMITY_FLOOR}`, 422);
    }
    if (key === 'retention_days' && ((value as number) < 30 || (value as number) > 3650)) {
      throw new ConsoleError('retenção entre 30 e 3650 dias', 422);
    }
    if (key.startsWith('dlp_') && !['warn', 'block'].includes(value as string)) {
      throw new ConsoleError('modo deve ser warn ou block', 422);
    }
    if (kind === 'number' && (value as number) < 1) throw new ConsoleError('valor deve ser positivo', 422);
    const row = this.s.store.policies.get(key);
    if (!row) throw new ConsoleError('unknown policy', 404);
    const old = row.value;
    row.value = { [field]: value };
    row.updated_by = identity.employeeId;
    row.updated_at = new Date().toISOString();
    this.s.audit.append('policy.changed', {
      actor: identity.employeeId,
      payload: { key, old, new: { [field]: value } },
    });
    return { key, value: row.value };
  }

  conversations(identity: IdentityContext): Record<string, unknown>[] {
    requireGovernance(identity);
    const units = new Map(this.s.store.units.map((u) => [u.id, u.name]));
    const owners = new Map(this.s.store.employees.map((e) => [e.id, e.unit_id]));
    return this.s.conversations.conversations
      .filter((c) => c.playground_agent === null)
      .slice()
      .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1))
      .slice(0, 100)
      .map((c) => {
        const unitId = owners.get(c.owner_id) ?? '';
        const agents = new Set<string>();
        for (const u of this.s.conversations.usage) {
          if (u.conversation_id === c.id) for (const a of u.agent_ids) agents.add(a);
        }
        return {
          id: c.id,
          unit: units.get(unitId) ?? unitId,
          created_at: c.created_at,
          updated_at: c.updated_at,
          messages: this.s.conversations.messages.filter((m) => m.conversation_id === c.id).length,
          sensitive: c.sensitive,
          agents: [...agents].sort(),
        };
      });
  }

  transcript(identity: IdentityContext, conversationId: string, justification: string): Record<string, unknown> {
    requireGovernance(identity);
    if (justification.trim().length < 20) throw new ConsoleError('justificativa de no mínimo 20 caracteres', 422);
    const conv = this.s.conversations.conversations.find((c) => c.id === conversationId);
    if (!conv) throw new ConsoleError('conversation not found', 404);
    const minutes = Number(this.s.policy.store.value('transcript_grant_minutes', 60));
    this.s.transcriptGrants.push({
      conversation_id: conversationId,
      grantee_id: identity.employeeId,
      justification,
      expires_at: Date.now() + minutes * 60_000,
    });
    this.s.audit.append('transcript.access', {
      actor: identity.employeeId,
      conversation: conversationId,
      payload: { justification, minutes },
    });
    const owner = this.s.store.employee(conv.owner_id);
    return {
      owner: owner ? owner.name : null,
      expires_in_minutes: minutes,
      messages: this.s.conversations.messagesOf(conversationId).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        redacted: m.redacted,
        payload: m.payload,
        created_at: m.created_at,
      })),
    };
  }
}
