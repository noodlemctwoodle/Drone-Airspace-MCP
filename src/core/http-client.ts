import { UpstreamError } from './errors.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: FetchLike;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResponse {
  status: number;
  body: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
  contentType?: string;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  etag?: string;
  lastModified?: string;
  timeoutMs?: number;
  provider?: string;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * fetch wrapper with timeout, bounded retries on 429/5xx/network failures,
 * conditional-request headers and a fixed User-Agent. Throws UpstreamError
 * for anything the caller cannot reasonably act on.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retries = opts.retries ?? 2;
    this.logger = opts.logger ?? silentLogger;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getText(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const provider = options.provider ?? new URL(url).host;
    const headers: Record<string, string> = {
      'User-Agent': this.opts.userAgent,
      Accept: 'application/json, text/xml, application/xml, text/html;q=0.9, */*;q=0.8',
      ...options.headers,
    };
    if (options.etag) headers['If-None-Match'] = options.etag;
    if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.retries) {
      attempt += 1;
      try {
        const res = await this.fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
          redirect: 'follow',
        });
        if (res.status === 304) {
          return { status: 304, body: '', notModified: true };
        }
        if (RETRYABLE.has(res.status) && attempt <= this.retries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(3, attempt - 1);
          this.logger.debug(`${provider} responded ${res.status}; retrying in ${backoff} ms`);
          await this.sleep(backoff);
          continue;
        }
        const body = await res.text();
        if (!res.ok) {
          throw new UpstreamError(provider, `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`, res.status);
        }
        return {
          status: res.status,
          body,
          etag: res.headers.get('etag') ?? undefined,
          lastModified: res.headers.get('last-modified') ?? undefined,
          contentType: res.headers.get('content-type') ?? undefined,
          notModified: false,
        };
      } catch (error) {
        if (error instanceof UpstreamError) throw error;
        lastError = error;
        if (attempt <= this.retries) {
          const backoff = 500 * Math.pow(3, attempt - 1);
          this.logger.debug(`${provider} request failed (${(error as Error)?.message}); retrying in ${backoff} ms`);
          await this.sleep(backoff);
          continue;
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new UpstreamError(provider, message.includes('abort') || message.includes('timeout') ? 'request timed out' : message);
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<{ data: T; response: HttpResponse }> {
    const response = await this.getText(url, options);
    if (response.notModified) {
      return { data: undefined as unknown as T, response };
    }
    try {
      return { data: JSON.parse(response.body) as T, response };
    } catch {
      throw new UpstreamError(options.provider ?? new URL(url).host, 'response was not valid JSON');
    }
  }
}
