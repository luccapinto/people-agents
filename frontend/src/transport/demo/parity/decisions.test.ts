// @vitest-environment node
/** Every policy-engine decision recorded from the Python back-end must be reproduced here. */
import { beforeAll, describe, expect, it } from 'vitest';
import goldens from '../../../../../shared/generated/goldens.json';
import { PolicyEngine, type PolicyRow, PolicyStore } from '../authz/policy';
import type { Services } from '../runtime/services';
import { freshEngine, personaIdentities } from './engine';

let services: Services;
let who: ReturnType<typeof personaIdentities>;
let subjects: Record<string, string | null>;
// The console can turn team compensation on, and the demo must then allow exactly what the
// back-end allows: the goldens record both states of the governance switch.
const SWITCH = 'manager_can_view_team_compensation';
let engines: Record<string, PolicyEngine>;

beforeAll(async () => {
  services = await freshEngine();
  who = personaIdentities(services);
  const outsider = services.dataset.employees.find((e) => e.name === 'Maria Oliveira');
  subjects = {
    self: null,
    report: services.dataset.personas.find((p) => p.key === 'colaborador')?.employee_id ?? null,
    outsider: outsider ? outsider.id : null,
  };
  const rows = new Map<string, PolicyRow>(services.store.policies);
  const row = rows.get(SWITCH);
  if (row) rows.set(SWITCH, { ...row, value: { enabled: true } });
  engines = { false: services.policy, true: new PolicyEngine(new PolicyStore(rows)) };
});

describe('goldens.decisions', () => {
  for (const [index, item] of goldens.decisions.entries()) {
    it(`${index} ${item.persona} ${item.action} ${item.subject}`, () => {
      const identity = who[item.persona];
      const subject = subjects[item.subject] ?? identity.employeeId;
      const d =
        item.action === 'analytics.aggregate'
          ? services.policy.authorize(identity, item.action, null, {
              unitIds: ['U11'],
              allUnits: services.dataset.units,
            })
          : services.policy.authorize(identity, item.action, subject);
      expect({ allowed: d.allowed, policy: d.policy }).toEqual({ allowed: item.allowed, policy: item.policy });
    });
  }
});

describe('goldens.scope_decisions', () => {
  for (const [index, item] of goldens.scope_decisions.entries()) {
    it(`${index} ${item.persona} ${item.scope} ${item.domain}`, () => {
      const d = engines[String(item.team_compensation)].authorizeScope(who[item.persona], item.scope, item.domain);
      expect({ allowed: d.allowed, policy: d.policy }).toEqual({ allowed: item.allowed, policy: item.policy });
    });
  }
});
