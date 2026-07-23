import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson } from './fetchJson';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(impl: () => Promise<Response> | never) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe('fetchJson', () => {
  it('returns the parsed body on success', async () => {
    stub(async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    expect(await fetchJson<{ hello: string }>('/x')).toEqual({ ok: true, data: { hello: 'world' } });
  });

  it('reports failure on a non-ok status instead of returning a body', async () => {
    // /duels and /fame previously ignored status entirely and rendered the
    // empty state, so a 500 looked exactly like "no data yet".
    stub(async () => new Response('nope', { status: 500 }));
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });

  it('reports failure when the request rejects', async () => {
    stub(async () => { throw new Error('offline'); });
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });

  it('reports failure when the body is not valid JSON', async () => {
    stub(async () => new Response('<html>error page</html>', { status: 200 }));
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });
});
