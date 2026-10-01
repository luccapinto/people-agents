/** Career, onboarding, documents, profile, reimbursement and timekeeping tools. */
import { type Day, addDays, diffDays, fromISO, gt, lt, month, toISO, year } from '../core/date';
import { pyRound } from '../core/money';
import type { ToolDef } from '../runtime/registry';
import { type ToolContext, ToolError, type ToolResult, fail } from '../runtime/tool';
import {
  guideCategory,
  parseReceipt,
  receiptFieldsDict,
  validateReceipt,
} from '../runtime/receipts';
import { MONTHS, d, hours, maskAccount, money, plural } from './util';
import { knowledgeAnswer } from './common';

const BANKS: Record<string, string> = {
  '001': 'Banco Horizonte (fictício)',
  '077': 'Banco Aurora (fictício)',
  '260': 'Banco Pétala (fictício)',
  '341': 'Banco Meridiano (fictício)',
};

function uploadFor(ctx: ToolContext, uploadId: string): { filename: string; text_content: string } {
  const row = ctx.services.uploads.find((u) => u.id === uploadId && u.owner_id === ctx.identity.employeeId);
  if (!row) throw new ToolError('Comprovante não encontrado.');
  return row;
}

const PROBATION_DAYS = 90; // CLT art. 445, parágrafo único: the experience contract lasts at most 90 days
const FOCUS = ['buddy', 'experiencia', 'proximas'];

function probationOf(ctx: ToolContext): [Day, string] {
  const hire = ctx.identity.hireDate;
  const end = addDays(hire, PROBATION_DAYS - 1);
  if (!lt(end, ctx.today)) {
    return [
      end,
      `Seu período de experiência vai até ${d(end)}: são ${PROBATION_DAYS} dias a partir da admissão em ${d(hire)} ` +
        '(CLT, art. 445). Se nada for comunicado até lá, o contrato passa a ser por prazo indeterminado.',
    ];
  }
  return [
    end,
    `Seu período de experiência terminou em ${d(end)}, ${PROBATION_DAYS} dias depois da admissão em ${d(hire)} (CLT, art. 445).`,
  ];
}

export const careerTools: ToolDef[] = [
  {
    name: 'career_overview',
    action: 'self.career.read',
    params: {},
    handler: (ctx): ToolResult => {
      const hr = ctx.hr();
      const catalog = new Map(hr.career.trainings().map((t) => [t.id, t]));
      const assigned = hr.career.assignments(ctx.subjectId as string);
      const cycle = hr.career.reviewCycle();
      const paths = hr.career.learningPaths();
      const pending = assigned
        .filter((a) => a.status === 'pendente')
        .map((a) => ({
          id: a.training_id,
          title: catalog.get(a.training_id)?.title ?? a.training_id,
          hours: catalog.get(a.training_id)?.hours ?? 0,
          due_date: a.due_date ? toISO(a.due_date) : null,
          days_left: a.due_date ? diffDays(a.due_date, ctx.today) : null,
        }));
      pending.sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : (a.due_date ?? '9999') > (b.due_date ?? '9999') ? 1 : 0));
      const done = assigned.filter((a) => a.status !== 'pendente').map((a) => catalog.get(a.training_id)?.title ?? a.training_id);
      const phases = (cycle?.phases ?? []).map((ph) => {
        const s = fromISO(ph.start);
        const e = fromISO(ph.end);
        const state = lt(e, ctx.today) ? 'concluída' : !gt(s, ctx.today) ? 'em andamento' : 'próxima';
        return { ...ph, state };
      });
      const data = {
        pending_trainings: pending,
        completed_trainings: done,
        cycle: { name: cycle?.name ?? null, phases },
        learning_paths: paths.map((p) => ({
          title: p.title,
          description: p.description,
          audience: p.audience,
          steps: p.steps.filter((s) => catalog.has(s)).map((s) => catalog.get(s)!.title),
        })),
      };
      let summary = `Você tem ${plural(pending.length, 'treinamento obrigatório pendente', 'treinamentos obrigatórios pendentes')}`;
      if (pending.length) {
        summary += `; o mais urgente é ${pending[0].title}, até ${d(fromISO(pending[0].due_date as string))}`;
      }
      const nxt = phases.find((p) => p.state !== 'concluída');
      if (nxt) {
        summary += `. No ${data.cycle.name}, a fase ${nxt.label} vai de ${d(fromISO(nxt.start))} a ${d(fromISO(nxt.end))}`;
      }
      return { data, summary: `${summary}.`, card: { type: 'career', data } };
    },
  },
  {
    name: 'career_matching_jobs',
    action: 'self.career.read',
    params: {},
    handler: (ctx): ToolResult => {
      const hr = ctx.hr();
      const skills = new Set(hr.career.skills(ctx.subjectId as string));
      const jobs = hr.career.jobPostings();
      const units = new Map(hr.directory.units().map((u) => [u.id, u.name]));
      const history = hr.payroll.salaryHistory(ctx.subjectId as string);
      const lastChange = history.length ? history[history.length - 1].effective_date : ctx.identity.hireDate;
      const monthsInRole = (year(ctx.today) - year(lastChange)) * 12 + month(ctx.today) - month(lastChange);
      const minMonths = Number((ctx.services.companyPolicies().career as Record<string, number>).internal_mobility_min_months);
      const ranked = jobs
        .filter((j) => !lt(j.closes_at, ctx.today))
        .map((j) => {
          const overlap = j.skills.filter((s) => skills.has(s)).sort();
          return {
            id: j.id,
            title: j.title,
            unit: units.get(j.unit_id) ?? j.unit_id,
            level: j.level,
            skills: j.skills,
            matched: overlap,
            missing: j.skills.filter((s) => !skills.has(s)).sort(),
            score: j.skills.length ? pyRound(overlap.length / j.skills.length, 2) : 0,
            closes_at: toISO(j.closes_at),
          };
        });
      ranked.sort(
        (a, b) =>
          b.score - a.score ||
          (a.closes_at < b.closes_at ? -1 : a.closes_at > b.closes_at ? 1 : 0) ||
          (a.id < b.id ? -1 : 1),
      );
      const top = ranked.filter((r) => r.score > 0).slice(0, 4);
      const eligible = monthsInRole >= minMonths;
      const data = {
        jobs: top,
        skills: [...skills].sort(),
        eligible,
        months_in_role: monthsInRole,
        min_months: minMonths,
        rule: (ctx.services.companyPolicies().career as Record<string, string>).manager_notification,
      };
      if (!top.length) {
        return {
          data,
          summary: 'Não há vagas internas abertas compatíveis com suas habilidades agora.',
          card: { type: 'jobs', data },
        };
      }
      const best = top[0];
      let summary =
        `A vaga mais compatível é ${best.title} (${best.unit}), com ${best.matched.length} de ${best.skills.length} ` +
        `habilidades em comum; inscrições até ${d(fromISO(best.closes_at))}.`;
      if (!eligible) {
        summary += ` Pela política, a candidatura exige ${minMonths} meses na posição atual (você tem ${monthsInRole}).`;
      }
      return { data, summary, card: { type: 'jobs', data } };
    },
  },
  {
    name: 'onboarding_checklist',
    action: 'self.onboarding.read',
    params: {
      focus: {
        type: 'str',
        optional: true,
        default: null,
        description:
          'O campo perguntado: buddy, experiencia (fim do período de experiência) ou ' +
          'proximas (próximas tarefas). Vazio para o resumo do checklist.',
      },
    },
    /** Asked for one field ("quem é meu buddy?"), the answer is that field in one sentence and the
     *  checklist card is the support; otherwise the summary of the checklist. */
    handler: (ctx, args): ToolResult => {
      const raw = args.focus as string | null;
      const focus = raw !== null && FOCUS.includes(raw) ? raw : null;
      const [probationEnd, probation] = probationOf(ctx);
      const hr = ctx.hr();
      const tasks = hr.onboarding.tasks(ctx.subjectId as string);
      const buddy = hr.onboarding.buddy(ctx.subjectId as string);
      if (!tasks.length) {
        if (focus === 'experiencia') {
          // long past onboarding, the question still has an answer
          return { data: { probation_end: toISO(probationEnd) }, summary: probation };
        }
        return fail('Você não tem um checklist de onboarding ativo.');
      }
      const items = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        due_date: toISO(t.due_date),
        status: t.status,
        owner: t.owner,
        overdue: t.status !== 'concluído' && lt(t.due_date, ctx.today),
      }));
      const done = items.filter((t) => t.status === 'concluído').length;
      const nxt = items.filter((t) => t.status !== 'concluído').slice(0, 3);
      const data = {
        items,
        done,
        total: items.length,
        progress: pyRound(done / items.length, 2),
        buddy: buddy ? { name: buddy.name, title: buddy.title, email: buddy.email } : null,
        start_date: toISO(ctx.identity.hireDate),
        probation_end: toISO(probationEnd),
      };
      const upcoming = nxt.map((t) => `${t.title} (até ${d(fromISO(t.due_date))})`).join('; ');
      let summary: string;
      if (focus === 'buddy') {
        summary = buddy
          ? `Seu buddy é ${buddy.name}, ${buddy.title} (${buddy.email}).`
          : 'Você ainda não tem um buddy definido; seu gestor indica um na primeira semana.';
      } else if (focus === 'experiencia') {
        summary = probation;
      } else if (focus === 'proximas') {
        summary = nxt.length ? `Suas próximas tarefas: ${upcoming}.` : 'Você concluiu todas as tarefas do onboarding.';
      } else {
        summary = `Você concluiu ${done} de ${items.length} tarefas do onboarding.`;
        if (nxt.length) summary += ` Próximas: ${upcoming}.`;
        if (buddy) summary += ` Seu buddy é ${buddy.name} (${buddy.title}).`;
      }
      return { data, summary, card: { type: 'checklist', data } };
    },
  },
  {
    name: 'onboarding_complete_task',
    action: 'self.onboarding.change',
    params: { task_id: { type: 'str', description: 'Identificador da tarefa (ex.: ONB-05)' } },
    executor: (ctx, args): ToolResult => {
      const t = ctx.hr().onboarding.completeTask(ctx.identity.employeeId, String(args.task_id));
      return { data: { task_id: t.id }, summary: `Tarefa “${t.title}” marcada como concluída.` };
    },
    handler: (ctx, args): ToolResult => {
      const task = ctx.hr().onboarding.tasks(ctx.identity.employeeId).find((t) => t.id === args.task_id) ?? null;
      if (task === null) return fail('Não encontrei essa tarefa no seu checklist.');
      if (task.status === 'concluído') return fail('Essa tarefa já está concluída.');
      return {
        data: { task_id: task.id },
        summary: 'Confirme para marcar a tarefa como concluída.',
        proposal: {
          summary: `Marcar como concluída: ${task.title}`,
          details: [
            { label: 'Tarefa', value: task.title },
            { label: 'Responsável', value: task.owner },
          ],
          args: { task_id: task.id },
        },
      };
    },
  },
];

function issueDocument(ctx: ToolContext, kind: string, params: Record<string, unknown>, title: string) {
  const doc = ctx.hr().documents.record(ctx.identity.employeeId, kind, params, ctx.today);
  return {
    document_id: doc.id,
    kind,
    title,
    verification_code: doc.verification_code,
    issued_on: toISO(ctx.today),
    pdf_url: `/api/documents/issued/${doc.id}`,
    params,
  };
}

export const documentTools: ToolDef[] = [
  {
    name: 'documents_employment_letter',
    action: 'self.documents.issue',
    params: {
      purpose: { type: 'str', default: 'comprovação de vínculo', maxLength: 120, description: 'Finalidade (ex.: banco, aluguel)' },
    },
    handler: (ctx, args): ToolResult => {
      const data = issueDocument(ctx, 'employment_letter', { purpose: args.purpose }, 'Declaração de vínculo empregatício');
      return {
        data,
        card: { type: 'document', data },
        summary: `Emiti sua declaração de vínculo (${args.purpose}). Código de verificação ${data.verification_code}.`,
      };
    },
  },
  {
    name: 'documents_visa_letter',
    action: 'self.documents.issue',
    params: {
      country: { type: 'str', maxLength: 60, description: 'País de destino' },
      start: { type: 'date', description: 'Início da viagem (AAAA-MM-DD)' },
      end: { type: 'date', description: 'Fim da viagem (AAAA-MM-DD)' },
    },
    handler: (ctx, args): ToolResult => {
      const start = args.start as Day;
      const end = args.end as Day;
      if (lt(end, start)) throw new ToolError('A data de fim da viagem é anterior ao início.');
      const data = issueDocument(
        ctx,
        'visa_letter',
        { country: args.country, start: toISO(start), end: toISO(end) },
        `Carta para visto — ${args.country}`,
      );
      return {
        data,
        card: { type: 'document', data },
        summary:
          `Emiti a carta para o consulado (${args.country}, ${d(start)} a ${d(end)}), ` +
          `com código de verificação ${data.verification_code}.`,
      };
    },
  },
  {
    name: 'documents_income_statement',
    action: 'self.documents.issue',
    params: { year: { type: 'int', default: 2025, description: 'Ano-calendário' } },
    handler: (ctx, args): ToolResult => {
      const st = ctx.hr().payroll.incomeStatement(ctx.subjectId as string, args.year as number);
      if (st === null) return fail(`Não há informe de rendimentos de ${args.year} para você.`);
      const data: Record<string, unknown> = issueDocument(
        ctx,
        'income_statement',
        { year: args.year },
        `Informe de rendimentos ${args.year}`,
      );
      data.figures = { ...st };
      return {
        data,
        card: { type: 'document', data },
        summary:
          `Informe de ${args.year}: rendimentos tributáveis ${money(st.taxable_income)}, INSS ${money(st.inss)}, ` +
          `IRRF ${money(st.irrf)}, 13º de ${money(st.thirteenth_gross)} (tributação exclusiva).`,
      };
    },
  },
];

export const profileTools: ToolDef[] = [
  {
    name: 'profile_get',
    action: 'self.profile.read',
    params: {},
    handler: (ctx): ToolResult => {
      const eid = ctx.subjectId as string;
      const hr = ctx.hr();
      const address = hr.profile.address(eid);
      const bank = hr.profile.bankAccount(eid);
      const deps = hr.benefits.dependents(eid);
      const sections: ({ title: string; items: { label: string; value: string }[] } | null)[] = [
        address
          ? {
              title: 'Endereço',
              items: [
                { label: 'Logradouro', value: `${address.street}, ${address.number} ${address.complement}`.trim() },
                { label: 'Bairro', value: address.district },
                { label: 'Cidade', value: `${address.city}/${address.state}` },
                { label: 'CEP', value: address.zip },
              ],
            }
          : null,
        bank
          ? {
              title: 'Conta para pagamento',
              items: [
                { label: 'Banco', value: `${bank.bank_name} (${bank.bank_code})` },
                { label: 'Agência', value: bank.agency },
                { label: 'Conta', value: maskAccount(bank.account) },
                { label: 'Atualizada em', value: d(bank.updated_at) },
              ],
            }
          : null,
        {
          title: 'Dependentes',
          items: deps.length
            ? deps.map((x) => ({
                label: x.name,
                value: `${x.relationship}, nascimento ${d(x.birth_date)}${x.ir_dependent ? ', dependente no IR' : ''}`,
              }))
            : [{ label: 'Nenhum', value: 'sem dependentes cadastrados' }],
        },
      ];
      const data = { title: 'Meus dados cadastrais', sections: sections.filter(Boolean) };
      let summary = address
        ? `Seu endereço cadastrado é em ${address.district}, ${address.city}/${address.state}`
        : 'Sem endereço cadastrado';
      summary += bank ? `; conta de pagamento no ${bank.bank_name}, final ${bank.account.slice(-3)}` : '';
      summary += deps.length ? `; ${deps.length} dependente(s).` : '; nenhum dependente.';
      return { data, summary, card: { type: 'sections', data } };
    },
  },
  {
    name: 'profile_update_address',
    action: 'self.profile.change',
    params: {
      street: { type: 'str', maxLength: 120 },
      number: { type: 'str', maxLength: 20 },
      complement: { type: 'str', default: '', maxLength: 60 },
      district: { type: 'str', maxLength: 60 },
      city: { type: 'str', maxLength: 60 },
      state: { type: 'str', minLength: 2, maxLength: 2 },
      zip: { type: 'str', pattern: /^\d{5}-?\d{3}$/ },
    },
    executor: (ctx, args): ToolResult => {
      ctx.hr().profile.updateAddress(ctx.identity.employeeId, args as Record<string, string>);
      return {
        data: { updated: true },
        summary: 'Endereço atualizado. Se você usa vale-transporte, revise o trajeto com o DP.',
      };
    },
    handler: (_ctx, args): ToolResult => ({
      data: { valid: true },
      summary: 'Preparei a atualização do endereço para você confirmar.',
      proposal: {
        summary: 'Atualizar endereço residencial',
        details: [
          { label: 'Novo endereço', value: `${args.street}, ${args.number} ${args.complement}`.trim() },
          { label: 'Bairro / cidade', value: `${args.district}, ${args.city}/${String(args.state).toUpperCase()}` },
          { label: 'CEP', value: String(args.zip) },
        ],
        args: { ...args },
      },
    }),
  },
  {
    name: 'profile_add_dependent',
    action: 'self.profile.change',
    params: {
      name: { type: 'str', maxLength: 120 },
      relationship: { type: 'str', description: 'cônjuge, filho(a), enteado(a), pai, mãe' },
      birth_date: { type: 'date' },
      ir_dependent: { type: 'bool', default: true, description: 'Incluir como dependente no IR' },
    },
    executor: (ctx, args): ToolResult => {
      const eid = ctx.identity.employeeId;
      const born = fromISO(String(args.birth_date));
      const hr = ctx.hr();
      const existing =
        hr.benefits
          .dependents(eid)
          .find((x) => x.birth_date.getTime() === born.getTime() && x.relationship === args.relationship) ?? null;
      let depId: string;
      if (existing) {
        hr.benefits.setIrDependent(eid, existing.id, args.ir_dependent as boolean);
        depId = existing.id;
      } else {
        depId = hr.benefits.addDependent(
          eid,
          String(args.name),
          String(args.relationship),
          born,
          args.ir_dependent as boolean,
          false,
          args.relationship === 'filho(a)' ? 'aguardando certidão' : 'active',
        ).id;
      }
      return {
        data: { dependent_id: depId },
        summary: `Dependente incluído no cadastro${args.ir_dependent ? ' e no IR.' : '.'}`,
      };
    },
    handler: (_ctx, args): ToolResult => ({
      data: { valid: true },
      summary:
        'Como dependente no IR, a base do IRRF mensal diminui R$ 189,59. Confirme a inclusão no cartão.',
      proposal: {
        summary: `Incluir ${args.name} como dependente`,
        details: [
          { label: 'Nome', value: String(args.name) },
          { label: 'Parentesco', value: String(args.relationship) },
          { label: 'Nascimento', value: d(args.birth_date as Day) },
          {
            label: 'Dependente no IR',
            value: args.ir_dependent ? 'sim (dedução de R$ 189,59 por mês no IRRF)' : 'não',
          },
        ],
        args: { ...args, birth_date: toISO(args.birth_date as Day) },
      },
    }),
  },
  {
    name: 'profile_update_bank_account',
    action: 'self.profile.change_bank',
    params: {
      bank_code: { type: 'str', pattern: /^\d{3}$/, description: 'Código do banco (3 dígitos)' },
      agency: { type: 'str', pattern: /^\d{3,5}$/ },
      account: { type: 'str', pattern: /^\d{4,12}-?[\dxX]$/ },
    },
    executor: (ctx, args): ToolResult => {
      ctx.hr().profile.updateBankAccount(
        ctx.identity.employeeId,
        {
          bank_code: String(args.bank_code),
          bank_name: BANKS[String(args.bank_code)] ?? `Banco ${args.bank_code}`,
          agency: String(args.agency),
          account: String(args.account),
          type: 'corrente',
        },
        ctx.today,
      );
      return {
        data: { updated: true },
        summary:
          'Conta bancária atualizada. O time de Segurança foi notificado e você receberá um e-mail de confirmação.',
      };
    },
    handler: (ctx, args): ToolResult => {
      const rules = ctx.services.companyPolicies().profile as Record<string, string>;
      const current = ctx.hr().profile.bankAccount(ctx.identity.employeeId);
      return {
        data: { valid: true },
        summary: 'Troca de conta é uma ação sensível: confirme no cartão e verifique sua identidade com o código.',
        proposal: {
          summary: 'Trocar a conta bancária de pagamento',
          details: [
            {
              label: 'Conta atual',
              value: current ? `${current.bank_name}, ag. ${current.agency}, ${maskAccount(current.account)}` : '-',
            },
            {
              label: 'Nova conta',
              value: `${BANKS[String(args.bank_code)] ?? `Banco ${args.bank_code}`}, ag. ${args.agency}, ${maskAccount(String(args.account))}`,
            },
            { label: 'Vigência', value: rules.bank_change_effective },
            { label: 'Segurança', value: rules.bank_change_alert },
          ],
          args: { ...args },
        },
      };
    },
  },
];

export const reimbursementTools: ToolDef[] = [
  {
    name: 'reimbursement_extract_receipt',
    action: 'self.reimbursement.read',
    params: { upload_id: { type: 'str', description: 'Identificador do arquivo enviado' } },
    handler: (ctx, args): ToolResult => {
      const up = uploadFor(ctx, String(args.upload_id));
      if (!up.text_content.trim()) {
        return fail('Não consegui ler o texto deste arquivo. Envie o comprovante em PDF ou informe valor, data e CNPJ.');
      }
      const fields = parseReceipt(up.text_content);
      const policy = ctx.services.reimbursementPolicy();
      const issues = validateReceipt(fields, null, ctx.today, policy);
      if (fields.injectionSignals.length) {
        ctx.services.audit.append('guardrail.injection', {
          actor: ctx.identity.employeeId,
          conversation: ctx.conversationId,
          payload: { source: 'receipt', upload: args.upload_id, signals: fields.injectionSignals },
        });
      }
      const ok = !issues.some((i) => i.severity === 'error');
      const data = {
        upload_id: args.upload_id,
        filename: up.filename,
        fields: receiptFieldsDict(fields),
        issues,
        valid: ok,
        categories: Object.keys(policy.categories),
      };
      const bits = [
        fields.amount !== null ? `valor ${money(fields.amount)}` : null,
        fields.date ? `data ${d(fields.date)}` : null,
        fields.merchant ? `estabelecimento ${fields.merchant}` : null,
        fields.category ? `categoria sugerida ${fields.category}` : null,
      ].filter(Boolean);
      let summary = `Li o comprovante: ${bits.join(', ')}.`;
      summary += ok
        ? ' Está dentro da política.'
        : ` Há pendências: ${issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ')}`;
      if (fields.injectionSignals.length) summary += ' O arquivo continha instruções escondidas, que foram ignoradas.';
      const result: ToolResult = { data, summary, card: { type: 'receipt_extraction', data } };
      if (ok && fields.date) {
        result.proposal = {
          summary: `Pedir reembolso de ${money(fields.amount as number)} (${fields.category})`,
          details: [
            { label: 'Categoria', value: String(fields.category) },
            { label: 'Valor', value: money(fields.amount as number) },
            { label: 'Data', value: d(fields.date) },
            { label: 'Estabelecimento', value: fields.merchant ?? '-' },
            { label: 'Aprovação', value: policy.approval },
          ],
          args: {
            upload_id: args.upload_id,
            category: fields.category,
            amount: fields.amount,
            date: toISO(fields.date),
            description: `${fields.category} — ${fields.merchant ?? up.filename}`,
          },
          tool: 'reimbursement_submit',
        };
      }
      return result;
    },
  },
  {
    name: 'reimbursement_submit',
    action: 'self.reimbursement.request',
    params: {
      upload_id: { type: 'str', description: 'Identificador do comprovante enviado' },
      category: { type: 'str', description: 'Categoria da política' },
      amount: { type: 'float', gt: 0, description: 'Valor em reais' },
      date: { type: 'date', description: 'Data da despesa (AAAA-MM-DD)' },
      description: { type: 'str', default: '', maxLength: 300, description: 'Descrição curta' },
    },
    executor: (ctx, args): ToolResult => {
      const up = uploadFor(ctx, String(args.upload_id));
      const parsed = parseReceipt(up.text_content);
      const policy = ctx.services.reimbursementPolicy();
      const issues = validateReceipt(
        {
          amount: args.amount as number,
          date: fromISO(String(args.date)),
          cnpj: parsed.cnpj,
          merchant: parsed.merchant,
          category: String(args.category),
          itemsFlagged: parsed.itemsFlagged,
          injectionSignals: parsed.injectionSignals,
        },
        String(args.category),
        ctx.today,
        policy,
      );
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new ToolError(errors[0].message);
      const r = ctx.hr().reimbursements.create(
        ctx.identity.employeeId,
        String(args.category),
        args.amount as number,
        fromISO(String(args.date)),
        parsed.merchant || up.filename,
        parsed.cnpj ?? '',
        String(args.description ?? ''),
        ctx.today,
      );
      return {
        data: { reimbursement_id: r.id, status: r.status },
        summary: `Reembolso ${r.id} de ${money(r.amount)} enviado para aprovação.`,
      };
    },
    handler: (ctx, args): ToolResult => {
      const up = uploadFor(ctx, String(args.upload_id));
      const parsed = parseReceipt(up.text_content);
      const policy = ctx.services.reimbursementPolicy();
      const issues = validateReceipt(
        {
          amount: args.amount as number,
          date: args.date as Day,
          cnpj: parsed.cnpj,
          merchant: parsed.merchant,
          category: String(args.category),
          itemsFlagged: parsed.itemsFlagged,
          injectionSignals: parsed.injectionSignals,
        },
        String(args.category),
        ctx.today,
        policy,
      );
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) {
        const data = { issues };
        return fail(`Não posso enviar: ${errors.map((i) => i.message).join(' ')}`, data, { type: 'validation', data });
      }
      return {
        data: { valid: true },
        summary: 'O comprovante está dentro da política. Confirme para enviar o pedido.',
        proposal: {
          summary: `Pedir reembolso de ${money(args.amount as number)} (${args.category})`,
          details: [
            { label: 'Categoria', value: String(args.category) },
            { label: 'Valor', value: money(args.amount as number) },
            { label: 'Data', value: d(args.date as Day) },
            { label: 'Aprovação', value: policy.approval },
            { label: 'Pagamento', value: policy.payment },
          ],
          args: { ...args, date: toISO(args.date as Day) },
        },
      };
    },
  },
  {
    name: 'reimbursement_list',
    action: 'self.reimbursement.read',
    params: {},
    handler: (ctx): ToolResult => {
      const items = ctx.hr().reimbursements.list(ctx.subjectId as string);
      const rows = items.map((r) => [toISO(r.date), r.category, r.amount, r.status]);
      const data = {
        title: 'Meus reembolsos',
        columns: ['Data', 'Categoria', 'Valor', 'Status'],
        rows,
        money_columns: [2],
      };
      const pending = items.filter((r) => ['em análise', 'aprovado'].includes(r.status));
      let summary: string;
      if (!items.length) {
        summary = 'Você não tem pedidos de reembolso registrados. Envie um comprovante para começar.';
      } else {
        summary = `Você tem ${items.length} reembolso(s) registrado(s)`;
        summary += pending.length
          ? `; ${pending.length} ainda não foram pagos (${money(pending.reduce((sum, r) => sum + r.amount, 0))}).`
          : ', todos pagos.';
      }
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'reimbursement_guide',
    action: 'none',
    params: {
      category: {
        type: 'str',
        optional: true,
        default: null,
        maxLength: 60,
        description: 'Despesa como a pessoa descreveu (ex.: almoço com cliente, hotel da viagem)',
      },
    },
    /** Before the receipt: what the policy allows for this expense and how to send it. */
    handler: (ctx, args): ToolResult => {
      const policy = ctx.services.reimbursementPolicy();
      const rules = policy.categories;
      const [match, mealOutsideTravel] = guideCategory((args.category as string | null) ?? '', policy);
      const categories = Object.entries(rules).map(([name, rule]) => ({
        name,
        limit: rule.limit,
        per: rule.per,
        match: name === match,
      }));
      const data = {
        category: match,
        categories,
        submit_within_days: policy.submit_within_days,
        approval: policy.approval,
        not_reimbursable: policy.not_reimbursable,
        requirements: 'nota fiscal, cupom fiscal ou recibo legível, com CNPJ, data e valor',
        accepts: 'PDF, PNG, JPG ou TXT, até 5 MB',
        note: mealOutsideTravel ? policy.meal_outside_travel : null,
      };
      const rule = categories.find((c) => c.match);
      const lead = mealOutsideTravel
        ? `${policy.meal_outside_travel} `
        : rule
          ? `Para ${rule.name}, o limite é ${money(rule.limit)} por ${rule.per}. `
          : '';
      const summary =
        lead +
        `Envie o comprovante (${data.requirements}) em até ${policy.submit_within_days} dias da despesa; ` +
        `a aprovação é do ${policy.approval}. Anexe o arquivo aqui na conversa e eu leio os campos para você conferir.`;
      const [, citations] = knowledgeAnswer(
        ctx,
        `reembolso ${(args.category as string | null) || 'comprovante despesa'}`,
        ctx.knowledge.length ? [...ctx.knowledge] : ['reembolso'],
      );
      return { data, summary, card: { type: 'receipt_upload', data }, citations: citations.slice(0, 2) };
    },
  },
];

export const timekeepingTools: ToolDef[] = [
  {
    name: 'time_get_bank',
    action: 'self.time.read',
    params: {},
    handler: (ctx): ToolResult => {
      const months = ctx.hr().time.months(ctx.subjectId as string);
      if (!months.length) return fail('Ainda não há registros de ponto fechados para você.');
      const rows = months.map((m) => ({
        month: m.month,
        label: MONTHS[Number(m.month.slice(5)) - 1].slice(0, 3),
        expected: m.expected_hours,
        worked: m.worked_hours,
        overtime: m.overtime_hours,
        bank_delta: m.bank_delta_hours,
        bank_balance: m.bank_balance_hours,
      }));
      const last = rows[rows.length - 1];
      const limit = Number((ctx.services.companyPolicies().time as Record<string, number>).bank_hours_limit);
      const data = {
        months: rows,
        bank_balance: last.bank_balance,
        last_month: last.month,
        overtime_last_month: last.overtime,
        overtime_year: rows.reduce((sum, r) => sum + r.overtime, 0),
        limit,
      };
      const summary =
        `Seu banco de horas está em ${hours(last.bank_balance)} (limite de ${limit}h). ` +
        `Em ${MONTHS[Number(last.month.slice(5)) - 1]} você fez ${hours(last.overtime)} de horas extras pagas; ` +
        `no ano, ${hours(data.overtime_year)}.`;
      return { data, summary, card: { type: 'time_bank', data } };
    },
  },
  {
    name: 'time_request_adjustment',
    action: 'self.time.request',
    params: {
      date: { type: 'date', description: 'Dia da marcação (AAAA-MM-DD)' },
      time: { type: 'str', pattern: /^\d{2}:\d{2}$/, description: 'Horário HH:MM' },
      kind: { type: 'str', description: 'entrada ou saída' },
      reason: { type: 'str', minLength: 3, maxLength: 200, description: 'Motivo do ajuste' },
    },
    executor: (ctx, args): ToolResult => {
      const a = ctx
        .hr()
        .time.requestAdjustment(
          ctx.identity.employeeId,
          fromISO(String(args.date)),
          String(args.time),
          String(args.kind),
          String(args.reason),
        );
      return { data: { adjustment_id: a.id }, summary: `Ajuste ${a.id} enviado para aprovação do gestor.` };
    },
    handler: (ctx, args): ToolResult => {
      const kind = String(args.kind);
      if (!['entrada', 'saída', 'saida'].includes(kind)) return fail('Informe se o ajuste é de entrada ou de saída.');
      const dayValue = args.date as Day;
      if (gt(dayValue, ctx.today)) return fail('Não é possível ajustar marcações futuras.');
      return {
        data: { valid: true },
        summary: 'Preparei o ajuste de ponto para você confirmar.',
        proposal: {
          summary: `Ajustar ponto de ${d(dayValue)} (${kind} ${args.time})`,
          details: [
            { label: 'Dia', value: d(dayValue) },
            { label: 'Marcação', value: `${kind} às ${args.time}` },
            { label: 'Motivo', value: String(args.reason) },
            {
              label: 'Prazo',
              value: String((ctx.services.companyPolicies().time as Record<string, string>).adjustment_deadline),
            },
          ],
          args: {
            date: toISO(dayValue),
            time: args.time,
            kind: kind === 'saida' ? 'saída' : kind,
            reason: args.reason,
          },
        },
      };
    },
  },
];

export { addDays };
