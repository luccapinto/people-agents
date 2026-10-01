// @vitest-environment node
/** Same cases as backend/tests/runtime/test_flows.py: the policy has a meal category only for trips. */
import { describe, expect, it } from 'vitest';
import catalog from '../../../../../shared/generated/catalog.json';
import type { Catalog } from '../data/types';
import { guideCategory, type ReimbursementPolicy } from './receipts';

// Written by the back-end exporter from shared/catalog/company_policies.yaml.
const generated: Catalog = catalog as unknown as Catalog;
const policy: ReimbursementPolicy = generated.company_policies.reimbursement as unknown as ReimbursementPolicy;

describe('reimbursement guide category', () => {
  const cases: [string, string | null, boolean][] = [
    ['almoco', null, true],
    ['jantar viagem', 'alimentação em viagem', false],
    ['uber viagem', 'transporte por aplicativo', false],
    ['hotel', 'hospedagem', false],
  ];
  for (const [expense, category, note] of cases) {
    it(`maps "${expense}"`, () => {
      expect(guideCategory(expense, policy)).toEqual([category, note]);
    });
  }
});
