import { describe, expect, it } from 'vitest';
import { parseSse, SseParser, toStreamEvent } from './sse';

describe('SseParser', () => {
  it('emits frames only when a blank line closes them', () => {
    const parser = new SseParser();
    expect(parser.push('event: text.delta\ndata: {"delta":"oi"}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'text.delta', data: '{"delta":"oi"}' }]);
  });

  it('reassembles frames split at arbitrary chunk boundaries', () => {
    const body =
      'event: message.start\ndata: {"conversation_id":"c1"}\n\n' +
      'event: text.delta\ndata: {"delta":"Você tem 12 dias"}\n\n' +
      'event: message.end\ndata: {"message_id":"m1","resolved":true}\n\n';
    const parser = new SseParser();
    const frames = [];
    for (let i = 0; i < body.length; i += 7) frames.push(...parser.push(body.slice(i, i + 7)));
    frames.push(...parser.end());
    expect(frames.map((f) => f.event)).toEqual(['message.start', 'text.delta', 'message.end']);
    expect(JSON.parse(frames[1].data)).toEqual({ delta: 'Você tem 12 dias' });
  });

  it('joins multi-line data fields with newlines', () => {
    const [frame] = new SseParser().push('event: card\ndata: {"a":1,\ndata: "b":2}\n\n');
    expect(frame.data).toBe('{"a":1,\n"b":2}');
    expect(JSON.parse(frame.data)).toEqual({ a: 1, b: 2 });
  });

  it('ignores comments and tolerates CRLF line endings', () => {
    const frames = new SseParser().push(': keep-alive\r\nevent: usage\r\ndata: {"model":"fake"}\n\n');
    expect(frames).toEqual([{ event: 'usage', data: '{"model":"fake"}' }]);
  });

  it('flushes a trailing frame that was never terminated', () => {
    const parser = new SseParser();
    parser.push('event: error\ndata: {"code":"x","message":"y"}');
    expect(parser.end()).toEqual([{ event: 'error', data: '{"code":"x","message":"y"}' }]);
  });

  it('turns malformed JSON into an error event instead of throwing', () => {
    expect(toStreamEvent({ event: 'card', data: '{nope' })).toEqual({
      event: 'error',
      data: { code: 'bad_frame', message: 'Evento inválido recebido do servidor.' },
    });
  });

  it('parses a whole body into typed events', () => {
    const events = parseSse(
      'event: trace.route\ndata: {"mode":"single","agents":["vacation"]}\n\nevent: usage\ndata: {"model":"fake","prompt_tokens":1,"completion_tokens":2,"cost_usd":0}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: 'trace.route', data: { mode: 'single' } });
  });
});
