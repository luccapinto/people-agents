// @vitest-environment node
/** The governance tools read the console's own data and are closed to everyone else. */
import { describe, expect, it } from 'vitest';
import { freshEngine, personaIdentities } from '../parity/engine';
import { execute } from '../runtime/registry';
import { ToolContext } from '../runtime/tool';

const TOOLS = ['governance_usage', 'governance_guardrails', 'governance_security_events', 'governance_transcript_access'];
const TABS: Record<string, string> = {
  governance_usage: '/console?tab=overview',
  governance_guardrails: '/console?tab=policies',
  governance_security_events: '/console?tab=audit',
  governance_transcript_access: '/console?tab=conversations',
};

describe('governance tools', () => {
  it('answer the governance role with a table card linking to the console', async () => {
    const s = await freshEngine();
    const ctx = new ToolContext(personaIdentities(s).governanca, s, 'governance');
    for (const name of TOOLS) {
      const ex = execute(ctx, name, {}, new Set(TOOLS));
      expect(ex.status, name).toBe('ok');
      expect(ex.result.card?.type, name).toBe('table');
      expect(ex.result.card?.data.link, name).toEqual({ href: TABS[name], label: expect.any(String) });
      expect(ex.result.summary.length, name).toBeGreaterThan(20);
    }
  });

  it('are denied to an employee without the governance role', async () => {
    const s = await freshEngine();
    const ctx = new ToolContext(personaIdentities(s).colaborador, s, 'governance');
    for (const name of TOOLS) {
      const ex = execute(ctx, name, {}, new Set(TOOLS));
      expect(ex.status, name).toBe('denied');
      expect(ex.decision.policy, name).toBe('tool_roles');
    }
  });
});
