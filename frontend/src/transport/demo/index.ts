/** `DemoTransport`: the whole back-end, in the browser.
 *
 *  Same interface as `HttpTransport`; every call runs the ported engine against the bundled
 *  fictional dataset. Nothing leaves the page. */
import type {
  AgentDetail,
  AgentListItem,
  AgentSpec,
  AuditPage,
  Branding as BrandingContract,
  ChainVerification,
  ChatRequest,
  ConsoleConversation,
  ConsoleOverview,
  ConversationSummary,
  EvaluationResult,
  Me,
  Persona,
  Policy,
  ProposalResult,
  StoredMessage,
  StreamEvent,
  StudioCatalog,
  StudioDocument,
  StudioMetrics,
  StudioUploadResult,
  TranscriptAccess,
  Transport,
  UploadResult,
} from '../types';
import { TransportError } from '../types';
import { toISO } from './core/date';
import { type IdentityContext, loadIdentity, rolesOf, isGovernance, isHrbp, isManager } from './authz/identity';
import { diffDays } from './core/date';
import { loadBranding } from './data/load';
import { uuid } from './data/store';
import { clear as clearStorage, load as loadState, save as saveState } from './persist';
import { publicAgent } from './runtime/agents';
import { ConsoleError, ConsoleService } from './runtime/console';
import { engine, resetEngine } from './runtime/engine';
import { Orchestrator } from './runtime/orchestrator';
import { ProposalError } from './runtime/proposals';
import type { Branding } from './runtime/prompts';
import type { Services } from './runtime/services';
import { Studio, StudioError } from './runtime/studio';
import { SAMPLE_RECEIPT_FILENAME, SAMPLE_RECEIPT_TEXT } from './sample-receipt';

const TOKEN_KEY = 'atrium.token';
const STREAM_DELAY_MS = 12;

function wrapError(exc: unknown): TransportError {
  if (exc instanceof ProposalError) return new TransportError(exc.status, exc.code, exc.message);
  if (exc instanceof StudioError) return new TransportError(exc.status, `studio_${exc.status}`, exc.message);
  if (exc instanceof ConsoleError) return new TransportError(exc.status, `console_${exc.status}`, exc.message);
  const message = exc instanceof Error ? exc.message : String(exc);
  return new TransportError(500, 'demo_error', message);
}

export class DemoTransport implements Transport {
  readonly mode = 'demo' as const;

  private services: Services | null = null;
  private brandingData: Branding | null = null;

  private async engine(): Promise<Services> {
    if (this.services) return this.services;
    this.brandingData ??= (await loadBranding()) as unknown as Branding;
    const s = await engine(this.brandingData);
    loadState(s);
    this.services = s;
    return s;
  }

  private async identity(): Promise<IdentityContext> {
    const s = await this.engine();
    const employeeId = sessionStorage.getItem(TOKEN_KEY);
    if (!employeeId) throw new TransportError(401, 'unauthenticated', 'Entre com uma persona para usar a demonstração.');
    const me = loadIdentity(s.dataset, employeeId);
    if (!me) throw new TransportError(401, 'unauthenticated', 'Persona desconhecida.');
    return me;
  }

  private persist(): void {
    if (this.services) saveState(this.services);
  }

  async personas(): Promise<Persona[]> {
    const s = await this.engine();
    const byId = new Map(s.dataset.employees.map((e) => [e.id, e]));
    return s.dataset.personas.map((p) => ({ ...p, title: byId.get(p.employee_id)?.title ?? '' }));
  }

  async login(employeeId: string): Promise<void> {
    const s = await this.engine();
    if (!s.dataset.personas.some((p) => p.employee_id === employeeId)) {
      throw new TransportError(403, 'forbidden', 'only demo personas can sign in through the development IdP');
    }
    sessionStorage.setItem(TOKEN_KEY, employeeId);
    s.audit.append('auth.login', { actor: employeeId, payload: { idp: 'demo' } });
    this.persist();
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  async me(): Promise<Me> {
    const s = await this.engine();
    const me = await this.identity();
    const agents = s.agents.visibleFor(me).map(publicAgent);
    const roleKey = isGovernance(me)
      ? 'governance'
      : isHrbp(me)
        ? 'hrbp'
        : isManager(me)
          ? 'manager'
          : diffDays(s.today, me.hireDate) <= 90
            ? 'newhire'
            : 'employee';
    const governance = s.companyPolicies().governance as Record<string, string>;
    const notice = governance.transparency_notice.replace('{product}', String(s.branding.productName));
    return {
      employee_id: me.employeeId,
      name: me.name,
      email: me.email,
      title: me.title,
      unit_id: me.unitId,
      roles: rolesOf(me).slice().sort(),
      hire_date: toISO(me.hireDate),
      agents: agents as unknown as Me['agents'],
      starters: s.catalog.agents.starters[roleKey] ?? [],
      transparency_notice: notice,
      branding: s.branding as unknown as BrandingContract,
    };
  }

  async *chat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const s = await this.engine();
    const me = await this.identity();
    const attachments = (req.attachments ?? [])
      .map((id) => s.uploads.find((u) => u.id === id && u.owner_id === me.employeeId))
      .filter(Boolean)
      .map((u) => ({ upload_id: u!.id, filename: u!.filename }));
    const orchestrator = new Orchestrator(s, STREAM_DELAY_MS);
    try {
      for await (const event of orchestrator.run(
        me,
        req.conversation_id ?? null,
        req.message,
        attachments,
        req.playground_agent ?? null,
      )) {
        yield event as unknown as StreamEvent;
      }
    } finally {
      await s.audit.flush();
      this.persist();
    }
  }

  async confirmProposal(id: string, token: string): Promise<ProposalResult> {
    const s = await this.engine();
    const me = await this.identity();
    try {
      const out = await s.proposals.confirm(me, id, token);
      return out as unknown as ProposalResult;
    } catch (exc) {
      throw wrapError(exc);
    } finally {
      await s.audit.flush();
      this.persist();
    }
  }

  async cancelProposal(id: string): Promise<void> {
    const s = await this.engine();
    const me = await this.identity();
    try {
      s.proposals.cancel(me, id);
    } catch (exc) {
      throw wrapError(exc);
    }
    this.persist();
  }

  async stepUpChallenge(): Promise<{ delivery: string; code?: string; message: string }> {
    const me = await this.identity();
    const code = stepUpCode(me.employeeId);
    return {
      delivery: 'demo',
      code,
      message:
        'Em produção o código chega pelo aplicativo autenticador. No ambiente de demonstração ele é exibido aqui.',
    };
  }

  async stepUp(code: string): Promise<void> {
    const s = await this.engine();
    const me = await this.identity();
    if (code !== stepUpCode(me.employeeId)) {
      s.audit.append('auth.step_up_failed', { actor: me.employeeId });
      throw new TransportError(401, 'invalid_code', 'código inválido');
    }
    s.proposals.recordStepUp(me);
    this.persist();
  }

  async conversations(): Promise<ConversationSummary[]> {
    const s = await this.engine();
    const me = await this.identity();
    return s.conversations.list(me.employeeId).map((c) => ({
      id: c.id,
      title: c.title,
      playground_agent: c.playground_agent,
      sensitive: c.sensitive,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
  }

  async messages(conversationId: string): Promise<StoredMessage[]> {
    const s = await this.engine();
    const me = await this.identity();
    const conv = s.conversations.conversations.find((c) => c.id === conversationId && c.owner_id === me.employeeId);
    if (!conv) throw new TransportError(404, 'not_found', 'conversation not found');
    return s.conversations.messagesOf(conversationId).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      redacted: m.redacted,
      payload: m.payload as StoredMessage['payload'],
      created_at: m.created_at,
    }));
  }

  async upload(file: File): Promise<UploadResult> {
    const s = await this.engine();
    const me = await this.identity();
    const isText = file.type.startsWith('text/') || /\.(txt|md)$/i.test(file.name);
    const content = isText ? await file.text() : '';
    const row = {
      id: uuid(),
      owner_id: me.employeeId,
      filename: file.name.slice(0, 120),
      mime: file.type || 'application/octet-stream',
      size_bytes: file.size,
      text_content: content,
      created_at: new Date().toISOString(),
    };
    s.uploads.push(row);
    s.audit.append('upload.created', {
      actor: me.employeeId,
      payload: { upload: row.id, mime: row.mime, bytes: row.size_bytes },
    });
    this.persist();
    return { upload_id: row.id, filename: file.name, size: file.size, readable: Boolean(content.trim()) };
  }

  /** Loads the bundled example receipt as if the person had uploaded it. */
  async uploadSampleReceipt(): Promise<UploadResult> {
    const file = new File([SAMPLE_RECEIPT_TEXT], SAMPLE_RECEIPT_FILENAME, { type: 'text/plain' });
    return this.upload(file);
  }

  async download(path: string, filename: string): Promise<void> {
    const s = await this.engine();
    const me = await this.identity();
    const hr = s.session(me.employeeId);
    const person = hr.directory.get(me.employeeId);
    if (!person) throw new TransportError(404, 'not_found', 'person not found');
    const personInput = {
      id: person.id,
      name: person.name,
      title: person.title,
      hire_date: toISO(person.hire_date),
    };
    const payslipMatch = /\/documents\/payslip\/([^?]+)(?:\?kind=(\w+))?/.exec(path);
    if (payslipMatch) {
      const slip = hr.payroll.payslip(me.employeeId, payslipMatch[1], payslipMatch[2] ?? 'monthly');
      if (!slip) throw new TransportError(404, 'not_found', 'payslip not found');
      s.audit.append('document.download', {
        actor: me.employeeId,
        subject: me.employeeId,
        payload: { kind: 'payslip', month: slip.month },
      });
      // Code-splitting boundary: pdf-lib and the embedded TTF only load when a PDF is asked for.
      const { downloadBlob, payslipPdf } = await import('./pdf');
      downloadBlob(await payslipPdf(s.branding, slip, personInput), filename);
      this.persist();
      return;
    }
    const issuedMatch = /\/documents\/issued\/([^?]+)/.exec(path);
    if (issuedMatch) {
      const doc = hr.documents.get(issuedMatch[1]);
      if (!doc) throw new TransportError(404, 'not_found', 'document not found');
      const privateRecord = hr.directory.private(me.employeeId);
      const figures =
        doc.kind === 'income_statement'
          ? hr.payroll.incomeStatement(me.employeeId, Number(doc.params.year))
          : null;
      s.audit.append('document.download', {
        actor: me.employeeId,
        subject: me.employeeId,
        payload: { kind: doc.kind, id: doc.id },
      });
      // Code-splitting boundary: see above.
      const { downloadBlob, letterPdf } = await import('./pdf');
      downloadBlob(await letterPdf(s.branding, doc, personInput, privateRecord?.cpf ?? '-', figures), filename);
      this.persist();
      return;
    }
    throw new TransportError(404, 'not_found', path);
  }

  async feedback(messageId: string, rating: 1 | -1, agentId?: string): Promise<void> {
    const s = await this.engine();
    const me = await this.identity();
    s.conversations.recordFeedback(messageId, me.employeeId, agentId ?? null, rating);
    this.persist();
  }

  // ------------------------------------------------------------------ governance console
  private async console(): Promise<[ConsoleService, IdentityContext]> {
    const s = await this.engine();
    return [new ConsoleService(s), await this.identity()];
  }

  async consoleOverview(): Promise<ConsoleOverview> {
    const [c, me] = await this.console();
    try {
      return c.overview(me) as unknown as ConsoleOverview;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consoleAudit(q: { type?: string; before?: number }): Promise<AuditPage> {
    const s = await this.engine();
    const [c, me] = await this.console();
    await s.audit.flush();
    try {
      return c.audit(me, q) as unknown as AuditPage;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consoleVerify(): Promise<ChainVerification> {
    const [c, me] = await this.console();
    try {
      const out = await c.verify(me);
      this.persist();
      return out as unknown as ChainVerification;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consolePolicies(): Promise<Policy[]> {
    const [c, me] = await this.console();
    try {
      return c.policies(me) as unknown as Policy[];
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consoleUpdatePolicy(key: string, value: unknown): Promise<{ key: string; value: Record<string, unknown> }> {
    const [c, me] = await this.console();
    try {
      const out = c.updatePolicy(me, key, value);
      this.persist();
      return out as { key: string; value: Record<string, unknown> };
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consoleConversations(): Promise<ConsoleConversation[]> {
    const [c, me] = await this.console();
    try {
      return c.conversations(me) as unknown as ConsoleConversation[];
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async consoleTranscript(id: string, justification: string): Promise<TranscriptAccess> {
    const [c, me] = await this.console();
    try {
      const out = c.transcript(me, id, justification);
      this.persist();
      return out as unknown as TranscriptAccess;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  // ------------------------------------------------------------------ agent studio
  private async studio(): Promise<[Studio, IdentityContext]> {
    const s = await this.engine();
    return [new Studio(s), await this.identity()];
  }

  async studioCatalog(): Promise<StudioCatalog> {
    const [st, me] = await this.studio();
    return st.catalog(me) as unknown as StudioCatalog;
  }

  async studioAgents(): Promise<AgentListItem[]> {
    const [st, me] = await this.studio();
    return st.list(me) as unknown as AgentListItem[];
  }

  async studioAgent(id: string): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      return st.get(me, id) as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioCreate(spec: AgentSpec): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.create(me, spec as unknown as Record<string, unknown>);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioUpdate(id: string, spec: AgentSpec): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.update(me, id, spec as unknown as Record<string, unknown>);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioDocuments(id: string): Promise<StudioDocument[]> {
    const [st, me] = await this.studio();
    try {
      return st.documents(me, id) as unknown as StudioDocument[];
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioUpload(id: string, file: File): Promise<StudioUploadResult> {
    const [st, me] = await this.studio();
    const name = file.name || 'documento.txt';
    if (!/\.(md|txt)$/i.test(name)) {
      throw new TransportError(415, 'unsupported_media_type', 'Na demonstração, envie Markdown ou TXT.');
    }
    try {
      const out = st.addDocument(me, id, name, await file.text());
      this.persist();
      return out;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioEvaluate(id: string): Promise<EvaluationResult> {
    const [st, me] = await this.studio();
    try {
      const out = await st.evaluate(me, id);
      this.persist();
      return out as unknown as EvaluationResult;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioSubmit(id: string): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.submit(me, id);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioReview(id: string, decisionKind: 'approve' | 'reject', note: string): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.review(me, id, decisionKind === 'approve', note);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioStatus(id: string, status: 'paused' | 'published' | 'archived'): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.setStatus(me, id, status);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioRollback(id: string, version: number): Promise<AgentDetail> {
    const [st, me] = await this.studio();
    try {
      const out = st.rollback(me, id, version);
      this.persist();
      return out as unknown as AgentDetail;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  async studioMetrics(id: string): Promise<StudioMetrics> {
    const [st, me] = await this.studio();
    try {
      return st.metrics(me, id) as unknown as StudioMetrics;
    } catch (exc) {
      throw wrapError(exc);
    }
  }

  /** "Reiniciar demo": drops every local mutation and reloads the pristine dataset. */
  reset(): void {
    clearStorage();
    resetEngine();
    this.services = null;
  }
}

/** Deterministic six-digit code, like the development IdP's step-up challenge. */
function stepUpCode(employeeId: string): string {
  let h = 0;
  for (const ch of `atrium-demo:${employeeId}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h % 1_000_000).padStart(6, '0');
}
