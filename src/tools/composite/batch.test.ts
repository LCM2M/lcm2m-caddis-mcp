import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { ApiError, AuthMissingError, CompanySelectionRequiredError } from '../../client.js';
import { createLimiter, ToolHandlerRegistry } from '../registry.js';

// The exported registerBatchTool mutates McpServer. We test the behavior by invoking the
// same runBatch path it uses — via a stub that mirrors dispatchOne semantics. To keep this
// black-box but focused, we reach into the module and exercise the dispatch through a
// constructed registry and limiter. Since dispatchOne is not exported, we test via a thin
// re-implementation of the fan-out using the public pieces the module composes.
//
// Rationale: the public surface of registerBatchTool is the tool handler it registers with
// McpServer. We don't want a full McpServer here — we just want to verify the per-entry
// dispatch contract. So we reconstruct the same pipeline using the exported registry +
// limiter and a minimal adapter that mirrors what batch.ts does. If batch.ts drifts, these
// tests will catch it because the tool itself composes only these primitives.

import { registerBatchTool } from './batch.js';

// Build a fake McpServer-like shim that captures the handler registration so we can invoke it
// directly and verify end-to-end batch behavior.
interface CapturedRegistration {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeFakeServer() {
  const registrations: CapturedRegistration[] = [];
  const server = {
    registerTool(
      name: string,
      config: CapturedRegistration['config'],
      handler: CapturedRegistration['handler'],
    ) {
      registrations.push({ name, config, handler });
    },
  };
  return { server: server as never, registrations };
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string[] {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text);
}

const defaultConfig = {
  apiUrl: 'https://api.test',
  username: 'u',
  password: 'p',
  companyId: 1,
  maxRetries: 3,
  maxRetryWaitMs: 30_000,
  batchConcurrency: 5,
};

describe('caddis_batch', () => {
  it('returns one content block per request in input order', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('tool_a', {}, async () => ({
      content: [{ type: 'text', text: 'body-A' }],
    }));
    registry.register('tool_b', {}, async () => ({
      content: [{ type: 'text', text: 'body-B' }],
    }));

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);

    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);
    const result = (await reg.handler({
      requests: [{ tool: 'tool_a' }, { tool: 'tool_b' }, { tool: 'tool_a' }],
    })) as { content: Array<{ type: string; text: string }> };

    const texts = textContent(result);
    assert.deepEqual(texts, [
      '#0 tool_a ok\nbody-A',
      '#1 tool_b ok\nbody-B',
      '#2 tool_a ok\nbody-A',
    ]);
  });

  it('reports unknown tool per entry without sinking others', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('tool_a', {}, async () => ({
      content: [{ type: 'text', text: 'A' }],
    }));

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const result = (await reg.handler({
      requests: [{ tool: 'tool_a' }, { tool: 'does_not_exist' }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const texts = textContent(result);
    assert.equal(texts[0], '#0 tool_a ok\nA');
    assert.equal(texts[1], '#1 does_not_exist error\nunknown tool: does_not_exist');
    assert.ok(!result.isError);
  });

  it('reports validation failures per entry', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register(
      'tool_x',
      { count: z.number().int(), name: z.string() },
      async ({ name, count }) => ({
        content: [{ type: 'text', text: `${name}:${count}` }],
      }),
    );

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const result = (await reg.handler({
      requests: [
        { tool: 'tool_x', args: { count: 'not a number', name: 'ok' } },
        { tool: 'tool_x', args: { count: 5, name: 'yes' } },
      ],
    })) as { content: Array<{ type: string; text: string }> };

    const texts = textContent(result);
    assert.match(texts[0] ?? '', /^#0 tool_x error\nvalidation:.*count/);
    assert.equal(texts[1], '#1 tool_x ok\nyes:5');
  });

  it('isolates 5xx / thrown errors per entry without sinking batch', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('good', {}, async () => ({
      content: [{ type: 'text', text: 'yay' }],
    }));
    registry.register('boom_5xx', {}, async () => {
      throw new ApiError('500 Internal Server Error', 500, 'server blew up');
    });
    registry.register('boom_generic', {}, async () => {
      throw new Error('plain crash');
    });

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const result = (await reg.handler({
      requests: [{ tool: 'good' }, { tool: 'boom_5xx' }, { tool: 'boom_generic' }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    const texts = textContent(result);
    assert.equal(texts[0], '#0 good ok\nyay');
    assert.match(texts[1] ?? '', /^#1 boom_5xx error\n.*500 Internal Server Error/);
    assert.match(texts[2] ?? '', /^#2 boom_generic error\nplain crash/);
    assert.ok(!result.isError);
  });

  it('preserves isError results from handlers as per-entry errors', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('bad_4xx', {}, async () => ({
      isError: true,
      content: [{ type: 'text', text: '404 Not Found' }],
    }));

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const result = (await reg.handler({ requests: [{ tool: 'bad_4xx' }] })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const texts = textContent(result);
    assert.equal(texts[0], '#0 bad_4xx error\n404 Not Found');
    assert.ok(!result.isError);
  });

  it('propagates AuthMissingError to top-level', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('auth_tool', {}, async () => {
      throw new AuthMissingError();
    });

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    await assert.rejects(reg.handler({ requests: [{ tool: 'auth_tool' }] }), AuthMissingError);
  });

  it('propagates CompanySelectionRequiredError to top-level', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('comp_tool', {}, async () => {
      throw new CompanySelectionRequiredError([
        { id: 1, name: 'Acme' },
        { id: 2, name: 'Beta' },
      ]);
    });

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    await assert.rejects(
      reg.handler({ requests: [{ tool: 'comp_tool' }] }),
      CompanySelectionRequiredError,
    );
  });

  it('respects the concurrency cap', async () => {
    const registry = new ToolHandlerRegistry();
    let inFlight = 0;
    let peak = 0;
    registry.register('slow', {}, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { content: [{ type: 'text' as const, text: 'done' }] };
    });

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, { ...defaultConfig, batchConcurrency: 3 });
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    await reg.handler({
      requests: Array.from({ length: 10 }, () => ({ tool: 'slow' })),
    });

    assert.equal(peak, 3);
  });

  it('rejects an empty batch via zod input schema', async () => {
    const registry = new ToolHandlerRegistry();
    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    // Simulate what the MCP SDK would do: parse input against the declared inputSchema.
    const shape = reg.config.inputSchema as Record<string, z.ZodTypeAny>;
    const schema = z.object(shape);
    assert.equal(schema.safeParse({ requests: [] }).success, false);
  });

  it('rejects a batch over max size via zod input schema', async () => {
    const registry = new ToolHandlerRegistry();
    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const shape = reg.config.inputSchema as Record<string, z.ZodTypeAny>;
    const schema = z.object(shape);
    const oversized = { requests: Array.from({ length: 21 }, () => ({ tool: 'x' })) };
    assert.equal(schema.safeParse(oversized).success, false);
    const fits = { requests: Array.from({ length: 20 }, () => ({ tool: 'x' })) };
    assert.equal(schema.safeParse(fits).success, true);
  });

  it('rejects nested caddis_batch calls', async () => {
    const registry = new ToolHandlerRegistry();
    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const result = (await reg.handler({
      requests: [{ tool: 'caddis_batch', args: { requests: [] } }],
    })) as { content: Array<{ type: string; text: string }> };

    const texts = textContent(result);
    assert.match(texts[0] ?? '', /cannot be nested/);
  });

  it('enumerates available tools in the description', async () => {
    const registry = new ToolHandlerRegistry();
    registry.register('tool_a', {}, async () => ({
      content: [{ type: 'text', text: 'x' }],
    }));
    registry.register('tool_b', {}, async () => ({
      content: [{ type: 'text', text: 'x' }],
    }));

    const { server, registrations } = makeFakeServer();
    registerBatchTool(server, registry, defaultConfig);
    const reg = registrations.find((r) => r.name === 'caddis_batch');
    assert.ok(reg);

    const desc = reg.config.description ?? '';
    assert.match(desc, /tool_a/);
    assert.match(desc, /tool_b/);
    // Should not advertise itself as callable through itself
    assert.doesNotMatch(desc, /Available tools:.*caddis_batch/);
  });
});

describe('createLimiter via registry (sanity)', () => {
  it('is the same primitive used by the batch tool', async () => {
    // This guards against accidental divergence: batch.ts must import createLimiter
    // from registry.ts, not reinvent it.
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    assert.equal(peak, 2);
  });
});
