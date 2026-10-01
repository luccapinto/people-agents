"""HR domain models shared by ports, adapters and tools."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict


class Model(BaseModel):
    model_config = ConfigDict(frozen=True)


class Unit(Model):
    id: str
    name: str
    parent_id: str | None


class Employee(Model):
    """Directory entry (no personal data)."""

    id: str
    name: str
    email: str
    title: str
    unit_id: str
    manager_id: str | None
    hire_date: date
    location: str
    work_mode: str
    status: str
    termination_date: date | None = None
    termination_reason: str | None = None


class PrivateRecord(Model):
    employee_id: str
    cpf: str
    birth_date: date
    sex: str


class SalaryEntry(Model):
    effective_date: date
    salary: float
    reason: str


class PayslipLine(Model):
    code: str
    label: str
    earning: float | None = None
    deduction: float | None = None


class Payslip(Model):
    id: str
    employee_id: str
    month: str
    kind: str
    gross: float
    deductions: float
    net: float
    inss_base: float
    irrf_base: float
    fgts: float
    lines: list[PayslipLine]
    paid_on: date


class VacationPeriod(Model):
    id: str
    employee_id: str
    acquisition_start: date
    acquisition_end: date
    concession_end: date
    entitled_days: int
    sold_days: int
    status: str  # closed | open | accruing


class VacationRequest(Model):
    id: str
    employee_id: str
    period_id: str
    start: date
    days: int
    sell_days: int
    advance_13th: bool
    status: str
    requested_at: date
    decided_by: str | None = None
    decision_note: str | None = None


class LeaveRequest(Model):
    id: str
    employee_id: str
    kind: str
    start: date
    days: int
    status: str
    note: str | None = None


class TimeMonth(Model):
    employee_id: str
    month: str
    expected_hours: float
    worked_hours: float
    overtime_hours: float
    bank_delta_hours: float
    bank_balance_hours: float


class TimeAdjustment(Model):
    id: str
    employee_id: str
    date: date
    time: str
    kind: str
    reason: str
    status: str


class Absence(Model):
    employee_id: str
    date: date
    type: str
    days: int


class Plan(Model):
    id: str
    kind: str
    name: str
    operator: str
    accommodation: str | None
    coverage: str
    employee_cost: float
    dependent_cost: float
    copay: str
    reimbursement: str
    highlights: list[str]


class Enrollment(Model):
    employee_id: str
    plan_id: str
    since: date
    dependents: list[str]


class Dependent(Model):
    id: str
    employee_id: str
    name: str
    relationship: str
    birth_date: date
    ir_dependent: bool
    health_plan: bool
    status: str


class BenefitBalances(Model):
    employee_id: str
    meal_card_monthly: float
    food_card_monthly: float
    flex_balance: float
    daycare_children: int
    daycare_monthly_per_child: float
    life_insurance_multiple: int
    wellness: str
    transport_voucher: bool


class PlanChangeRequest(Model):
    id: str
    employee_id: str
    from_plan: str
    to_plan: str
    effective_date: date
    reason: str
    status: str


class BankAccount(Model):
    employee_id: str
    bank_code: str
    bank_name: str
    agency: str
    account: str
    type: str
    updated_at: date


class Address(Model):
    employee_id: str
    street: str
    number: str
    complement: str
    district: str
    city: str
    state: str
    zip: str


class Reimbursement(Model):
    id: str
    employee_id: str
    category: str
    amount: float
    date: date
    merchant: str
    cnpj: str
    status: str
    submitted_at: date
    description: str = ""


class Training(Model):
    id: str
    title: str
    mandatory: bool
    hours: int
    due: str | None


class TrainingAssignment(Model):
    employee_id: str
    training_id: str
    status: str
    due_date: date | None
    completed_at: date | None


class JobPosting(Model):
    id: str
    title: str
    unit_id: str
    level: str
    skills: list[str]
    posted_at: date
    closes_at: date


class OnboardingTask(Model):
    id: str
    employee_id: str
    title: str
    category: str
    due_date: date
    status: str
    owner: str


class IncomeStatement(Model):
    employee_id: str
    year: int
    taxable_income: float
    inss: float
    irrf: float
    health_paid: float
    thirteenth_gross: float
    thirteenth_inss: float
    thirteenth_irrf: float
    plr_2024_paid: float
    dependents: int


class PlrPayment(Model):
    employee_id: str
    year: int
    amount: float
    tax: float
    paid_on: date


class IssuedDocument(Model):
    id: str
    employee_id: str
    kind: str
    params: dict
    verification_code: str
