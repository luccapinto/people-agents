/** Tools shared by agents: knowledge search, human hand-off, compliance channels. */
import { hitForModel } from '../runtime/knowledge';
import type { ToolDef } from '../runtime/registry';
import { type Citation, type ToolContext, type ToolResult, fail } from '../runtime/tool';

export const commonTools: ToolDef[] = [
  {
    name: 'kb_search',
    action: 'none',
    params: { query: { type: 'str', minLength: 2, maxLength: 300, description: 'O que procurar, em linguagem natural' } },
    handler: (ctx: ToolContext, args): ToolResult => {
      const kbIds = ctx.knowledge.length ? [...ctx.knowledge] : ['corporativo'];
      const hits = ctx.services.kb.search(ctx.identity, String(args.query), kbIds, 4);
      if (!hits.length) {
        return fail('Não encontrei nada sobre isso nas bases de conhecimento.', { query: args.query, kb: kbIds });
      }
      const citations: Citation[] = hits.map((h) => ({
        id: h.chunkId,
        kb: h.kbId,
        document: h.document,
        section: h.section,
        snippet: h.snippet,
        source: h.source,
      }));
      const data = { query: args.query, results: hits.map(hitForModel) };
      const best = hits[0];
      return {
        data,
        summary: `Segundo “${best.document}” (${best.section}): ${best.snippet}`,
        citations,
      };
    },
  },
  {
    name: 'ticket_open',
    action: 'self.ticket.open',
    params: {
      category: { type: 'str', maxLength: 60, description: 'Área responsável (ex.: Benefícios, DP, TI)' },
      summary: { type: 'str', minLength: 5, maxLength: 400, description: 'Resumo do pedido' },
    },
    executor: (ctx, args): ToolResult => {
      const tid = ctx.services.nextTicketId();
      ctx.services.tickets.push({
        id: tid,
        employee_id: ctx.identity.employeeId,
        agent_id: ctx.agentId,
        category: String(args.category),
        summary: String(args.summary),
        status: 'aberto',
        sensitive: ctx.agentId === 'compliance',
        created_at: new Date().toISOString(),
      });
      return {
        data: { ticket_id: tid },
        summary: `Chamado ${tid} aberto para ${args.category}. Você será contatado por e-mail.`,
      };
    },
    handler: (_ctx, args): ToolResult => ({
      data: { category: args.category },
      summary: 'Posso abrir um chamado para o time humano. Confirme no cartão.',
      proposal: {
        summary: `Abrir chamado para ${args.category}`,
        details: [
          { label: 'Área', value: String(args.category) },
          { label: 'Resumo', value: String(args.summary) },
          { label: 'Prazo de resposta', value: 'até 2 dias úteis' },
        ],
        args: { category: args.category, summary: args.summary },
      },
    }),
  },
  {
    name: 'compliance_support_channels',
    action: 'none',
    params: {},
    handler: (ctx): ToolResult => {
      const c = ctx.services.companyPolicies().compliance as Record<string, Record<string, string>> &
        Record<string, string>;
      const ethics = c.ethics_channel as unknown as Record<string, string>;
      const support = c.support_program as unknown as Record<string, string>;
      const emergency = c.emergency as unknown as string;
      const data = {
        channels: [
          {
            kind: 'ethics',
            name: ethics.name,
            url: ethics.url,
            phone: ethics.phone,
            description:
              'Relatos de assédio, discriminação, fraude ou conduta antiética. Pode ser anônimo; a empresa proíbe retaliação.',
          },
          { kind: 'support', name: support.name, phone: support.phone, description: support.description },
          { kind: 'emergency', name: 'Emergência', description: emergency },
        ],
      };
      const summary =
        `Você pode procurar o ${ethics.name} (${ethics.url}, ${ethics.phone}), ` +
        `inclusive de forma anônima, e o ${support.name} (${support.phone}), ` +
        `${support.description}. ${emergency}`;
      return { data, summary, card: { type: 'support_channels', data } };
    },
  },
];
