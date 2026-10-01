/** Live mode: an OpenAI-compatible chat completion against OpenRouter with the visitor's key.
 *
 *  The model only proposes: it picks agents and tool calls, and writes text. Every tool call
 *  still goes through the engine's registry (schema validation with no extra fields, the policy
 *  engine, proposals that the person confirms), and every answer through the output guardrails.
 *  Self-service tools have no subject parameter at all, so the model cannot name someone else. */
import { LIVE_MAX_TOKENS, OPENROUTER_URL, type LiveConfig } from '@/lib/liveMode';
import type { Field, ParamSpec } from './tool';

export interface LiveToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LiveMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface LiveCompletion {
  content: string;
  toolCalls: LiveToolCall[];
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
}

export class LiveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const JSON_TYPES: Record<Field['type'], string> = {
  str: 'string',
  int: 'integer',
  float: 'number',
  bool: 'boolean',
  date: 'string',
};

/** OpenAI function schema of a tool, from the same field spec the engine validates against. */
export function toolSchema(name: string, description: string, params: ParamSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(params)) {
    properties[key] = {
      type: JSON_TYPES[field.type],
      ...(field.type === 'date' ? { format: 'date' } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.ge !== undefined ? { minimum: field.ge } : {}),
      ...(field.le !== undefined ? { maximum: field.le } : {}),
      ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    };
    if (!field.optional && field.default === undefined) required.push(key);
  }
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', additionalProperties: false, properties, required },
    },
  };
}

export async function liveComplete(
  config: LiveConfig,
  messages: LiveMessage[],
  options: { tools?: Record<string, unknown>[]; toolChoice?: unknown; maxTokens?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<LiveCompletion> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: Math.min(options.maxTokens ?? LIVE_MAX_TOKENS, LIVE_MAX_TOKENS),
    temperature: 0.2,
    usage: { include: true },
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? 'auto';
  }
  const response = await fetchImpl(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'X-Title': 'Atrium demo' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LiveError(response.status, response.status === 401 ? 'chave recusada pela OpenRouter' : `HTTP ${response.status} ${detail.slice(0, 120)}`);
  }
  const data = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function: { name: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const message = data.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((call, i) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: call.id ?? `call_${i}`, name: call.function.name, arguments: args };
  });
  return {
    content: message.content ?? '',
    toolCalls,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    costUsd: data.usage?.cost ?? 0,
    model: data.model ?? config.model,
  };
}
