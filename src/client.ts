import type { Config } from './config.js';

const EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TTL_MS = 6 * 24 * 60 * 60 * 1000;

type Prefix = 'vm2m' | 'v1';
type QueryValue = string | number | boolean | Array<string | number | boolean> | undefined | null;

export interface RequestOpts {
  query?: Record<string, QueryValue>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export interface CaddisResponse {
  body: string;
  contentType: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthMissingError extends Error {
  constructor() {
    super(
      'Missing credentials. Set CADDIS_USERNAME and CADDIS_PASSWORD when launching the MCP server.',
    );
    this.name = 'AuthMissingError';
  }
}

export class CompanySelectionRequiredError extends Error {
  constructor(readonly companies: Array<{ id: number; name: string }>) {
    const list = companies.map((c) => `${c.id}: ${c.name}`).join(', ');
    super(`This user belongs to multiple companies. Set CADDIS_COMPANY_ID to one of: ${list}`);
    this.name = 'CompanySelectionRequiredError';
  }
}

const ACCEPT_HEADERS: Record<Prefix, string> = {
  vm2m: 'text/csv, text/yaml;q=0.9, */*;q=0.1',
  v1: 'application/json',
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CaddisApiClient {
  private cached: CachedToken | null = null;
  private loginInFlight: Promise<CachedToken> | null = null;

  // fetchFn is injected for testability; defaults to the global fetch in prod.
  constructor(
    private readonly config: Config,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  vm2m(path: string, opts: RequestOpts = {}): Promise<CaddisResponse> {
    return this.request('vm2m', path, opts);
  }

  v1(path: string, opts: RequestOpts = {}): Promise<CaddisResponse> {
    return this.request('v1', path, opts);
  }

  async v1Json<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const { body } = await this.v1(path, opts);
    return JSON.parse(body) as T;
  }

  private async request(prefix: Prefix, path: string, opts: RequestOpts): Promise<CaddisResponse> {
    const { maxRetries, maxRetryWaitMs } = this.config;
    let totalWaitMs = 0;

    for (let attempt = 0; ; attempt++) {
      const res = await this.sendWithRefresh(prefix, path, opts);

      if (res.status === 429 && attempt < maxRetries) {
        const rawWaitMs = parseRetryWaitMs(res);
        const waitMs = applyJitter(rawWaitMs);
        if (totalWaitMs + waitMs > maxRetryWaitMs) {
          console.error(
            `[caddis-mcp] 429 throttled on ${prefix}${path} but retry budget exhausted ` +
              `(would exceed ${maxRetryWaitMs}ms); surfacing error`,
          );
        } else {
          console.error(
            `[caddis-mcp] 429 throttled on ${prefix}${path}; waiting ${Math.round(waitMs)}ms ` +
              `before retry ${attempt + 1}/${maxRetries}`,
          );
          await discardBody(res);
          await sleep(waitMs);
          totalWaitMs += waitMs;
          continue;
        }
      }

      logLowRemaining(res, prefix, path);
      const body = await res.text();
      if (!res.ok) {
        throw new ApiError(`${res.status} ${res.statusText}`, res.status, body);
      }
      return { body, contentType: res.headers.get('content-type') ?? 'text/plain' };
    }
  }

  private async sendWithRefresh(
    prefix: Prefix,
    path: string,
    opts: RequestOpts,
  ): Promise<Response> {
    let { token } = await this.getToken();
    let res = await this.sendWithAuth(prefix, path, token, opts);
    if (res.status === 401) {
      this.cached = null;
      ({ token } = await this.getToken());
      res = await this.sendWithAuth(prefix, path, token, opts);
    }
    return res;
  }

  private sendWithAuth(prefix: Prefix, path: string, token: string, opts: RequestOpts) {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const qs = opts.query ? buildQueryString(opts.query) : '';
    const url = `${this.config.apiUrl}/${prefix}${suffix}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      Authorization: token,
      Accept: ACCEPT_HEADERS[prefix],
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    return this.fetchFn(url, {
      method: opts.method ?? 'GET',
      headers,
      body,
    });
  }

  private async getToken(): Promise<CachedToken> {
    if (this.cached && this.cached.expiresAt > Date.now() + EXPIRY_SKEW_MS) {
      return this.cached;
    }
    if (!this.loginInFlight) {
      this.loginInFlight = this.login().finally(() => {
        this.loginInFlight = null;
      });
    }
    return this.loginInFlight;
  }

  private async login(): Promise<CachedToken> {
    const { username, password, companyId } = this.config;
    if (!username || !password) throw new AuthMissingError();

    const res = await this.fetchFn(`${this.config.apiUrl}/vm2m/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        ...(companyId !== undefined ? { company_id: companyId } : {}),
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new ApiError(`Login failed: ${res.status} ${res.statusText}`, res.status, raw);
    }

    let parsed: LoginResponse;
    try {
      parsed = JSON.parse(raw) as LoginResponse;
    } catch {
      throw new ApiError('Login response was not JSON', res.status, raw);
    }

    if (!parsed.token) {
      if (parsed.companies && parsed.companies.length > 0) {
        throw new CompanySelectionRequiredError(parsed.companies);
      }
      throw new ApiError('Login response missing token', res.status, raw);
    }

    const expiresAt = decodeJwtExp(parsed.token) ?? Date.now() + DEFAULT_TTL_MS;
    this.cached = { token: parsed.token, expiresAt };
    return this.cached;
  }
}

interface LoginResponse {
  token?: string;
  companies?: Array<{ id: number; name: string }>;
  default_company_id?: number;
}

// Backend uses event.multiValueQueryStringParameters and only strips the `[]` suffix
// when rebuilding array params. Always append `[]` to array-valued keys so the Lambda
// handler sees them as arrays instead of collapsing to the last scalar value.
export function buildQueryString(query: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const arrayKey = `${key}[]`;
      for (const item of value) sp.append(arrayKey, String(item));
    } else {
      sp.append(key, String(value));
    }
  }
  return sp.toString();
}

const DEFAULT_RETRY_WAIT_MS = 1000;
const LOW_REMAINING_THRESHOLD = 3;
const RATE_LIMIT_BUCKETS = ['endpoint', 'user'] as const;

export function parseRetryWaitMs(res: Response): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const parsed = Number.parseFloat(retryAfter);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed * 1000);
  }
  const now = Date.now();
  const resetMs: number[] = [];
  for (const bucket of RATE_LIMIT_BUCKETS) {
    const raw = res.headers.get(`x-ratelimit-reset-${bucket}`);
    if (!raw) continue;
    const resetEpoch = Number(raw);
    if (!Number.isFinite(resetEpoch)) continue;
    const ms = resetEpoch * 1000 - now;
    if (ms > 0) resetMs.push(ms);
  }
  if (resetMs.length > 0) return Math.min(...resetMs);
  return DEFAULT_RETRY_WAIT_MS;
}

// ±20% jitter so concurrent throttled requests don't stampede on retry.
export function applyJitter(ms: number): number {
  const delta = ms * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, ms + delta);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore — underlying reader may already be released
  }
}

function logLowRemaining(res: Response, prefix: Prefix, path: string): void {
  for (const bucket of RATE_LIMIT_BUCKETS) {
    const remainingRaw = res.headers.get(`x-ratelimit-remaining-${bucket}`);
    const limitRaw = res.headers.get(`x-ratelimit-limit-${bucket}`);
    if (!remainingRaw || !limitRaw) continue;
    const remaining = Number(remainingRaw);
    const limit = Number(limitRaw);
    if (!Number.isFinite(remaining) || !Number.isFinite(limit)) continue;
    if (remaining <= LOW_REMAINING_THRESHOLD) {
      console.error(
        `[caddis-mcp] rate limit low: ${bucket} bucket at ${remaining}/${limit} ` +
          `after ${prefix}${path}`,
      );
    }
  }
}

export function decodeJwtExp(token: string): number | null {
  const [, payloadB64] = token.split('.');
  if (!payloadB64) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
