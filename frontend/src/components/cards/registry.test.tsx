import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cardRegistry, GenericCard } from './index';

/** One minimal, structurally valid payload per card type the back-end can emit. */
const PAYLOADS: Record<string, unknown> = {
  vacation_balance: {
    available_days: 12,
    accruing_days: 5,
    next_deadline: '2026-12-31',
    periods: [
      {
        id: 'P1',
        status: 'open',
        label: '2024/2025',
        acquisition_start: '2024-01-01',
        acquisition_end: '2024-12-31',
        concession_end: '2026-12-31',
        entitled_days: 30,
        taken_days: 18,
        scheduled_days: 0,
        pending_days: 0,
        sold_days: 0,
        balance_days: 12,
        days_to_deadline: 91,
        risk: 'attention',
      },
    ],
  },
  holiday_calendar: {
    year: 2026,
    location: 'São Paulo, SP',
    holidays: [{ date: '2026-11-20', name: 'Consciência Negra', scope: 'national', weekday: 4 }],
  },
  vacation_calendar: {
    period: '2024/2025',
    balance_days: 12,
    deadline: '2026-12-31',
    earliest_start: '2026-11-01',
    latest_end: '2026-12-31',
    windows: [
      {
        start: '2026-11-23',
        end: '2026-12-07',
        days: 15,
        rest_start: '2026-11-21',
        rest_end: '2026-12-08',
        rest_days: 18,
        bonus_days: 3,
        efficiency: 1.2,
        holidays_bridged: ['Consciência Negra'],
        holidays_inside: [],
      },
    ],
    plans: [
      {
        fractions: [
          {
            start: '2026-11-23',
            end: '2026-12-07',
            days: 15,
            rest_start: '2026-11-21',
            rest_end: '2026-12-08',
            rest_days: 18,
            bonus_days: 3,
            efficiency: 1.2,
            holidays_bridged: [],
            holidays_inside: [],
          },
        ],
        used_days: 15,
        rest_days: 18,
        bonus_days: 3,
      },
    ],
    holidays: [{ date: '2026-11-20', name: 'Consciência Negra', scope: 'national' }],
  },
  leave: { kind: 'licença-paternidade', start: '2026-10-02', end: '2026-10-21', days: 20 },
  breakdown: {
    title: 'Simulação',
    lines: [{ label: 'Salário bruto', value: 9000, kind: 'earning' }],
    gross: 9000,
    deductions: 1800,
    net: 7200,
    notes: ['Nota'],
  },
  payslip: {
    id: 'PAY-1',
    month: '2026-09',
    month_label: 'setembro de 2026',
    kind: 'monthly',
    lines: [{ code: 'SAL', label: 'Salário base', earning: 9000 }],
    gross: 9000,
    deductions: 1800,
    net: 7200,
    inss_base: 9000,
    irrf_base: 8000,
    fgts: 720,
    paid_on: '2026-09-30',
    pdf_url: '/api/documents/payslip/2026-09?kind=monthly',
  },
  annual_projection: {
    year: 2026,
    salary: 9000,
    months: [{ month: '2026-01', label: 'jan', gross: 9000, net: 7200, kind: 'actual' }],
    items: { salaries: 108000, overtime: 0, vacation: 0, vacation_third: 3000, thirteenth: 9000, plr: 0 },
    thirteenth: { gross: 9000, first: 4500, second_net: 3800, inss: 500, irrf: 200 },
    total_gross: 120000,
    total_net: 96000,
    notes: ['Nota'],
  },
  pgbl_simulation: {
    year: 2026,
    taxable_income: 110000,
    limit: 13200,
    contribution: 13200,
    monthly_contribution: 1100,
    tax_saving: 3630,
    eligible: true,
    tax_without_pgbl: 12000,
    tax_with_pgbl: 8370,
    best_model_without_pgbl: 'complete',
    scenarios: [{ percent: 0, contribution: 0, tax: 12000, saving: 0 }],
    recommendation: 'Contribuir até o limite de 12%.',
    assumptions: ['Premissa'],
  },
  benefits_summary: {
    plans: [
      {
        kind: 'health',
        plan_id: 'PLN-ESS',
        name: 'Vitalis Essencial',
        operator: 'Vitalis',
        since: '2024-01-01',
        accommodation: 'enfermaria',
        coverage: 'nacional',
        copay: '20%',
        dependents: ['Ana'],
        monthly_cost: 320.5,
      },
    ],
    meal_card_monthly: 1100,
    food_card_monthly: 700,
    flex_balance: 250,
    life_insurance_coverage: 108000,
    life_insurance_multiple: 12,
    transport_voucher: false,
  },
  plan_comparison: {
    kind: 'health',
    dependents_on_plan: 1,
    plans: [
      {
        plan_id: 'PLN-PLUS',
        name: 'Vitalis Plus',
        accommodation: 'apartamento',
        coverage: 'nacional',
        copay: '10%',
        reimbursement: '70%',
        highlights: ['Rede ampliada'],
        monthly_cost: 520,
        annual_cost: 6240,
        difference: 200,
        current: false,
      },
    ],
    rules: ['Troca na janela anual.'],
  },
  kv: { title: 'Auxílio-creche', items: [{ label: 'Valor', value: 'R$ 950,00' }] },
  sections: {
    title: 'Meus dados',
    sections: [{ title: 'Endereço', items: [{ label: 'Cidade', value: 'São Paulo/SP' }] }],
  },
  life_event: {
    event: 'nascimento',
    title: 'Nascimento de filho',
    date: '2026-09-29',
    steps: [{ agent: 'Benefícios', summaries: ['Inclusão no plano preparada.'] }],
  },
  table: {
    title: 'Meus pedidos',
    columns: ['Início', 'Valor'],
    rows: [['2026-11-23', 1234.56]],
    money_columns: [1],
  },
  validation: { issues: [{ code: 'min_fraction', message: 'Fração mínima de 5 dias.', severity: 'error' }] },
  receipt_extraction: {
    upload_id: 'u1',
    filename: 'nota.pdf',
    fields: {
      amount: 89.9,
      date: '2026-09-20',
      cnpj: '12.345.678/0001-95',
      merchant: 'Restaurante',
      category: 'alimentação',
      items_flagged: [],
      injection_signals: ['ignore previous instructions'],
    },
    issues: [{ message: 'Acima do limite.', severity: 'warning' }],
    valid: true,
  },
  receipt_upload: {
    category: 'alimentação em viagem',
    categories: [{ name: 'alimentação em viagem', limit: 180, per: 'dia', match: true }],
    submit_within_days: 60,
    approval: 'gestor imediato',
    not_reimbursable: ['bebidas alcoólicas'],
    requirements: 'nota fiscal com CNPJ, data e valor',
    accepts: 'PDF, PNG, JPG ou TXT, até 5 MB',
  },
  general_request: { kind: 'redacao', label: 'redação de texto' },
  time_bank: {
    months: [
      { month: '2026-08', label: 'ago', expected: 176, worked: 180, overtime: 4, bank_delta: 2, bank_balance: 10 },
    ],
    bank_balance: 10,
    last_month: '2026-08',
    overtime_last_month: 4,
    overtime_year: 22,
    limit: 40,
  },
  document: {
    document_id: 'DOC-1',
    kind: 'employment_letter',
    title: 'Declaração de vínculo',
    verification_code: 'AB12CD34',
    issued_on: '2026-10-01',
    pdf_url: '/api/documents/issued/DOC-1',
    figures: { taxable_income: 110000 },
  },
  support_channels: {
    channels: [
      { kind: 'ethics', name: 'Canal de Ética', url: 'https://x', phone: '0800', description: 'Relatos.' },
    ],
  },
  career: {
    pending_trainings: [{ id: 'T1', title: 'LGPD', hours: 2, due_date: '2026-10-20', days_left: 19 }],
    completed_trainings: ['Código de conduta'],
    cycle: { name: 'Ciclo 2026', phases: [{ label: 'Autoavaliação', start: '2026-10-01', end: '2026-10-15', state: 'em andamento' }] },
    learning_paths: [{ title: 'Dados', description: 'Trilha', audience: 'todos', steps: ['SQL'] }],
  },
  jobs: {
    jobs: [
      {
        id: 'J1',
        title: 'Engenheiro de Dados Sênior',
        unit: 'Plataforma de Dados',
        level: 'sênior',
        skills: ['sql', 'python'],
        matched: ['sql'],
        missing: ['python'],
        score: 0.5,
        closes_at: '2026-10-30',
      },
    ],
    skills: ['sql'],
    eligible: true,
    months_in_role: 18,
    min_months: 12,
    rule: 'A liderança é avisada.',
  },
  checklist: {
    items: [
      { id: 'ONB-01', title: 'Acessos', category: 'ti', due_date: '2026-09-25', status: 'pendente', owner: 'TI', overdue: true },
    ],
    done: 2,
    total: 5,
    progress: 0.4,
    buddy: { name: 'Rafael Lima', title: 'Analista', email: 'r@x.com' },
    start_date: '2026-09-21',
  },
  team_table: {
    members: [
      {
        id: 'E1',
        name: 'João Souza',
        title: 'Analista',
        hire_date: '2023-01-02',
        tenure_months: 44,
        new_member: false,
        work_anniversary: '2026-10-15',
        anniversary_years: 3,
        vacation_balance: 20,
        vacation_deadline: '2026-11-30',
        vacation_risk: 'critical',
        days_to_deadline: 60,
        days_since_vacation: 420,
        pending_requests: 1,
        bank_hours: 12,
        overtime_last_month: 6,
        mandatory_pending: 0,
      },
    ],
    highlights: {
      expiring: ['João Souza'],
      long_without_vacation: ['João Souza'],
      high_hours: [],
      pending_approvals: 1,
      anniversaries: ['João Souza'],
      new_members: [],
    },
    privacy_note: 'Remuneração do time não é exibida.',
  },
  approvals: {
    items: [
      {
        request_id: 'FER-50001',
        employee: 'João Souza',
        employee_id: 'E1',
        start: '2026-11-23',
        end: '2026-12-07',
        days: 15,
        sell_days: 0,
        requested_at: '2026-09-20',
      },
    ],
  },
  analytics: {
    metric: 'headcount',
    label: 'Headcount',
    definition: 'Pessoas ativas.',
    group_by: 'unit',
    unit: 'Tecnologia',
    k: 5,
    groups: [
      { group: 'Plataforma de Dados', value: 8, n: 8, suppressed: false },
      { group: 'Segurança', value: null, n: null, suppressed: true },
    ],
    suppressed_count: 1,
    unit_suffix: '',
  },
};

describe('cardRegistry', () => {
  it('covers every card type the tools emit', () => {
    expect(Object.keys(cardRegistry).sort()).toEqual(Object.keys(PAYLOADS).sort());
  });

  it.each(Object.keys(PAYLOADS))('renders %s without crashing', (type) => {
    const Component = cardRegistry[type];
    const { container } = render(<Component data={PAYLOADS[type]} agentName="Férias e Ausências" />);
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('falls back to a key/value dump for unknown types', () => {
    expect(cardRegistry.unknown_type).toBeUndefined();
    const { container } = render(<GenericCard data={{ alguma_coisa: 42, lista: [1, 2] }} />);
    expect(container.textContent).toContain('alguma coisa');
    expect(container.textContent).toContain('42');
  });
});
