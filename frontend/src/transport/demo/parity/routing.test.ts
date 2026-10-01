// @vitest-environment node
/** Every routing decision recorded from the Python back-end must be reproduced here. */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import goldens from '../../../../../shared/generated/goldens.json';
import { profileOf } from '../runtime/agents';
import { LexicalRouter } from '../runtime/router';
import type { Services } from '../runtime/services';
import { loadYaml } from './eval-yaml';
import { freshEngine, personaIdentities } from './engine';

const EVAL = new URL('../../../../../shared/eval/', import.meta.url).pathname;

let services: Services;
let who: ReturnType<typeof personaIdentities>;

beforeAll(async () => {
  services = await freshEngine();
  who = personaIdentities(services);
});

describe('goldens.routing', () => {
  for (const [index, item] of goldens.routing.entries()) {
    it(`${index} ${item.persona}: ${item.q}`, () => {
      const identity = who[item.persona];
      const visible = services.agents.visibleFor(identity);
      expect(visible.map((a) => a.id)).toEqual(item.visible);
      const router = new LexicalRouter(visible.map(profileOf), services.lifeEvents(), services.lexicon(), services.intentModel);
      const d = router.route(item.q, visible.map((a) => a.id));
      expect({ mode: d.mode, agents: d.agents, life_event: d.lifeEvent }).toEqual({
        mode: item.mode,
        agents: item.agents,
        life_event: item.life_event,
      });
    });
  }
});

/** The blind sets are recorded as a question count and a SHA-256 of their decisions: a diff of the
 *  decisions one by one would show which ones flipped, a look at the sets' errors. Nothing here
 *  prints an individual blind decision or expectation. */
describe('goldens.routing_blind', () => {
  for (const [name, expected] of Object.entries(goldens.routing_blind)) {
    it(`${name} reproduces every decision`, () => {
      const questions = loadYaml(`${EVAL}${name}`).questions as unknown as { persona: string; q: string }[];
      const lines: string[] = [];
      for (const item of questions) {
        const visible = services.agents.visibleFor(who[item.persona]);
        const router = new LexicalRouter(visible.map(profileOf), services.lifeEvents(), services.lexicon(), services.intentModel);
        const d = router.route(item.q, visible.map((a) => a.id));
        lines.push([item.persona, item.q, d.mode, d.agents.join(','), d.lifeEvent ?? ''].join('|'));
      }
      expect(lines.length).toEqual(expected.questions);
      expect(createHash('sha256').update(lines.join('\n')).digest('hex')).toEqual(expected.digest);
    });
  }
});
