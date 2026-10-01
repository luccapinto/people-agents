// @vitest-environment node
/** Every policy-engine decision recorded from the Python back-end must be reproduced here. */
import { beforeAll, describe, expect, it } from 'vitest';
import goldens from '../../../../../shared/generated/goldens.json';
import type { Services } from '../runtime/services';
import { freshEngine, personaIdentities } from './engine';

let services: Services;
let who: ReturnType<typeof personaIdentities>;
let subjects: Record<string, string | null>;

beforeAll(async () => {
  services = await freshEngine();
  who = personaIdentities(services);
  const outsider = services.dataset.employees.find((e) => e.name === 'Maria Oliveira');
  subjects = {
    self: null,
    report: services.dataset.personas.find((p) => p.key === 'colaborador')?.employee_id ?? null,
    outsider: outsider ? outsider.id : null,
  };
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
      const d = services.policy.authorizeScope(who[item.persona], item.scope, item.domain);
      expect({ allowed: d.allowed, policy: d.policy }).toEqual({ allowed: item.allowed, policy: item.policy });
    });
  }
});
