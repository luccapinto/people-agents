-- Systems of record of the fictional company (the "HRIS"). In a real deployment these
-- tables live behind HRIS/payroll/benefits APIs; the reference adapters read them here.
CREATE SCHEMA hr;

CREATE TABLE hr.units (
    id text PRIMARY KEY,
    name text NOT NULL,
    parent_id text REFERENCES hr.units(id)
);

-- Directory: visible to any authenticated employee (name, title, unit, manager).
CREATE TABLE hr.employees (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    title text NOT NULL,
    unit_id text NOT NULL REFERENCES hr.units(id),
    manager_id text REFERENCES hr.employees(id),
    hire_date date NOT NULL,
    location text NOT NULL,
    work_mode text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'terminated')),
    termination_date date,
    termination_reason text
);
CREATE INDEX ON hr.employees (manager_id);
CREATE INDEX ON hr.employees (unit_id);

-- Private record: self only.
CREATE TABLE hr.employee_private (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    cpf text NOT NULL,
    birth_date date NOT NULL,
    sex char(1) NOT NULL
);

CREATE TABLE hr.hrbp_assignments (
    hrbp_id text NOT NULL REFERENCES hr.employees(id),
    unit_id text NOT NULL REFERENCES hr.units(id),
    PRIMARY KEY (hrbp_id, unit_id)
);

CREATE TABLE hr.platform_roles (
    employee_id text NOT NULL REFERENCES hr.employees(id),
    role text NOT NULL,
    PRIMARY KEY (employee_id, role)
);

CREATE TABLE hr.compensation (
    id bigserial PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    effective_date date NOT NULL,
    salary numeric(12, 2) NOT NULL,
    reason text NOT NULL
);
CREATE INDEX ON hr.compensation (employee_id, effective_date);

CREATE TABLE hr.payslips (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    month text NOT NULL,
    kind text NOT NULL,
    gross numeric(12, 2) NOT NULL,
    deductions numeric(12, 2) NOT NULL,
    net numeric(12, 2) NOT NULL,
    inss_base numeric(12, 2) NOT NULL,
    irrf_base numeric(12, 2) NOT NULL,
    fgts numeric(12, 2) NOT NULL,
    lines jsonb NOT NULL,
    paid_on date NOT NULL
);
CREATE INDEX ON hr.payslips (employee_id, month);

CREATE TABLE hr.income_statements (
    employee_id text NOT NULL REFERENCES hr.employees(id),
    year int NOT NULL,
    data jsonb NOT NULL,
    PRIMARY KEY (employee_id, year)
);

CREATE TABLE hr.plr (
    employee_id text NOT NULL REFERENCES hr.employees(id),
    year int NOT NULL,
    amount numeric(12, 2) NOT NULL,
    tax numeric(12, 2) NOT NULL,
    paid_on date NOT NULL,
    PRIMARY KEY (employee_id, year)
);

CREATE TABLE hr.vacation_periods (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    acquisition_start date NOT NULL,
    acquisition_end date NOT NULL,
    concession_end date NOT NULL,
    entitled_days int NOT NULL,
    sold_days int NOT NULL DEFAULT 0,
    status text NOT NULL
);
CREATE INDEX ON hr.vacation_periods (employee_id);

CREATE TABLE hr.vacation_requests (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    period_id text NOT NULL REFERENCES hr.vacation_periods(id),
    start date NOT NULL,
    days int NOT NULL CHECK (days >= 5),
    sell_days int NOT NULL DEFAULT 0,
    advance_13th boolean NOT NULL DEFAULT false,
    status text NOT NULL CHECK (status IN ('pending_manager', 'approved', 'taken', 'rejected', 'cancelled')),
    requested_at date NOT NULL,
    decided_by text REFERENCES hr.employees(id),
    decided_at timestamptz,
    decision_note text
);
CREATE INDEX ON hr.vacation_requests (employee_id);
CREATE SEQUENCE hr.vacation_request_seq START 50000;

CREATE TABLE hr.leave_requests (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    kind text NOT NULL,
    start date NOT NULL,
    days int NOT NULL,
    status text NOT NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr.absences (
    id bigserial PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    date date NOT NULL,
    type text NOT NULL,
    days int NOT NULL
);

CREATE TABLE hr.time_bank (
    employee_id text NOT NULL REFERENCES hr.employees(id),
    month text NOT NULL,
    expected_hours numeric(6, 1) NOT NULL,
    worked_hours numeric(6, 1) NOT NULL,
    overtime_hours numeric(6, 1) NOT NULL,
    bank_delta_hours numeric(6, 1) NOT NULL,
    bank_balance_hours numeric(6, 1) NOT NULL,
    PRIMARY KEY (employee_id, month)
);

CREATE TABLE hr.time_adjustments (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    date date NOT NULL,
    time text NOT NULL,
    kind text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Public catalogs.
CREATE TABLE hr.benefit_plans (
    id text PRIMARY KEY,
    kind text NOT NULL,
    data jsonb NOT NULL
);

CREATE TABLE hr.benefit_enrollments (
    id bigserial PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    plan_id text NOT NULL REFERENCES hr.benefit_plans(id),
    since date NOT NULL,
    dependents jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE hr.plan_change_requests (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    from_plan text NOT NULL,
    to_plan text NOT NULL,
    effective_date date NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr.dependents (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    name text NOT NULL,
    relationship text NOT NULL,
    birth_date date NOT NULL,
    ir_dependent boolean NOT NULL,
    health_plan boolean NOT NULL,
    status text NOT NULL
);

CREATE TABLE hr.benefit_balances (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    data jsonb NOT NULL
);

CREATE TABLE hr.bank_accounts (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    bank_code text NOT NULL,
    bank_name text NOT NULL,
    agency text NOT NULL,
    account text NOT NULL,
    type text NOT NULL,
    updated_at date NOT NULL
);

CREATE TABLE hr.addresses (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    street text NOT NULL,
    number text NOT NULL,
    complement text NOT NULL,
    district text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    zip text NOT NULL
);

CREATE TABLE hr.reimbursements (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    category text NOT NULL,
    amount numeric(12, 2) NOT NULL,
    date date NOT NULL,
    merchant text NOT NULL,
    cnpj text NOT NULL,
    status text NOT NULL,
    submitted_at date NOT NULL,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE hr.trainings (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE hr.learning_paths (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE hr.review_cycles (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE hr.job_postings (id text PRIMARY KEY, data jsonb NOT NULL);

CREATE TABLE hr.training_assignments (
    employee_id text NOT NULL REFERENCES hr.employees(id),
    training_id text NOT NULL REFERENCES hr.trainings(id),
    status text NOT NULL,
    due_date date,
    completed_at date,
    PRIMARY KEY (employee_id, training_id)
);

CREATE TABLE hr.employee_skills (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    skills text[] NOT NULL
);

CREATE TABLE hr.onboarding_tasks (
    id text NOT NULL,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    title text NOT NULL,
    category text NOT NULL,
    due_date date NOT NULL,
    status text NOT NULL,
    owner text NOT NULL,
    PRIMARY KEY (employee_id, id)
);

CREATE TABLE hr.buddies (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    buddy_id text NOT NULL REFERENCES hr.employees(id)
);

CREATE TABLE hr.documents_issued (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    kind text NOT NULL,
    params jsonb NOT NULL,
    verification_code text NOT NULL UNIQUE,
    issued_at timestamptz NOT NULL DEFAULT now()
);
