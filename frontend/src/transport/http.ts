import { SseParser, toStreamEvent } from './sse';
import {
  type ChatRequest,
  type ConversationSummary,
  type Me,
  type Persona,
  type ProposalResult,
  type StoredMessage,
  type StreamEvent,
  type Transport,
  TransportError,
  type UploadResult,
} from './types';

const TOKEN_KEY = 'atrium.token';

function readError(status: number, body: unknown): TransportError {
  // FastAPI wraps raised detail in {detail: ...}; the proposal routes use {code, message}.
  const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : body;
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = String(detail.code);
    const message = 'message' in detail ? String(detail.message) : code;
    return new TransportError(status, code, message);
  }
  const message = typeof detail === 'string' ? detail : `HTTP ${status}`;
  return new TransportError(status, `http_${status}`, message);
}

export class HttpTransport implements Transport {
  readonly mode = 'http' as const;

  private readonly base: string;

  constructor(base = '/api') {
    this.base = base;
  }

  get token(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const token = this.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string> | undefined),
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => null);
      }
      throw readError(response.status, body);
    }
    return response;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return (await response.json()) as T;
  }

  private postJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.json<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  personas(): Promise<Persona[]> {
    return this.json<Persona[]>('/auth/personas');
  }

  async login(employeeId: string): Promise<void> {
    const out = await this.postJson<{ token: string }>('/auth/login', { employee_id: employeeId });
    sessionStorage.setItem(TOKEN_KEY, out.token);
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  me(): Promise<Me> {
    return this.json<Me>('/me');
  }

  async *chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.base}/chat`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify(req),
      signal,
    });
    if (!response.ok || !response.body) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      throw readError(response.status, body);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          yield toStreamEvent(frame);
        }
      }
      for (const frame of parser.end()) yield toStreamEvent(frame);
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  confirmProposal(id: string, token: string): Promise<ProposalResult> {
    return this.postJson<ProposalResult>(`/proposals/${id}/confirm`, { token });
  }

  async cancelProposal(id: string): Promise<void> {
    await this.postJson(`/proposals/${id}/cancel`);
  }

  stepUpChallenge(): Promise<{ delivery: string; code?: string; message: string }> {
    return this.postJson<{ delivery: string; code?: string; message: string }>(
      '/auth/step-up/challenge',
    );
  }

  async stepUp(code: string): Promise<void> {
    await this.postJson('/auth/step-up', { code });
  }

  conversations(): Promise<ConversationSummary[]> {
    return this.json<ConversationSummary[]>('/conversations');
  }

  messages(conversationId: string): Promise<StoredMessage[]> {
    return this.json<StoredMessage[]>(`/conversations/${conversationId}/messages`);
  }

  async upload(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    return this.json<UploadResult>('/uploads', { method: 'POST', body: form });
  }

  async download(path: string, filename: string): Promise<void> {
    const url = path.startsWith('/api') ? path : `${this.base}${path}`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) throw readError(response.status, null);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  async feedback(messageId: string, rating: 1 | -1, agentId?: string): Promise<void> {
    await this.postJson(`/messages/${messageId}/feedback`, { rating, agent_id: agentId ?? null });
  }
}
