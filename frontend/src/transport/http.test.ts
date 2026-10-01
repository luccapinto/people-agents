import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpTransport } from './http';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('HttpTransport while signed out', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  // A screen that mounts just as the session is dropped must not send an unauthenticated
  // request: the browser would log the 401 as an error.
  it('answers authenticated calls locally, without touching the network', async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HttpTransport();
    await expect(http.conversations()).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
    await expect(http.me()).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
    await expect(http.studioAgents()).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still reaches the sign-in endpoints, and sends the token once signed in', async () => {
    const fetchMock = vi.fn(async (url: string) => ok(url.endsWith('/auth/login') ? { token: 't0k3n' } : []));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HttpTransport();
    await http.personas();
    await http.login('E1023');
    await http.conversations();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/personas', '/api/auth/login', '/api/conversations']);
    const [, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k3n');
  });
});
