// @vitest-environment node
/** The demo's "Usar comprovante de exemplo" button: the bundled receipt is attached to the message
 *  the card sends, and it must be read (fields, hidden instruction flagged, proposal), not answered
 *  with the list of past reimbursements. */
import { describe, expect, it } from 'vitest';
import { freshEngine, personaIdentities } from '../parity/engine';
import { SAMPLE_RECEIPT_FILENAME, SAMPLE_RECEIPT_TEXT } from '../sample-receipt';
import { Orchestrator, type StreamEventOut } from './orchestrator';

describe('sample receipt in the demo', () => {
  it('is read as data and turned into a reimbursement proposal', async () => {
    const s = await freshEngine();
    const rafael = personaIdentities(s).colaborador;
    s.uploads.push({
      id: 'sample-1',
      owner_id: rafael.employeeId,
      filename: SAMPLE_RECEIPT_FILENAME,
      mime: 'text/plain',
      size_bytes: SAMPLE_RECEIPT_TEXT.length,
      text_content: SAMPLE_RECEIPT_TEXT,
      created_at: new Date().toISOString(),
    } as never);
    const events: StreamEventOut[] = [];
    const attachment = [{ upload_id: 'sample-1', filename: SAMPLE_RECEIPT_FILENAME }];
    for await (const e of new Orchestrator(s).run(rafael, null, 'Segue o comprovante para o reembolso.', attachment)) events.push(e);
    const tools = events.filter((e) => e.event === 'trace.tool').map((e) => e.data.tool);
    expect(tools).toEqual(['reimbursement_extract_receipt']);
    const card = events.find((e) => e.event === 'card')!.data.card as { type: string; data: { fields: { amount: number; injection_signals: string[] } } };
    expect(card.type).toBe('receipt_extraction');
    expect(card.data.fields.amount).toBe(103.95);
    expect(card.data.fields.injection_signals.length).toBeGreaterThan(0);
    expect(events.some((e) => e.event === 'proposal')).toBe(true);
  });
});
