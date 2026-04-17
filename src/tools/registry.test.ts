import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { createLimiter, ToolHandlerRegistry } from './registry.js';

describe('ToolHandlerRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolHandlerRegistry();
    const handler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
    registry.register('my_tool', { foo: z.string() }, handler);

    const entry = registry.get('my_tool');
    assert.ok(entry);
    assert.equal(entry.handler, handler);
  });

  it('compiles the zod object schema at registration', () => {
    const registry = new ToolHandlerRegistry();
    registry.register('my_tool', { foo: z.string(), count: z.number().int() }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    const entry = registry.get('my_tool');
    assert.ok(entry);
    const bad = entry.inputSchema.safeParse({ foo: 123 });
    assert.equal(bad.success, false);
    const good = entry.inputSchema.safeParse({ foo: 'x', count: 7 });
    assert.equal(good.success, true);
  });

  it('handles an empty input schema', () => {
    const registry = new ToolHandlerRegistry();
    registry.register('no_args', {}, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    const entry = registry.get('no_args');
    assert.ok(entry);
    assert.equal(entry.inputSchema.safeParse({}).success, true);
  });

  it('returns undefined for unknown tools', () => {
    const registry = new ToolHandlerRegistry();
    assert.equal(registry.get('missing'), undefined);
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolHandlerRegistry();
    const h = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
    registry.register('dup', {}, h);
    assert.throws(() => registry.register('dup', {}, h), /already registered/);
  });

  it('lists registered names', () => {
    const registry = new ToolHandlerRegistry();
    const h = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
    registry.register('a', {}, h);
    registry.register('b', {}, h);
    assert.deepEqual(registry.names().sort(), ['a', 'b']);
  });
});

describe('createLimiter', () => {
  it('runs tasks sequentially when max is 1', async () => {
    const run = createLimiter(1);
    const order: string[] = [];
    const makeTask = (label: string, delay: number) => async () => {
      order.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, delay));
      order.push(`${label}:end`);
      return label;
    };

    const results = await Promise.all([
      run(makeTask('a', 20)),
      run(makeTask('b', 5)),
      run(makeTask('c', 5)),
    ]);

    assert.deepEqual(results, ['a', 'b', 'c']);
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('caps concurrency at max', async () => {
    const max = 3;
    const run = createLimiter(max);
    let inFlight = 0;
    let peak = 0;

    const task = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };

    await Promise.all(Array.from({ length: 10 }, () => run(task)));
    assert.equal(peak, max);
  });

  it('releases slot when task throws', async () => {
    const run = createLimiter(1);
    await assert.rejects(
      run(async () => {
        throw new Error('boom');
      }),
    );
    const result = await run(async () => 'recovered');
    assert.equal(result, 'recovered');
  });

  it('rejects max < 1', () => {
    assert.throws(() => createLimiter(0), /max must be >= 1/);
  });
});
