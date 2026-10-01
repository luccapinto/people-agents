/** Proposals: the only path from a model's intent to a write (`atrium.runtime.proposals`).
 *
 *  A write tool returns a draft; this service stores it with a random 256-bit token (only the
 *  SHA-256 hash is kept) and streams the token to the client. `confirm` checks owner, token,
 *  status, expiry, single use and (for sensitive actions) a fresh step-up, then re-authorizes
 *  and runs the tool's executor. */
import type { IdentityContext } from '../authz/identity';
import { uuid } from '../data/store';
import { type ProposalDraft, ToolContext, ToolError, type Tool } from './tool';
import type { Services } from './services';

export const PROPOSAL_TTL_MS = 15 * 60 * 1000;
export const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

export class ProposalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ProposalError';
  }
}

export interface ProposalRow {
  id: string;
  actor_id: string;
  subject_id: string;
  tool: string;
  agent_id: string;
  args: Record<string, unknown>;
  summary: string;
  details: { label: string; value: string }[];
  risk: string;
  token_hash: string;
  status: string;
  conversation_id: string | null;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
  result: Record<string, unknown> | null;
}

export interface PublicProposal {
  id: string;
  token?: string;
  tool: string;
  title: string;
  agent_id: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: string;
  step_up_required: boolean;
  expires_at: string;
  status: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenUrlsafe(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class ProposalService {
  readonly rows: ProposalRow[] = [];
  readonly stepUps = new Map<string, number>();

  constructor(private readonly s: Services) {}

  async create(ctx: ToolContext, t: Tool, draft: ProposalDraft): Promise<PublicProposal> {
    const token = tokenUrlsafe(32);
    const subject = draft.subjectId ?? ctx.identity.employeeId;
    const now = Date.now();
    const row: ProposalRow = {
      id: uuid(),
      actor_id: ctx.identity.employeeId,
      subject_id: subject,
      tool: t.name,
      agent_id: ctx.agentId,
      args: draft.args,
      summary: draft.summary,
      details: draft.details,
      risk: t.risk,
      token_hash: await sha256Hex(token),
      status: 'pending',
      conversation_id: ctx.conversationId,
      created_at: now,
      expires_at: now + PROPOSAL_TTL_MS,
      decided_at: null,
      result: null,
    };
    this.rows.push(row);
    this.s.audit.append('proposal.created', {
      actor: ctx.identity.employeeId,
      subject,
      conversation: ctx.conversationId,
      request: ctx.identity.requestId,
      payload: { proposal: row.id, tool: t.name, risk: t.risk, summary: draft.summary },
    });
    return {
      id: row.id,
      token,
      tool: t.name,
      title: t.title,
      agent_id: ctx.agentId,
      summary: draft.summary,
      details: draft.details,
      risk: t.risk,
      step_up_required: t.risk === 'sensitive',
      expires_at: new Date(row.expires_at).toISOString(),
      status: 'pending',
    };
  }

  async confirm(identity: IdentityContext, proposalId: string, token: string): Promise<Record<string, unknown>> {
    const row = this.rows.find((p) => p.id === proposalId && p.actor_id === identity.employeeId);
    if (!row) {
      this.reject(identity, proposalId, 'not_found');
      throw new ProposalError('not_found', 'Proposta não encontrada para esta pessoa.', 404);
    }
    if (row.token_hash !== (await sha256Hex(token || ''))) {
      this.reject(identity, proposalId, 'invalid_token');
      throw new ProposalError('invalid_token', 'Token de confirmação inválido.', 403);
    }
    if (row.status !== 'pending') {
      this.reject(identity, proposalId, 'already_used');
      throw new ProposalError('already_used', 'Esta proposta já foi usada ou cancelada.', 409);
    }
    if (row.expires_at < Date.now()) {
      this.reject(identity, proposalId, 'expired');
      throw new ProposalError('expired', 'A proposta expirou. Peça novamente ao assistente.', 410);
    }
    if (row.risk === 'sensitive') {
      const at = this.stepUps.get(identity.employeeId) ?? 0;
      if (at <= Date.now() - STEP_UP_MAX_AGE_MS) {
        throw new ProposalError('step_up_required', 'Confirme sua identidade para concluir esta ação sensível.', 401);
      }
    }
    row.status = 'executed';
    row.decided_at = Date.now();

    const t = this.s.tools()[row.tool];
    const ctx = new ToolContext(identity, this.s, row.agent_id, row.conversation_id);
    ctx.subjectId = row.subject_id;
    const decision = t.subject !== 'none' ? this.s.policy.authorize(identity, t.action, row.subject_id) : null;
    if (decision && !decision.allowed) {
      this.finalize(identity, row, 'failed', { error: decision.reason });
      throw new ProposalError('denied', decision.reason, 403);
    }
    let result;
    try {
      if (!t.executor) throw new ToolError('Ferramenta sem executor.');
      result = t.executor(ctx, row.args);
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      this.finalize(identity, row, 'failed', { error: message });
      throw new ProposalError('failed', message, 422);
    }
    const outcome = { summary: result.summary, data: result.data, card: result.card ?? null };
    this.finalize(identity, row, 'executed', outcome);
    if (row.risk === 'sensitive') {
      this.s.audit.append('security.alert', {
        actor: identity.employeeId,
        subject: row.subject_id,
        payload: { reason: 'sensitive_action_executed', tool: row.tool, proposal: row.id },
      });
    }
    return { id: row.id, status: 'executed', ...outcome };
  }

  cancel(identity: IdentityContext, proposalId: string): Record<string, unknown> {
    const row = this.rows.find((p) => p.id === proposalId && p.actor_id === identity.employeeId && p.status === 'pending');
    if (!row) throw new ProposalError('not_found', 'Proposta não encontrada ou já decidida.', 404);
    row.status = 'cancelled';
    row.decided_at = Date.now();
    this.s.audit.append('proposal.cancelled', { actor: identity.employeeId, payload: { proposal: proposalId } });
    return { id: proposalId, status: 'cancelled' };
  }

  private finalize(identity: IdentityContext, row: ProposalRow, status: string, result: Record<string, unknown>): void {
    row.status = status;
    row.result = result;
    this.s.audit.append(`proposal.${status}`, {
      actor: identity.employeeId,
      subject: row.subject_id,
      conversation: row.conversation_id,
      payload: { proposal: row.id, tool: row.tool, result: JSON.stringify(result).slice(0, 300) },
    });
  }

  private reject(identity: IdentityContext, proposalId: string, code: string): void {
    this.s.audit.append('proposal.rejected', { actor: identity.employeeId, payload: { proposal: proposalId, code } });
  }

  recordStepUp(identity: IdentityContext): void {
    this.stepUps.set(identity.employeeId, Date.now());
    this.s.audit.append('auth.step_up', { actor: identity.employeeId });
  }

  reset(): void {
    this.rows.length = 0;
    this.stepUps.clear();
  }
}
