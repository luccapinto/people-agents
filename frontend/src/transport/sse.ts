import type { StreamEvent } from './types';

interface RawFrame {
  event: string;
  data: string;
}

/**
 * Incremental `text/event-stream` parser. Feed arbitrary chunks (they may split in the
 * middle of a line, a frame, or a UTF-8 sequence) and get back complete frames.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): RawFrame[] {
    this.buffer += chunk;
    const frames: RawFrame[] = [];
    let index = this.buffer.indexOf('\n\n');
    while (index !== -1) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
      index = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  end(): RawFrame[] {
    const rest = this.buffer;
    this.buffer = '';
    const frame = parseBlock(rest);
    return frame ? [frame] : [];
  }
}

function parseBlock(block: string): RawFrame | null {
  const normalized = block.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let event = 'message';
  const dataLines: string[] = [];
  let sawData = false;
  for (const line of normalized.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') {
      dataLines.push(value);
      sawData = true;
    }
  }
  if (!sawData) return null;
  return { event, data: dataLines.join('\n') };
}

/** Decode a raw frame into a typed stream event; malformed JSON becomes an error event. */
export function toStreamEvent(frame: RawFrame): StreamEvent {
  try {
    const data: unknown = frame.data ? JSON.parse(frame.data) : {};
    return { event: frame.event, data } as StreamEvent;
  } catch {
    return {
      event: 'error',
      data: { code: 'bad_frame', message: 'Evento inválido recebido do servidor.' },
    };
  }
}

/** Parse a whole SSE body at once (used by tests and non-streaming fallbacks). */
export function parseSse(body: string): StreamEvent[] {
  const parser = new SseParser();
  return [...parser.push(body), ...parser.end()].map(toStreamEvent);
}
