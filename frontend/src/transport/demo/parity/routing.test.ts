// @vitest-environment node
/** Every routing decision recorded from the Python back-end must be reproduced here. */
import { beforeAll, describe, expect, it } from 'vitest';
import goldens from '../../../../../shared/generated/goldens.json';
import { profileOf } from '../runtime/agents';
import { LexicalRouter } from '../runtime/router';
import type { Services } from '../runtime/services';
import { freshEngine, personaIdentities } from './engine';

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
      const router = new LexicalRouter(visible.map(profileOf), services.lifeEvents());
      const d = router.route(item.q, visible.map((a) => a.id));
      expect({ mode: d.mode, agents: d.agents, life_event: d.lifeEvent }).toEqual({
        mode: item.mode,
        agents: item.agents,
        life_event: item.life_event,
      });
    });
  }
});
