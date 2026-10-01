/** Tool registry: catalog metadata + implementations + the governed execution path. */
import type { Decision } from '../authz/policy';
import { rolesOf } from '../authz/identity';
import type { ToolMeta } from '../data/types';
import { analyticsTools } from '../tools/analytics';
import { benefitsTools } from '../tools/benefits';
import { commonTools } from '../tools/common';
import { leadershipTools } from '../tools/leadership';
import { careerTools, documentTools, profileTools, reimbursementTools, timekeepingTools } from '../tools/misc';
import { payrollTools } from '../tools/payroll';
import { vacationTools } from '../tools/vacation';
import {
  type Executor,
  type Handler,
  type ParamSpec,
  type Tool,
  type ToolContext,
  ToolError,
  type ToolResult,
  fail,
  validateArgs,
} from './tool';

export interface ToolDef {
  name: string;
  action: string;
  params: ParamSpec;
  handler: Handler;
  executor?: Executor;
  roles?: string[];
}

const DEFS: ToolDef[] = [
  ...commonTools,
  ...vacationTools,
  ...payrollTools,
  ...benefitsTools,
  ...leadershipTools,
  ...analyticsTools,
  ...careerTools,
  ...documentTools,
  ...profileTools,
  ...reimbursementTools,
  ...timekeepingTools,
];

let catalogMeta: Record<string, ToolMeta> | null = null;
let built: Record<string, Tool> | null = null;

export function setToolCatalog(meta: Record<string, ToolMeta>): void {
  catalogMeta = meta;
  built = null;
}

export function toolCatalog(): Record<string, ToolMeta> {
  if (!catalogMeta) throw new Error('tool catalog not loaded');
  return catalogMeta;
}

export function allTools(): Record<string, Tool> {
  if (built) return built;
  const meta = toolCatalog();
  const out: Record<string, Tool> = {};
  for (const def of DEFS) {
    const m = meta[def.name];
    if (!m) throw new Error(`tool ${def.name} is not in the governed catalog`);
    if (m.risk !== 'read' && !def.executor) throw new Error(`${def.name}: write/sensitive tools need an executor`);
    out[def.name] = {
      name: def.name,
      title: m.title,
      description: m.description,
      risk: m.risk,
      subject: m.subject,
      action: def.action,
      params: def.params,
      handler: def.handler,
      executor: def.executor,
      roles: def.roles ?? [],
      hints: m.hints ?? [],
    };
  }
  built = out;
  return out;
}

export interface Execution {
  tool: Tool;
  args: Record<string, unknown>;
  result: ToolResult;
  decision: Decision;
  durationMs: number;
  status: string;
}

export interface ToolTraceDict {
  tool: string;
  title: string;
  risk: string;
  args: Record<string, unknown>;
  decision: Decision;
  status: string;
  duration_ms: number;
  error: string | null;
}

export function executionTrace(ex: Execution): ToolTraceDict {
  return {
    tool: ex.tool.name,
    title: ex.tool.title,
    risk: ex.tool.risk,
    args: ex.args,
    decision: ex.decision,
    status: ex.status,
    duration_ms: ex.durationMs,
    error: ex.result.error ?? null,
  };
}

function finish(
  ctx: ToolContext,
  t: Tool,
  args: Record<string, unknown>,
  result: ToolResult,
  decision: Decision,
  started: number,
  status: string,
): Execution {
  const ex: Execution = { tool: t, args, result, decision, durationMs: Math.round(performance.now() - started), status };
  ctx.services.audit.append(status === 'denied' ? 'tool.denied' : 'tool.call', {
    actor: ctx.identity.employeeId,
    subject: ctx.subjectId,
    conversation: ctx.conversationId,
    request: ctx.identity.requestId,
    payload: {
      agent: ctx.agentId,
      tool: t.name,
      risk: t.risk,
      args,
      status,
      decision,
      result: result.summary.slice(0, 300),
    },
  });
  return ex;
}

/** Validate, authorize, run and audit one tool call requested by an agent. */
export function execute(
  ctx: ToolContext,
  name: string,
  rawArgs: Record<string, unknown> | null,
  allowed: Set<string>,
): Execution {
  const tools = allTools();
  const started = performance.now();
  if (!(name in tools) || !allowed.has(name)) {
    const t: Tool = tools[name] ?? {
      name,
      title: name,
      description: '',
      risk: 'read',
      subject: 'none',
      action: 'none',
      params: {},
      handler: () => ({ data: {}, summary: '' }),
      roles: [],
      hints: [],
    };
    const dec: Decision = {
      allowed: false,
      policy: 'agent_tool_allowlist',
      reason: 'Esta ferramenta não faz parte das ferramentas deste agente.',
    };
    return finish(ctx, t, rawArgs ?? {}, fail(dec.reason), dec, started, 'denied');
  }
  const t = tools[name];
  const parsed = validateArgs(t.params, rawArgs);
  if (!parsed.ok) {
    const dec: Decision = {
      allowed: false,
      policy: 'schema_validation',
      reason: 'Argumentos inválidos para a ferramenta.',
    };
    return finish(ctx, t, rawArgs ?? {}, fail(`Argumentos inválidos: ${parsed.message}`), dec, started, 'invalid');
  }

  const roles = rolesOf(ctx.identity);
  if (t.roles.length && !t.roles.some((r) => roles.includes(r))) {
    const dec: Decision = {
      allowed: false,
      policy: 'tool_roles',
      reason: `Ferramenta restrita a: ${[...t.roles].sort().join(', ')}.`,
    };
    return finish(ctx, t, parsed.dump, fail(dec.reason), dec, started, 'denied');
  }

  let decision: Decision;
  if (t.subject === 'self') {
    ctx.subjectId = ctx.identity.employeeId;
    decision = ctx.services.policy.authorize(ctx.identity, t.action, ctx.subjectId);
  } else if (t.subject === 'none') {
    decision = t.roles.length
      ? { allowed: true, policy: 'tool_roles', reason: 'Papel exigido pela ferramenta presente.' }
      : { allowed: true, policy: 'no_subject', reason: 'Ferramenta sem dado pessoal de terceiros.' };
  } else {
    decision = { allowed: true, policy: 'deferred_to_handler', reason: 'Alvo resolvido e autorizado pela ferramenta.' };
  }

  if (!decision.allowed) return finish(ctx, t, parsed.dump, fail(decision.reason), decision, started, 'denied');

  let result: ToolResult;
  try {
    result = t.handler(ctx, parsed.values);
  } catch (exc) {
    if (exc instanceof ToolError) {
      return finish(ctx, t, parsed.dump, fail(exc.message), decision, started, 'error');
    }
    throw exc;
  }
  if (result.decision) decision = result.decision;
  const status =
    result.decision && !result.decision.allowed
      ? 'denied'
      : result.proposal
        ? 'proposal'
        : result.error
          ? 'error'
          : 'ok';
  return finish(ctx, t, parsed.dump, result, decision, started, status);
}

/** OpenAI-compatible function schema, used only for the fake model's tool list. */
export function toolSchema(t: Tool): { type: string; function: { name: string; description: string } } {
  return { type: 'function', function: { name: t.name, description: t.description } };
}
