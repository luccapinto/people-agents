/** Governance tools (agent: Governança). The same data as the governance console, read in the chat
 *  by the governance role only (tool roles plus the policy engine's governance.read), each card
 *  linking to the console screen that shows it in full (`atrium.tools.governance`). */
import { fixed, pyRound } from '../core/money';
import type { ToolDef } from '../runtime/registry';
import type { ToolContext, ToolResult } from '../runtime/tool';
import { plural } from './util';

const GOVERNANCE = ['governance_admin'];
const WINDOW_DAYS = 30;
const RECENT = 8;
const SECURITY_TYPES = [
  'tool.denied',
  'authz.denied',
  'security.alert',
  'guardrail.output_blocked',
  'guardrail.injection',
  'chat.sensitive',
];
const SECURITY_LABELS: Record<string, [string, string]> = {
  'tool.denied': ['ferramenta negada', 'ferramentas negadas'],
  'authz.denied': ['acesso negado', 'acessos negados'],
  'security.alert': ['alerta de segurança', 'alertas de segurança'],
  'guardrail.output_blocked': ['resposta bloqueada', 'respostas bloqueadas'],
  'guardrail.injection': ['injeção detectada', 'injeções detectadas'],
  'chat.sensitive': ['tema sensível', 'temas sensíveis'],
};
const POLICY_LABELS: Record<string, string> = {
  blocked_topics: 'Tópicos bloqueados',
  dlp_customer_data_mode: 'Dados pessoais em massa',
  dlp_secrets_mode: 'Segredos colados no chat',
  k_anonymity_min: 'Tamanho mínimo de grupo (k-anonimato)',
  manager_can_view_team_compensation: 'Gestores veem remuneração do time',
  retention_days: 'Retenção de conversas (dias)',
  transcript_grant_minutes: 'Acesso justificado a transcrições (minutos)',
  user_daily_token_budget: 'Orçamento diário de tokens por pessoa',
  user_rate_limit_per_minute: 'Mensagens por minuto por pessoa',
};
const MODES: Record<string, string> = { warn: 'avisar', block: 'bloquear' };

/** The policy engine decides again inside the tool, so the refusal is audited with its reason. */
function denied(ctx: ToolContext): ToolResult | null {
  const decision = ctx.services.policy.authorize(ctx.identity, 'governance.read');
  if (decision.allowed) return null;
  return { data: {}, summary: decision.reason, error: decision.reason, decision };
}

function link(tab: string, label: string): { href: string; label: string } {
  return { href: `/console?tab=${tab}`, label };
}

function withinWindow(ts: string): boolean {
  return Date.parse(ts) > Date.now() - WINDOW_DAYS * 86_400_000;
}

export const governanceTools: ToolDef[] = [
  {
    name: 'governance_usage',
    action: 'governance.read',
    roles: GOVERNANCE,
    params: {},
    handler: (ctx): ToolResult => {
      const refused = denied(ctx);
      if (refused) return refused;
      const byAgent = new Map<string, { turns: number; resolved: number; cost: number; tokens: number }>();
      for (const u of ctx.services.conversations.usage) {
        if (!withinWindow(u.ts)) continue;
        for (const a of u.agent_ids) {
          const row = byAgent.get(a) ?? { turns: 0, resolved: 0, cost: 0, tokens: 0 };
          row.turns += 1;
          if (u.resolved) row.resolved += 1;
          row.cost += u.cost_usd;
          row.tokens += u.prompt_tokens + u.completion_tokens;
          byAgent.set(a, row);
        }
      }
      const names = new Map<string, string>();
      for (const a of ctx.services.agents.agents) {
        const v = ctx.services.agents.latestVersion(a.id);
        if (v) names.set(a.id, v.spec.name);
      }
      const rows = [...byAgent.entries()].sort((a, b) => b[1].turns - a[1].turns || (a[0] < b[0] ? -1 : 1));
      const turns = rows.reduce((sum, [, r]) => sum + r.turns, 0);
      const resolved = rows.reduce((sum, [, r]) => sum + r.resolved, 0);
      const cost = rows.reduce((sum, [, r]) => sum + r.cost, 0);
      const table = rows.map(([agent, r]) => [
        names.get(agent) ?? agent,
        r.turns,
        `${pyRound((100 * r.resolved) / r.turns)}%`,
        r.cost,
        r.tokens,
      ]);
      const data = {
        title: `Uso por agente, últimos ${WINDOW_DAYS} dias`,
        columns: ['Agente', 'Interações', 'Resolvidas', 'Custo (US$)', 'Tokens'],
        rows: table,
        money_columns: [],
        usd_columns: [3],
        link: link('overview', 'Abrir a visão geral no console'),
      };
      let summary: string;
      if (!rows.length) {
        summary = `Nenhuma interação registrada nos últimos ${WINDOW_DAYS} dias.`;
      } else {
        const top = table[0];
        summary =
          `Nos últimos ${WINDOW_DAYS} dias foram ${plural(turns, 'interação', 'interações')} com agentes, ` +
          `${pyRound((100 * resolved) / turns)}% resolvidas sem atendimento humano, custo de modelo de US$ ${fixed(cost, 4)}. ` +
          `O agente mais usado foi ${top[0]} (${plural(top[1] as number, 'interação', 'interações')}).`;
      }
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'governance_guardrails',
    action: 'governance.read',
    roles: GOVERNANCE,
    params: {},
    handler: (ctx): ToolResult => {
      const refused = denied(ctx);
      if (refused) return refused;
      const rows = ctx.services.store.policyStore.all().map((p) => {
        const value = 'enabled' in p.value ? p.value.enabled : p.value.value;
        let shown: string;
        if (typeof value === 'boolean') shown = value ? 'ligado' : 'desligado';
        else if (Array.isArray(value)) shown = value.join(', ') || 'nenhum';
        else shown = MODES[String(value)] ?? String(value);
        return [POLICY_LABELS[p.key] ?? p.key, shown];
      });
      const fired = new Map<string, { name: string; outcome: string; count: number }>();
      for (const e of ctx.services.audit.events) {
        if (e.type !== 'guardrail.input' || !withinWindow(e.ts)) continue;
        for (const o of (e.payload.outcomes as { name: string; outcome: string }[] | undefined) ?? []) {
          const key = `${o.name}|${o.outcome}`;
          const row = fired.get(key) ?? { name: o.name, outcome: o.outcome, count: 0 };
          row.count += 1;
          fired.set(key, row);
        }
      }
      const counts = [...fired.values()]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.outcome < b.outcome ? -1 : 1))
        .filter((r) => r.outcome !== 'pass')
        .map((r) => `${r.name} ${MODES[r.outcome] ?? r.outcome}: ${r.count}`);
      const data = {
        title: 'Políticas e guardrails em vigor',
        columns: ['Política', 'Valor'],
        rows,
        link: link('policies', 'Abrir as políticas no console'),
      };
      let summary =
        `Estão em vigor ${plural(rows.length, 'política', 'políticas')} de governança, e os guardrails de entrada ` +
        '(dados pessoais, segredos, injeção de prompt, temas bloqueados e sensíveis) rodam em toda mensagem. ';
      summary += counts.length
        ? `Nos últimos ${WINDOW_DAYS} dias dispararam: ${counts.join('; ')}.`
        : `Nenhum guardrail de entrada disparou nos últimos ${WINDOW_DAYS} dias.`;
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'governance_security_events',
    action: 'governance.read',
    roles: GOVERNANCE,
    params: {},
    handler: (ctx): ToolResult => {
      const refused = denied(ctx);
      if (refused) return refused;
      const byType = new Map<string, number>();
      for (const e of ctx.services.audit.events) {
        if (!SECURITY_TYPES.includes(e.type) || !withinWindow(e.ts)) continue;
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      }
      const counts = [...byType.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const names = ctx.services.directory();
      const rows = ctx.services.audit.events
        .filter((e) => SECURITY_TYPES.includes(e.type))
        .slice()
        .sort((a, b) => b.id - a.id)
        .slice(0, RECENT)
        .map((e) => [
          e.ts.slice(0, 10),
          SECURITY_LABELS[e.type][0],
          e.actor_id ? (names.get(e.actor_id) ?? e.actor_id) : '—',
          `#${e.id}`,
        ]);
      const data = {
        title: 'Eventos de segurança recentes',
        columns: ['Data', 'Evento', 'Pessoa', 'Registro'],
        rows,
        link: link('audit', 'Abrir a trilha de auditoria no console'),
      };
      const summary = counts.length
        ? `Nos últimos ${WINDOW_DAYS} dias a auditoria registrou ` +
          counts.map(([type, n]) => plural(n, ...SECURITY_LABELS[type])).join(', ') +
          '. Cada evento está na trilha encadeada por hash, com quem pediu e o que foi decidido.'
        : `Nenhum evento de segurança nos últimos ${WINDOW_DAYS} dias.`;
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'governance_transcript_access',
    action: 'governance.read',
    roles: GOVERNANCE,
    params: {},
    handler: (ctx): ToolResult => {
      const refused = denied(ctx);
      if (refused) return refused;
      const names = ctx.services.directory();
      const events = ctx.services.audit.events
        .filter((e) => e.type === 'transcript.access')
        .slice()
        .sort((a, b) => b.id - a.id)
        .slice(0, RECENT);
      const table = events.map((e) => [
        e.ts.slice(0, 10),
        e.actor_id ? (names.get(e.actor_id) ?? e.actor_id) : null,
        (e.payload.justification as string | undefined) || '—',
        (e.payload.minutes as number | undefined) ?? null,
      ]);
      const data = {
        title: 'Acessos justificados a transcrições',
        columns: ['Data', 'Quem acessou', 'Justificativa', 'Minutos'],
        rows: table,
        link: link('conversations', 'Abrir as conversas no console'),
      };
      const summary = events.length
        ? `Há ${plural(events.length, 'acesso justificado', 'acessos justificados')} a transcrições registrados; cada um exige ` +
          'uma justificativa, vale por tempo limitado e fica na auditoria.'
        : 'Nenhum acesso a transcrições foi registrado. Todo acesso exige justificativa e fica na auditoria.';
      return { data, summary, card: { type: 'table', data } };
    },
  },
];
