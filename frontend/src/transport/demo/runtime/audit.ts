/** Append-only, hash-chained audit log.
 *
 *  Same canonical string as `app.append_audit`:
 *  `sha256(prev_hash|id|ts|type|actor|subject|conversation|request|payload::text)`.
 *  Hashing is asynchronous (WebCrypto), so `append` enqueues and returns the id immediately
 *  while a serial promise chain keeps the links in order; `flush()` awaits it. */
import { maskStructure } from '../guardrails/pii';

export const GENESIS = '0'.repeat(64);

export interface AuditEventRow {
  id: number;
  ts: string;
  type: string;
  actor_id: string | null;
  subject_id: string | null;
  conversation_id: string | null;
  request_id: string | null;
  payload: Record<string, unknown>;
  payload_text: string;
  prev_hash: string;
  hash: string;
}

export interface AppendOptions {
  actor?: string | null;
  subject?: string | null;
  conversation?: string | null;
  request?: string | null;
  payload?: Record<string, unknown>;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function microTimestamp(): string {
  return `${new Date().toISOString().slice(0, -1)}000Z`;
}

export class AuditLog {
  readonly events: AuditEventRow[] = [];
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();

  append(type: string, o: AppendOptions = {}): number {
    const id = this.nextId;
    this.nextId += 1;
    const row: AuditEventRow = {
      id,
      ts: microTimestamp(),
      type,
      actor_id: o.actor ?? null,
      subject_id: o.subject ?? null,
      conversation_id: o.conversation ?? null,
      request_id: o.request ?? null,
      payload: maskStructure(o.payload ?? {}),
      payload_text: '',
      prev_hash: GENESIS,
      hash: '',
    };
    row.payload_text = JSON.stringify(row.payload);
    this.events.push(row);
    this.tail = this.tail.then(async () => {
      const previous = this.events[this.events.indexOf(row) - 1];
      row.prev_hash = previous ? previous.hash : GENESIS;
      row.hash = await sha256Hex(this.canonical(row));
    });
    return id;
  }

  private canonical(row: AuditEventRow): string {
    return [
      row.prev_hash,
      String(row.id),
      row.ts,
      row.type,
      row.actor_id ?? '',
      row.subject_id ?? '',
      row.conversation_id ?? '',
      row.request_id ?? '',
      row.payload_text,
    ].join('|');
  }

  async flush(): Promise<void> {
    await this.tail;
  }

  async verify(): Promise<{ ok: boolean; checked: number; broken_at: number | null; reason: string }> {
    await this.flush();
    let prev = GENESIS;
    for (let i = 0; i < this.events.length; i += 1) {
      const row = this.events[i];
      if (row.prev_hash !== prev) {
        return { ok: false, checked: i, broken_at: row.id, reason: 'prev_hash does not match the previous event' };
      }
      const digest = await sha256Hex(this.canonical({ ...row, prev_hash: prev }));
      if (digest !== row.hash) {
        return { ok: false, checked: i, broken_at: row.id, reason: 'event content does not match its hash' };
      }
      prev = row.hash;
    }
    return { ok: true, checked: this.events.length, broken_at: null, reason: 'chain intact' };
  }

  restore(rows: AuditEventRow[]): void {
    this.events.length = 0;
    this.events.push(...rows);
    this.nextId = rows.length ? rows[rows.length - 1].id + 1 : 1;
    this.tail = Promise.resolve();
  }

  reset(): void {
    this.events.length = 0;
    this.nextId = 1;
    this.tail = Promise.resolve();
  }
}
