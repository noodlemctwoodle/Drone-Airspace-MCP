import type { FetchLike } from '../../src/core/http-client.js';

export interface Route {
  match: string | RegExp;
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
  /** Called instead of static body when present. */
  handler?: (url: string, init?: RequestInit) => { status?: number; body?: string | object; headers?: Record<string, string> };
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
}

export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!route) return new Response('not found', { status: 404 });
    const r = route.handler ? route.handler(url, init) : route;
    const status = r.status ?? 200;
    const nullBody = status === 204 || status === 205 || status === 304;
    const body = nullBody ? null : r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status, headers: r.headers ?? { 'content-type': typeof r.body === 'string' ? 'text/plain' : 'application/json' } });
  };
  return { fetch: fetchImpl, calls };
}
