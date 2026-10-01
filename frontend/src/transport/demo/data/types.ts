/** Shapes of `shared/generated/*.json` as consumed by the in-browser engine. */

export interface RawUnit {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface RawEmployee {
  id: string;
  name: string;
  email: string;
  title: string;
  unit_id: string;
  manager_id: string | null;
  hire_date: string;
  birth_date: string;
  sex: string;
  location: string;
  work_mode: string;
  status: string;
  termination_date: string | null;
  termination_reason: string | null;
  cpf: string;
}

export interface RawPersona {
  key: string;
  name: string;
  label: string;
  description: string;
  employee_id: string;
}

export interface RawSalary {
  employee_id: string;
  effective_date: string;
  salary: number;
  reason: string;
}

export interface RawPayslipLine {
  code: string;
  label: string;
  earning?: number;
  deduction?: number;
}

export interface RawPayslip {
  id: string;
  employee_id: string;
  month: string;
  kind: string;
  gross: number;
  deductions: number;
  net: number;
  inss_base: number;
  irrf_base: number;
  fgts: number;
  lines: RawPayslipLine[];
  paid_on: string;
}

export interface RawIncomeStatement {
  employee_id: string;
  year: number;
  taxable_income: number;
  inss: number;
  irrf: number;
  health_paid: number;
  thirteenth_gross: number;
  thirteenth_inss: number;
  thirteenth_irrf: number;
  plr_2024_paid: number;
  dependents: number;
}

export interface RawPlr {
  employee_id: string;
  year: number;
  amount: number;
  tax: number;
  paid_on: string;
}

export interface RawVacationPeriod {
  id: string;
  employee_id: string;
  acquisition_start: string;
  acquisition_end: string;
  concession_end: string;
  entitled_days: number;
  sold_days: number;
  status: string;
}

export interface RawVacationRequest {
  id: string;
  employee_id: string;
  period_id: string;
  start: string;
  days: number;
  sell_days: number;
  advance_13th: boolean;
  status: string;
  requested_at: string;
  decided_by: string | null;
  decision_note?: string | null;
}

export interface RawLeaveRequest {
  id: string;
  employee_id: string;
  kind: string;
  start: string;
  days: number;
  status: string;
  note: string | null;
}

export interface RawAbsence {
  employee_id: string;
  date: string;
  type: string;
  days: number;
}

export interface RawTimeMonth {
  employee_id: string;
  month: string;
  expected_hours: number;
  worked_hours: number;
  overtime_hours: number;
  bank_delta_hours: number;
  bank_balance_hours: number;
}

export interface RawTimeAdjustment {
  id: string;
  employee_id: string;
  date: string;
  time: string;
  kind: string;
  reason: string;
  status: string;
}

export interface RawPlan {
  id: string;
  kind: string;
  name: string;
  operator: string;
  accommodation: string | null;
  coverage: string;
  employee_cost: number;
  dependent_cost: number;
  copay: string;
  reimbursement: string;
  highlights: string[];
}

export interface RawEnrollment {
  employee_id: string;
  plan_id: string;
  since: string;
  dependents: string[];
}

export interface RawDependent {
  id: string;
  employee_id: string;
  name: string;
  relationship: string;
  birth_date: string;
  ir_dependent: boolean;
  health_plan: boolean;
  status: string;
}

export interface RawBalances {
  employee_id: string;
  meal_card_monthly: number;
  food_card_monthly: number;
  flex_balance: number;
  daycare_children: number;
  daycare_monthly_per_child: number;
  life_insurance_multiple: number;
  wellness: string;
  transport_voucher: boolean;
}

export interface RawPlanChange {
  id: string;
  employee_id: string;
  from_plan: string;
  to_plan: string;
  effective_date: string;
  reason: string;
  status: string;
}

export interface RawBankAccount {
  employee_id: string;
  bank_code: string;
  bank_name: string;
  agency: string;
  account: string;
  type: string;
  updated_at: string;
}

export interface RawAddress {
  employee_id: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
}

export interface RawReimbursement {
  id: string;
  employee_id: string;
  category: string;
  amount: number;
  date: string;
  merchant: string;
  cnpj: string;
  status: string;
  submitted_at: string;
  description: string;
}

export interface RawTraining {
  id: string;
  title: string;
  mandatory: boolean;
  hours: number;
  due: string | null;
}

export interface RawTrainingAssignment {
  employee_id: string;
  training_id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
}

export interface RawLearningPath {
  id: string;
  title: string;
  audience: string;
  steps: string[];
  description: string;
}

export interface RawReviewPhase {
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface RawReviewCycle {
  id: string;
  name: string;
  phases: RawReviewPhase[];
}

export interface RawJobPosting {
  id: string;
  title: string;
  unit_id: string;
  level: string;
  skills: string[];
  posted_at: string;
  closes_at: string;
}

export interface RawSkills {
  employee_id: string;
  skills: string[];
}

export interface RawOnboardingTask {
  id: string;
  employee_id: string;
  title: string;
  category: string;
  due_date: string;
  status: string;
  owner: string;
}

export interface RawBuddy {
  employee_id: string;
  buddy_id: string;
}

export interface Dataset {
  meta: { company: string; fictional: boolean; today: string; seed: number; generator: string };
  personas: RawPersona[];
  units: RawUnit[];
  employees: RawEmployee[];
  hrbp_assignments: { hrbp_id: string; unit_id: string }[];
  platform_roles: { employee_id: string; role: string }[];
  compensation: RawSalary[];
  payslips: RawPayslip[];
  income_statements: RawIncomeStatement[];
  plr: RawPlr[];
  vacation_periods: RawVacationPeriod[];
  vacation_requests: RawVacationRequest[];
  absences: RawAbsence[];
  time_bank: RawTimeMonth[];
  time_adjustments: RawTimeAdjustment[];
  benefit_plans: RawPlan[];
  benefit_enrollments: RawEnrollment[];
  dependents: RawDependent[];
  benefit_balances: RawBalances[];
  bank_accounts: RawBankAccount[];
  addresses: RawAddress[];
  reimbursements: RawReimbursement[];
  trainings: RawTraining[];
  training_assignments: RawTrainingAssignment[];
  learning_paths: RawLearningPath[];
  review_cycles: RawReviewCycle[];
  job_postings: RawJobPosting[];
  employee_skills: RawSkills[];
  onboarding_tasks: RawOnboardingTask[];
  buddies: RawBuddy[];
}

export interface Audience {
  type: 'all' | 'roles' | 'units';
  roles?: string[];
  units?: string[];
}

export interface CatalogAgentSpec {
  id: string;
  name: string;
  icon: string;
  description: string;
  audience: Audience;
  knowledge: string[];
  tools: string[];
  instructions: string;
  tone?: string;
  origin?: string;
  owner?: string;
  reviewer?: string;
  routing: { keywords: string[]; examples: string[] };
  evaluation?: { kind: string; question: string; expect_kb?: string }[];
}

export interface ToolMeta {
  title: string;
  description: string;
  risk: 'read' | 'write' | 'sensitive';
  subject: 'self' | 'target' | 'none';
  hints?: string[];
}

export interface LifeEventStep {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface LifeEvent {
  title: string;
  keywords: string[];
  intro: string;
  steps: LifeEventStep[];
}

/** `shared/catalog/lexicon.yaml`, section `subjects`: whose data a message asks for. */
export interface LexiconSubjects {
  domains: Record<string, string[]>;
  person_only: string[];
  self_possessive: string[];
  money_verbs: string[];
  pay_questions: string[];
  question_pay_verbs: string[];
  links: string[];
  group_links: string[];
  articles: string[];
  fillers: string[];
  manager: string[];
  team: string[];
  group: string[];
  role: string[];
  aggregate: string[];
  company: string[];
  time_words: string[];
  rule_cues: string[];
  entitlement_verbs: string[];
  third_person: string[];
  first_person: string[];
  feminine: string[];
}

/** `shared/catalog/lexicon.yaml`: domain vocabulary shared by the router and the fake model. */
export interface LexiconData {
  synonyms?: Record<string, string[]>;
  approval_by_me?: string[];
  team_reference?: string[];
  containers?: string[];
  general?: Record<string, string[]>;
  subjects?: LexiconSubjects;
}

export interface Catalog {
  agents: { agents: CatalogAgentSpec[]; common_rules: string; starters: Record<string, string[]> };
  tools: Record<string, ToolMeta>;
  life_events: { events: Record<string, LifeEvent> };
  company_policies: Record<string, Record<string, unknown>>;
  lexicon: LexiconData;
}

export interface KbBase {
  id: string;
  name: string;
  description: string;
  audience: Audience;
}

export interface KbChunk {
  id: string;
  kb: string;
  source: string;
  document: string;
  section: string;
  content: string;
  snippet: string;
}

export interface KbData {
  knowledge_bases: KbBase[];
  chunks: KbChunk[];
}
