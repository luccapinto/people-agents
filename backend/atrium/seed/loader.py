"""Load the generated dataset into the ``hr`` schema (runs as the owner role)."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine, text

from atrium.config import REPO_ROOT

DATASET_PATH = REPO_ROOT / "shared/generated/dataset.json"

DEFAULT_POLICIES = {
    "manager_can_view_team_compensation": ({"enabled": False}, "Gestores podem ver salário e holerite do time."),
    "k_anonymity_min": ({"value": 5}, "Tamanho mínimo de grupo em agregados de People Analytics (nunca abaixo de 5)."),
    "retention_days": ({"value": 180}, "Retenção do conteúdo das conversas, em dias."),
    "dlp_secrets_mode": ({"value": "block"}, "Segredos e credenciais coladas no chat: warn ou block."),
    "dlp_customer_data_mode": ({"value": "warn"}, "Dados pessoais em massa (ex.: lista de CPFs): warn ou block."),
    "blocked_topics": ({"value": ["apostas esportivas", "política partidária", "criptomoedas como investimento"]}, "Tópicos que o assistente recusa."),
    "user_daily_token_budget": ({"value": 200000}, "Orçamento diário de tokens por pessoa."),
    "user_rate_limit_per_minute": ({"value": 12}, "Mensagens por minuto por pessoa."),
    "transcript_grant_minutes": ({"value": 60}, "Validade de um acesso justificado a uma transcrição."),
}


def load_dataset(path: Path = DATASET_PATH) -> dict:
    return json.loads(path.read_text())


def _rows(conn, sql: str, rows: list[dict]) -> None:
    if rows:
        conn.execute(text(sql), rows)


def seed(owner_url: str, data: dict | None = None) -> dict:
    data = data or load_dataset()
    engine = create_engine(owner_url)
    with engine.begin() as c:
        _rows(c, "INSERT INTO hr.units (id, name, parent_id) VALUES (:id, :name, :parent_id)",
              sorted(data["units"], key=lambda u: (u["parent_id"] is not None, u["id"])))
        emps = data["employees"]
        _rows(c, """INSERT INTO hr.employees (id, name, email, title, unit_id, manager_id, hire_date, location, work_mode,
                    status, termination_date, termination_reason)
                    VALUES (:id, :name, :email, :title, :unit_id, NULL, :hire_date, :location, :work_mode, :status,
                    :termination_date, :termination_reason)""", emps)
        _rows(c, "UPDATE hr.employees SET manager_id = :manager_id WHERE id = :id",
              [{"id": e["id"], "manager_id": e["manager_id"]} for e in emps if e["manager_id"]])
        _rows(c, "INSERT INTO hr.employee_private VALUES (:id, :cpf, :birth_date, :sex)", emps)
        _rows(c, "INSERT INTO hr.hrbp_assignments VALUES (:hrbp_id, :unit_id)", data["hrbp_assignments"])
        _rows(c, "INSERT INTO hr.platform_roles VALUES (:employee_id, :role)", data["platform_roles"])
        _rows(c, "INSERT INTO hr.compensation (employee_id, effective_date, salary, reason) VALUES (:employee_id, :effective_date, :salary, :reason)", data["compensation"])
        _rows(c, """INSERT INTO hr.payslips VALUES (:id, :employee_id, :month, :kind, :gross, :deductions, :net, :inss_base,
                    :irrf_base, :fgts, CAST(:lines AS jsonb), :paid_on)""",
              [dict(p, lines=json.dumps(p["lines"], ensure_ascii=False)) for p in data["payslips"]])
        _rows(c, "INSERT INTO hr.income_statements VALUES (:employee_id, :year, CAST(:data AS jsonb))",
              [{"employee_id": s["employee_id"], "year": s["year"], "data": json.dumps(s, ensure_ascii=False)} for s in data["income_statements"]])
        _rows(c, "INSERT INTO hr.plr VALUES (:employee_id, :year, :amount, :tax, :paid_on)", data["plr"])
        _rows(c, """INSERT INTO hr.vacation_periods VALUES (:id, :employee_id, :acquisition_start, :acquisition_end,
                    :concession_end, :entitled_days, :sold_days, :status)""", data["vacation_periods"])
        _rows(c, """INSERT INTO hr.vacation_requests (id, employee_id, period_id, start, days, sell_days, advance_13th, status,
                    requested_at, decided_by) VALUES (:id, :employee_id, :period_id, :start, :days, :sell_days, :advance_13th,
                    :status, :requested_at, :decided_by)""", data["vacation_requests"])
        _rows(c, "INSERT INTO hr.absences (employee_id, date, type, days) VALUES (:employee_id, :date, :type, :days)", data["absences"])
        _rows(c, """INSERT INTO hr.time_bank VALUES (:employee_id, :month, :expected_hours, :worked_hours, :overtime_hours,
                    :bank_delta_hours, :bank_balance_hours)""", data["time_bank"])
        _rows(c, "INSERT INTO hr.benefit_plans VALUES (:id, :kind, CAST(:data AS jsonb))",
              [{"id": p["id"], "kind": p["kind"], "data": json.dumps(p, ensure_ascii=False)} for p in data["benefit_plans"]])
        _rows(c, "INSERT INTO hr.benefit_enrollments (employee_id, plan_id, since, dependents) VALUES (:employee_id, :plan_id, :since, CAST(:dependents AS jsonb))",
              [dict(e, dependents=json.dumps(e["dependents"])) for e in data["benefit_enrollments"]])
        _rows(c, """INSERT INTO hr.dependents VALUES (:id, :employee_id, :name, :relationship, :birth_date, :ir_dependent,
                    :health_plan, :status)""", data["dependents"])
        _rows(c, "INSERT INTO hr.benefit_balances VALUES (:employee_id, CAST(:data AS jsonb))",
              [{"employee_id": b["employee_id"], "data": json.dumps(b, ensure_ascii=False)} for b in data["benefit_balances"]])
        _rows(c, "INSERT INTO hr.bank_accounts VALUES (:employee_id, :bank_code, :bank_name, :agency, :account, :type, :updated_at)", data["bank_accounts"])
        _rows(c, "INSERT INTO hr.addresses VALUES (:employee_id, :street, :number, :complement, :district, :city, :state, :zip)", data["addresses"])
        _rows(c, """INSERT INTO hr.reimbursements VALUES (:id, :employee_id, :category, :amount, :date, :merchant, :cnpj,
                    :status, :submitted_at, :description)""", data["reimbursements"])
        for table, key in (("trainings", "trainings"), ("learning_paths", "learning_paths"), ("review_cycles", "review_cycles"), ("job_postings", "job_postings")):
            _rows(c, f"INSERT INTO hr.{table} VALUES (:id, CAST(:data AS jsonb))",
                  [{"id": r["id"], "data": json.dumps(r, ensure_ascii=False)} for r in data[key]])
        _rows(c, "INSERT INTO hr.training_assignments VALUES (:employee_id, :training_id, :status, :due_date, :completed_at)", data["training_assignments"])
        _rows(c, "INSERT INTO hr.employee_skills VALUES (:employee_id, :skills)", data["employee_skills"])
        _rows(c, "INSERT INTO hr.onboarding_tasks VALUES (:id, :employee_id, :title, :category, :due_date, :status, :owner)", data["onboarding_tasks"])
        _rows(c, "INSERT INTO hr.buddies VALUES (:employee_id, :buddy_id)", data["buddies"])
        _rows(c, "INSERT INTO app.policies (key, value, description) VALUES (:key, CAST(:value AS jsonb), :description) ON CONFLICT (key) DO NOTHING",
              [{"key": k, "value": json.dumps(v), "description": d} for k, (v, d) in DEFAULT_POLICIES.items()])
    engine.dispose()
    return {"employees": len(data["employees"]), "payslips": len(data["payslips"])}
