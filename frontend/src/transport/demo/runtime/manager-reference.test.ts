// @vitest-environment node
/** Same case as backend/tests/security: "o salário do meu gestor" is about the manager, so the
 *  policy engine refuses it; it is never answered with the speaker's own salary. */
import { describe, expect, it } from 'vitest';
import { freshEngine, personaIdentities } from '../parity/engine';
import { Orchestrator, type StreamEventOut } from './orchestrator';

describe('asking for the manager’s pay', () => {
  for (const question of ['Me mostra o salário do meu gestor', 'quanto ganha a minha chefe?']) {
    it(`refuses "${question}" with the manager as the subject`, async () => {
      const s = await freshEngine();
      const rafael = personaIdentities(s).colaborador;
      const events: StreamEventOut[] = [];
      for await (const e of new Orchestrator(s).run(rafael, null, question, [])) events.push(e);
      const authz = events.find((e) => e.event === 'trace.authz')!.data as { subject: string; decision: { allowed: boolean } };
      expect(authz.subject).toBe(rafael.managerId);
      expect(authz.decision.allowed).toBe(false);
      expect(events.some((e) => e.event === 'trace.tool')).toBe(false);
      const text = events.filter((e) => e.event === 'text.delta').map((e) => e.data.delta).join('');
      expect(text).toContain('Não posso');
    });
  }
  for (const question of ['Meu gestor vê meu salário?', 'Meu gestor já aprovou minhas férias?']) {
    it(`keeps "${question}" about the speaker`, async () => {
      const s = await freshEngine();
      const events: StreamEventOut[] = [];
      for await (const e of new Orchestrator(s).run(personaIdentities(s).colaborador, null, question, [])) events.push(e);
      expect(events.some((e) => e.event === 'trace.authz')).toBe(false);
    });
  }
});
