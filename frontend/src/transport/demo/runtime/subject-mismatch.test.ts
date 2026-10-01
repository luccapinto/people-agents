// @vitest-environment node
/** The hard guarantee under the detection (backend/tests/security/test_subject.py): even if a
 *  router or a model picks a self-service tool for a question about the team, execute() does not
 *  read the speaker's data. */
import { describe, expect, it } from 'vitest';
import { freshEngine, personaIdentities } from '../parity/engine';
import { execute } from './registry';
import { ToolContext } from './tool';

describe('self-service tools on a turn about someone else', () => {
  it('refuses payroll_get_payslip with policy subject_mismatch', async () => {
    const s = await freshEngine();
    const ctx = new ToolContext(personaIdentities(s).gestora, s, 'payroll', null, [], 'team');
    const ex = execute(ctx, 'payroll_get_payslip', {}, new Set(['payroll_get_payslip']));
    expect(ex.status).toBe('denied');
    expect(ex.decision.policy).toBe('subject_mismatch');
    expect(ctx.subjectId).toBeNull();
  });
});
