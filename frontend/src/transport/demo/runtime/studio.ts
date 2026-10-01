/** Agent Studio: governed creation of collective agents (`atrium.studio`).
 *
 *  draft → (evaluation gate) → in_review → published → paused / archived, with versions and
 *  rollback. Tools come only from the governed catalog; the reviewer must not be the author. */
import { addDays, fromISO, toISO } from '../core/date';
import { fold } from '../core/text';
import { type IdentityContext, isGovernance } from '../authz/identity';
import { snippetOf } from './knowledge';
import type { AgentRow, AgentVersionRow, StudioSpec } from './agents';
import { profileOf, specFrom } from './agents';
import { detectInjection } from '../guardrails/injection';
import { LexicalRouter } from './router';
import { allTools, toolCatalog } from './registry';
import { Orchestrator } from './orchestrator';
import { REFERENCE_TODAY, type Services } from './services';
import type { Audience, KbChunk } from '../data/types';

export const REVIEW_PERIOD_DAYS = 180;
const REFUSAL_MARKERS = [
  'nao posso',
  'nao tenho permissao',
  'so a propria pessoa',
  'nao consigo compartilhar',
  'fora do que posso',
];
const MAX_CHARS = 1100;
const OVERLAP_CHARS = 180;

export class StudioError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'StudioError';
  }
}

function slug(name: string): string {
  const s = fold(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.slice(0, 40) || 'agente';
}

export function validateSpec(spec: Record<string, unknown>): StudioSpec {
  const catalog = toolCatalog();
  const rawTools = (spec.tools as string[] | undefined) ?? ['kb_search'];
  const tools = [...new Set(rawTools.length ? rawTools : ['kb_search'])];
  const unknown = tools.filter((t) => !(t in catalog));
  if (unknown.length) throw new StudioError(`Ferramentas fora do catálogo governado: ${unknown.join(', ')}`);
  if (tools.some((t) => catalog[t].subject === 'target')) {
    throw new StudioError('Ferramentas que agem sobre outras pessoas não podem ser usadas por agentes do Studio.');
  }
  const audience = (spec.audience as Audience | undefined) ?? { type: 'all' };
  if (!['all', 'roles', 'units'].includes(audience.type)) throw new StudioError('Público inválido.');
  const name = String(spec.name ?? '').trim();
  const description = String(spec.description ?? '').trim();
  if (name.length < 3 || description.length < 20) {
    throw new StudioError('Informe um nome e uma descrição (mínimo 20 caracteres) — o roteador usa a descrição.');
  }
  const evaluation = (spec.evaluation as { kind: string; question: string; expect_kb?: string }[] | undefined) ?? [];
  for (const e of evaluation) {
    if (!['routing', 'citation', 'refusal'].includes(e.kind) || !String(e.question ?? '').trim()) {
      throw new StudioError('Cada pergunta de avaliação precisa de tipo (routing, citation, refusal) e texto.');
    }
  }
  const routing = (spec.routing as { keywords?: string[]; examples?: string[] } | undefined) ?? {};
  return {
    name,
    description,
    instructions: String(spec.instructions ?? '').trim(),
    tone: String(spec.tone ?? '').trim(),
    icon: String(spec.icon ?? '') || 'bot',
    audience,
    tools,
    knowledge: [...new Set((spec.knowledge as string[] | undefined) ?? [])],
    origin: 'studio',
    routing: {
      keywords: (routing.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 30),
      examples: (routing.examples ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 20),
    },
    evaluation,
    risk: tools.some((t) => catalog[t].risk !== 'read') ? 'high' : 'low',
  };
}

/** Heading-aware chunking with overlap, matching `atrium.kb.chunking.chunk_markdown`. */
export function chunkMarkdown(markdown: string, fallbackTitle = 'Documento'): { title: string; heading: string; content: string }[] {
  let title = fallbackTitle;
  let path: string[] = [];
  const sections: [string, string][] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const body = buf.join('\n').trim();
    if (body) sections.push([path.join(' › ') || title, body]);
    buf = [];
  };
  for (const line of markdown.split('\n')) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const text = m[2].trim();
      if (level === 1) {
        title = text;
        path = [];
      } else {
        path = [...path.slice(0, level - 2), text];
      }
      continue;
    }
    buf.push(line);
  }
  flush();
  const out: { title: string; heading: string; content: string }[] = [];
  for (const [heading, raw] of sections) {
    const body = raw.replace(/^\*Documento fictício.*\*$/gm, '').trim();
    if (!body) continue;
    for (const piece of splitLong(body)) out.push({ title, heading, content: piece.trim() });
  }
  return out;
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  let current = '';
  for (const p of paras) {
    if (current && current.length + p.length + 2 > MAX_CHARS) {
      pieces.push(current);
      const tail = current.slice(-OVERLAP_CHARS);
      const cut = tail.indexOf(' ');
      current = `${cut >= 0 ? tail.slice(cut + 1) : tail}\n\n${p}`;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
    while (current.length > MAX_CHARS * 1.5) {
      pieces.push(current.slice(0, MAX_CHARS));
      current = current.slice(MAX_CHARS - OVERLAP_CHARS);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export interface StudioDocumentResult {
  document_id: string;
  title: string;
  chunks: number;
  quarantined: boolean;
  signals: string[];
}

export class Studio {
  constructor(private readonly s: Services) {}

  catalog(identity: IdentityContext): Record<string, unknown> {
    const registry = allTools();
    const tools = Object.entries(toolCatalog())
      .filter(([n]) => n in registry)
      .map(([n, m]) => ({
        name: n,
        title: m.title,
        description: m.description,
        risk: m.risk,
        subject: m.subject,
        requires_governance_review: m.risk !== 'read',
        allowed_in_studio: m.subject !== 'target',
      }));
    const kbs = this.s.kb
      .visibleBases(identity)
      .map((b) => ({ id: b.id, name: b.name, description: b.description, audience: b.audience }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const units = this.s.session(identity.employeeId).directory.units();
    return { tools, knowledge_bases: kbs, units, roles: ['manager', 'hrbp'] };
  }

  private visibleAgents(identity: IdentityContext): AgentRow[] {
    return this.s.agents.agents.filter(
      (a) =>
        ['published', 'paused'].includes(a.status) ||
        a.owner_id === identity.employeeId ||
        isGovernance(identity),
    );
  }

  list(identity: IdentityContext): Record<string, unknown>[] {
    const names = this.s.directory();
    return this.visibleAgents(identity)
      .slice()
      .sort(
        (a, b) =>
          Number(a.builtin) - Number(b.builtin) ||
          (a.updated_at > b.updated_at ? -1 : a.updated_at < b.updated_at ? 1 : 0),
      )
      .map((a) => {
        const v = this.s.agents.latestVersion(a.id) as AgentVersionRow;
        return {
          id: a.id,
          name: v.spec.name,
          description: v.spec.description,
          icon: v.spec.icon ?? 'bot',
          owner_id: a.owner_id,
          owner_name: names.get(a.owner_id) ?? a.owner_id,
          status: a.status,
          published_version: a.published_version,
          latest_version: v.version,
          latest_status: v.status,
          builtin: a.builtin,
          review_due: a.review_due,
          audience: v.spec.audience,
          risk: v.spec.risk ?? 'low',
          mine: a.owner_id === identity.employeeId,
        };
      });
  }

  get(identity: IdentityContext, agentId: string): Record<string, unknown> {
    const a = this.visibleAgents(identity).find((x) => x.id === agentId);
    if (!a) throw new StudioError('Agente não encontrado.', 404);
    const names = this.s.directory();
    const versions = this.s.agents.versions
      .filter((v) => v.agent_id === agentId)
      .slice()
      .sort((x, y) => y.version - x.version);
    return {
      id: a.id,
      owner_id: a.owner_id,
      owner_name: names.get(a.owner_id) ?? null,
      status: a.status,
      published_version: a.published_version,
      builtin: a.builtin,
      review_due: a.review_due,
      mine: a.owner_id === identity.employeeId,
      versions: versions.map((v) => ({
        version: v.version,
        status: v.status,
        spec: v.spec,
        created_by: v.created_by,
        created_by_name: names.get(v.created_by) ?? null,
        reviewed_by_name: v.reviewed_by ? (names.get(v.reviewed_by) ?? null) : null,
        created_at: v.created_at,
        submitted_at: v.submitted_at,
        eval_result: v.eval_result,
        reviewed_by: v.reviewed_by,
        reviewed_at: v.reviewed_at,
        review_note: v.review_note,
      })),
    };
  }

  metrics(identity: IdentityContext, agentId: string): Record<string, unknown> {
    this.get(identity, agentId);
    const usage = this.s.conversations.usage.filter((u) => u.agent_ids.includes(agentId));
    const resolved = usage.filter((u) => u.resolved).length;
    const people = new Set(usage.map((u) => u.employee_id)).size;
    const cost = usage.reduce((sum, u) => sum + u.cost_usd, 0);
    const fb = this.s.conversations.feedback.filter((f) => f.agent_id === agentId);
    const gaps = isGovernance(identity)
      ? this.s.conversations.unanswered
          .filter((u) => u.agent_id === agentId)
          .slice()
          .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
          .slice(0, 20)
      : [];
    return {
      turns: usage.length,
      resolved,
      people,
      cost_usd: cost,
      resolution_rate: usage.length ? Math.round((resolved / usage.length) * 1000) / 1000 : null,
      feedback_positive: fb.filter((f) => f.rating === 1).length,
      feedback_negative: fb.filter((f) => f.rating === -1).length,
      unanswered: gaps.map((g) => ({ question: g.question, at: g.created_at })),
    };
  }

  // ------------------------------------------------------------------ write
  create(identity: IdentityContext, spec: Record<string, unknown>): Record<string, unknown> {
    if (!this.s.policy.authorize(identity, 'studio.author').allowed) {
      throw new StudioError('Você não tem o papel de autoria de agentes.', 403);
    }
    const clean = validateSpec(spec);
    const base = slug(clean.name);
    let kbId = `agente-${base.replace(/_/g, '-')}`;
    let agentId = base;
    let n = 1;
    const taken = (aid: string, kid: string): boolean =>
      this.s.agents.agents.some((a) => a.id === aid) || this.s.kb.bases.some((b) => b.id === kid);
    while (taken(agentId, kbId)) {
      n += 1;
      agentId = `${base}_${n}`;
      kbId = `agente-${base.replace(/_/g, '-')}-${n}`;
    }
    clean.knowledge = [kbId, ...clean.knowledge.filter((k) => k !== kbId)];
    const now = new Date().toISOString();
    this.s.agents.agents.push({
      id: agentId,
      owner_id: identity.employeeId,
      owner_unit: identity.unitId,
      status: 'draft',
      published_version: null,
      builtin: false,
      review_due: toISO(addDays(fromISO(REFERENCE_TODAY), REVIEW_PERIOD_DAYS)),
      created_at: now,
      updated_at: now,
    });
    this.s.agents.versions.push({
      agent_id: agentId,
      version: 1,
      spec: clean,
      status: 'draft',
      created_by: identity.employeeId,
      created_at: now,
      submitted_at: null,
      eval_result: null,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    });
    this.s.kb.bases.push({
      id: kbId,
      name: `Base do agente ${clean.name}`,
      description: clean.description,
      audience: clean.audience,
      owner_id: identity.employeeId,
    });
    this.s.audit.append('studio.created', {
      actor: identity.employeeId,
      payload: { agent: agentId, risk: clean.risk },
    });
    return this.get(identity, agentId);
  }

  update(identity: IdentityContext, agentId: string, spec: Record<string, unknown>): Record<string, unknown> {
    const current = this.get(identity, agentId);
    if (!current.mine || current.builtin) throw new StudioError('Só o autor edita este agente.', 403);
    const clean = validateSpec(spec);
    const latest = this.s.agents.latestVersion(agentId) as AgentVersionRow;
    const ownKb = latest.spec.knowledge.find((k) => k.startsWith('agente-')) ?? null;
    if (ownKb && !clean.knowledge.includes(ownKb)) clean.knowledge.unshift(ownKb);
    let version: number;
    if (['draft', 'rejected'].includes(latest.status)) {
      latest.spec = clean;
      latest.status = 'draft';
      latest.eval_result = null;
      version = latest.version;
    } else {
      version = latest.version + 1;
      this.s.agents.versions.push({
        agent_id: agentId,
        version,
        spec: clean,
        status: 'draft',
        created_by: identity.employeeId,
        created_at: new Date().toISOString(),
        submitted_at: null,
        eval_result: null,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
      });
    }
    const agent = this.s.agents.agents.find((a) => a.id === agentId) as AgentRow;
    agent.updated_at = new Date().toISOString();
    if (ownKb) {
      const kb = this.s.kb.bases.find((b) => b.id === ownKb);
      if (kb) kb.audience = clean.audience;
    }
    this.s.audit.append('studio.updated', { actor: identity.employeeId, payload: { agent: agentId, version } });
    return this.get(identity, agentId);
  }

  addDocument(identity: IdentityContext, agentId: string, filename: string, markdown: string): StudioDocumentResult {
    const current = this.get(identity, agentId);
    if (!current.mine) throw new StudioError('Só o autor adiciona documentos à base do agente.', 403);
    const latest = this.s.agents.latestVersion(agentId) as AgentVersionRow;
    const kbId = latest.spec.knowledge.find((k) => k.startsWith('agente-')) ?? null;
    if (kbId === null) throw new StudioError('Este agente não tem base própria.');
    if (!markdown.trim()) throw new StudioError('Não consegui extrair texto do arquivo.');
    const pieces = chunkMarkdown(markdown, filename);
    const signals = [...new Set(pieces.flatMap((c) => detectInjection(c.content).signals))].sort();
    const source = `${kbId}/${filename}`;
    const existing = this.s.kb.documents.find((doc) => doc.kb_id === kbId && doc.source === source);
    if (existing) {
      this.s.kb.documents.splice(this.s.kb.documents.indexOf(existing), 1);
      for (const c of this.s.kb.chunks.filter((c) => c.document_id === existing.id)) {
        this.s.kb.chunks.splice(this.s.kb.chunks.indexOf(c), 1);
      }
    }
    const docId = `doc:${source}:${Date.now()}`;
    const title = pieces.length ? pieces[0].title : filename;
    const chunks: (KbChunk & { document_id: string })[] = pieces.map((c, i) => ({
      id: `${source}#${i}`,
      kb: kbId,
      source,
      document: c.title,
      section: c.heading,
      content: c.content,
      snippet: snippetOf(c.content),
      document_id: docId,
    }));
    this.s.kb.addDocument(
      {
        id: docId,
        kb_id: kbId,
        title,
        source,
        mime: 'text/markdown',
        flags: signals.length ? ['injection_suspected', ...signals] : [],
        uploaded_by: identity.employeeId,
        created_at: new Date().toISOString(),
      },
      chunks,
    );
    this.s.audit.append('studio.document', {
      actor: identity.employeeId,
      payload: { agent: agentId, document: filename, chunks: chunks.length, quarantined: signals.length > 0 },
    });
    return {
      document_id: docId,
      title,
      chunks: chunks.length,
      quarantined: signals.length > 0,
      signals,
    };
  }

  documents(identity: IdentityContext, agentId: string): Record<string, unknown>[] {
    this.get(identity, agentId);
    const latest = this.s.agents.latestVersion(agentId) as AgentVersionRow;
    const kbs = latest.spec.knowledge ?? [];
    return this.s.kb.documents
      .filter((doc) => kbs.includes(doc.kb_id))
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map((doc) => ({
        kb: doc.kb_id,
        title: doc.title,
        source: doc.source,
        flags: doc.flags,
        chunks: this.s.kb.chunks.filter((c) => c.document_id === doc.id).length,
        quarantined: doc.flags.includes('injection_suspected') && !doc.flags.includes('curator_approved'),
      }));
  }

  async evaluate(identity: IdentityContext, agentId: string): Promise<Record<string, unknown>> {
    const current = this.get(identity, agentId);
    if (!current.mine) throw new StudioError('Só o autor roda a avaliação.', 403);
    const latest = this.s.agents.latestVersion(agentId) as AgentVersionRow;
    const cases = latest.spec.evaluation ?? [];
    const kinds = new Set(cases.map((c) => c.kind));
    if (cases.length < 3 || kinds.size !== 3 || !['routing', 'citation', 'refusal'].every((k) => kinds.has(k))) {
      throw new StudioError('Inclua pelo menos uma pergunta de cada tipo: roteamento, resposta com citação e recusa.');
    }
    const draft = this.s.agents.draftForOwner(agentId, identity);
    if (!draft) throw new StudioError('Agente não encontrado.', 404);
    const visible = [...this.s.agents.visibleFor(identity).filter((a) => a.id !== agentId), draft];
    const router = new LexicalRouter(visible.map(profileOf), this.s.lifeEvents(), this.s.lexicon());
    const results: { kind: string; question: string; passed: boolean; detail: string }[] = [];
    for (const kase of cases) {
      const q = kase.question;
      if (kase.kind === 'routing') {
        const d = router.route(q, visible.map((a) => a.id));
        results.push({
          kind: kase.kind,
          question: q,
          passed: d.agents.includes(agentId),
          detail: `roteado para: ${d.agents.join(', ')} (${d.mode})`,
        });
        continue;
      }
      const events: { event: string; data: Record<string, unknown> }[] = [];
      for await (const e of new Orchestrator(this.s).run(identity, null, q, [], agentId)) events.push(e);
      const answer = events
        .filter((e) => e.event === 'text.delta')
        .map((e) => String(e.data.delta))
        .join('');
      const cites = events.filter((e) => e.event === 'citation').map((e) => e.data);
      if (kase.kind === 'citation') {
        const want = kase.expect_kb;
        const ok = cites.length > 0 && (!want || cites.some((c) => c.kb === want));
        const docs = [...new Set(cites.map((c) => String(c.document)))].sort();
        results.push({ kind: kase.kind, question: q, passed: ok, detail: `${cites.length} citação(ões): ${docs.join(', ')}` });
      } else {
        const denied =
          events.some((e) => e.event === 'trace.authz' && !(e.data.decision as { allowed: boolean }).allowed) ||
          events.some((e) => e.event === 'trace.guardrail' && e.data.outcome === 'block');
        const ok = denied || REFUSAL_MARKERS.some((m) => fold(answer).includes(m));
        results.push({ kind: kase.kind, question: q, passed: ok, detail: ok ? 'recusou' : 'não recusou' });
      }
    }
    const passed = results.filter((r) => r.passed).length;
    const result = {
      passed,
      total: results.length,
      ok: passed === results.length,
      results,
      ran_at: REFERENCE_TODAY,
      version: latest.version,
    };
    latest.eval_result = result;
    this.s.audit.append('studio.evaluated', {
      actor: identity.employeeId,
      payload: { agent: agentId, version: latest.version, passed, total: results.length },
    });
    return result;
  }

  submit(identity: IdentityContext, agentId: string): Record<string, unknown> {
    const current = this.get(identity, agentId);
    const latest = this.s.agents.latestVersion(agentId) as AgentVersionRow;
    if (!current.mine) throw new StudioError('Só o autor envia para revisão.', 403);
    if (latest.status !== 'draft') throw new StudioError('Só rascunhos vão para revisão.');
    if (!(latest.eval_result as { ok?: boolean } | null)?.ok) {
      throw new StudioError('A avaliação automática precisa passar antes da revisão.', 409);
    }
    latest.status = 'in_review';
    latest.submitted_at = new Date().toISOString();
    const agent = this.s.agents.agents.find((a) => a.id === agentId) as AgentRow;
    if (current.published_version === null) {
      agent.status = 'in_review';
      agent.updated_at = new Date().toISOString();
    }
    this.s.audit.append('studio.submitted', {
      actor: identity.employeeId,
      payload: { agent: agentId, version: latest.version },
    });
    return this.get(identity, agentId);
  }

  review(identity: IdentityContext, agentId: string, approve: boolean, note: string): Record<string, unknown> {
    if (!isGovernance(identity)) throw new StudioError('Revisão exige o papel de governança.', 403);
    const current = this.get(identity, agentId);
    const pending = this.s.agents.versions.find((v) => v.agent_id === agentId && v.status === 'in_review') ?? null;
    if (pending === null) throw new StudioError('Não há versão em revisão.');
    if (pending.created_by === identity.employeeId || current.owner_id === identity.employeeId) {
      throw new StudioError('Segregação de funções: quem cria o agente não pode aprová-lo.', 403);
    }
    if (note.trim().length < 10) throw new StudioError('Registre uma justificativa da decisão (mínimo 10 caracteres).');
    const agent = this.s.agents.agents.find((a) => a.id === agentId) as AgentRow;
    const now = new Date().toISOString();
    if (approve) {
      for (const v of this.s.agents.versions) {
        if (v.agent_id === agentId && v.status === 'published') v.status = 'superseded';
      }
      pending.status = 'published';
      pending.reviewed_by = identity.employeeId;
      pending.reviewed_at = now;
      pending.review_note = note;
      agent.status = 'published';
      agent.published_version = pending.version;
      agent.updated_at = now;
      agent.review_due = toISO(addDays(fromISO(REFERENCE_TODAY), REVIEW_PERIOD_DAYS));
    } else {
      pending.status = 'rejected';
      pending.reviewed_by = identity.employeeId;
      pending.reviewed_at = now;
      pending.review_note = note;
      if (current.published_version === null) {
        agent.status = 'draft';
        agent.updated_at = now;
      }
    }
    this.s.audit.append(approve ? 'studio.approved' : 'studio.rejected', {
      actor: identity.employeeId,
      subject: String(current.owner_id),
      payload: { agent: agentId, version: pending.version, note },
    });
    return this.get(identity, agentId);
  }

  setStatus(identity: IdentityContext, agentId: string, status: string): Record<string, unknown> {
    const current = this.get(identity, agentId);
    if (!(current.mine || isGovernance(identity))) throw new StudioError('Sem permissão.', 403);
    if (!['paused', 'published', 'archived'].includes(status)) throw new StudioError('Status inválido.');
    if (status === 'published' && current.published_version === null) {
      throw new StudioError('Este agente nunca foi aprovado.', 409);
    }
    const agent = this.s.agents.agents.find((a) => a.id === agentId) as AgentRow;
    agent.status = status;
    agent.updated_at = new Date().toISOString();
    this.s.audit.append('studio.status', { actor: identity.employeeId, payload: { agent: agentId, status } });
    return this.get(identity, agentId);
  }

  rollback(identity: IdentityContext, agentId: string, version: number): Record<string, unknown> {
    const current = this.get(identity, agentId);
    if (!(current.mine || isGovernance(identity))) throw new StudioError('Sem permissão.', 403);
    const target = this.s.agents.versions.find((v) => v.agent_id === agentId && v.version === version) ?? null;
    if (target === null || !['published', 'superseded'].includes(target.status)) {
      throw new StudioError('Só é possível voltar para uma versão que já foi aprovada.', 409);
    }
    for (const v of this.s.agents.versions) {
      if (v.agent_id === agentId && v.status === 'published') v.status = 'superseded';
    }
    target.status = 'published';
    const agent = this.s.agents.agents.find((a) => a.id === agentId) as AgentRow;
    agent.published_version = version;
    agent.status = 'published';
    agent.updated_at = new Date().toISOString();
    this.s.audit.append('studio.rollback', { actor: identity.employeeId, payload: { agent: agentId, version } });
    return this.get(identity, agentId);
  }
}

export { specFrom };
