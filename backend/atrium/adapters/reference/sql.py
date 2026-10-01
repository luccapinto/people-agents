"""Reference adapters over the fictional company's ``hr`` schema.

Every provider shares one connection whose transaction carries ``app.employee_id``; the
database's row-level security decides which rows exist for this identity. Queries are
therefore written *without* identity filters beyond the subject being asked for: if the
caller may not see a row, Postgres does not return it.
"""

from __future__ import annotations

import json
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date

from sqlalchemy import Connection, text

from atrium.db.engine import Database
from atrium.text import fold
from atrium.domain.models import (
    Absence,
    Address,
    BankAccount,
    BenefitBalances,
    Dependent,
    Employee,
    Enrollment,
    IncomeStatement,
    IssuedDocument,
    JobPosting,
    LeaveRequest,
    OnboardingTask,
    Payslip,
    Plan,
    PlanChangeRequest,
    PlrPayment,
    PrivateRecord,
    Reimbursement,
    SalaryEntry,
    TimeAdjustment,
    TimeMonth,
    Training,
    TrainingAssignment,
    Unit,
    VacationPeriod,
    VacationRequest,
)

EMP_COLS = "id, name, email, title, unit_id, manager_id, hire_date, location, work_mode, status, termination_date, termination_reason"


class _Repo:
    def __init__(self, conn: Connection) -> None:
        self.c = conn

    def _all(self, sql: str, **params) -> list[dict]:
        return [dict(r._mapping) for r in self.c.execute(text(sql), params)]

    def _one(self, sql: str, **params) -> dict | None:
        r = self.c.execute(text(sql), params).first()
        return dict(r._mapping) if r else None


def _num(row: dict, *keys: str) -> dict:
    for k in keys:
        if row.get(k) is not None:
            row[k] = float(row[k])
    return row


class SqlDirectory(_Repo):
    def get(self, employee_id: str) -> Employee | None:
        r = self._one(f"SELECT {EMP_COLS} FROM hr.employees WHERE id = :id", id=employee_id)
        return Employee(**r) if r else None

    def search(self, query: str, limit: int = 5) -> list[Employee]:
        """Accent- and case-insensitive match on any name token (directory is small)."""
        needle = fold(query).split()
        if not needle:
            return []
        rows = self._all(f"SELECT {EMP_COLS} FROM hr.employees WHERE status = 'active' ORDER BY name")
        hits = [r for r in rows if all(any(t.startswith(n) for t in fold(r["name"]).split()) for n in needle)]
        return [Employee(**r) for r in hits[:limit]]

    def reports(self, manager_id: str, chain: bool = False) -> list[Employee]:
        if not chain:
            rows = self._all(f"SELECT {EMP_COLS} FROM hr.employees WHERE manager_id = :m AND status = 'active' ORDER BY name", m=manager_id)
        else:
            rows = self._all(
                f"""WITH RECURSIVE down AS (
                        SELECT {EMP_COLS} FROM hr.employees WHERE manager_id = :m AND status = 'active'
                        UNION ALL SELECT e.id, e.name, e.email, e.title, e.unit_id, e.manager_id, e.hire_date, e.location,
                            e.work_mode, e.status, e.termination_date, e.termination_reason
                        FROM hr.employees e JOIN down d ON e.manager_id = d.id WHERE e.status = 'active')
                    SELECT * FROM down ORDER BY name""", m=manager_id)
        return [Employee(**r) for r in rows]

    def units(self) -> list[Unit]:
        return [Unit(**r) for r in self._all("SELECT id, name, parent_id FROM hr.units ORDER BY id")]

    def by_units(self, unit_ids: list[str], include_terminated: bool = False) -> list[Employee]:
        rows = self._all(
            f"SELECT {EMP_COLS} FROM hr.employees WHERE unit_id = ANY(:u) AND (status = 'active' OR :t) ORDER BY id",
            u=list(unit_ids), t=include_terminated,
        )
        return [Employee(**r) for r in rows]

    def private(self, employee_id: str) -> PrivateRecord | None:
        r = self._one("SELECT * FROM hr.employee_private WHERE employee_id = :id", id=employee_id)
        return PrivateRecord(**r) if r else None


class SqlVacation(_Repo):
    def periods(self, employee_id: str) -> list[VacationPeriod]:
        return [VacationPeriod(**r) for r in self._all(
            "SELECT * FROM hr.vacation_periods WHERE employee_id = :e ORDER BY acquisition_start", e=employee_id)]

    def periods_for(self, employee_ids: list[str]) -> list[VacationPeriod]:
        return [VacationPeriod(**r) for r in self._all(
            "SELECT * FROM hr.vacation_periods WHERE employee_id = ANY(:e) ORDER BY employee_id, acquisition_start", e=list(employee_ids))]

    def requests(self, employee_id: str) -> list[VacationRequest]:
        return self.requests_for([employee_id])

    def requests_for(self, employee_ids: list[str]) -> list[VacationRequest]:
        rows = self._all(
            """SELECT id, employee_id, period_id, start, days, sell_days, advance_13th, status, requested_at, decided_by, decision_note
               FROM hr.vacation_requests WHERE employee_id = ANY(:e) ORDER BY start""", e=list(employee_ids))
        return [VacationRequest(**r) for r in rows]

    def get_request(self, request_id: str) -> VacationRequest | None:
        r = self._one(
            """SELECT id, employee_id, period_id, start, days, sell_days, advance_13th, status, requested_at, decided_by, decision_note
               FROM hr.vacation_requests WHERE id = :id""", id=request_id)
        return VacationRequest(**r) if r else None

    def create_request(self, employee_id, period_id, start, days, sell_days, advance_13th, requested_at) -> VacationRequest:
        rid = self.c.execute(text("SELECT 'VR-' || nextval('hr.vacation_request_seq')")).scalar_one()
        self.c.execute(text(
            """INSERT INTO hr.vacation_requests (id, employee_id, period_id, start, days, sell_days, advance_13th, status, requested_at)
               VALUES (:id, :e, :p, :s, :d, :sell, :adv, 'pending_manager', :at)"""),
            {"id": rid, "e": employee_id, "p": period_id, "s": start, "d": days, "sell": sell_days, "adv": advance_13th, "at": requested_at})
        req = self.get_request(rid)
        assert req is not None
        return req

    def set_status(self, request_id, status, decided_by, note) -> VacationRequest:
        res = self.c.execute(text(
            """UPDATE hr.vacation_requests SET status = :s, decided_by = coalesce(:by, decided_by), decided_at = now(),
               decision_note = :note WHERE id = :id"""), {"s": status, "by": decided_by, "note": note, "id": request_id})
        if res.rowcount != 1:
            raise PermissionError("vacation request not found for this identity")
        req = self.get_request(request_id)
        assert req is not None
        return req

    def create_leave(self, employee_id, kind, start, days, note) -> LeaveRequest:
        lid = f"LV-{secrets.token_hex(4).upper()}"
        self.c.execute(text(
            "INSERT INTO hr.leave_requests (id, employee_id, kind, start, days, status, note) VALUES (:id, :e, :k, :s, :d, 'registrada', :n)"),
            {"id": lid, "e": employee_id, "k": kind, "s": start, "d": days, "n": note})
        return LeaveRequest(id=lid, employee_id=employee_id, kind=kind, start=start, days=days, status="registrada", note=note)

    def leaves(self, employee_id) -> list[LeaveRequest]:
        return [LeaveRequest(**r) for r in self._all(
            "SELECT id, employee_id, kind, start, days, status, note FROM hr.leave_requests WHERE employee_id = :e ORDER BY start", e=employee_id)]


class SqlPayroll(_Repo):
    def salary_history(self, employee_id) -> list[SalaryEntry]:
        return [SalaryEntry(**_num(r, "salary")) for r in self._all(
            "SELECT effective_date, salary, reason FROM hr.compensation WHERE employee_id = :e ORDER BY effective_date", e=employee_id)]

    def payslips(self, employee_id, year=None) -> list[Payslip]:
        rows = self._all(
            "SELECT * FROM hr.payslips WHERE employee_id = :e AND (:ys = '' OR left(month, 4) = :ys) ORDER BY month, kind",
            e=employee_id, ys=str(year) if year else "")
        return [Payslip(**_num(r, "gross", "deductions", "net", "inss_base", "irrf_base", "fgts")) for r in rows]

    def payslip(self, employee_id, month, kind="monthly") -> Payslip | None:
        r = self._one("SELECT * FROM hr.payslips WHERE employee_id = :e AND month = :m AND kind = :k", e=employee_id, m=month, k=kind)
        return Payslip(**_num(r, "gross", "deductions", "net", "inss_base", "irrf_base", "fgts")) if r else None

    def income_statement(self, employee_id, year) -> IncomeStatement | None:
        r = self._one("SELECT data FROM hr.income_statements WHERE employee_id = :e AND year = :y", e=employee_id, y=year)
        return IncomeStatement(**r["data"]) if r else None

    def plr(self, employee_id) -> list[PlrPayment]:
        return [PlrPayment(**_num(r, "amount", "tax")) for r in self._all(
            "SELECT * FROM hr.plr WHERE employee_id = :e ORDER BY year", e=employee_id)]


class SqlBenefits(_Repo):
    def plans(self) -> list[Plan]:
        return [Plan(**r["data"]) for r in self._all("SELECT data FROM hr.benefit_plans ORDER BY id")]

    def enrollments(self, employee_id) -> list[Enrollment]:
        return [Enrollment(**r) for r in self._all(
            "SELECT employee_id, plan_id, since, dependents FROM hr.benefit_enrollments WHERE employee_id = :e ORDER BY plan_id", e=employee_id)]

    def dependents(self, employee_id) -> list[Dependent]:
        return [Dependent(**r) for r in self._all(
            "SELECT * FROM hr.dependents WHERE employee_id = :e AND status <> 'removido' ORDER BY birth_date", e=employee_id)]

    def balances(self, employee_id) -> BenefitBalances | None:
        r = self._one("SELECT data FROM hr.benefit_balances WHERE employee_id = :e", e=employee_id)
        return BenefitBalances(**r["data"]) if r else None

    def plan_changes(self, employee_id) -> list[PlanChangeRequest]:
        return [PlanChangeRequest(**r) for r in self._all(
            "SELECT id, employee_id, from_plan, to_plan, effective_date, reason, status FROM hr.plan_change_requests WHERE employee_id = :e", e=employee_id)]

    def request_plan_change(self, employee_id, from_plan, to_plan, effective, reason) -> PlanChangeRequest:
        rid = f"PC-{secrets.token_hex(4).upper()}"
        self.c.execute(text(
            """INSERT INTO hr.plan_change_requests (id, employee_id, from_plan, to_plan, effective_date, reason, status)
               VALUES (:id, :e, :f, :t, :d, :r, 'agendada')"""),
            {"id": rid, "e": employee_id, "f": from_plan, "t": to_plan, "d": effective, "r": reason})
        return PlanChangeRequest(id=rid, employee_id=employee_id, from_plan=from_plan, to_plan=to_plan,
                                 effective_date=effective, reason=reason, status="agendada")

    def add_dependent(self, employee_id, name, relationship, birth_date, ir_dependent, health_plan, status) -> Dependent:
        did = f"D{secrets.token_hex(3).upper()}"
        self.c.execute(text(
            "INSERT INTO hr.dependents VALUES (:id, :e, :n, :r, :b, :ir, :hp, :s)"),
            {"id": did, "e": employee_id, "n": name, "r": relationship, "b": birth_date, "ir": ir_dependent, "hp": health_plan, "s": status})
        return Dependent(id=did, employee_id=employee_id, name=name, relationship=relationship, birth_date=birth_date,
                         ir_dependent=ir_dependent, health_plan=health_plan, status=status)

    def enroll_dependent(self, employee_id, dependent_id) -> None:
        self.c.execute(text(
            """UPDATE hr.benefit_enrollments SET dependents = dependents || to_jsonb(CAST(:d AS text))
               WHERE employee_id = :e AND NOT dependents ? :d"""), {"e": employee_id, "d": dependent_id})


class SqlTime(_Repo):
    def months(self, employee_id) -> list[TimeMonth]:
        return self.months_for([employee_id])

    def months_for(self, employee_ids) -> list[TimeMonth]:
        rows = self._all("SELECT * FROM hr.time_bank WHERE employee_id = ANY(:e) ORDER BY employee_id, month", e=list(employee_ids))
        return [TimeMonth(**_num(r, "expected_hours", "worked_hours", "overtime_hours", "bank_delta_hours", "bank_balance_hours")) for r in rows]

    def adjustments(self, employee_id) -> list[TimeAdjustment]:
        return [TimeAdjustment(**r) for r in self._all(
            "SELECT id, employee_id, date, time, kind, reason, status FROM hr.time_adjustments WHERE employee_id = :e ORDER BY date", e=employee_id)]

    def request_adjustment(self, employee_id, day, time, kind, reason) -> TimeAdjustment:
        aid = f"AJ-{secrets.token_hex(3).upper()}"
        self.c.execute(text(
            "INSERT INTO hr.time_adjustments (id, employee_id, date, time, kind, reason, status) VALUES (:id, :e, :d, :t, :k, :r, 'aguardando gestor')"),
            {"id": aid, "e": employee_id, "d": day, "t": time, "k": kind, "r": reason})
        return TimeAdjustment(id=aid, employee_id=employee_id, date=day, time=time, kind=kind, reason=reason, status="aguardando gestor")

    def absences_for(self, employee_ids) -> list[Absence]:
        return [Absence(**r) for r in self._all(
            "SELECT employee_id, date, type, days FROM hr.absences WHERE employee_id = ANY(:e) ORDER BY date", e=list(employee_ids))]


class SqlReimbursements(_Repo):
    def list(self, employee_id) -> list[Reimbursement]:
        return [Reimbursement(**_num(r, "amount")) for r in self._all(
            "SELECT * FROM hr.reimbursements WHERE employee_id = :e ORDER BY date DESC", e=employee_id)]

    def create(self, employee_id, category, amount, day, merchant, cnpj, description, submitted_at) -> Reimbursement:
        rid = f"RB-{secrets.token_hex(3).upper()}"
        self.c.execute(text(
            "INSERT INTO hr.reimbursements VALUES (:id, :e, :c, :a, :d, :m, :cnpj, 'em análise', :s, :desc)"),
            {"id": rid, "e": employee_id, "c": category, "a": amount, "d": day, "m": merchant, "cnpj": cnpj, "s": submitted_at, "desc": description})
        return Reimbursement(id=rid, employee_id=employee_id, category=category, amount=amount, date=day, merchant=merchant,
                             cnpj=cnpj, status="em análise", submitted_at=submitted_at, description=description)


class SqlProfile(_Repo):
    def address(self, employee_id) -> Address | None:
        r = self._one("SELECT * FROM hr.addresses WHERE employee_id = :e", e=employee_id)
        return Address(**r) if r else None

    def bank_account(self, employee_id) -> BankAccount | None:
        r = self._one("SELECT * FROM hr.bank_accounts WHERE employee_id = :e", e=employee_id)
        return BankAccount(**r) if r else None

    def update_address(self, employee_id, address: dict) -> Address:
        fields = {k: address.get(k, "") for k in ("street", "number", "complement", "district", "city", "state", "zip")}
        res = self.c.execute(text(
            """UPDATE hr.addresses SET street = :street, number = :number, complement = :complement, district = :district,
               city = :city, state = :state, zip = :zip WHERE employee_id = :e"""), dict(fields, e=employee_id))
        if res.rowcount != 1:
            raise PermissionError("address not found for this identity")
        return Address(employee_id=employee_id, **fields)

    def update_bank_account(self, employee_id, account: dict, when: date) -> BankAccount:
        fields = {k: account[k] for k in ("bank_code", "bank_name", "agency", "account", "type")}
        res = self.c.execute(text(
            """UPDATE hr.bank_accounts SET bank_code = :bank_code, bank_name = :bank_name, agency = :agency, account = :account,
               type = :type, updated_at = :w WHERE employee_id = :e"""), dict(fields, e=employee_id, w=when))
        if res.rowcount != 1:
            raise PermissionError("bank account not found for this identity")
        return BankAccount(employee_id=employee_id, updated_at=when, **fields)


class SqlCareer(_Repo):
    def trainings(self) -> list[Training]:
        return [Training(**r["data"]) for r in self._all("SELECT data FROM hr.trainings ORDER BY id")]

    def assignments(self, employee_id) -> list[TrainingAssignment]:
        return self.assignments_for([employee_id])

    def assignments_for(self, employee_ids) -> list[TrainingAssignment]:
        return [TrainingAssignment(**r) for r in self._all(
            "SELECT * FROM hr.training_assignments WHERE employee_id = ANY(:e) ORDER BY employee_id, training_id", e=list(employee_ids))]

    def learning_paths(self) -> list[dict]:
        return [r["data"] for r in self._all("SELECT data FROM hr.learning_paths ORDER BY id")]

    def review_cycle(self) -> dict | None:
        r = self._one("SELECT data FROM hr.review_cycles ORDER BY id DESC LIMIT 1")
        return r["data"] if r else None

    def job_postings(self) -> list[JobPosting]:
        return [JobPosting(**r["data"]) for r in self._all("SELECT data FROM hr.job_postings ORDER BY id")]

    def skills(self, employee_id) -> list[str]:
        r = self._one("SELECT skills FROM hr.employee_skills WHERE employee_id = :e", e=employee_id)
        return list(r["skills"]) if r else []


class SqlOnboarding(_Repo):
    def tasks(self, employee_id) -> list[OnboardingTask]:
        return [OnboardingTask(**r) for r in self._all(
            "SELECT * FROM hr.onboarding_tasks WHERE employee_id = :e ORDER BY due_date, id", e=employee_id)]

    def buddy(self, employee_id) -> Employee | None:
        r = self._one(
            f"SELECT {', '.join('e.' + c.strip() for c in EMP_COLS.split(','))} FROM hr.buddies b JOIN hr.employees e ON e.id = b.buddy_id WHERE b.employee_id = :e",
            e=employee_id)
        return Employee(**r) if r else None

    def complete_task(self, employee_id, task_id) -> OnboardingTask:
        res = self.c.execute(text("UPDATE hr.onboarding_tasks SET status = 'concluído' WHERE employee_id = :e AND id = :t"),
                             {"e": employee_id, "t": task_id})
        if res.rowcount != 1:
            raise PermissionError("task not found for this identity")
        return next(t for t in self.tasks(employee_id) if t.id == task_id)


class SqlDocuments(_Repo):
    def record(self, employee_id, kind, params) -> IssuedDocument:
        did = f"DOC-{secrets.token_hex(4).upper()}"
        code = secrets.token_hex(5).upper()
        self.c.execute(text(
            "INSERT INTO hr.documents_issued (id, employee_id, kind, params, verification_code) VALUES (:id, :e, :k, CAST(:p AS jsonb), :c)"),
            {"id": did, "e": employee_id, "k": kind, "p": json.dumps(params, ensure_ascii=False, default=str), "c": code})
        return IssuedDocument(id=did, employee_id=employee_id, kind=kind, params=params, verification_code=code)


@dataclass
class SqlHRSession:
    employee_id: str
    conn: Connection

    def __post_init__(self) -> None:
        c = self.conn
        self.directory = SqlDirectory(c)
        self.vacation = SqlVacation(c)
        self.payroll = SqlPayroll(c)
        self.benefits = SqlBenefits(c)
        self.time = SqlTime(c)
        self.reimbursements = SqlReimbursements(c)
        self.profile = SqlProfile(c)
        self.career = SqlCareer(c)
        self.onboarding = SqlOnboarding(c)
        self.documents = SqlDocuments(c)


class SqlHRGateway:
    """``HRGateway`` over Postgres with RLS."""

    def __init__(self, db: Database) -> None:
        self.db = db

    @contextmanager
    def session(self, employee_id: str) -> Iterator[SqlHRSession]:
        with self.db.scoped(employee_id) as conn:
            yield SqlHRSession(employee_id, conn)
