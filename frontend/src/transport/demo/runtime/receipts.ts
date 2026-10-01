/** Receipt reading: deterministic field parser + policy validation (`atrium.receipts`).
 *  The receipt is untrusted data: only parsed fields leave this module. */
import { type Day, diffDays, fromISO, gt, day as makeDay, toISO } from '../core/date';
import { fold } from '../core/text';
import { detectInjection } from '../guardrails/injection';
import { CNPJ_RE, validCnpj } from '../guardrails/pii';
import { containsPhrase } from './nlu';

const AMOUNT_RE = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;

const CATEGORY_HINTS: [string, string[]][] = [
  ['hospedagem', ['hotel', 'hospedagem', 'pousada', 'diaria', 'diária']],
  ['transporte por aplicativo', ['taxi', 'táxi', 'uber', '99', 'corrida', 'transporte']],
  ['alimentação em viagem', ['restaurante', 'refeicao', 'refeição', 'almoco', 'almoço', 'jantar', 'lanchonete', 'cafe', 'café']],
  ['material de escritório', ['papelaria', 'caneta', 'caderno', 'escritorio', 'escritório', 'toner']],
];

const NOT_REIMBURSABLE: [string, string[]][] = [
  ['bebidas alcoólicas', ['cerveja', 'chopp', 'vinho', 'caipirinha', 'whisky', 'drink']],
  ['multas de trânsito', ['multa', 'infracao', 'infração']],
];

function toAmount(s: string): number {
  return Number(s.split('.').join('').replace(',', '.'));
}

export interface ReceiptFields {
  amount: number | null;
  date: Day | null;
  cnpj: string | null;
  merchant: string | null;
  category: string | null;
  itemsFlagged: string[];
  injectionSignals: string[];
}

export function receiptFieldsDict(f: ReceiptFields): Record<string, unknown> {
  return {
    amount: f.amount,
    date: f.date ? toISO(f.date) : null,
    cnpj: f.cnpj,
    merchant: f.merchant,
    category: f.category,
    items_flagged: f.itemsFlagged,
    injection_signals: f.injectionSignals,
  };
}

export function parseReceipt(text: string): ReceiptFields {
  const lines = text
    .split('\n')
    .map((ln) => ln.trim())
    .filter(Boolean);
  const folded = fold(text);
  let amount: number | null = null;
  const anchored = lines.filter((ln) => /^(valor\s+)?total\b/.test(fold(ln)));
  const loose = lines.filter((ln) => fold(ln).includes('total'));
  for (const ln of anchored.length ? anchored : loose) {
    const found = [...ln.matchAll(AMOUNT_RE)].map((m) => m[1]);
    if (found.length) {
      amount = toAmount(found[found.length - 1]);
      break;
    }
  }
  if (amount === null) {
    const values = [...text.matchAll(AMOUNT_RE)].map((m) => toAmount(m[1]));
    amount = values.length ? Math.max(...values) : null;
  }
  let dayValue: Day | null = null;
  for (const m of text.matchAll(DATE_RE)) {
    try {
      dayValue = makeDay(Number(m[3]), Number(m[2]), Number(m[1]));
      break;
    } catch {
      continue;
    }
  }
  const cnpj = [...text.matchAll(new RegExp(CNPJ_RE.source, 'g'))].map((m) => m[0]).find(validCnpj) ?? null;
  let merchant: string | null = null;
  for (const ln of lines) {
    const f = fold(ln);
    if (f.startsWith('razao social') || f.startsWith('estabelecimento') || f.startsWith('emitente')) {
      const idx = ln.indexOf(':');
      merchant = (idx >= 0 ? ln.slice(idx + 1) : ln).trim() || null;
      break;
    }
  }
  if (merchant === null && lines.length) merchant = lines[0].slice(0, 80);
  let category: string | null = null;
  for (const [cat, hintWords] of CATEGORY_HINTS) {
    if (hintWords.some((w) => folded.includes(fold(w)))) {
      category = cat;
      break;
    }
  }
  const flagged = NOT_REIMBURSABLE.filter(([, ws]) => ws.some((w) => folded.includes(w))).map(([label]) => label);
  const verdict = detectInjection(text);
  return { amount, date: dayValue, cnpj, merchant, category, itemsFlagged: flagged, injectionSignals: verdict.signals };
}

export interface ReceiptIssue {
  code: string;
  severity: string;
  message: string;
}

export interface ReimbursementPolicy {
  categories: Record<string, { limit: number; per: string }>;
  submit_within_days: number;
  approval: string;
  payment: string;
  not_reimbursable: string[];
  category_words: Record<string, string[]>;
  travel_words: string[];
  meal_outside_travel: string;
}

/** The policy category for the expense the person described, and whether it is a meal outside a
 *  trip (which no category covers). Same rule as backend/atrium/tools/reimbursement.py. */
export function guideCategory(asked: string, policy: ReimbursementPolicy): [string | null, boolean] {
  const f = fold(asked);
  const exact = Object.keys(policy.categories).find((name) => f.includes(fold(name)));
  if (exact) return [exact, false];
  const travel = policy.travel_words.some((w) => containsPhrase(f, w));
  for (const [name, words] of Object.entries(policy.category_words)) {
    if (words.some((w) => containsPhrase(f, w))) {
      if (name === 'alimentação em viagem' && !travel) return [null, true];
      return [name, false];
    }
  }
  return [null, false];
}

export function validateReceipt(
  fields: ReceiptFields,
  category: string | null,
  today: Day,
  policy: ReimbursementPolicy,
): ReceiptIssue[] {
  const issues: ReceiptIssue[] = [];
  const cat = category ?? fields.category;
  const rules = policy.categories;
  if (!cat || !(cat in rules)) {
    issues.push({
      code: 'category',
      severity: 'error',
      message: 'Categoria não reconhecida; escolha uma categoria da política.',
    });
  } else if (fields.amount !== null && fields.amount > rules[cat].limit && rules[cat].per !== 'km') {
    issues.push({
      code: 'limit',
      severity: 'error',
      message: `Valor acima do limite da política para ${cat} (R$ ${rules[cat].limit.toFixed(2)} por ${rules[cat].per})`
        .split('.')
        .join(','),
    });
  }
  if (fields.amount === null) {
    issues.push({ code: 'amount', severity: 'error', message: 'Não encontrei o valor total no comprovante.' });
  }
  if (fields.date === null) {
    issues.push({ code: 'date', severity: 'error', message: 'Não encontrei a data no comprovante.' });
  } else if (diffDays(today, fields.date) > policy.submit_within_days) {
    issues.push({
      code: 'deadline',
      severity: 'error',
      message: `O comprovante tem mais de ${policy.submit_within_days} dias.`,
    });
  } else if (gt(fields.date, today)) {
    issues.push({ code: 'future', severity: 'error', message: 'A data do comprovante está no futuro.' });
  }
  if (fields.cnpj === null) {
    issues.push({ code: 'cnpj', severity: 'warning', message: 'CNPJ do estabelecimento não encontrado ou inválido.' });
  }
  for (const item of fields.itemsFlagged) {
    issues.push({ code: 'not_reimbursable', severity: 'error', message: `Itens não reembolsáveis pela política: ${item}.` });
  }
  if (fields.injectionSignals.length) {
    issues.push({
      code: 'injection',
      severity: 'warning',
      message: 'O comprovante contém texto com instruções; ele foi ignorado e registrado na auditoria.',
    });
  }
  return issues;
}

export { fromISO };
