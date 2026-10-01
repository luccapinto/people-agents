/** Intent classifier used by the deterministic router (`atrium.runtime.intent`).
 *
 *  A linear model over hashed features of the folded text: whole words, word pairs and character
 *  n-grams of each word (so "olerite", "holerit" and "contracheque" still meet their neighbours).
 *  Trained offline by the back-end (`atrium train-router`); the weights live in
 *  `shared/generated/intent-model.json` and are read the same way by both engines.
 *
 *  Integer arithmetic plus one square root, so Python and the browser give bit-identical scores:
 *  weights are stored scaled by `SCALE`; a text's score for an agent is
 *  `(bias + sum(weights of its features) / sqrt(number of its features)) / SCALE`. */
import { fold } from '../core/text';
import { words } from './nlu';

export const SCALE = 100;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over the ASCII bytes of the text (non-ASCII characters are ignored). */
export function fnv1a(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    const b = text.charCodeAt(i);
    if (b > 0x7f) continue;
    h = Math.imul(h ^ b, FNV_PRIME) >>> 0;
  }
  return h;
}

/** Distinct hashed features of a text, in first-seen order. */
export function features(text: string, ngrams: number[], bits: number): number[] {
  const toks = words(fold(text));
  const raw: string[] = toks.map((t) => `w:${t}`);
  for (let i = 0; i + 1 < toks.length; i += 1) raw.push(`b:${toks[i]} ${toks[i + 1]}`);
  for (const t of toks) {
    const padded = ` ${t} `;
    for (const n of ngrams) {
      for (let i = 0; i + n <= padded.length; i += 1) raw.push(`c:${padded.slice(i, i + n)}`);
    }
  }
  const mask = (1 << bits) - 1;
  const seen = new Set<number>();
  for (const f of raw) seen.add(fnv1a(f) & mask);
  return [...seen];
}

export class IntentModel {
  constructor(
    readonly ngrams: number[],
    readonly bits: number,
    readonly classes: string[],
    readonly bias: number[],
    /** feature hash -> flat [class index, weight, ...] */
    readonly rows: Map<number, number[]>,
    readonly trainingSha256: string,
  ) {}

  /** Score of each agent the model knows, for this text. */
  scores(text: string): Record<string, number> {
    const feats = features(text, this.ngrams, this.bits);
    const sums = new Array<number>(this.classes.length).fill(0);
    for (const f of feats) {
      const row = this.rows.get(f);
      if (!row) continue;
      for (let i = 0; i < row.length; i += 2) sums[row[i]] += row[i + 1];
    }
    const norm = feats.length ? Math.sqrt(feats.length) : 1.0;
    const out: Record<string, number> = {};
    for (let i = 0; i < this.classes.length; i += 1) out[this.classes[i]] = (this.bias[i] + sums[i] / norm) / SCALE;
    return out;
  }
}

/** `shared/generated/intent-model.json` as exported by the back-end trainer. */
export interface IntentModelData {
  ngrams: number[];
  hash_bits: number;
  classes: string[];
  bias: number[];
  features: number[];
  rows: number[][];
  training_sha256: string;
}

export function parseModel(data: IntentModelData): IntentModel {
  const rows = new Map<number, number[]>();
  for (let i = 0; i < data.features.length; i += 1) rows.set(data.features[i], data.rows[i]);
  return new IntentModel(data.ngrams, data.hash_bits, data.classes, data.bias, rows, data.training_sha256);
}
