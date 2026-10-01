/** In-memory systems of record with the row-level security of `003_security.sql`.
 *
 *  Every read goes through an identity-scoped session: if the SQL policy would hide a row,
 *  these providers hide it too, so tools cannot reach data the database would refuse. */
import { type Day, addDays, cmp, fromISO, lte, toISO } from '../core/date';
import { fold } from '../core/text';
import { type PolicyRow, PolicyStore, type Decision } from '../authz/policy';
import type {
  Dataset,
  RawAbsence,
  RawAddress,
  RawBalances,
  RawBankAccount,
  RawBuddy,
  RawDependent,
  RawEmployee,
  RawEnrollment,
  RawIncomeStatement,
  RawJobPosting,
  RawLearningPath,
  RawLeaveRequest,
  RawOnboardingTask,
  RawPayslip,
  RawPlan,
  RawPlanChange,
  RawPlr,
  RawReimbursement,
  RawReviewCycle,
  RawSalary,
  RawSkills,
  RawTimeAdjustment,
  RawTimeMonth,
  RawTraining,
  RawTrainingAssignment,
  RawUnit,
  RawVacationPeriod,
  RawVacationRequest,
} from './types';

export class RlsError extends Error {}

export interface IssuedDocument {
  id: string;
  employee_id: string;
  kind: string;
  params: Record<string, unknown>;
  verification_code: string;
  issued_on: string;
}

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Mutable company data plus the derived indexes the RLS predicates need. */
export class Store {
  readonly units: RawUnit[];
  readonly employees: RawEmployee[];
  readonly hrbpAssignments: { hrbp_id: string; unit_id: string }[];
  readonly platformRoles: { employee_id: string; role: string }[];
  readonly compensation: RawSalary[];
  readonly payslips: RawPayslip[];
  readonly incomeStatements: RawIncomeStatement[];
  readonly plr: RawPlr[];
  readonly vacationPeriods: RawVacationPeriod[];
  readonly vacationRequests: RawVacationRequest[];
  readonly leaveRequests: RawLeaveRequest[];
  readonly absences: RawAbsence[];
  readonly timeBank: RawTimeMonth[];
  readonly timeAdjustments: RawTimeAdjustment[];
  readonly benefitPlans: RawPlan[];
  readonly enrollments: RawEnrollment[];
  readonly dependents: RawDependent[];
  readonly balances: RawBalances[];
  readonly planChanges: RawPlanChange[];
  readonly bankAccounts: RawBankAccount[];
  readonly addresses: RawAddress[];
  readonly reimbursements: RawReimbursement[];
  readonly trainings: RawTraining[];
  readonly trainingAssignments: RawTrainingAssignment[];
  readonly learningPaths: RawLearningPath[];
  readonly reviewCycles: RawReviewCycle[];
  readonly jobPostings: RawJobPosting[];
  readonly skills: RawSkills[];
  readonly onboardingTasks: RawOnboardingTask[];
  readonly buddies: RawBuddy[];
  readonly issuedDocuments: IssuedDocument[] = [];
  readonly policies = new Map<string, PolicyRow>();
  readonly policyStore: PolicyStore;

  private readonly byId = new Map<string, RawEmployee>();
  private readonly unitParent = new Map<string, string | null>();
  private vacationSeq = 0;

  constructor(readonly data: Dataset) {
    const clone = <T>(rows: T[]): T[] => rows.map((r) => ({ ...r }) as T);
    this.units = clone(data.units);
    this.employees = clone(data.employees);
    this.hrbpAssignments = clone(data.hrbp_assignments);
    this.platformRoles = clone(data.platform_roles);
    this.compensation = clone(data.compensation);
    this.payslips = data.payslips.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l })) }));
    this.incomeStatements = clone(data.income_statements);
    this.plr = clone(data.plr);
    this.vacationPeriods = clone(data.vacation_periods);
    this.vacationRequests = clone(data.vacation_requests);
    this.leaveRequests = [];
    this.absences = clone(data.absences);
    this.timeBank = clone(data.time_bank);
    this.timeAdjustments = clone(data.time_adjustments);
    this.benefitPlans = clone(data.benefit_plans);
    this.enrollments = data.benefit_enrollments.map((e) => ({ ...e, dependents: [...e.dependents] }));
    this.dependents = clone(data.dependents);
    this.balances = clone(data.benefit_balances);
    this.planChanges = [];
    this.bankAccounts = clone(data.bank_accounts);
    this.addresses = clone(data.addresses);
    this.reimbursements = clone(data.reimbursements);
    this.trainings = clone(data.trainings);
    this.trainingAssignments = clone(data.training_assignments);
    this.learningPaths = data.learning_paths.map((p) => ({ ...p, steps: [...p.steps] }));
    this.reviewCycles = data.review_cycles.map((c) => ({ ...c, phases: c.phases.map((p) => ({ ...p })) }));
    this.jobPostings = data.job_postings.map((j) => ({ ...j, skills: [...j.skills] }));
    this.skills = data.employee_skills.map((s) => ({ ...s, skills: [...s.skills] }));
    this.onboardingTasks = clone(data.onboarding_tasks);
    this.buddies = clone(data.buddies);
    for (const e of this.employees) this.byId.set(e.id, e);
    for (const u of this.units) this.unitParent.set(u.id, u.parent_id);
    for (const r of this.vacationRequests) {
      const m = /^FER-(\d+)$/.exec(r.id);
      if (m) this.vacationSeq = Math.max(this.vacationSeq, Number(m[1]));
    }
    this.policyStore = new PolicyStore(this.policies);
  }

  nextVacationId(): string {
    this.vacationSeq += 1;
    return `FER-${String(this.vacationSeq).padStart(5, '0')}`;
  }

  employee(id: string | null): RawEmployee | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** `hr.in_chain`: is `subject` anywhere below `manager` in the active org chart? */
  inChain(manager: string | null, subject: string): boolean {
    if (!manager || manager === subject) return false;
    let current = this.byId.get(subject);
    let depth = 0;
    while (current && depth < 32) {
      if (current.manager_id === manager) return true;
      current = current.manager_id ? this.byId.get(current.manager_id) : undefined;
      depth += 1;
    }
    return false;
  }

  /** `hr.hrbp_covers`: does the HRBP own a unit on the subject's unit path? */
  hrbpCovers(hrbp: string | null, subject: string): boolean {
    if (!hrbp || hrbp === subject) return false;
    const e = this.byId.get(subject);
    if (!e) return false;
    const chain: string[] = [];
    let current: string | null = e.unit_id;
    let depth = 0;
    while (current && depth <= 32) {
      chain.push(current);
      current = this.unitParent.get(current) ?? null;
      depth += 1;
    }
    return this.hrbpAssignments.some((a) => a.hrbp_id === hrbp && chain.includes(a.unit_id));
  }

  unitChain(unitId: string): string[] {
    const chain: string[] = [];
    let current: string | null = unitId;
    let depth = 0;
    while (current && depth <= 32) {
      chain.push(current);
      current = this.unitParent.get(current) ?? null;
      depth += 1;
    }
    return chain;
  }

  hasPlatformRole(employeeId: string | null, role: string): boolean {
    return Boolean(employeeId) && this.platformRoles.some((r) => r.employee_id === employeeId && r.role === role);
  }

  directoryNames(): Map<string, string> {
    return new Map(this.employees.filter((e) => e.status === 'active').map((e) => [e.id, e.name]));
  }

  /** After loading a snapshot, continue the FER- sequence past the restored rows. */
  restoreSequences(): void {
    for (const r of this.vacationRequests) {
      const m = /^FER-(\d+)$/.exec(r.id);
      if (m) this.vacationSeq = Math.max(this.vacationSeq, Number(m[1]));
    }
  }
}

export interface SalaryEntry {
  effective_date: Day;
  salary: number;
  reason: string;
}

export interface VacationPeriodRow {
  id: string;
  employee_id: string;
  acquisition_start: Day;
  acquisition_end: Day;
  concession_end: Day;
  entitled_days: number;
  sold_days: number;
  status: string;
}

export interface VacationRequestRow {
  id: string;
  employee_id: string;
  period_id: string;
  start: Day;
  days: number;
  sell_days: number;
  advance_13th: boolean;
  status: string;
  requested_at: Day;
  decided_by: string | null;
  decision_note: string | null;
}

export interface DependentRow extends Omit<RawDependent, 'birth_date'> {
  birth_date: Day;
}

export interface EmployeeRow extends Omit<RawEmployee, 'hire_date' | 'termination_date'> {
  hire_date: Day;
  termination_date: Day | null;
}

function toEmployee(e: RawEmployee): EmployeeRow {
  return {
    ...e,
    hire_date: fromISO(e.hire_date),
    termination_date: e.termination_date ? fromISO(e.termination_date) : null,
  };
}

function toPeriod(p: RawVacationPeriod): VacationPeriodRow {
  return {
    ...p,
    acquisition_start: fromISO(p.acquisition_start),
    acquisition_end: fromISO(p.acquisition_end),
    concession_end: fromISO(p.concession_end),
  };
}

function toRequest(r: RawVacationRequest): VacationRequestRow {
  return {
    ...r,
    start: fromISO(r.start),
    requested_at: fromISO(r.requested_at),
    decision_note: r.decision_note ?? null,
  };
}

/** All ports bound to one identity. The predicates mirror the SQL policies one by one. */
export class HRSession {
  constructor(
    readonly store: Store,
    readonly employeeId: string,
  ) {}

  private selfOnly(ownerId: string): boolean {
    return ownerId === this.employeeId;
  }

  /** `self_or_switch`: compensation, payslips, income statements, PLR. */
  private compensationVisible(ownerId: string): boolean {
    if (ownerId === this.employeeId) return true;
    return (
      this.store.policyStore.enabled('manager_can_view_team_compensation') && this.store.inChain(this.employeeId, ownerId)
    );
  }

  /** `team_read`: vacation, time, development data. */
  private teamVisible(ownerId: string): boolean {
    return (
      ownerId === this.employeeId ||
      this.store.inChain(this.employeeId, ownerId) ||
      this.store.hrbpCovers(this.employeeId, ownerId)
    );
  }

  private teamWritable(ownerId: string): boolean {
    return ownerId === this.employeeId || this.store.inChain(this.employeeId, ownerId);
  }

  // ------------------------------------------------------------------ directory
  readonly directory = {
    get: (employeeId: string | null | undefined): EmployeeRow | null => {
      const e = employeeId ? this.store.employee(employeeId) : undefined;
      return e ? toEmployee(e) : null;
    },
    search: (query: string, limit = 5): EmployeeRow[] => {
      const needle = fold(query).split(' ').filter(Boolean);
      if (!needle.length) return [];
      const rows = this.store.employees
        .filter((e) => e.status === 'active')
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const hits = rows.filter((r) => {
        const tokens = fold(r.name).split(' ');
        return needle.every((n) => tokens.some((t) => t.startsWith(n)));
      });
      return hits.slice(0, limit).map(toEmployee);
    },
    reports: (managerId: string, chain = false): EmployeeRow[] => {
      const active = this.store.employees.filter((e) => e.status === 'active');
      let picked: RawEmployee[];
      if (!chain) {
        picked = active.filter((e) => e.manager_id === managerId);
      } else {
        picked = active.filter((e) => this.store.inChain(managerId, e.id));
      }
      return picked
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map(toEmployee);
    },
    units: (): RawUnit[] => this.store.units.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    byUnits: (unitIds: string[], includeTerminated = false): EmployeeRow[] =>
      this.store.employees
        .filter((e) => unitIds.includes(e.unit_id) && (e.status === 'active' || includeTerminated))
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(toEmployee),
    private: (employeeId: string): { employee_id: string; cpf: string; birth_date: Day; sex: string } | null => {
      if (!this.selfOnly(employeeId)) return null;
      const e = this.store.employee(employeeId);
      return e ? { employee_id: e.id, cpf: e.cpf, birth_date: fromISO(e.birth_date), sex: e.sex } : null;
    },
  };

  // ------------------------------------------------------------------ vacation
  readonly vacation = {
    periods: (employeeId: string): VacationPeriodRow[] => this.vacation.periodsFor([employeeId]),
    periodsFor: (employeeIds: string[]): VacationPeriodRow[] =>
      this.store.vacationPeriods
        .filter((p) => employeeIds.includes(p.employee_id) && this.teamVisible(p.employee_id))
        .slice()
        .sort(
          (a, b) =>
            (a.employee_id < b.employee_id ? -1 : a.employee_id > b.employee_id ? 1 : 0) ||
            (a.acquisition_start < b.acquisition_start ? -1 : a.acquisition_start > b.acquisition_start ? 1 : 0),
        )
        .map(toPeriod),
    requests: (employeeId: string): VacationRequestRow[] => this.vacation.requestsFor([employeeId]),
    requestsFor: (employeeIds: string[]): VacationRequestRow[] =>
      this.store.vacationRequests
        .filter((r) => employeeIds.includes(r.employee_id) && this.teamVisible(r.employee_id))
        .slice()
        .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
        .map(toRequest),
    getRequest: (requestId: string): VacationRequestRow | null => {
      const r = this.store.vacationRequests.find((x) => x.id === requestId && this.teamVisible(x.employee_id));
      return r ? toRequest(r) : null;
    },
    createRequest: (
      employeeId: string,
      periodId: string,
      start: Day,
      days: number,
      sellDays: number,
      advance13th: boolean,
      requestedAt: Day,
    ): VacationRequestRow => {
      if (employeeId !== this.employeeId) throw new RlsError('vacation request insert denied');
      const row: RawVacationRequest = {
        id: this.store.nextVacationId(),
        employee_id: employeeId,
        period_id: periodId,
        start: toISO(start),
        days,
        sell_days: sellDays,
        advance_13th: advance13th,
        status: 'pending_manager',
        requested_at: toISO(requestedAt),
        decided_by: null,
        decision_note: null,
      };
      this.store.vacationRequests.push(row);
      return toRequest(row);
    },
    setStatus: (requestId: string, status: string, decidedBy: string | null, note: string | null): VacationRequestRow => {
      const row = this.store.vacationRequests.find((x) => x.id === requestId && this.teamWritable(x.employee_id));
      if (!row) throw new RlsError('vacation request not found for this identity');
      row.status = status;
      row.decided_by = decidedBy ?? row.decided_by;
      row.decision_note = note;
      return toRequest(row);
    },
    createLeave: (employeeId: string, kind: string, start: Day, days: number, note: string) => {
      if (employeeId !== this.employeeId) throw new RlsError('leave insert denied');
      const row: RawLeaveRequest = {
        id: `LV-${hex(4).toUpperCase()}`,
        employee_id: employeeId,
        kind,
        start: toISO(start),
        days,
        status: 'registrada',
        note,
      };
      this.store.leaveRequests.push(row);
      return { ...row, start };
    },
    leaves: (employeeId: string) =>
      this.store.leaveRequests
        .filter((l) => l.employee_id === employeeId && this.teamVisible(l.employee_id))
        .map((l) => ({ ...l, start: fromISO(l.start) })),
  };

  // ------------------------------------------------------------------ payroll
  readonly payroll = {
    salaryHistory: (employeeId: string): SalaryEntry[] =>
      this.store.compensation
        .filter((c) => c.employee_id === employeeId && this.compensationVisible(c.employee_id))
        .slice()
        .sort((a, b) => (a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : 0))
        .map((c) => ({ effective_date: fromISO(c.effective_date), salary: c.salary, reason: c.reason })),
    payslips: (employeeId: string, year?: number): RawPayslip[] =>
      this.store.payslips
        .filter(
          (p) =>
            p.employee_id === employeeId &&
            this.compensationVisible(p.employee_id) &&
            (year === undefined || p.month.slice(0, 4) === String(year)),
        )
        .slice()
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0) || (a.kind < b.kind ? -1 : 1)),
    payslip: (employeeId: string, month: string, kind = 'monthly'): RawPayslip | null =>
      this.store.payslips.find(
        (p) => p.employee_id === employeeId && p.month === month && p.kind === kind && this.compensationVisible(p.employee_id),
      ) ?? null,
    incomeStatement: (employeeId: string, year: number): RawIncomeStatement | null =>
      this.store.incomeStatements.find(
        (s) => s.employee_id === employeeId && s.year === year && this.compensationVisible(s.employee_id),
      ) ?? null,
    plr: (employeeId: string): RawPlr[] =>
      this.store.plr.filter((p) => p.employee_id === employeeId && this.compensationVisible(p.employee_id)),
  };

  // ------------------------------------------------------------------ benefits
  readonly benefits = {
    plans: (): RawPlan[] => this.store.benefitPlans.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    enrollments: (employeeId: string): RawEnrollment[] =>
      this.store.enrollments
        .filter((e) => e.employee_id === employeeId && this.selfOnly(e.employee_id))
        .slice()
        .sort((a, b) => (a.plan_id < b.plan_id ? -1 : 1)),
    dependents: (employeeId: string): DependentRow[] =>
      this.store.dependents
        .filter((d) => d.employee_id === employeeId && d.status !== 'removido' && this.selfOnly(d.employee_id))
        .slice()
        .sort((a, b) => (a.birth_date < b.birth_date ? -1 : a.birth_date > b.birth_date ? 1 : 0))
        .map((d) => ({ ...d, birth_date: fromISO(d.birth_date) })),
    balances: (employeeId: string): RawBalances | null =>
      this.store.balances.find((b) => b.employee_id === employeeId && this.selfOnly(b.employee_id)) ?? null,
    planChanges: (employeeId: string): RawPlanChange[] =>
      this.store.planChanges.filter((p) => p.employee_id === employeeId && this.selfOnly(p.employee_id)),
    requestPlanChange: (
      employeeId: string,
      fromPlan: string,
      toPlan: string,
      effective: Day,
      reason: string,
    ): RawPlanChange & { effective_date_day: Day } => {
      if (!this.selfOnly(employeeId)) throw new RlsError('plan change insert denied');
      const row: RawPlanChange = {
        id: `PC-${hex(4).toUpperCase()}`,
        employee_id: employeeId,
        from_plan: fromPlan,
        to_plan: toPlan,
        effective_date: toISO(effective),
        reason,
        status: 'agendada',
      };
      this.store.planChanges.push(row);
      return { ...row, effective_date_day: effective };
    },
    addDependent: (
      employeeId: string,
      name: string,
      relationship: string,
      birthDate: Day,
      irDependent: boolean,
      healthPlan: boolean,
      status: string,
    ): DependentRow => {
      if (!this.selfOnly(employeeId)) throw new RlsError('dependent insert denied');
      const row: RawDependent = {
        id: `D${hex(3).toUpperCase()}`,
        employee_id: employeeId,
        name,
        relationship,
        birth_date: toISO(birthDate),
        ir_dependent: irDependent,
        health_plan: healthPlan,
        status,
      };
      this.store.dependents.push(row);
      return { ...row, birth_date: birthDate };
    },
    enrollDependent: (employeeId: string, dependentId: string): void => {
      if (!this.selfOnly(employeeId)) throw new RlsError('enrollment update denied');
      for (const e of this.store.enrollments) {
        if (e.employee_id === employeeId && !e.dependents.includes(dependentId)) e.dependents.push(dependentId);
      }
    },
    setIrDependent: (employeeId: string, dependentId: string, irDependent: boolean): void => {
      const row = this.store.dependents.find((d) => d.id === dependentId && d.employee_id === employeeId);
      if (!row || !this.selfOnly(employeeId)) throw new RlsError('dependent not found for this identity');
      row.ir_dependent = irDependent;
    },
  };

  // ------------------------------------------------------------------ time
  readonly time = {
    months: (employeeId: string): RawTimeMonth[] => this.time.monthsFor([employeeId]),
    monthsFor: (employeeIds: string[]): RawTimeMonth[] =>
      this.store.timeBank
        .filter((m) => employeeIds.includes(m.employee_id) && this.teamVisible(m.employee_id))
        .slice()
        .sort(
          (a, b) =>
            (a.employee_id < b.employee_id ? -1 : a.employee_id > b.employee_id ? 1 : 0) ||
            (a.month < b.month ? -1 : a.month > b.month ? 1 : 0),
        ),
    adjustments: (employeeId: string): RawTimeAdjustment[] =>
      this.store.timeAdjustments
        .filter((a) => a.employee_id === employeeId && this.teamVisible(a.employee_id))
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    requestAdjustment: (employeeId: string, dayValue: Day, time: string, kind: string, reason: string) => {
      if (!this.selfOnly(employeeId)) throw new RlsError('adjustment insert denied');
      const row: RawTimeAdjustment = {
        id: `AJ-${hex(3).toUpperCase()}`,
        employee_id: employeeId,
        date: toISO(dayValue),
        time,
        kind,
        reason,
        status: 'aguardando gestor',
      };
      this.store.timeAdjustments.push(row);
      return row;
    },
    absencesFor: (employeeIds: string[]): RawAbsence[] =>
      this.store.absences
        .filter((a) => employeeIds.includes(a.employee_id) && this.teamVisible(a.employee_id))
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
  };

  // ------------------------------------------------------------------ reimbursements
  readonly reimbursements = {
    list: (employeeId: string): (Omit<RawReimbursement, 'date'> & { date: Day })[] =>
      this.store.reimbursements
        .filter((r) => r.employee_id === employeeId && this.selfOnly(r.employee_id))
        .slice()
        .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))
        .map((r) => ({ ...r, date: fromISO(r.date) })),
    create: (
      employeeId: string,
      category: string,
      amount: number,
      dayValue: Day,
      merchant: string,
      cnpj: string,
      description: string,
      submittedAt: Day,
    ) => {
      if (!this.selfOnly(employeeId)) throw new RlsError('reimbursement insert denied');
      const row: RawReimbursement = {
        id: `RB-${hex(3).toUpperCase()}`,
        employee_id: employeeId,
        category,
        amount,
        date: toISO(dayValue),
        merchant,
        cnpj,
        status: 'em análise',
        submitted_at: toISO(submittedAt),
        description,
      };
      this.store.reimbursements.push(row);
      return { ...row, date: dayValue };
    },
  };

  // ------------------------------------------------------------------ profile
  readonly profile = {
    address: (employeeId: string): RawAddress | null =>
      this.store.addresses.find((a) => a.employee_id === employeeId && this.selfOnly(a.employee_id)) ?? null,
    bankAccount: (employeeId: string): (Omit<RawBankAccount, 'updated_at'> & { updated_at: Day }) | null => {
      const row = this.store.bankAccounts.find((b) => b.employee_id === employeeId && this.selfOnly(b.employee_id));
      return row ? { ...row, updated_at: fromISO(row.updated_at) } : null;
    },
    updateAddress: (employeeId: string, address: Record<string, string>): RawAddress => {
      const row = this.store.addresses.find((a) => a.employee_id === employeeId);
      if (!row || !this.selfOnly(employeeId)) throw new RlsError('address not found for this identity');
      for (const k of ['street', 'number', 'complement', 'district', 'city', 'state', 'zip'] as const) {
        row[k] = address[k] ?? '';
      }
      return { ...row };
    },
    updateBankAccount: (employeeId: string, account: Record<string, string>, when: Day): RawBankAccount => {
      const row = this.store.bankAccounts.find((b) => b.employee_id === employeeId);
      if (!row || !this.selfOnly(employeeId)) throw new RlsError('bank account not found for this identity');
      for (const k of ['bank_code', 'bank_name', 'agency', 'account', 'type'] as const) row[k] = account[k];
      row.updated_at = toISO(when);
      return { ...row };
    },
  };

  // ------------------------------------------------------------------ career
  readonly career = {
    trainings: (): RawTraining[] => this.store.trainings.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    assignments: (employeeId: string) => this.career.assignmentsFor([employeeId]),
    assignmentsFor: (employeeIds: string[]) =>
      this.store.trainingAssignments
        .filter((a) => employeeIds.includes(a.employee_id) && this.teamVisible(a.employee_id))
        .slice()
        .sort(
          (a, b) =>
            (a.employee_id < b.employee_id ? -1 : a.employee_id > b.employee_id ? 1 : 0) ||
            (a.training_id < b.training_id ? -1 : 1),
        )
        .map((a) => ({ ...a, due_date: a.due_date ? fromISO(a.due_date) : null })),
    learningPaths: (): RawLearningPath[] => this.store.learningPaths.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    reviewCycle: (): RawReviewCycle | null => {
      const sorted = this.store.reviewCycles.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      return sorted.length ? sorted[sorted.length - 1] : null;
    },
    jobPostings: (): (Omit<RawJobPosting, 'posted_at' | 'closes_at'> & { posted_at: Day; closes_at: Day })[] =>
      this.store.jobPostings
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((j) => ({ ...j, posted_at: fromISO(j.posted_at), closes_at: fromISO(j.closes_at) })),
    skills: (employeeId: string): string[] => {
      const row = this.store.skills.find((s) => s.employee_id === employeeId && this.selfOnly(s.employee_id));
      return row ? [...row.skills] : [];
    },
  };

  // ------------------------------------------------------------------ onboarding
  readonly onboarding = {
    tasks: (employeeId: string): (Omit<RawOnboardingTask, 'due_date'> & { due_date: Day })[] =>
      this.store.onboardingTasks
        .filter((t) => t.employee_id === employeeId && this.teamVisible(t.employee_id))
        .slice()
        .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0) || (a.id < b.id ? -1 : 1))
        .map((t) => ({ ...t, due_date: fromISO(t.due_date) })),
    buddy: (employeeId: string): EmployeeRow | null => {
      const b = this.store.buddies.find((x) => x.employee_id === employeeId && this.teamVisible(x.employee_id));
      const e = b ? this.store.employee(b.buddy_id) : undefined;
      return e ? toEmployee(e) : null;
    },
    completeTask: (employeeId: string, taskId: string) => {
      const row = this.store.onboardingTasks.find((t) => t.employee_id === employeeId && t.id === taskId);
      if (!row || !this.teamWritable(employeeId)) throw new RlsError('task not found for this identity');
      row.status = 'concluído';
      return { ...row, due_date: fromISO(row.due_date) };
    },
  };

  // ------------------------------------------------------------------ documents
  readonly documents = {
    record: (employeeId: string, kind: string, params: Record<string, unknown>, issuedOn: Day): IssuedDocument => {
      if (!this.selfOnly(employeeId)) throw new RlsError('document insert denied');
      const doc: IssuedDocument = {
        id: `DOC-${hex(4).toUpperCase()}`,
        employee_id: employeeId,
        kind,
        params,
        verification_code: hex(5).toUpperCase(),
        issued_on: toISO(issuedOn),
      };
      this.store.issuedDocuments.push(doc);
      return doc;
    },
    get: (documentId: string): IssuedDocument | null =>
      this.store.issuedDocuments.find((d) => d.id === documentId && this.selfOnly(d.employee_id)) ?? null,
  };
}

export type { Decision };
export { addDays, cmp, lte };
