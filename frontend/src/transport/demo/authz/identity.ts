/** The authenticated identity, derived from the dataset exactly like `hr.identity()`. */
import { type Day, fromISO } from '../core/date';
import type { Dataset, RawEmployee } from '../data/types';

export interface IdentityContext {
  employeeId: string;
  name: string;
  email: string;
  title: string;
  unitId: string;
  unitPath: string[];
  managerId: string | null;
  location: string;
  hireDate: Day;
  directReports: string[];
  chainReports: string[];
  hrbpUnits: string[];
  platformRoles: string[];
  sessionId: string;
  requestId: string;
}

export function rolesOf(identity: IdentityContext): string[] {
  const roles = new Set<string>(['employee', ...identity.platformRoles]);
  if (identity.directReports.length) roles.add('manager');
  if (identity.hrbpUnits.length) roles.add('hrbp');
  return [...roles];
}

export function hasRole(identity: IdentityContext, role: string): boolean {
  return rolesOf(identity).includes(role);
}

export function isManager(identity: IdentityContext): boolean {
  return identity.directReports.length > 0;
}

export function isHrbp(identity: IdentityContext): boolean {
  return identity.hrbpUnits.length > 0;
}

export function isGovernance(identity: IdentityContext): boolean {
  return identity.platformRoles.includes('governance_admin');
}

export function firstName(identity: IdentityContext): string {
  return identity.name.split(/\s+/)[0];
}

/** What the model is told about the user (no personal data beyond the directory). */
export function identitySummary(identity: IdentityContext): Record<string, unknown> {
  return {
    nome: identity.name,
    cargo: identity.title,
    unidade: identity.unitId,
    'papéis': rolesOf(identity).slice().sort(),
    'admissão': identity.hireDate.toISOString().slice(0, 10),
    local: identity.location,
    liderados_diretos: identity.directReports.length,
  };
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Walk the unit tree from the employee's unit to the root; root first (depth DESC). */
function unitPathOf(units: Map<string, string | null>, unitId: string): string[] {
  const chain: string[] = [];
  let current: string | null = unitId;
  let depth = 0;
  while (current && depth <= 32 && units.has(current)) {
    chain.push(current);
    current = units.get(current) ?? null;
    depth += 1;
  }
  return chain.reverse();
}

export function loadIdentity(data: Dataset, employeeId: string, sessionId = ''): IdentityContext | null {
  const me = data.employees.find((e) => e.id === employeeId && e.status === 'active');
  if (!me) return null;
  const units = new Map<string, string | null>(data.units.map((u) => [u.id, u.parent_id]));
  const active = data.employees.filter((e) => e.status === 'active');
  const direct = active.filter((e) => e.manager_id === me.id).map((e) => e.id).sort();
  const chain: string[] = [];
  let frontier = [...direct];
  let depth = 0;
  while (frontier.length && depth < 32) {
    chain.push(...frontier);
    const next: string[] = [];
    for (const e of active) if (e.manager_id && frontier.includes(e.manager_id)) next.push(e.id);
    frontier = next;
    depth += 1;
  }
  return {
    employeeId: me.id,
    name: me.name,
    email: me.email,
    title: me.title,
    unitId: me.unit_id,
    unitPath: unitPathOf(units, me.unit_id),
    managerId: me.manager_id,
    location: me.location,
    hireDate: fromISO(me.hire_date),
    directReports: direct,
    chainReports: [...new Set(chain)].sort(),
    hrbpUnits: data.hrbp_assignments.filter((a) => a.hrbp_id === me.id).map((a) => a.unit_id).sort(),
    platformRoles: data.platform_roles.filter((r) => r.employee_id === me.id).map((r) => r.role).sort(),
    sessionId,
    requestId: randomHex(16),
  };
}

export function employeeIsActive(e: RawEmployee): boolean {
  return e.status === 'active';
}
