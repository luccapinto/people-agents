/** Shared fixture for the parity suites: one freshly seeded engine per suite. */
import brandingJson from '../../../../../config/branding.json';
import { loadIdentity, type IdentityContext } from '../authz/identity';
import { buildEngine } from '../runtime/engine';
import type { Branding } from '../runtime/prompts';
import type { Services } from '../runtime/services';

export const branding = brandingJson as unknown as Branding;

export async function freshEngine(): Promise<Services> {
  return buildEngine(branding);
}

export function personaIdentities(s: Services): Record<string, IdentityContext> {
  const out: Record<string, IdentityContext> = {};
  for (const p of s.dataset.personas) {
    const identity = loadIdentity(s.dataset, p.employee_id);
    if (identity) out[p.key] = identity;
  }
  return out;
}
