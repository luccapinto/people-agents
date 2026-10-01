/** Tools: the only way an agent touches company data (`atrium.runtime.tool`).
 *
 *  A tool declares its risk and its subject mode. The runtime — not the model — decides who
 *  the subject is, validates arguments (unknown fields rejected) and runs the handler inside
 *  an identity-scoped session. Write and sensitive tools return a proposal. */
import type { Day } from '../core/date';
import { fromISO, toISO } from '../core/date';
import type { Decision } from '../authz/policy';
import type { IdentityContext } from '../authz/identity';
import type { HRSession } from '../data/store';
import type { Services } from './services';

export type Risk = 'read' | 'write' | 'sensitive';

export interface Card {
  type: string;
  data: Record<string, unknown>;
}

export interface Citation {
  id: string;
  kb: string;
  document: string;
  section: string;
  snippet: string;
  source: string;
}

export interface ProposalDraft {
  summary: string;
  details: { label: string; value: string }[];
  args: Record<string, unknown>;
  subjectId?: string | null;
  tool?: string | null;
}

export interface ToolResult {
  data: Record<string, unknown>;
  summary: string;
  card?: Card | null;
  citations?: Citation[];
  proposal?: ProposalDraft | null;
  error?: string | null;
  decision?: Decision | null;
  // Follow-up phrases offered as chips ("Quero tirar férias de 21/12 a 04/01"): sent as a new
  // message when clicked, so they go through routing, authorization and confirmation again.
  suggestions?: string[];
}

export function fail(message: string, data: Record<string, unknown> = {}, card: Card | null = null): ToolResult {
  return { data: { erro: message, ...data }, summary: message, error: message, card };
}

/** A business rule refused the request (shown to the user, audited). */
export class ToolError extends Error {}

export class ToolContext {
  subjectId: string | null = null;

  constructor(
    readonly identity: IdentityContext,
    readonly services: Services,
    readonly agentId: string,
    readonly conversationId: string | null = null,
    readonly knowledge: string[] = [],
  ) {}

  get today(): Day {
    return this.services.today;
  }

  hr(): HRSession {
    return this.services.session(this.identity.employeeId);
  }
}

// --------------------------------------------------------------------------- argument schemas
export interface Field {
  type: 'str' | 'int' | 'float' | 'bool' | 'date';
  /** Optional fields default to `undefined`; `null` is an explicit nullable default. */
  optional?: boolean;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  ge?: number;
  le?: number;
  gt?: number;
  pattern?: RegExp;
  description?: string;
}

export type ParamSpec = Record<string, Field>;

export interface ValidationFailure {
  ok: false;
  message: string;
}

export interface ValidationSuccess {
  ok: true;
  /** JSON-serializable arguments, as `model_dump(mode="json")` produces them. */
  dump: Record<string, unknown>;
  values: Record<string, unknown>;
}

function coerce(field: Field, raw: unknown): unknown {
  switch (field.type) {
    case 'str':
      if (typeof raw !== 'string') throw new Error('Input should be a valid string');
      return raw;
    case 'bool':
      if (typeof raw !== 'boolean') throw new Error('Input should be a valid boolean');
      return raw;
    case 'int': {
      if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
      if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw);
      throw new Error('Input should be a valid integer');
    }
    case 'float': {
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
      throw new Error('Input should be a valid number');
    }
    case 'date': {
      if (raw instanceof Date) return raw;
      if (typeof raw === 'string') {
        try {
          return fromISO(raw);
        } catch {
          throw new Error('Input should be a valid date');
        }
      }
      throw new Error('Input should be a valid date');
    }
    default:
      throw new Error('unsupported field');
  }
}

export function validateArgs(spec: ParamSpec, raw: Record<string, unknown> | null): ValidationSuccess | ValidationFailure {
  const input = raw ?? {};
  const errors: string[] = [];
  const values: Record<string, unknown> = {};
  const dump: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (!(key in spec)) errors.push(`${key}: Extra inputs are not permitted`);
  }
  for (const [key, field] of Object.entries(spec)) {
    const present = key in input && input[key] !== undefined;
    let value: unknown;
    if (!present || input[key] === null) {
      if (!present && !('default' in field) && !field.optional) {
        errors.push(`${key}: Field required`);
        continue;
      }
      if (input[key] === null && !field.optional) {
        errors.push(`${key}: Input should be a valid value`);
        continue;
      }
      value = 'default' in field ? field.default : null;
      values[key] = value;
      dump[key] = value instanceof Date ? toISO(value) : (value ?? null);
      continue;
    }
    try {
      value = coerce(field, input[key]);
    } catch (exc) {
      errors.push(`${key}: ${(exc as Error).message}`);
      continue;
    }
    if (typeof value === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push(`${key}: String should have at least ${field.minLength} characters`);
        continue;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push(`${key}: String should have at most ${field.maxLength} characters`);
        continue;
      }
      if (field.pattern && !field.pattern.test(value)) {
        errors.push(`${key}: String should match pattern '${field.pattern.source}'`);
        continue;
      }
    }
    if (typeof value === 'number') {
      if (field.ge !== undefined && value < field.ge) {
        errors.push(`${key}: Input should be greater than or equal to ${field.ge}`);
        continue;
      }
      if (field.le !== undefined && value > field.le) {
        errors.push(`${key}: Input should be less than or equal to ${field.le}`);
        continue;
      }
      if (field.gt !== undefined && value <= field.gt) {
        errors.push(`${key}: Input should be greater than ${field.gt}`);
        continue;
      }
    }
    values[key] = value;
    dump[key] = value instanceof Date ? toISO(value) : value;
  }
  if (errors.length) return { ok: false, message: errors.join('; ') };
  return { ok: true, dump, values };
}

export type Handler = (ctx: ToolContext, args: Record<string, unknown>) => ToolResult;
export type Executor = (ctx: ToolContext, args: Record<string, unknown>) => ToolResult;

export interface Tool {
  name: string;
  title: string;
  description: string;
  risk: Risk;
  subject: 'self' | 'target' | 'none';
  action: string;
  params: ParamSpec;
  handler: Handler;
  executor?: Executor;
  roles: string[];
  hints: string[];
}
