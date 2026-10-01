/** Lazy loaders for the generated JSON. Each file becomes its own chunk so the first paint
 *  only pays for the shell; the engine pulls them in when the demo session starts.
 *  The dynamic imports here are deliberate code-splitting boundaries (1.9 MB of dataset). */
import type { IntentModelData } from '../runtime/intent';
import type { Catalog, Dataset, KbData } from './types';

let datasetPromise: Promise<Dataset> | null = null;
let catalogPromise: Promise<Catalog> | null = null;
let kbPromise: Promise<KbData> | null = null;
let intentModelPromise: Promise<IntentModelData> | null = null;

export function loadDataset(): Promise<Dataset> {
  datasetPromise ??= import('../../../../../shared/generated/dataset.json').then((m) => m.default as unknown as Dataset);
  return datasetPromise;
}

export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= import('../../../../../shared/generated/catalog.json').then((m) => m.default as unknown as Catalog);
  return catalogPromise;
}

export function loadKb(): Promise<KbData> {
  kbPromise ??= import('../../../../../shared/generated/kb-chunks.json').then((m) => m.default as unknown as KbData);
  return kbPromise;
}

export function loadIntentModel(): Promise<IntentModelData> {
  intentModelPromise ??= import('../../../../../shared/generated/intent-model.json').then(
    (m) => m.default as unknown as IntentModelData,
  );
  return intentModelPromise;
}

export function loadBranding(): Promise<Record<string, unknown>> {
  return import('../../../../../config/branding.json').then((m) => m.default as unknown as Record<string, unknown>);
}
