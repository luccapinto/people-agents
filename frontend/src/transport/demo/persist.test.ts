/** A returning visitor after a deploy must get the current built-in agents, not the ones saved in
 *  their browser by the previous build. */
import { afterEach, describe, expect, it } from 'vitest';
import { freshEngine } from './parity/engine';
import { load, save, STORAGE_KEY } from './persist';

afterEach(() => localStorage.removeItem(STORAGE_KEY));

describe('demo persistence', () => {
  it('restores a snapshot saved by the same build', async () => {
    const before = await freshEngine();
    before.tickets.push({ id: 'CH-1' } as never);
    save(before);
    const after = await freshEngine();
    expect(load(after)).toBe(true);
    expect(after.tickets).toHaveLength(1);
  });

  it('drops a snapshot saved by a build with another catalog and keeps the current agents', async () => {
    const old = await freshEngine();
    // The previous build seeded this agent without the tool the current catalog gives it.
    old.agents.versions.find((v) => v.agent_id === 'reimbursement')!.spec.tools = ['reimbursement_list', 'kb_search'];
    save(old);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { catalog: string };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, catalog: 'previous-build' }));

    const current = await freshEngine();
    expect(load(current)).toBe(false);
    expect(current.agents.versions.find((v) => v.agent_id === 'reimbursement')!.spec.tools).toContain('reimbursement_guide');
  });
});
