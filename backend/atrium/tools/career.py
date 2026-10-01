"""Career and onboarding tools (agents: Carreira e Desenvolvimento, Onboarding)."""

from __future__ import annotations

from datetime import date

from pydantic import Field

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolResult
from atrium.tools._util import company_policies, d, plural


@tool("career_overview", params=NoArgs, action="self.career.read")
def career_overview(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        catalog = {t.id: t for t in hr.career.trainings()}
        assigned = hr.career.assignments(ctx.subject_id)
        cycle = hr.career.review_cycle()
        paths = hr.career.learning_paths()
    pending = [{"id": a.training_id, "title": catalog[a.training_id].title, "hours": catalog[a.training_id].hours,
                "due_date": a.due_date.isoformat() if a.due_date else None,
                "days_left": (a.due_date - ctx.today).days if a.due_date else None}
               for a in assigned if a.status == "pendente"]
    pending.sort(key=lambda x: x["due_date"] or "9999")
    done = [catalog[a.training_id].title for a in assigned if a.status != "pendente"]
    phases = []
    for ph in (cycle or {}).get("phases", []):
        s, e = date.fromisoformat(ph["start"]), date.fromisoformat(ph["end"])
        state = "concluída" if e < ctx.today else ("em andamento" if s <= ctx.today else "próxima")
        phases.append(ph | {"state": state})
    data = {"pending_trainings": pending, "completed_trainings": done, "cycle": {"name": (cycle or {}).get("name"), "phases": phases},
            "learning_paths": [{"title": p["title"], "description": p["description"], "audience": p["audience"],
                                "steps": [catalog[s].title for s in p["steps"] if s in catalog]} for p in paths]}
    summary = f"Você tem {plural(len(pending), 'treinamento obrigatório pendente', 'treinamentos obrigatórios pendentes')}"
    if pending:
        summary += f"; o mais urgente é {pending[0]['title']}, até {d(date.fromisoformat(pending[0]['due_date']))}"
    nxt = next((p for p in phases if p["state"] != "concluída"), None)
    if nxt:
        summary += f". No {data['cycle']['name']}, a fase {nxt['label']} vai de {d(date.fromisoformat(nxt['start']))} a {d(date.fromisoformat(nxt['end']))}"
    return ToolResult(data=data, summary=summary + ".", card=Card("career", data))


@tool("career_matching_jobs", params=NoArgs, action="self.career.read")
def career_matching_jobs(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        skills = set(hr.career.skills(ctx.subject_id))
        jobs = hr.career.job_postings()
        units = {u.id: u.name for u in hr.directory.units()}
        history = hr.payroll.salary_history(ctx.subject_id)
    last_change = history[-1].effective_date if history else ctx.identity.hire_date
    months_in_role = (ctx.today.year - last_change.year) * 12 + ctx.today.month - last_change.month
    min_months = company_policies()["career"]["internal_mobility_min_months"]
    ranked = []
    for j in jobs:
        if j.closes_at < ctx.today:
            continue
        overlap = sorted(skills & set(j.skills))
        score = round(len(overlap) / len(j.skills), 2) if j.skills else 0
        ranked.append({"id": j.id, "title": j.title, "unit": units.get(j.unit_id, j.unit_id), "level": j.level, "skills": j.skills,
                       "matched": overlap, "missing": sorted(set(j.skills) - skills), "score": score,
                       "closes_at": j.closes_at.isoformat()})
    ranked.sort(key=lambda r: (-r["score"], r["closes_at"], r["id"]))
    top = [r for r in ranked if r["score"] > 0][:4]
    eligible = months_in_role >= min_months
    data = {"jobs": top, "skills": sorted(skills), "eligible": eligible, "months_in_role": months_in_role, "min_months": min_months,
            "rule": company_policies()["career"]["manager_notification"]}
    if not top:
        return ToolResult(data=data, summary="Não há vagas internas abertas compatíveis com suas habilidades agora.", card=Card("jobs", data))
    best = top[0]
    summary = (f"A vaga mais compatível é {best['title']} ({best['unit']}), com {len(best['matched'])} de {len(best['skills'])} "
               f"habilidades em comum; inscrições até {d(date.fromisoformat(best['closes_at']))}.")
    if not eligible:
        summary += f" Pela política, a candidatura exige {min_months} meses na posição atual (você tem {months_in_role})."
    return ToolResult(data=data, summary=summary, card=Card("jobs", data))


@tool("onboarding_checklist", params=NoArgs, action="self.onboarding.read")
def onboarding_checklist(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        tasks = hr.onboarding.tasks(ctx.subject_id)
        buddy = hr.onboarding.buddy(ctx.subject_id)
    if not tasks:
        return ToolResult.fail("Você não tem um checklist de onboarding ativo.")
    items = [{"id": t.id, "title": t.title, "category": t.category, "due_date": t.due_date.isoformat(), "status": t.status,
              "owner": t.owner, "overdue": t.status != "concluído" and t.due_date < ctx.today} for t in tasks]
    done = sum(1 for t in items if t["status"] == "concluído")
    nxt = [t for t in items if t["status"] != "concluído"][:3]
    data = {"items": items, "done": done, "total": len(items), "progress": round(done / len(items), 2),
            "buddy": {"name": buddy.name, "title": buddy.title, "email": buddy.email} if buddy else None,
            "start_date": ctx.identity.hire_date.isoformat()}
    summary = f"Você concluiu {done} de {len(items)} tarefas do onboarding."
    if nxt:
        summary += " Próximas: " + "; ".join(f"{t['title']} (até {d(date.fromisoformat(t['due_date']))})" for t in nxt) + "."
    if buddy:
        summary += f" Seu buddy é {buddy.name} ({buddy.title})."
    return ToolResult(data=data, summary=summary, card=Card("checklist", data))


class TaskArgs(Args):
    task_id: str = Field(..., description="Identificador da tarefa (ex.: ONB-05)")


def _execute_task(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        t = hr.onboarding.complete_task(ctx.identity.employee_id, args["task_id"])
    return ToolResult(data={"task_id": t.id}, summary=f"Tarefa “{t.title}” marcada como concluída.")


@tool("onboarding_complete_task", params=TaskArgs, action="self.onboarding.change", executor=_execute_task)
def onboarding_complete_task(ctx: ToolContext, args: TaskArgs) -> ToolResult:
    with ctx.hr() as hr:
        task = next((t for t in hr.onboarding.tasks(ctx.identity.employee_id) if t.id == args.task_id), None)
    if task is None:
        return ToolResult.fail("Não encontrei essa tarefa no seu checklist.")
    if task.status == "concluído":
        return ToolResult.fail("Essa tarefa já está concluída.")
    draft = ProposalDraft(summary=f"Marcar como concluída: {task.title}", details=[{"label": "Tarefa", "value": task.title},
                          {"label": "Responsável", "value": task.owner}], args={"task_id": task.id})
    return ToolResult(data={"task_id": task.id}, summary="Confirme para marcar a tarefa como concluída.", proposal=draft)
