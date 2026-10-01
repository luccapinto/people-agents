// @vitest-environment node
/** The classifier must hash and score exactly like the Python trainer that produced the weights:
 *  the constants below come from `atrium.runtime.intent` on the same inputs. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadIntentModel } from '../data/load';
import { type IntentModel, features, fnv1a, parseModel } from './intent';

let model: IntentModel;

beforeAll(async () => {
  model = parseModel(await loadIntentModel());
});

describe('intent model', () => {
  it('hashes feature strings like Python', () => {
    expect(fnv1a('')).toBe(2166136261);
    expect(fnv1a('w:ferias')).toBe(2071395784);
    expect(fnv1a('b:quantos dias')).toBe(3511295465);
    expect(fnv1a('c: fer')).toBe(1771540797);
  });

  it('takes features in first-seen order: words, then pairs, then character n-grams', () => {
    expect(features('Quantos dias de férias eu tenho?', model.ngrams, model.bits).slice(0, 6)).toEqual([
      107889, 128535, 43647, 196040, 198802, 120874,
    ]);
  });

  it('scores a text bit-identically to the back-end', () => {
    expect(model.scores('quantos dias de ferias eu tenho').vacation).toBe(6.47506275730838);
    expect(model.scores('qual foi o desconto do INSS no meu holerite').payroll).toBe(2.1852614417330143);
  });
});
