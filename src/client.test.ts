import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  ApiError,
  applyJitter,
  buildQueryString,
  CaddisApiClient,
  CompanySelectionRequiredError,
  decodeJwtExp,
  type FetchLike,
  parseRetryWaitMs,
} from './client.js';
import type { Config } from './config.js';

// --------------------------------------------------------------------------
// Tier 1 — pure helpers
// --------------------------------------------------------------------------

describe('buildQueryString', () => {
  it('encodes scalar values', () => {
    assert.equal(buildQueryString({ foo: 'bar', n: 1, b: true }), 'foo=bar&n=1&b=true');
  });

  it('skips undefined and null', () => {
    assert.equal(buildQueryString({ a: 'x', b: undefined, c: null }), 'a=x');
  });

  it('skips empty arrays', () => {
    assert.equal(buildQueryString({ ids: [] }), '');
  });

  it('fans arrays out with [] suffix (backend contract)', () => {
    // URLSearchParams encodes `[` as `%5B` and `]` as `%5D`.
    assert.equal(buildQueryString({ ids: [1, 2, 3] }), 'ids%5B%5D=1&ids%5B%5D=2&ids%5B%5D=3');
  });

  it('handles mixed scalar and array keys', () => {
    assert.equal(
      buildQueryString({ active: true, ids: [1, 2] }),
      'active=true&ids%5B%5D=1&ids%5B%5D=2',
    );
  });

  it('URL-encodes reserved characters', () => {
    assert.equal(buildQueryString({ q: 'a b&c' }), 'q=a+b%26c');
  });
});

describe('parseRetryWaitMs', () => {
  const mkRes = (headers: Record<string, string>) => new Response(null, { status: 429, headers });

  it('parses an integer Retry-After', () => {
    assert.equal(parseRetryWaitMs(mkRes({ 'retry-after': '5' })), 5000);
  });

  it('parses a fractional Retry-After', () => {
    // 3.217 * 1000 = 3217, Math.ceil → 3217
    assert.equal(parseRetryWaitMs(mkRes({ 'retry-after': '3.217' })), 3217);
  });

  it('falls back to X-RateLimit-Reset when Retry-After is invalid', () => {
    const future = Math.floor(Date.now() / 1000) + 5;
    const ms = parseRetryWaitMs(
      mkRes({
        'retry-after': 'garbage',
        'x-ratelimit-reset-endpoint': String(future),
      }),
    );
    assert.ok(ms > 4000 && ms <= 5000, `expected ~5000, got ${ms}`);
  });

  it('picks the smaller of endpoint vs user reset', () => {
    const now = Math.floor(Date.now() / 1000);
    const ms = parseRetryWaitMs(
      mkRes({
        'x-ratelimit-reset-endpoint': String(now + 10),
        'x-ratelimit-reset-user': String(now + 3),
      }),
    );
    assert.ok(ms > 2000 && ms <= 3000, `expected ~3000, got ${ms}`);
  });

  it('ignores past reset headers', () => {
    const past = Math.floor(Date.now() / 1000) - 5;
    assert.equal(parseRetryWaitMs(mkRes({ 'x-ratelimit-reset-endpoint': String(past) })), 1000);
  });

  it('defaults to 1000ms when no headers present', () => {
    assert.equal(parseRetryWaitMs(mkRes({})), 1000);
  });
});

describe('applyJitter', () => {
  it('stays within ±20% of the base', () => {
    const base = 1000;
    for (let i = 0; i < 200; i++) {
      const result = applyJitter(base);
      assert.ok(result >= 800 && result <= 1200, `${result} out of [800, 1200]`);
    }
  });

  it('never returns a negative value', () => {
    assert.ok(applyJitter(0) >= 0);
    assert.ok(applyJitter(1) >= 0);
  });
});

describe('decodeJwtExp', () => {
  const encodeJwt = (payload: unknown): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = Buffer.from('sig').toString('base64url');
    return `${header}.${body}.${sig}`;
  };

  it('decodes exp from a valid JWT', () => {
    const jwt = encodeJwt({ exp: 1234567890 });
    assert.equal(decodeJwtExp(jwt), 1234567890 * 1000);
  });

  it('returns null when token has no dots', () => {
    assert.equal(decodeJwtExp('nodots'), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(decodeJwtExp(''), null);
  });

  it('returns null when exp is missing from the payload', () => {
    assert.equal(decodeJwtExp(encodeJwt({ user: 'kevin' })), null);
  });

  it('returns null when exp is not a number', () => {
    assert.equal(decodeJwtExp(encodeJwt({ exp: 'soon' })), null);
  });

  it('returns null when the payload is not valid base64 JSON', () => {
    assert.equal(decodeJwtExp('a.!!!.c'), null);
  });
});

// --------------------------------------------------------------------------
// Tier 2 — CaddisApiClient integration with mocked fetch
// --------------------------------------------------------------------------

const baseConfig: Config = {
  apiUrl: 'https://api.test',
  username: 'tester',
  password: 'secret',
  companyId: 1,
  maxRetries: 3,
  maxRetryWaitMs: 30_000,
  batchConcurrency: 5,
};

interface MockCall {
  url: string;
  init: RequestInit;
}

type Handler = (call: MockCall, index: number) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const calls: MockCall[] = [];
  const fn: FetchLike = async (input, init) => {
    const call: MockCall = { url: input.toString(), init: init ?? {} };
    const index = calls.length;
    calls.push(call);
    return handler(call, index);
  };
  return { fn, calls };
}

function makeJwt(expSecondsFromNow = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString('base64url');
  const sig = Buffer.from('sig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function jsonRes(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function textRes(
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/csv', ...extraHeaders },
  });
}

const headerOf = (call: MockCall, name: string): string | undefined => {
  const h = call.init.headers as Record<string, string> | undefined;
  return h?.[name];
};

function at<T>(arr: readonly T[], i: number): T {
  const item = arr[i];
  if (item === undefined) throw new Error(`test helper: no element at index ${i}`);
  return item;
}

describe('CaddisApiClient — lazy login', () => {
  it('logs in on first request and caches the token', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: jwt });
      return textRes(200, 'equipment csv');
    });
    const client = new CaddisApiClient(baseConfig, mock.fn);

    await client.vmcp('/equipment');
    await client.vmcp('/equipment');

    assert.equal(mock.calls.length, 3, 'expected 1 login + 2 requests');
    assert.ok(mock.calls[0]?.url.endsWith('/vmcp/sessions'));
    assert.equal(mock.calls[0]?.init.method, 'POST');
    assert.equal(headerOf(at(mock.calls, 1), 'Authorization'), jwt);
    assert.equal(headerOf(at(mock.calls, 2), 'Authorization'), jwt);
  });

  it('passes query params through buildQueryString', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => (i === 0 ? jsonRes(200, { token: jwt }) : textRes(200, 'ok')));
    const client = new CaddisApiClient(baseConfig, mock.fn);

    await client.vmcp('/alarms', { query: { equipIds: [1, 2], pm: true } });

    const url = mock.calls[1]?.url ?? '';
    assert.ok(url.includes('equipIds%5B%5D=1'), `missing ids[] in ${url}`);
    assert.ok(url.includes('equipIds%5B%5D=2'));
    assert.ok(url.includes('pm=true'));
  });
});

describe('CaddisApiClient — 401 one-shot re-login', () => {
  it('clears cache and re-logs in on 401, then retries once', async () => {
    const jwt1 = makeJwt();
    const jwt2 = makeJwt();
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: jwt1 });
      if (i === 1) return textRes(401, 'Unauthorized');
      if (i === 2) return jsonRes(200, { token: jwt2 });
      return textRes(200, 'equipment csv');
    });
    const client = new CaddisApiClient(baseConfig, mock.fn);

    const res = await client.vmcp('/equipment');

    assert.equal(res.body, 'equipment csv');
    assert.equal(mock.calls.length, 4);
    assert.equal(headerOf(at(mock.calls, 3), 'Authorization'), jwt2);
  });
});

describe('CaddisApiClient — 429 retry loop', () => {
  it('retries on 429 and succeeds', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: jwt });
      if (i === 1) return textRes(429, 'throttled', { 'retry-after': '0.001' });
      return textRes(200, 'success');
    });
    const client = new CaddisApiClient(baseConfig, mock.fn);

    const res = await client.vmcp('/equipment');
    assert.equal(res.body, 'success');
    assert.equal(mock.calls.length, 3);
  });

  it('fails after exhausting maxRetries', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: jwt });
      return textRes(429, 'throttled', { 'retry-after': '0.001' });
    });
    const client = new CaddisApiClient({ ...baseConfig, maxRetries: 2 }, mock.fn);

    await assert.rejects(
      client.vmcp('/equipment'),
      (err: unknown) => err instanceof ApiError && err.status === 429,
    );
    // login + initial + 2 retries = 4 calls
    assert.equal(mock.calls.length, 4);
  });

  it('bails early when the next wait would exceed maxRetryWaitMs', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: jwt });
      // 5s wait blown out by a 100ms budget
      return textRes(429, 'throttled', { 'retry-after': '5' });
    });
    const client = new CaddisApiClient(
      { ...baseConfig, maxRetries: 3, maxRetryWaitMs: 100 },
      mock.fn,
    );

    await assert.rejects(
      client.vmcp('/equipment'),
      (err: unknown) => err instanceof ApiError && err.status === 429,
    );
    // login + 1 attempt, no retries (budget blown immediately)
    assert.equal(mock.calls.length, 2);
  });
});

describe('CaddisApiClient — concurrent login dedup', () => {
  it('single-flights the login call across parallel requests', async () => {
    const jwt = makeJwt();
    let loginCount = 0;
    const fn: FetchLike = async (input) => {
      const url = input.toString();
      if (url.endsWith('/vmcp/sessions')) {
        loginCount++;
        await new Promise((r) => setTimeout(r, 10));
        return jsonRes(200, { token: jwt });
      }
      return textRes(200, 'ok');
    };
    const client = new CaddisApiClient(baseConfig, fn);

    await Promise.all([
      client.vmcp('/equipment'),
      client.vmcp('/equipment'),
      client.vmcp('/equipment'),
    ]);

    assert.equal(loginCount, 1, 'login should only fire once');
  });
});

describe('CaddisApiClient — JWT expiry', () => {
  it('proactively re-logs in when the cached token is inside the expiry skew', async () => {
    // EXPIRY_SKEW_MS = 30_000; a token expiring in 10s triggers re-login on the next call
    const soonJwt = makeJwt(10);
    const freshJwt = makeJwt(3600);
    const mock = mockFetch((_, i) => {
      if (i === 0) return jsonRes(200, { token: soonJwt });
      if (i === 1) return textRes(200, 'first');
      if (i === 2) return jsonRes(200, { token: freshJwt });
      return textRes(200, 'second');
    });
    const client = new CaddisApiClient(baseConfig, mock.fn);

    await client.vmcp('/equipment');
    await client.vmcp('/equipment');

    const loginCalls = mock.calls.filter((c) => c.url.endsWith('/vmcp/sessions'));
    assert.equal(loginCalls.length, 2);
    assert.equal(headerOf(at(mock.calls, 3), 'Authorization'), freshJwt);
  });
});

describe('CaddisApiClient — CompanySelectionRequiredError', () => {
  it('throws when login returns companies list without a token', async () => {
    const mock = mockFetch(() =>
      jsonRes(200, {
        companies: [
          { id: 1, name: 'Acme' },
          { id: 2, name: 'Beta' },
        ],
      }),
    );
    const client = new CaddisApiClient({ ...baseConfig, companyId: undefined }, mock.fn);

    await assert.rejects(client.vmcp('/equipment'), (err: unknown) => {
      if (!(err instanceof CompanySelectionRequiredError)) return false;
      assert.equal(err.companies.length, 2);
      return true;
    });
  });
});

describe('CaddisApiClient — body passthrough', () => {
  it('vmcp returns raw text unchanged', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) =>
      i === 0 ? jsonRes(200, { token: jwt }) : textRes(200, 'id,name\n1,foo'),
    );
    const client = new CaddisApiClient(baseConfig, mock.fn);

    const res = await client.vmcp('/equipment');
    assert.equal(res.body, 'id,name\n1,foo');
    assert.equal(res.contentType, 'text/csv');
  });

  it('v1Json parses the body as JSON', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) =>
      i === 0 ? jsonRes(200, { token: jwt }) : jsonRes(200, { hello: 'world', n: 42 }),
    );
    const client = new CaddisApiClient(baseConfig, mock.fn);

    const res = await client.v1Json<{ hello: string; n: number }>('/equipment');
    assert.deepEqual(res, { hello: 'world', n: 42 });
  });

  it('v1 requests use the v1 path prefix and JSON Accept header', async () => {
    const jwt = makeJwt();
    const mock = mockFetch((_, i) => (i === 0 ? jsonRes(200, { token: jwt }) : jsonRes(200, {})));
    const client = new CaddisApiClient(baseConfig, mock.fn);

    await client.v1('/equipment');

    const call = at(mock.calls, 1);
    assert.ok(call.url.includes('/v1/equipment'));
    assert.equal(headerOf(call, 'Accept'), 'application/json');
  });
});
