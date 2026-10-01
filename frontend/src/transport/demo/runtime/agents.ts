/** Agents: specs from the in-memory catalog (built-ins + Agent Studio), filtered by
 *  audience and lifecycle for each identity (`atrium.runtime.agents`). */
import { type IdentityContext, rolesOf } from '../authz/identity';
import type { Audience, CatalogAgentSpec } from '../data/types';
import type { RoutingProfile } from './router';

export interface StudioSpec {
  name: string;
  description: string;
  instructions: string;
  tone: string;
  icon: string;
  audience: Audience;
  tools: string[];
  knowledge: string[];
  origin: string;
  routing: { keywords: string[]; examples: string[] };
  evaluation: { kind: string; question: string; expect_kb?: string }[];
  risk: string;
}

export interface AgentRow {
  id: string;
  owner_id: string;
  owner_unit: string | null;
  status: string;
  published_version: number | null;
  builtin: boolean;
  review_due: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentVersionRow {
  agent_id: string;
  version: number;
  spec: StudioSpec;
  status: string;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  eval_result: Record<string, unknown> | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface AgentSpec {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  knowledge: string[];
  audience: Audience;
  icon: string;
  keywords: string[];
  examples: string[];
  status: string;
  version: number;
  ownerId: string | null;
  builtin: boolean;
  origin: string;
  evaluation: { kind: string; question: string; expect_kb?: string }[];
  tone: string;
}

export function specFrom(
  agentId: string,
  spec: StudioSpec | CatalogAgentSpec,
  meta: { status: string; version: number; ownerId: string | null; builtin: boolean },
): AgentSpec {
  const routing = spec.routing ?? { keywords: [], examples: [] };
  return {
    id: agentId,
    name: spec.name,
    description: spec.description,
    instructions: spec.instructions ?? '',
    tools: [...(spec.tools ?? [])],
    knowledge: [...(spec.knowledge ?? [])],
    audience: spec.audience ?? { type: 'all' },
    icon: spec.icon ?? 'bot',
    keywords: [...(routing.keywords ?? [])],
    examples: [...(routing.examples ?? [])],
    evaluation: [...(spec.evaluation ?? [])],
    tone: spec.tone ?? '',
    origin: spec.origin ?? 'catalog',
    status: meta.status,
    version: meta.version,
    ownerId: meta.ownerId,
    builtin: meta.builtin,
  };
}

export function profileOf(a: AgentSpec): RoutingProfile {
  return { agentId: a.id, name: a.name, description: a.description, keywords: a.keywords, examples: a.examples };
}

export function publicAgent(a: AgentSpec): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    status: a.status,
    version: a.version,
    builtin: a.builtin,
    origin: a.origin,
    audience: a.audience,
    tools: a.tools,
    knowledge: a.knowledge,
  };
}

export function audienceAllows(audience: Audience, identity: IdentityContext): boolean {
  const kind = audience.type ?? 'all';
  if (kind === 'all') return true;
  const roles = rolesOf(identity);
  if (kind === 'roles') return (audience.roles ?? []).some((r) => roles.includes(r));
  if (kind === 'units') return (audience.units ?? []).some((u) => identity.unitPath.includes(u));
  return false;
}

export class AgentDirectory {
  readonly agents: AgentRow[] = [];
  readonly versions: AgentVersionRow[] = [];

  latestVersion(agentId: string): AgentVersionRow | undefined {
    return this.versions
      .filter((v) => v.agent_id === agentId)
      .slice()
      .sort((a, b) => b.version - a.version)[0];
  }

  /** `JOIN LATERAL`: published version when there is one, otherwise the newest draft. */
  private rowsFor(): AgentSpec[] {
    const out: AgentSpec[] = [];
    const sorted = this.agents
      .slice()
      .sort((a, b) => Number(b.builtin) - Number(a.builtin) || (a.id < b.id ? -1 : 1));
    for (const a of sorted) {
      const candidates = this.versions
        .filter((v) => v.agent_id === a.id && (v.version === a.published_version || a.published_version === null))
        .slice()
        .sort((x, y) => y.version - x.version);
      const v = candidates[0];
      if (!v) continue;
      out.push(specFrom(a.id, v.spec, { status: a.status, version: v.version, ownerId: a.owner_id, builtin: a.builtin }));
    }
    return out;
  }

  visibleFor(identity: IdentityContext): AgentSpec[] {
    return this.rowsFor().filter((a) => a.status === 'published' && audienceAllows(a.audience, identity));
  }

  get(agentId: string, identity: IdentityContext): AgentSpec | null {
    return this.visibleFor(identity).find((a) => a.id === agentId) ?? null;
  }

  /** Latest version (any status) of an agent the identity owns: playground and evaluation. */
  draftForOwner(agentId: string, identity: IdentityContext): AgentSpec | null {
    const a = this.agents.find((x) => x.id === agentId && x.owner_id === identity.employeeId);
    if (!a) return null;
    const v = this.latestVersion(agentId);
    if (!v) return null;
    return specFrom(a.id, v.spec, { status: 'playground', version: v.version, ownerId: a.owner_id, builtin: a.builtin });
  }
}
