/** Builds and seeds one engine instance: agents, knowledge bases and chunks. */
import { addDays, fromISO, toISO } from '../core/date';
import { detectInjection } from '../guardrails/injection';
import { loadCatalog, loadDataset, loadIntentModel, loadKb } from '../data/load';
import type { Catalog, CatalogAgentSpec, Dataset, KbChunk, KbData } from '../data/types';
import type { StudioSpec } from './agents';
import type { KbDocumentRow } from './knowledge';
import { Services, REFERENCE_TODAY } from './services';
import type { Branding } from './prompts';
import { parseModel } from './intent';
import { agentRisk } from './registry';

export const REVIEW_PERIOD_DAYS = 180;

function toStudioSpec(spec: CatalogAgentSpec): StudioSpec {
  const { owner, reviewer, id, ...rest } = spec;
  void owner;
  void reviewer;
  void id;
  return rest as unknown as StudioSpec;
}

function seedAgents(s: Services, catalog: Catalog, dataset: Dataset): void {
  const governance = dataset.platform_roles
    .filter((r) => r.role === 'governance_admin')
    .map((r) => r.employee_id)
    .sort()[0];
  const byName = new Map(dataset.employees.map((e) => [e.name, e.id]));
  const unitOf = new Map(dataset.employees.map((e) => [e.id, e.unit_id]));
  const reviewDue = toISO(addDays(fromISO(REFERENCE_TODAY), REVIEW_PERIOD_DAYS));
  for (const spec of catalog.agents.agents) {
    const studio = spec.origin === 'studio';
    const owner = studio ? (byName.get(spec.owner as string) as string) : governance;
    s.agents.agents.push({
      id: spec.id,
      owner_id: owner,
      owner_unit: unitOf.get(owner) ?? null,
      status: 'published',
      published_version: 1,
      builtin: !studio,
      review_due: reviewDue,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-15T00:00:00.000Z',
    });
    const body = { ...toStudioSpec(spec), risk: agentRisk(spec.tools) };
    if (studio) {
      const evaluation = spec.evaluation ?? [];
      s.agents.versions.push({
        agent_id: spec.id,
        version: 1,
        spec: body,
        status: 'published',
        created_by: owner,
        created_at: '2026-09-10T00:00:00.000Z',
        submitted_at: '2026-09-14T00:00:00.000Z',
        eval_result: {
          passed: evaluation.length,
          total: evaluation.length,
          ok: true,
          ran_at: '2026-09-14',
          version: 1,
          results: evaluation.map((e) => ({ question: e.question, kind: e.kind, passed: true, detail: '' })),
        },
        reviewed_by: byName.get(spec.reviewer as string) ?? null,
        reviewed_at: '2026-09-15T00:00:00.000Z',
        review_note: 'Aprovado: só ferramentas de leitura e chamado; audiência restrita à área.',
      });
    } else {
      s.agents.versions.push({
        agent_id: spec.id,
        version: 1,
        spec: body,
        status: 'published',
        created_by: owner,
        created_at: '2026-09-10T00:00:00.000Z',
        submitted_at: null,
        eval_result: null,
        reviewed_by: owner,
        reviewed_at: '2026-09-15T00:00:00.000Z',
        review_note: null,
      });
    }
  }
}

function seedKnowledge(s: Services, kbData: KbData, dataset: Dataset): void {
  const governance = dataset.platform_roles
    .filter((r) => r.role === 'governance_admin')
    .map((r) => r.employee_id)
    .sort()[0];
  const studioOwner = dataset.employees.find((e) => e.name === 'Mariana Costa')?.id ?? null;
  for (const base of kbData.knowledge_bases) {
    s.kb.bases.push({
      id: base.id,
      name: base.name,
      description: base.description,
      audience: base.audience,
      owner_id: base.id === 'plataforma-dados' ? studioOwner : governance,
    });
  }
  const bySource = new Map<string, KbChunk[]>();
  for (const chunk of kbData.chunks) {
    bySource.set(chunk.source, [...(bySource.get(chunk.source) ?? []), chunk]);
  }
  for (const [source, chunks] of bySource) {
    const flags = [...new Set(chunks.flatMap((c) => detectInjection(c.content).signals))].sort();
    const doc: KbDocumentRow = {
      id: `doc:${source}`,
      kb_id: chunks[0].kb,
      title: chunks[0].document,
      source,
      mime: 'text/markdown',
      flags: flags.length ? ['injection_suspected', ...flags] : [],
      uploaded_by: null,
      created_at: '2026-09-01T00:00:00.000Z',
    };
    s.kb.documents.push(doc);
    s.kb.chunks.push(...chunks.map((c) => ({ ...c, document_id: doc.id })));
  }
  s.kb.rebuild();
}

let instance: Services | null = null;
let building: Promise<Services> | null = null;

export async function buildEngine(branding: Branding): Promise<Services> {
  const [dataset, catalog, kbData, modelData] = await Promise.all([loadDataset(), loadCatalog(), loadKb(), loadIntentModel()]);
  const s = new Services(dataset, catalog, kbData, branding, parseModel(modelData));
  seedAgents(s, catalog, dataset);
  seedKnowledge(s, kbData, dataset);
  return s;
}

export function engine(branding: Branding): Promise<Services> {
  if (instance) return Promise.resolve(instance);
  building ??= buildEngine(branding).then((s) => {
    instance = s;
    return s;
  });
  return building;
}

export function resetEngine(): void {
  instance = null;
  building = null;
}
