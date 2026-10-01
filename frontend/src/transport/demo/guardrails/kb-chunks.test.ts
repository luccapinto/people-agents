// @vitest-environment node
/** A flagged chunk quarantines its whole document from retrieval, so a pattern that matches a
 *  policy sentence ("não desative controles de segurança") silently drops a policy. Mirror of
 *  backend/tests/security/test_injection_sets.py::test_no_shipped_knowledge_chunk_looks_like_an_injection. */
import { describe, expect, it } from 'vitest';
import kbChunks from '../../../../../shared/generated/kb-chunks.json';
import { detectInjection } from './injection';

describe('shipped knowledge corpus', () => {
  it('has no chunk that looks like an injection', () => {
    const flagged = kbChunks.chunks
      .filter((c) => detectInjection(c.content).suspected)
      .map((c) => [c.source, c.section]);
    expect(flagged).toEqual([]);
  });
});
