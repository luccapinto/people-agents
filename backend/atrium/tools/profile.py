"""Profile tools (agent: Dados Cadastrais). Bank account change is a sensitive action."""

from __future__ import annotations

from datetime import date

from pydantic import Field

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolResult
from atrium.tools._util import company_policies, d, mask_account

BANKS = {"001": "Banco Horizonte (fictício)", "077": "Banco Aurora (fictício)", "260": "Banco Pétala (fictício)",
         "341": "Banco Meridiano (fictício)"}


@tool("profile_get", params=NoArgs, action="self.profile.read")
def profile_get(ctx: ToolContext, args: NoArgs) -> ToolResult:
    eid = ctx.subject_id
    with ctx.hr() as hr:
        address = hr.profile.address(eid)
        bank = hr.profile.bank_account(eid)
        deps = hr.benefits.dependents(eid)
    sections = [
        {"title": "Endereço", "items": [{"label": "Logradouro", "value": f"{address.street}, {address.number} {address.complement}".strip()},
                                         {"label": "Bairro", "value": address.district},
                                         {"label": "Cidade", "value": f"{address.city}/{address.state}"},
                                         {"label": "CEP", "value": address.zip}]} if address else None,
        {"title": "Conta para pagamento", "items": [{"label": "Banco", "value": f"{bank.bank_name} ({bank.bank_code})"},
                                                     {"label": "Agência", "value": bank.agency},
                                                     {"label": "Conta", "value": mask_account(bank.account)},
                                                     {"label": "Atualizada em", "value": d(bank.updated_at)}]} if bank else None,
        {"title": "Dependentes", "items": [{"label": x.name, "value": f"{x.relationship}, nascimento {d(x.birth_date)}"
                                            + (", dependente no IR" if x.ir_dependent else "")} for x in deps]
         or [{"label": "Nenhum", "value": "sem dependentes cadastrados"}]},
    ]
    data = {"title": "Meus dados cadastrais", "sections": [s for s in sections if s]}
    summary = f"Seu endereço cadastrado é em {address.district}, {address.city}/{address.state}" if address else "Sem endereço cadastrado"
    summary += f"; conta de pagamento no {bank.bank_name}, final {bank.account[-3:]}" if bank else ""
    summary += f"; {len(deps)} dependente(s)." if deps else "; nenhum dependente."
    return ToolResult(data=data, summary=summary, card=Card("sections", data))


class AddressArgs(Args):
    street: str = Field(..., max_length=120)
    number: str = Field(..., max_length=20)
    complement: str = Field("", max_length=60)
    district: str = Field(..., max_length=60)
    city: str = Field(..., max_length=60)
    state: str = Field(..., min_length=2, max_length=2)
    zip: str = Field(..., pattern=r"^\d{5}-?\d{3}$")


def _execute_address(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        hr.profile.update_address(ctx.identity.employee_id, args)
    return ToolResult(data={"updated": True}, summary="Endereço atualizado. Se você usa vale-transporte, revise o trajeto com o DP.")


@tool("profile_update_address", params=AddressArgs, action="self.profile.change", executor=_execute_address)
def profile_update_address(ctx: ToolContext, args: AddressArgs) -> ToolResult:
    details = [{"label": "Novo endereço", "value": f"{args.street}, {args.number} {args.complement}".strip()},
               {"label": "Bairro / cidade", "value": f"{args.district}, {args.city}/{args.state.upper()}"}, {"label": "CEP", "value": args.zip}]
    draft = ProposalDraft(summary="Atualizar endereço residencial", details=details, args=args.model_dump(mode="json"))
    return ToolResult(data={"valid": True}, summary="Preparei a atualização do endereço para você confirmar.", proposal=draft)


class DependentArgs(Args):
    name: str = Field(..., max_length=120)
    relationship: str = Field(..., description="cônjuge, filho(a), enteado(a), pai, mãe")
    birth_date: date
    ir_dependent: bool = Field(True, description="Incluir como dependente no IR")


def _execute_dependent(ctx: ToolContext, args: dict) -> ToolResult:
    eid = ctx.identity.employee_id
    born = date.fromisoformat(args["birth_date"])
    with ctx.hr() as hr:
        existing = next((x for x in hr.benefits.dependents(eid) if x.birth_date == born and x.relationship == args["relationship"]), None)
        if existing:
            hr.benefits.set_ir_dependent(eid, existing.id, args["ir_dependent"])
            dep_id = existing.id
        else:
            dep_id = hr.benefits.add_dependent(eid, args["name"], args["relationship"], born, args["ir_dependent"], False,
                                               "aguardando certidão" if args["relationship"] == "filho(a)" else "active").id
    return ToolResult(data={"dependent_id": dep_id}, summary="Dependente incluído no cadastro" + (" e no IR." if args["ir_dependent"] else "."))


@tool("profile_add_dependent", params=DependentArgs, action="self.profile.change", executor=_execute_dependent)
def profile_add_dependent(ctx: ToolContext, args: DependentArgs) -> ToolResult:
    details = [{"label": "Nome", "value": args.name}, {"label": "Parentesco", "value": args.relationship},
               {"label": "Nascimento", "value": d(args.birth_date)},
               {"label": "Dependente no IR", "value": "sim (dedução de R$ 189,59 por mês no IRRF)" if args.ir_dependent else "não"}]
    draft = ProposalDraft(summary=f"Incluir {args.name} como dependente", details=details, args=args.model_dump(mode="json"))
    return ToolResult(data={"valid": True}, summary="Como dependente no IR, a base do IRRF mensal diminui R$ 189,59. Confirme a inclusão no cartão.",
                      proposal=draft)


class BankArgs(Args):
    bank_code: str = Field(..., pattern=r"^\d{3}$", description="Código do banco (3 dígitos)")
    agency: str = Field(..., pattern=r"^\d{3,5}$")
    account: str = Field(..., pattern=r"^\d{4,12}-?[\dxX]$")


def _execute_bank(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        hr.profile.update_bank_account(ctx.identity.employee_id, {
            "bank_code": args["bank_code"], "bank_name": BANKS.get(args["bank_code"], f"Banco {args['bank_code']}"),
            "agency": args["agency"], "account": args["account"], "type": "corrente"}, ctx.today)
    return ToolResult(data={"updated": True},
                      summary="Conta bancária atualizada. O time de Segurança foi notificado e você receberá um e-mail de confirmação.")


@tool("profile_update_bank_account", params=BankArgs, action="self.profile.change_bank", executor=_execute_bank)
def profile_update_bank_account(ctx: ToolContext, args: BankArgs) -> ToolResult:
    rules = company_policies()["profile"]
    with ctx.hr() as hr:
        current = hr.profile.bank_account(ctx.identity.employee_id)
    details = [{"label": "Conta atual", "value": f"{current.bank_name}, ag. {current.agency}, {mask_account(current.account)}" if current else "-"},
               {"label": "Nova conta", "value": f"{BANKS.get(args.bank_code, 'Banco ' + args.bank_code)}, ag. {args.agency}, {mask_account(args.account)}"},
               {"label": "Vigência", "value": rules["bank_change_effective"]},
               {"label": "Segurança", "value": rules["bank_change_alert"]}]
    draft = ProposalDraft(summary="Trocar a conta bancária de pagamento", details=details, args=args.model_dump(mode="json"))
    return ToolResult(data={"valid": True}, proposal=draft,
                      summary="Troca de conta é uma ação sensível: confirme no cartão e verifique sua identidade com o código.")
