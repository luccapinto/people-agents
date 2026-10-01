"""Deterministic generator of the fictional company "Nimbus Serviços Digitais S.A.".

Everything here is fictional. The generator is seeded, iterates in a fixed order and
never depends on the wall clock: the reference date is ``REFERENCE_TODAY`` (2026-10-01).
The output dict is the single dataset used by the Postgres seed and by the static demo
(``shared/generated/dataset.json``).
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal

from atrium.calculators.holidays import holiday_map, is_non_working
from atrium.calculators.money import cents
from atrium.calculators.payroll import PayslipInput, payslip, plr_tax, thirteenth
from atrium.calculators.vacation import add_years, concession_end, is_valid_start
from atrium.clock import REFERENCE_TODAY

TODAY = REFERENCE_TODAY
SEED = 20261001

FIRST_F = ["Ana", "Beatriz", "Camila", "Daniela", "Eduarda", "Fernanda", "Gabriela", "Helena", "Isabela", "Júlia",
           "Larissa", "Letícia", "Luana", "Manuela", "Natália", "Olívia", "Paula", "Renata", "Sofia", "Tatiane",
           "Vanessa", "Yasmin", "Aline", "Bruna", "Carolina", "Débora", "Elisa", "Flávia", "Giovana", "Lívia"]
FIRST_M = ["André", "Bernardo", "Caio", "Diego", "Enzo", "Felipe", "Gabriel", "Henrique", "Igor", "João",
           "Leonardo", "Lucas", "Marcelo", "Nicolas", "Otávio", "Pedro", "Rodrigo", "Samuel", "Tiago", "Vinícius",
           "Arthur", "Breno", "César", "Danilo", "Emanuel", "Fábio", "Guilherme", "Heitor", "Murilo", "Vitor"]
LAST = ["Silva", "Santos", "Oliveira", "Souza", "Pereira", "Carvalho", "Ferreira", "Rodrigues", "Almeida", "Nascimento",
        "Araújo", "Ribeiro", "Martins", "Barbosa", "Gomes", "Cardoso", "Monteiro", "Freitas", "Correia", "Dias",
        "Vieira", "Batista", "Moreira", "Cavalcanti", "Rocha", "Teixeira", "Campos", "Pinheiro", "Andrade", "Machado",
        "Fonseca", "Siqueira", "Queiroz", "Bezerra", "Tavares", "Lacerda", "Peixoto", "Brandão", "Guimarães", "Sales"]

# id, name, parent, head (name, sex, title, salary), staff size, staff titles [(title, min, max)]
UNITS = [
    ("U01", "Presidência", None, ("Helena Duarte", "F", "Diretora-Presidente", 48000), 2,
     [("Chief of Staff", 18000, 22000), ("Assistente Executiva", 6500, 7500)]),
    ("U10", "Tecnologia", "U01", ("Eduardo Ramos", "M", "Diretor de Tecnologia", 38000), 0, []),
    ("U11", "Plataforma de Dados", "U10", ("Mariana Costa", "F", "Gerente de Plataforma de Dados", 21500), 8,
     [("Engenheira(o) de Dados Sênior", 14500, 17500), ("Engenheira(o) de Dados Pleno", 10500, 12500),
      ("Analista de Dados Pleno", 8800, 10500), ("Cientista de Dados Sênior", 15000, 18000)]),
    ("U12", "Engenharia de Produto", "U10", ("Thiago Nogueira", "M", "Gerente de Engenharia", 22000), 12,
     [("Desenvolvedor(a) Sênior", 14000, 17500), ("Desenvolvedor(a) Pleno", 9500, 12500),
      ("Designer de Produto", 9000, 12000), ("Analista de Produto Júnior", 5200, 6200)]),
    ("U13", "Infraestrutura e Segurança", "U10", ("Fernanda Lopes", "F", "Gerente de Infraestrutura", 21000), 8,
     [("Engenheira(o) de Confiabilidade", 12500, 16000), ("Analista de Segurança da Informação", 9000, 13000)]),
    ("U14", "Governança de IA", "U10", ("Carlos Mendes", "M", "Líder de Governança de IA e Plataforma", 19500), 2,
     [("Especialista em Governança de IA", 13000, 15500)]),
    ("U20", "Pessoas", "U01", ("Luciana Prado", "F", "Diretora de Pessoas", 34000), 0, []),
    ("U21", "Business Partners", "U20", ("Sílvia Moura", "F", "Gerente de Business Partners", 17500), 3,
     [("Analista de Business Partner", 6500, 8500)]),
    ("U22", "Departamento Pessoal e Benefícios", "U20", ("Cláudia Reis", "F", "Coordenadora de DP e Benefícios", 12500), 4,
     [("Analista de DP", 5200, 7200), ("Analista de Benefícios", 5400, 7000)]),
    ("U23", "Desenvolvimento e Cultura", "U20", ("Bruno Teixeira", "M", "Coordenador de Desenvolvimento", 12800), 3,
     [("Analista de T&D", 5800, 7600)]),
    ("U30", "Financeiro", "U01", ("Ricardo Azevedo", "M", "Diretor Financeiro", 36000), 0, []),
    ("U31", "Contabilidade e Fiscal", "U30", ("Simone Prates", "F", "Gerente de Contabilidade", 16500), 5,
     [("Analista Contábil", 6000, 8500), ("Analista Fiscal", 6200, 8800)]),
    ("U32", "FP&A", "U30", ("Marcos Vidal", "M", "Gerente de FP&A", 17000), 4,
     [("Analista Financeiro", 7000, 10500)]),
    ("U40", "Comercial", "U01", ("Paulo Henrique Lima", "M", "Diretor Comercial", 35000), 0, []),
    ("U41", "Vendas", "U40", ("Adriana Fontes", "F", "Gerente de Vendas", 18500), 13,
     [("Executivo(a) de Contas", 7500, 12000), ("SDR", 4200, 5200)]),
    ("U42", "Sucesso do Cliente", "U40", ("Rogério Salles", "M", "Gerente de Sucesso do Cliente", 16000), 8,
     [("Analista de Sucesso do Cliente", 5500, 8000)]),
    ("U50", "Operações", "U01", ("Vera Albuquerque", "F", "Diretora de Operações", 33000), 0, []),
    ("U51", "Atendimento", "U50", ("Jorge Matos", "M", "Coordenador de Atendimento", 11000), 16,
     [("Analista de Atendimento", 3600, 4800), ("Analista de Atendimento Sênior", 4800, 6000)]),
    ("U52", "Processos e Qualidade", "U50", ("Kátia Ramalho", "F", "Coordenadora de Qualidade", 11500), 5,
     [("Analista de Processos", 5800, 8200)]),
    ("U60", "Jurídico e Compliance", "U01", ("Gustavo Pires", "M", "Diretor Jurídico e de Compliance", 30000), 3,
     [("Advogada(o)", 11000, 15000), ("Analista de Compliance", 7500, 9500)]),
]

# Fixed people (personas and people referenced by tests and docs).
FIXED_STAFF = {
    "U11": [("Rafael Lima", "M", "Analista de Dados Pleno", 9800, date(2024, 3, 4))],
    "U12": [("Beatriz Rocha", "F", "Analista de Produto Júnior", 5600, date(2026, 9, 21))],
    "U21": [("Patrícia Almeida", "F", "HR Business Partner — Tecnologia", 13800, date(2019, 5, 6)),
            ("Renato Farias", "M", "HR Business Partner — Negócios", 13200, date(2021, 2, 1))],
    "U31": [("Maria Oliveira", "F", "Analista Contábil Sênior", 9600, date(2018, 8, 13))],
}
FIXED_HEAD_HIRE = {"Mariana Costa": date(2020, 1, 13), "Carlos Mendes": date(2021, 6, 7)}

PERSONAS = [
    {"key": "colaborador", "name": "Rafael Lima", "label": "Colaborador", "description": "Analista de Dados Pleno, 2 anos e meio de casa, casado, plano de saúde com dependente."},
    {"key": "gestora", "name": "Mariana Costa", "label": "Gestora", "description": "Gerente de Plataforma de Dados, time de 8 pessoas."},
    {"key": "hrbp", "name": "Patrícia Almeida", "label": "RH / HRBP", "description": "HR Business Partner da Tecnologia: vê agregados com k-anonimato."},
    {"key": "governanca", "name": "Carlos Mendes", "label": "Governança", "description": "Admin de Governança de IA: auditoria, políticas, Agent Studio."},
    {"key": "novata", "name": "Beatriz Rocha", "label": "Recém-admitida", "description": "Analista de Produto Júnior, em onboarding desde 21/09/2026."},
]

HEALTH_PLANS = [
    {"id": "PLN-ESS", "kind": "health", "name": "Vitalis Essencial", "operator": "Vitalis Saúde (fictícia)",
     "accommodation": "enfermaria", "coverage": "regional (Grande São Paulo)", "employee_cost": 0.00,
     "dependent_cost": 180.00, "copay": "30% por consulta e exame simples, limitado a R$ 60 por evento",
     "reimbursement": "não possui", "highlights": ["Hospitais da rede Vitalis Grande SP", "Telemedicina 24h", "Sem mensalidade para o titular"]},
    {"id": "PLN-PLUS", "kind": "health", "name": "Vitalis Plus", "operator": "Vitalis Saúde (fictícia)",
     "accommodation": "apartamento", "coverage": "nacional", "employee_cost": 120.00,
     "dependent_cost": 290.00, "copay": "20% por consulta e exame simples, limitado a R$ 40 por evento",
     "reimbursement": "até 2x a tabela Vitalis em consultas", "highlights": ["Rede nacional", "Quarto privativo", "Telemedicina 24h"]},
    {"id": "PLN-PREM", "kind": "health", "name": "Vitalis Premium", "operator": "Vitalis Saúde (fictícia)",
     "accommodation": "apartamento", "coverage": "nacional e emergência internacional", "employee_cost": 380.00,
     "dependent_cost": 520.00, "copay": "sem coparticipação",
     "reimbursement": "até 5x a tabela Vitalis", "highlights": ["Hospitais premium", "Livre escolha com reembolso", "Check-up anual"]},
    {"id": "ODO-BAS", "kind": "dental", "name": "Sorriso Odonto Básico", "operator": "Sorriso Odonto (fictícia)",
     "accommodation": None, "coverage": "nacional", "employee_cost": 0.00, "dependent_cost": 0.00,
     "copay": "sem coparticipação", "reimbursement": "não possui", "highlights": ["Prevenção e restaurações", "Urgência 24h"]},
    {"id": "ODO-PLUS", "kind": "dental", "name": "Sorriso Odonto Plus", "operator": "Sorriso Odonto (fictícia)",
     "accommodation": None, "coverage": "nacional", "employee_cost": 25.00, "dependent_cost": 25.00,
     "copay": "sem coparticipação", "reimbursement": "não possui", "highlights": ["Ortodontia", "Implantes com carência de 12 meses"]},
]

TRAININGS = [
    {"id": "TR-CONDUTA", "title": "Código de Conduta 2026", "mandatory": True, "hours": 1, "due": "2026-10-31"},
    {"id": "TR-LGPD", "title": "LGPD Essencial", "mandatory": True, "hours": 2, "due": "2026-11-30"},
    {"id": "TR-SEGINFO", "title": "Segurança da Informação e Phishing", "mandatory": True, "hours": 1, "due": "2026-10-15"},
    {"id": "TR-ASSEDIO", "title": "Prevenção ao Assédio e Respeito", "mandatory": True, "hours": 1, "due": "2026-12-15"},
    {"id": "TR-IA", "title": "Uso Responsável de IA Generativa", "mandatory": True, "hours": 1, "due": "2026-11-15"},
    {"id": "TR-DBT", "title": "Modelagem de Dados com dbt", "mandatory": False, "hours": 8, "due": None},
    {"id": "TR-LIDER", "title": "Liderança Situacional", "mandatory": False, "hours": 12, "due": None},
    {"id": "TR-COMUNIC", "title": "Comunicação Assertiva", "mandatory": False, "hours": 4, "due": None},
    {"id": "TR-PYTHON", "title": "Python para Análise de Dados", "mandatory": False, "hours": 16, "due": None},
    {"id": "TR-PRODUTO", "title": "Descoberta de Produto", "mandatory": False, "hours": 6, "due": None},
]

LEARNING_PATHS = [
    {"id": "LP-DADOS", "title": "Trilha de Engenharia de Dados", "audience": "Tecnologia", "steps": ["TR-PYTHON", "TR-DBT"], "description": "Do SQL à orquestração de pipelines confiáveis."},
    {"id": "LP-LIDER", "title": "Trilha de Primeira Liderança", "audience": "Gestores e futuros gestores", "steps": ["TR-LIDER", "TR-COMUNIC"], "description": "Feedback, delegação e conversas de carreira."},
    {"id": "LP-PRODUTO", "title": "Trilha de Produto", "audience": "Produto e Engenharia", "steps": ["TR-PRODUTO", "TR-COMUNIC"], "description": "Descoberta, priorização e métricas."},
]

JOB_POSTINGS = [
    {"id": "VG-101", "title": "Engenheira(o) de Dados Sênior", "unit_id": "U11", "level": "Sênior", "skills": ["python", "sql", "dbt", "airflow", "spark"], "posted_at": "2026-09-15", "closes_at": "2026-10-20"},
    {"id": "VG-102", "title": "Analista de Dados Sênior — Pricing", "unit_id": "U32", "level": "Sênior", "skills": ["sql", "python", "estatística", "power bi"], "posted_at": "2026-09-22", "closes_at": "2026-10-25"},
    {"id": "VG-103", "title": "Cientista de Dados Pleno — Atendimento", "unit_id": "U51", "level": "Pleno", "skills": ["python", "machine learning", "sql", "nlp"], "posted_at": "2026-09-10", "closes_at": "2026-10-18"},
    {"id": "VG-104", "title": "Product Manager Pleno", "unit_id": "U12", "level": "Pleno", "skills": ["descoberta de produto", "sql", "métricas"], "posted_at": "2026-09-01", "closes_at": "2026-10-10"},
    {"id": "VG-105", "title": "Analista de Governança de IA", "unit_id": "U14", "level": "Pleno", "skills": ["governança", "lgpd", "python", "avaliação de modelos"], "posted_at": "2026-09-25", "closes_at": "2026-10-30"},
    {"id": "VG-106", "title": "Executivo(a) de Contas Enterprise", "unit_id": "U41", "level": "Sênior", "skills": ["negociação", "crm", "vendas complexas"], "posted_at": "2026-09-18", "closes_at": "2026-10-22"},
    {"id": "VG-107", "title": "Analista de Benefícios Pleno", "unit_id": "U22", "level": "Pleno", "skills": ["benefícios", "excel", "atendimento"], "posted_at": "2026-09-05", "closes_at": "2026-10-12"},
]

SKILLS_BY_UNIT = {
    "U11": ["python", "sql", "dbt", "airflow", "spark", "estatística", "power bi", "machine learning"],
    "U12": ["typescript", "react", "python", "descoberta de produto", "métricas", "sql"],
    "U13": ["kubernetes", "terraform", "segurança", "python", "observabilidade"],
    "U14": ["governança", "lgpd", "python", "avaliação de modelos"],
    "U31": ["contabilidade", "excel", "fiscal"], "U32": ["excel", "sql", "power bi", "estatística"],
    "U41": ["negociação", "crm", "vendas complexas"], "U42": ["atendimento", "crm", "métricas"],
    "U51": ["atendimento", "crm"], "U52": ["processos", "excel", "métricas"],
}

REVIEW_CYCLE = {
    "id": "CICLO-2026", "name": "Ciclo de Desempenho 2026",
    "phases": [
        {"key": "self", "label": "Autoavaliação", "start": "2026-10-05", "end": "2026-10-23"},
        {"key": "manager", "label": "Avaliação do gestor", "start": "2026-10-26", "end": "2026-11-13"},
        {"key": "calibration", "label": "Calibração", "start": "2026-11-16", "end": "2026-11-27"},
        {"key": "feedback", "label": "Conversas de feedback", "start": "2026-12-07", "end": "2026-12-18"},
    ],
}

BANKS = [("001", "Banco Horizonte (fictício)"), ("077", "Banco Aurora (fictício)"), ("260", "Banco Pétala (fictício)"), ("341", "Banco Meridiano (fictício)")]
STREETS = ["Rua das Acácias", "Avenida Paulista", "Rua Harmonia", "Rua Cardeal Arcoverde", "Rua Augusta", "Alameda Santos",
           "Rua Vergueiro", "Rua dos Pinheiros", "Avenida Rebouças", "Rua Tucuna", "Rua Fradique Coutinho"]
DISTRICTS = ["Pinheiros", "Vila Madalena", "Bela Vista", "Moema", "Perdizes", "Vila Mariana", "Tatuapé", "Santana"]


def _cpf(rng: random.Random) -> str:
    digits = [rng.randint(0, 9) for _ in range(9)]
    for factor in (10, 11):
        s = sum(d * (factor - i) for i, d in enumerate(digits))
        r = (s * 10) % 11
        digits.append(0 if r == 10 else r)
    s = "".join(map(str, digits))
    return f"{s[:3]}.{s[3:6]}.{s[6:9]}-{s[9:]}"


def _slug(name: str) -> str:
    import unicodedata

    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    parts = n.split()
    return f"{parts[0]}.{parts[-1]}"


def _month_starts(start: date, end: date) -> list[date]:
    out = []
    d = date(start.year, start.month, 1)
    while d <= end:
        out.append(d)
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


def _dsr_ratio(year: int, month: int, hmap) -> Decimal:
    d = date(year, month, 1)
    rest = useful = 0
    while d.month == month:
        if d.weekday() == 6 or d in hmap:
            rest += 1
        else:
            useful += 1
        d += timedelta(days=1)
    return Decimal(rest) / Decimal(useful)


class Generator:
    def __init__(self) -> None:
        self.rng = random.Random(SEED)
        self.hmap = holiday_map(range(2015, 2029))
        self.used_names: set[str] = set()
        self.employees: list[dict] = []
        self.seq = 1000

    # ----------------------------------------------------------------- people
    def _new_id(self) -> str:
        self.seq += 1
        return f"E{self.seq}"

    def _random_name(self, sex: str) -> str:
        while True:
            first = self.rng.choice(FIRST_F if sex == "F" else FIRST_M)
            last = self.rng.choice(LAST)
            name = f"{first} {last}"
            if name not in self.used_names and not name.startswith("Maria "):
                self.used_names.add(name)
                return name

    _GENDERED = {
        "Engenheira(o)": ("Engenheira", "Engenheiro"),
        "Executivo(a)": ("Executiva", "Executivo"),
        "Desenvolvedor(a)": ("Desenvolvedora", "Desenvolvedor"),
        "Advogada(o)": ("Advogada", "Advogado"),
    }

    def _title(self, title: str, sex: str) -> str:
        for token, (fem, masc) in self._GENDERED.items():
            title = title.replace(token, fem if sex == "F" else masc)
        return title

    def _person(self, name, sex, title, salary, unit_id, manager_id, hire: date, status="active", term=None) -> dict:
        self.used_names.add(name)
        rng = self.rng
        emp = {
            "id": self._new_id(),
            "name": name,
            "email": f"{_slug(name)}@nimbus.example",
            "title": title,
            "unit_id": unit_id,
            "manager_id": manager_id,
            "hire_date": hire.isoformat(),
            "birth_date": date(rng.randint(1972, 2002), rng.randint(1, 12), rng.randint(1, 28)).isoformat(),
            "sex": sex,
            "location": "SP-SAO_PAULO",
            "work_mode": rng.choice(["híbrido", "híbrido", "híbrido", "remoto", "presencial"]),
            "status": status,
            "termination_date": term.isoformat() if term else None,
            "termination_reason": None,
            "cpf": _cpf(rng),
            "salary": salary,
        }
        self.employees.append(emp)
        return emp

    def build_people(self) -> None:
        rng = self.rng
        heads: dict[str, dict] = {}
        for uid, _name, parent, head, _staff, _titles in UNITS:
            hname, hsex, htitle, hsal = head
            manager = heads[parent]["id"] if parent else None
            hire = FIXED_HEAD_HIRE.get(hname) or date(rng.randint(2014, 2022), rng.randint(1, 12), rng.randint(1, 28))
            heads[uid] = self._person(hname, hsex, htitle, hsal, uid, manager, hire)
        for uid, _name, _parent, _head, staff, titles in UNITS:
            fixed = FIXED_STAFF.get(uid, [])
            for name, sex, title, sal, hire in fixed:
                self._person(name, sex, title, sal, uid, heads[uid]["id"], hire)
            for _ in range(staff - len(fixed)):
                sex = rng.choice("FM")
                t, lo, hi = rng.choice(titles)
                sal = round(rng.uniform(lo, hi) / 50) * 50
                hire = date(rng.randint(2016, 2026), rng.randint(1, 12), rng.randint(1, 28))
                if hire > TODAY - timedelta(days=60):
                    hire = TODAY - timedelta(days=rng.randint(200, 2400))
                self._person(self._random_name(sex), sex, self._title(t, sex), sal, uid, heads[uid]["id"], hire)
        # Terminated people over the last 12 months (turnover analytics).
        term_units = ["U51", "U51", "U51", "U41", "U41", "U42", "U12", "U12", "U13", "U31", "U52", "U11"]
        reasons = ["pedido de demissão", "pedido de demissão", "desligamento sem justa causa", "fim de contrato"]
        for uid in term_units:
            unit = next(u for u in UNITS if u[0] == uid)
            sex = rng.choice("FM")
            t, lo, hi = rng.choice(unit[5])
            hire = date(rng.randint(2018, 2024), rng.randint(1, 12), rng.randint(1, 28))
            term = TODAY - timedelta(days=rng.randint(10, 360))
            p = self._person(self._random_name(sex), sex, self._title(t, sex), round(rng.uniform(lo, hi) / 50) * 50,
                             uid, heads[uid]["id"], hire, status="terminated", term=term)
            p["termination_reason"] = rng.choice(reasons)
        self.heads = heads
        # Mariana's team: fixed hire dates so the leadership scenarios are always present:
        # two vacations expiring soon, one person without vacation for a long time, one pending request.
        team = [e for e in self.employees if e["manager_id"] == heads["U11"]["id"] and e["status"] == "active"]
        for e, hire in zip(team[1:5], (date(2022, 12, 5), date(2023, 11, 20), date(2021, 4, 12), date(2022, 8, 1)), strict=True):
            e["hire_date"] = hire.isoformat()

    def by_name(self, name: str) -> dict:
        return next(e for e in self.employees if e["name"] == name)

    # ----------------------------------------------------------------- compensation
    def build_compensation(self) -> list[dict]:
        rows = []
        for e in self.employees:
            hire = date.fromisoformat(e["hire_date"])
            final = Decimal(e["salary"])
            # Annual merit in March; walk backwards from the current salary.
            raises = []
            y = TODAY.year if TODAY.month >= 3 else TODAY.year - 1
            while date(y, 3, 1) > hire and len(raises) < 4:
                raises.append(date(y, 3, 1))
                y -= 1
            if e["status"] == "terminated":
                raises = [r for r in raises if r < date.fromisoformat(e["termination_date"])]
            salary = final
            entries = []
            for r in raises:
                pct = Decimal(str(self.rng.choice([0.04, 0.05, 0.055, 0.06, 0.08])))
                entries.append((r, salary, "mérito anual" if pct < Decimal("0.07") else "promoção"))
                salary = (salary / (1 + pct) / 50).quantize(Decimal(1)) * 50
            entries.append((hire, salary, "admissão"))
            for when, value, reason in sorted(entries):
                rows.append({"employee_id": e["id"], "effective_date": when.isoformat(), "salary": float(value), "reason": reason})
        return rows

    # ----------------------------------------------------------------- vacation
    def _valid_monday(self, d: date) -> date:
        while not (d.weekday() == 0 and is_valid_start(d, self.hmap)):
            d += timedelta(days=1)
        return d

    def build_vacation(self) -> tuple[list[dict], list[dict]]:
        rng = self.rng
        periods, requests = [], []
        mariana = self.by_name("Mariana Costa")
        team = [e for e in self.employees if e["manager_id"] == mariana["id"] and e["status"] == "active"]
        team_ids = [e["id"] for e in team]
        special = {team_ids[1]: "expiring", team_ids[2]: "expiring", team_ids[3]: "no_vacation", team_ids[4]: "pending"}
        req_seq = 0
        for e in self.employees:
            if e["status"] != "active":
                continue
            hire = date.fromisoformat(e["hire_date"])
            k = 0
            while True:
                acq_start = add_years(hire, k)
                if acq_start > TODAY:
                    break
                acq_end = add_years(hire, k + 1) - timedelta(days=1)
                pid = f"{e['id']}-P{k + 1}"
                deadline = concession_end(acq_end)
                complete = acq_end < TODAY
                entitled = 30
                fractions: list[tuple[date, int, str]] = []
                sold = 0
                mode = special.get(e["id"])
                if e["name"] == "Rafael Lima":
                    if k == 0:
                        fractions = [(date(2025, 7, 7), 20, "taken"), (date(2025, 12, 22), 10, "taken")]
                    elif k == 1:
                        fractions = [(date(2026, 7, 6), 10, "taken")]
                elif complete and deadline < TODAY:
                    start = self._valid_monday(acq_end + timedelta(days=rng.randint(20, 200)))
                    if mode == "no_vacation":
                        fractions = [(self._valid_monday(acq_end + timedelta(days=20)), 30, "taken")]
                    elif rng.random() < 0.25:
                        fractions = [(start, 20, "taken")]
                        sold = 10
                    elif rng.random() < 0.5:
                        fractions = [(start, 20, "taken"), (self._valid_monday(start + timedelta(days=90)), 10, "taken")]
                    else:
                        fractions = [(start, 30, "taken")]
                elif complete:
                    if mode == "expiring":
                        fractions = [] if rng.random() < 0.5 else [(self._valid_monday(acq_end + timedelta(days=40)), 10, "taken")]
                    elif mode == "no_vacation":
                        fractions = []
                    elif mode == "pending":
                        fractions = [(date(2026, 11, 23), 15, "pending_manager")]
                    else:
                        roll = rng.random()
                        if roll < 0.3 and acq_end + timedelta(days=40) < TODAY:
                            fractions = [(self._valid_monday(acq_end + timedelta(days=30)), 30, "taken")]
                        elif roll < 0.6:
                            first = self._valid_monday(acq_end + timedelta(days=rng.randint(15, 120)))
                            status = "taken" if first + timedelta(days=15) < TODAY else "approved"
                            if first < TODAY + timedelta(days=31) and status == "approved":
                                first = self._valid_monday(TODAY + timedelta(days=35))
                            fractions = [(first, 15, status)]
                        elif roll < 0.8:
                            first = self._valid_monday(TODAY + timedelta(days=rng.randint(40, 150)))
                            fractions = [(first, rng.choice([15, 20, 30]), "approved")]
                status = "accruing" if not complete else ("closed" if deadline < TODAY else "open")
                accrued = entitled if complete else min(30, int(((TODAY - acq_start).days / 365) * 30))
                periods.append({
                    "id": pid, "employee_id": e["id"], "acquisition_start": acq_start.isoformat(),
                    "acquisition_end": acq_end.isoformat(), "concession_end": deadline.isoformat(),
                    "entitled_days": entitled if complete else accrued, "sold_days": sold, "status": status,
                })
                # Scheduled vacations must end inside the concession period.
                fractions = [f for f in fractions if f[0] + timedelta(days=f[1] - 1) <= deadline]
                for start, days, rstatus in fractions:
                    req_seq += 1
                    if rstatus == "taken" and start + timedelta(days=days) > TODAY:
                        rstatus = "approved"
                    requests.append({
                        "id": f"FER-{req_seq:05d}", "employee_id": e["id"], "period_id": pid,
                        "start": start.isoformat(), "days": days, "sell_days": sold if fractions[0][0] == start else 0,
                        "advance_13th": False, "status": rstatus,
                        "requested_at": (start - timedelta(days=45)).isoformat(),
                        "decided_by": e["manager_id"] if rstatus in ("approved", "taken") else None,
                    })
                k += 1
        return periods, requests

    # ----------------------------------------------------------------- benefits
    def build_benefits(self) -> dict:
        rng = self.rng
        dependents, enrollments, balances, banks, addresses = [], [], [], [], []
        dep_seq = 0
        for e in self.employees:
            if e["status"] != "active":
                continue
            deps = []
            if e["name"] == "Rafael Lima":
                deps = [("Juliana Lima", "cônjuge", date(1995, 4, 18))]
            elif e["name"] == "Beatriz Rocha":
                deps = []
            else:
                if rng.random() < 0.45:
                    deps.append((f"{rng.choice(FIRST_F + FIRST_M)} {e['name'].split()[-1]}", "cônjuge", date(rng.randint(1975, 1999), rng.randint(1, 12), rng.randint(1, 28))))
                for _ in range(rng.choice([0, 0, 1, 1, 2])):
                    deps.append((f"{rng.choice(FIRST_F + FIRST_M)} {e['name'].split()[-1]}", "filho(a)", date(rng.randint(2010, 2025), rng.randint(1, 12), rng.randint(1, 28))))
            plan = "PLN-ESS"
            if e["name"] == "Rafael Lima":
                plan = "PLN-ESS"
            elif e["salary"] > 15000:
                plan = rng.choice(["PLN-PLUS", "PLN-PREM"])
            elif e["salary"] > 8000:
                plan = rng.choice(["PLN-ESS", "PLN-PLUS"])
            dental = rng.choice(["ODO-BAS", "ODO-BAS", "ODO-PLUS"])
            dep_ids = []
            for name, rel, born in deps:
                dep_seq += 1
                did = f"D{dep_seq:04d}"
                dep_ids.append(did)
                dependents.append({"id": did, "employee_id": e["id"], "name": name, "relationship": rel,
                                   "birth_date": born.isoformat(), "ir_dependent": rel != "cônjuge" or rng.random() < 0.5 or name == "Juliana Lima",
                                   "health_plan": True, "status": "active"})
            since = max(date.fromisoformat(e["hire_date"]), date(2020, 1, 1))
            enrollments.append({"employee_id": e["id"], "plan_id": plan, "since": since.isoformat(), "dependents": dep_ids})
            enrollments.append({"employee_id": e["id"], "plan_id": dental, "since": since.isoformat(), "dependents": dep_ids})
            children_under_6 = sum(1 for _, rel, b in deps if rel == "filho(a)" and (TODAY - b).days < 6 * 365)
            balances.append({
                "employee_id": e["id"], "meal_card_monthly": 990.00, "food_card_monthly": 600.00,
                "flex_balance": round(rng.uniform(80, 900), 2), "daycare_children": children_under_6,
                "daycare_monthly_per_child": 650.00, "life_insurance_multiple": 24,
                "wellness": "Programa Bem Viver (academias e apps parceiros)", "transport_voucher": e["work_mode"] == "presencial",
            })
            bank = rng.choice(BANKS)
            banks.append({"employee_id": e["id"], "bank_code": bank[0], "bank_name": bank[1],
                          "agency": f"{rng.randint(1, 9999):04d}", "account": f"{rng.randint(10000, 99999)}-{rng.randint(0, 9)}",
                          "type": "corrente", "updated_at": "2025-01-10"})
            addresses.append({"employee_id": e["id"], "street": rng.choice(STREETS), "number": str(rng.randint(10, 2400)),
                              "complement": rng.choice(["", "apto 42", "apto 121", "casa 2", ""]),
                              "district": rng.choice(DISTRICTS), "city": "São Paulo", "state": "SP",
                              "zip": f"0{rng.randint(1000, 5999)}-{rng.randint(0, 999):03d}"})
        return {"dependents": dependents, "enrollments": enrollments, "balances": balances,
                "bank_accounts": banks, "addresses": addresses}

    # ----------------------------------------------------------------- time
    def build_time(self) -> list[dict]:
        rng = self.rng
        rows = []
        mariana = self.by_name("Mariana Costa")
        heavy = [e["id"] for e in self.employees if e["manager_id"] == mariana["id"]][5:7]
        for e in self.employees:
            if e["status"] != "active":
                continue
            hire = date.fromisoformat(e["hire_date"])
            balance = Decimal(0)
            for m in _month_starts(date(2026, 1, 1), date(2026, 9, 1)):
                if m < date(hire.year, hire.month, 1):
                    continue
                work_days = sum(1 for i in range(31) if (m + timedelta(days=i)).month == m.month and not is_non_working(m + timedelta(days=i), self.hmap))
                expected = Decimal(work_days * 8)
                overtime = Decimal(rng.choice([0, 0, 0, 2, 4, 6])) if e["id"] not in heavy else Decimal(rng.choice([12, 16, 20, 24]))
                if e["unit_id"] in ("U51", "U13") and rng.random() < 0.3:
                    overtime += Decimal(rng.choice([4, 8]))
                delta = Decimal(rng.choice([-4, -2, 0, 0, 2, 4, 6])) + (Decimal(8) if e["id"] in heavy else 0)
                balance += delta
                rows.append({"employee_id": e["id"], "month": m.strftime("%Y-%m"), "expected_hours": float(expected),
                             "worked_hours": float(expected + overtime + delta), "overtime_hours": float(overtime),
                             "bank_delta_hours": float(delta), "bank_balance_hours": float(balance)})
        return rows

    def build_absences(self) -> list[dict]:
        rng = self.rng
        rows = []
        for e in self.employees:
            if e["status"] != "active":
                continue
            for _ in range(rng.choice([0, 0, 0, 1, 1, 2, 3])):
                d = date(2026, rng.randint(1, 9), rng.randint(1, 28))
                if is_non_working(d, self.hmap):
                    continue
                kind = rng.choice(["atestado médico", "atestado médico", "falta justificada", "falta injustificada"])
                rows.append({"employee_id": e["id"], "date": d.isoformat(), "type": kind, "days": rng.choice([1, 1, 2, 3])})
        rows.sort(key=lambda r: (r["employee_id"], r["date"]))
        return rows

    # ----------------------------------------------------------------- payroll
    def build_payroll(self, comp, requests, benefits, time_rows) -> tuple[list[dict], list[dict], list[dict]]:
        payslips, statements, plr_rows = [], [], []
        plans = {p["id"]: p for p in HEALTH_PLANS}
        enroll = {}
        for row in benefits["enrollments"]:
            enroll.setdefault(row["employee_id"], []).append(row)
        deps_ir = {}
        for d in benefits["dependents"]:
            if d["ir_dependent"]:
                deps_ir[d["employee_id"]] = deps_ir.get(d["employee_id"], 0) + 1
        overtime = {(r["employee_id"], r["month"]): Decimal(str(r["overtime_hours"])) for r in time_rows}
        vt = {b["employee_id"]: b["transport_voucher"] for b in benefits["balances"]}
        comp_by = {}
        for c in comp:
            comp_by.setdefault(c["employee_id"], []).append(c)

        def salary_on(eid, d: date) -> Decimal:
            value = Decimal(0)
            for c in comp_by[eid]:
                if date.fromisoformat(c["effective_date"]) <= d:
                    value = Decimal(str(c["salary"]))
            return value

        def vacation_days(eid, m: date) -> int:
            total = 0
            for r in requests:
                if r["employee_id"] != eid or r["status"] not in ("taken", "approved"):
                    continue
                s = date.fromisoformat(r["start"])
                for i in range(r["days"]):
                    d = s + timedelta(days=i)
                    if d.year == m.year and d.month == m.month:
                        total += 1
            return min(30, total)

        for e in self.employees:
            if e["status"] != "active":
                continue
            eid = e["id"]
            hire = date.fromisoformat(e["hire_date"])
            health = dental = Decimal(0)
            for row in enroll.get(eid, []):
                p = plans[row["plan_id"]]
                cost = Decimal(str(p["employee_cost"])) + Decimal(str(p["dependent_cost"])) * len(row["dependents"])
                if p["kind"] == "health":
                    health = cost
                else:
                    dental = cost
            n_dep = deps_ir.get(eid, 0)
            annual = {"taxable": Decimal(0), "inss": Decimal(0), "irrf": Decimal(0), "health": Decimal(0)}
            for m in _month_starts(date(2025, 1, 1), date(2026, 9, 1)):
                if m < date(hire.year, hire.month, 1):
                    continue
                worked = 30 - (hire.day - 1) if (m.year, m.month) == (hire.year, hire.month) else 30
                salary = salary_on(eid, m + timedelta(days=27))
                ph = payslip(PayslipInput(
                    month=m, salary=salary, dependents=n_dep, days_worked=worked,
                    overtime_hours=overtime.get((eid, m.strftime("%Y-%m")), Decimal(0)),
                    dsr_ratio=_dsr_ratio(m.year, m.month, self.hmap),
                    vacation_days=vacation_days(eid, m), health_share=health, dental_share=dental,
                    transport_voucher=vt.get(eid, False),
                ))
                if m.year == 2025:
                    taxable = sum(Decimal(str(ln.get("earning", 0))) for ln in ph.lines if ln["code"] not in ("ABN", "ABN13"))
                    annual["taxable"] += taxable
                    annual["inss"] += Decimal(str(next(ln["deduction"] for ln in ph.lines if ln["code"] == "INSS")))
                    annual["irrf"] += sum(Decimal(str(ln.get("deduction", 0))) for ln in ph.lines if ln["code"].startswith("IRRF"))
                    annual["health"] += health
                    continue
                payslips.append({
                    "id": f"{eid}-{m.strftime('%Y-%m')}", "employee_id": eid, "month": m.strftime("%Y-%m"), "kind": "monthly",
                    "gross": float(ph.gross), "deductions": float(ph.deductions), "net": float(ph.net),
                    "inss_base": float(ph.inss_base), "irrf_base": float(ph.irrf_base), "fgts": float(ph.fgts),
                    "lines": ph.lines, "paid_on": (date(m.year, m.month, 1) + timedelta(days=34)).replace(day=5).isoformat(),
                })
            # 13th of 2025 (exclusive taxation) for the income statement.
            t13 = None
            if hire.year < 2025:
                t13 = thirteenth(salary_on(eid, date(2025, 12, 1)), 12, n_dep, date(2025, 12, 1))
            elif hire.year == 2025:
                months = 12 - hire.month + (1 if hire.day <= 16 else 0)
                if months:
                    t13 = thirteenth(salary_on(eid, date(2025, 12, 1)), months, n_dep, date(2025, 12, 1))
            # PLR 2025 paid in March 2026.
            if hire <= date(2025, 6, 30):
                base_sal = salary_on(eid, date(2025, 12, 1))
                mult = Decimal("2.0") if base_sal >= 20000 else Decimal("1.5") if base_sal >= 12000 else Decimal("1.0")
                amount = cents(base_sal * mult * Decimal("1.05"))
                tax = plr_tax(amount)
                plr_rows.append({"employee_id": eid, "year": 2025, "amount": float(amount), "tax": float(tax), "paid_on": "2026-03-20"})
                payslips.append({
                    "id": f"{eid}-2026-03-PLR", "employee_id": eid, "month": "2026-03", "kind": "plr",
                    "gross": float(amount), "deductions": float(tax), "net": float(amount - tax),
                    "inss_base": 0.0, "irrf_base": float(amount), "fgts": 0.0,
                    "lines": [{"code": "PLR", "label": "Participação nos Lucros 2025", "earning": float(amount)},
                              {"code": "IRPLR", "label": "IRRF sobre PLR (tributação exclusiva)", "deduction": float(tax)}],
                    "paid_on": "2026-03-20",
                })
            if hire < date(2026, 1, 1):
                statements.append({
                    "employee_id": eid, "year": 2025,
                    "taxable_income": float(cents(annual["taxable"])), "inss": float(cents(annual["inss"])),
                    "irrf": float(cents(annual["irrf"])), "health_paid": float(cents(annual["health"])),
                    "thirteenth_gross": float(t13.gross) if t13 else 0.0,
                    "thirteenth_inss": float(t13.inss) if t13 else 0.0,
                    "thirteenth_irrf": float(t13.irrf) if t13 else 0.0,
                    "plr_2024_paid": 0.0, "dependents": n_dep,
                })
        return payslips, statements, plr_rows

    # ----------------------------------------------------------------- career and onboarding
    def build_career(self) -> dict:
        rng = self.rng
        assignments, skills = [], []
        for e in self.employees:
            if e["status"] != "active":
                continue
            for t in TRAININGS:
                if not t["mandatory"]:
                    continue
                done = rng.random() < (0.15 if e["name"] == "Beatriz Rocha" else 0.6)
                if e["name"] == "Rafael Lima":
                    done = t["id"] in ("TR-SEGINFO", "TR-ASSEDIO")
                assignments.append({"employee_id": e["id"], "training_id": t["id"],
                                    "status": "concluído" if done else "pendente", "due_date": t["due"],
                                    "completed_at": "2026-08-20" if done else None})
            pool = SKILLS_BY_UNIT.get(e["unit_id"], ["excel", "comunicação"])
            chosen = sorted(set(rng.sample(pool, min(len(pool), rng.randint(2, 4)))))
            if e["name"] == "Rafael Lima":
                chosen = ["airflow", "dbt", "power bi", "python", "sql"]
            skills.append({"employee_id": e["id"], "skills": chosen})
        return {"assignments": assignments, "skills": skills}

    def build_onboarding(self) -> dict:
        bia = self.by_name("Beatriz Rocha")
        team = [e for e in self.employees if e["manager_id"] == bia["manager_id"] and e["id"] != bia["id"] and e["status"] == "active"]
        buddy = sorted(team, key=lambda e: e["hire_date"])[2]
        start = date.fromisoformat(bia["hire_date"])
        tasks = [
            ("Assinar contrato e termo de confidencialidade", "documentos", 0, "concluído", "Pessoas"),
            ("Retirar notebook e configurar MFA", "acessos", 0, "concluído", "Infraestrutura"),
            ("Acesso ao GitHub e ao Jira", "acessos", 2, "concluído", "Infraestrutura"),
            ("Café de boas-vindas com o buddy", "integração", 3, "concluído", "Buddy"),
            ("Acesso ao ambiente de dados (leitura)", "acessos", 7, "pendente", "Plataforma de Dados"),
            ("Treinamento Código de Conduta 2026", "treinamentos", 10, "pendente", "Você"),
            ("Treinamento Segurança da Informação", "treinamentos", 10, "pendente", "Você"),
            ("Escolher plano de saúde e incluir dependentes (até 30 dias da admissão)", "benefícios", 30, "pendente", "Você"),
            ("Cadastrar conta bancária para pagamento", "cadastro", 5, "concluído", "Você"),
            ("1:1 de 30 dias com a liderança", "integração", 30, "pendente", "Gestor"),
            ("Definir metas de experiência (45 dias)", "desempenho", 45, "pendente", "Gestor"),
            ("Avaliação do período de experiência (90 dias)", "desempenho", 89, "pendente", "Gestor"),
        ]
        rows = [{"id": f"ONB-{i + 1:02d}", "employee_id": bia["id"], "title": t, "category": c,
                 "due_date": (start + timedelta(days=dd)).isoformat(), "status": s, "owner": o}
                for i, (t, c, dd, s, o) in enumerate(tasks)]
        return {"tasks": rows, "buddies": [{"employee_id": bia["id"], "buddy_id": buddy["id"]}]}

    def build_reimbursements(self) -> list[dict]:
        rng = self.rng
        rows = []
        seq = 0
        cats = [("alimentação em viagem", 40, 180), ("transporte por aplicativo", 18, 90), ("hospedagem", 280, 900), ("material de escritório", 30, 250)]
        for e in self.employees:
            if e["status"] != "active" or rng.random() < 0.5:
                continue
            for _ in range(rng.randint(1, 3)):
                seq += 1
                cat, lo, hi = rng.choice(cats)
                d = date(2026, rng.randint(6, 9), rng.randint(1, 28))
                rows.append({"id": f"RB-{seq:05d}", "employee_id": e["id"], "category": cat,
                             "amount": round(rng.uniform(lo, hi), 2), "date": d.isoformat(),
                             "merchant": rng.choice(["Restaurante Sabor da Serra", "Táxi Rápido SP", "Hotel Paulista Center", "Papelaria Central"]),
                             "cnpj": "11.222.333/0001-81", "status": rng.choice(["pago", "pago", "aprovado", "em análise"]),
                             "submitted_at": (d + timedelta(days=2)).isoformat(), "description": ""})
        return rows

    # ----------------------------------------------------------------- assemble
    def build(self) -> dict:
        self.build_people()
        comp = self.build_compensation()
        periods, requests = self.build_vacation()
        benefits = self.build_benefits()
        time_rows = self.build_time()
        absences = self.build_absences()
        payslips, statements, plr_rows = self.build_payroll(comp, requests, benefits, time_rows)
        career = self.build_career()
        onboarding = self.build_onboarding()
        reimbursements = self.build_reimbursements()
        people = []
        for e in self.employees:
            p = dict(e)
            p.pop("salary")
            people.append(p)
        id_of = {e["name"]: e["id"] for e in self.employees}
        personas = [dict(p, employee_id=id_of[p["name"]]) for p in PERSONAS]
        hrbp = [
            {"hrbp_id": id_of["Patrícia Almeida"], "unit_id": "U10"},
            {"hrbp_id": id_of["Renato Farias"], "unit_id": "U40"},
            {"hrbp_id": id_of["Renato Farias"], "unit_id": "U50"},
            {"hrbp_id": id_of["Sílvia Moura"], "unit_id": "U01"},
        ]
        roles = [
            {"employee_id": id_of["Carlos Mendes"], "role": "governance_admin"},
            {"employee_id": id_of["Mariana Costa"], "role": "agent_author"},
            {"employee_id": id_of["Bruno Teixeira"], "role": "agent_author"},
            {"employee_id": id_of["Cláudia Reis"], "role": "agent_author"},
        ]
        return {
            "meta": {"company": "Nimbus Serviços Digitais S.A.", "fictional": True, "today": TODAY.isoformat(),
                     "seed": SEED, "generator": "atrium.seed.company"},
            "personas": personas,
            "units": [{"id": u[0], "name": u[1], "parent_id": u[2]} for u in UNITS],
            "employees": people,
            "hrbp_assignments": hrbp,
            "platform_roles": roles,
            "compensation": comp,
            "payslips": payslips,
            "income_statements": statements,
            "plr": plr_rows,
            "vacation_periods": periods,
            "vacation_requests": requests,
            "absences": absences,
            "time_bank": time_rows,
            "time_adjustments": [],
            "benefit_plans": HEALTH_PLANS,
            "benefit_enrollments": benefits["enrollments"],
            "dependents": benefits["dependents"],
            "benefit_balances": benefits["balances"],
            "bank_accounts": benefits["bank_accounts"],
            "addresses": benefits["addresses"],
            "reimbursements": reimbursements,
            "trainings": TRAININGS,
            "training_assignments": career["assignments"],
            "learning_paths": LEARNING_PATHS,
            "review_cycles": [REVIEW_CYCLE],
            "job_postings": JOB_POSTINGS,
            "employee_skills": career["skills"],
            "onboarding_tasks": onboarding["tasks"],
            "buddies": onboarding["buddies"],
        }


def generate() -> dict:
    return Generator().build()
