// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { LIVE_MAX_TOKENS, OPENROUTER_URL } from '@/lib/liveMode';
import { LiveError, liveComplete, toolSchema } from './live';

const config = { key: 'test-key-not-real', model: 'deepseek/deepseek-v4.1-flash' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('liveComplete', () => {
  it('sends the key only to OpenRouter, with a token cap', async () => {
    const fetchMock = vi.fn(async () => reply({ choices: [{ message: { content: 'Oi' } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00001 } }));
    const out = await liveComplete(config, [{ role: 'user', content: 'oi' }], { maxTokens: 99999 }, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    expect(new URL(url).host).toBe('openrouter.ai');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key-not-real');
    expect(JSON.parse(init.body as string).max_tokens).toBe(LIVE_MAX_TOKENS);
    expect(out).toMatchObject({ content: 'Oi', promptTokens: 10, completionTokens: 2, costUsd: 0.00001 });
  });

  it('parses tool calls and tolerates malformed arguments', async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        choices: [{ message: { content: null, tool_calls: [
          { id: 'a', function: { name: 'vacation_get_balance', arguments: '{}' } },
          { id: 'b', function: { name: 'payroll_get_payslip', arguments: '{not json' } },
        ] } }],
      }),
    );
    const out = await liveComplete(config, [{ role: 'user', content: 'saldo' }], {}, fetchMock);
    expect(out.toolCalls).toEqual([
      { id: 'a', name: 'vacation_get_balance', arguments: {} },
      { id: 'b', name: 'payroll_get_payslip', arguments: {} },
    ]);
  });

  it('reports a rejected key without echoing it', async () => {
    const fetchMock = vi.fn(async () => reply({ error: 'no' }, 401));
    const failure = await liveComplete(config, [], {}, fetchMock).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LiveError);
    expect((failure as LiveError).status).toBe(401);
    expect(String((failure as Error).message)).not.toContain(config.key);
  });
});

describe('toolSchema', () => {
  it('forbids extra fields, so the model cannot add a subject to a self-service tool', () => {
    const schema = toolSchema('payroll_get_payslip', 'Holerite', {
      month: { type: 'str', optional: true, description: 'AAAA-MM' },
    }) as { function: { parameters: { additionalProperties: boolean; properties: Record<string, unknown>; required: string[] } } };
    expect(schema.function.parameters.additionalProperties).toBe(false);
    expect(Object.keys(schema.function.parameters.properties)).toEqual(['month']);
    expect(schema.function.parameters.required).toEqual([]);
  });
});
