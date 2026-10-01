// @vitest-environment node
/** A knowledge search that finds nothing is never a dead end: it offers questions of the probable
 *  domain plus the HR ticket, and the ticket carries the unanswered question
 *  (backend/tests/runtime/test_flows.py::test_a_question_nobody_answers_offers_next_steps_and_an_hr_ticket). */
import { describe, expect, it } from 'vitest';
import { freshEngine, personaIdentities } from '../parity/engine';
import { Orchestrator, type StreamEventOut } from './orchestrator';

describe('a question nobody answers', () => {
  it('offers next steps and an HR ticket carrying the question', async () => {
    const s = await freshEngine();
    const me = personaIdentities(s).colaborador;
    const question = 'Qual a política para levar meu cachorro ao escritório às sextas?';

    const first: StreamEventOut[] = [];
    for await (const e of new Orchestrator(s).run(me, null, question)) first.push(e);
    let kbStatus: string | null = null;
    let chips: string[] = [];
    for (const e of first) {
      if (e.event === 'trace.tool' && e.data.tool === 'kb_search') kbStatus = String(e.data.status);
      if (e.event === 'suggestions') chips = e.data.items as string[];
    }
    expect(kbStatus).toBe('error');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips[chips.length - 1]).toBe('Abrir um chamado para o RH');

    const conversationId = String(first[0].data.conversation_id);
    const second: StreamEventOut[] = [];
    for await (const e of new Orchestrator(s).run(me, conversationId, chips[chips.length - 1])) second.push(e);
    let proposalTool: string | null = null;
    let details: { label: string; value: unknown }[] = [];
    for (const e of second) {
      if (e.event === 'proposal') {
        proposalTool = String(e.data.tool);
        details = e.data.details as { label: string; value: unknown }[];
      }
    }
    expect(proposalTool).toBe('ticket_open');
    // The ticket carries the question the assistant could not answer.
    expect(details.some((x) => String(x.value).includes('cachorro'))).toBe(true);
  });
});
