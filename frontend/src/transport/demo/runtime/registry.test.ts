// @vitest-environment node
/** Catalog contract (backend/tests/runtime/test_catalog_contract.py): every tool an agent can be
 *  given by the governed catalog must have an implementation in this engine too. */
import { describe, expect, it } from 'vitest';
import { freshEngine } from '../parity/engine';

describe('tool catalog', () => {
  it('has an implementation for every governed tool', async () => {
    const s = await freshEngine();
    const implemented = Object.keys(s.tools());
    expect(Object.keys(s.toolCatalog()).filter((name) => !implemented.includes(name))).toEqual([]);
  });
});
