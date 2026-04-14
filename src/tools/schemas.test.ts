import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from '../client.js';
import { runTool } from './schemas.js';

describe('runTool', () => {
  it('wraps successful text as content', async () => {
    const result = await runTool(async () => 'hello world');
    assert.deepEqual(result, { content: [{ type: 'text', text: 'hello world' }] });
    assert.ok(!result.isError);
  });

  it('wraps 4xx ApiError as isError with body', async () => {
    const result = await runTool(async () => {
      throw new ApiError('400 Bad Request', 400, '{"error":"nope"}');
    });
    assert.equal(result.isError, true);
    const first = result.content[0];
    assert.ok(first && first.type === 'text');
    assert.ok(first.text.includes('400 Bad Request'));
    assert.ok(first.text.includes('{"error":"nope"}'));
  });

  it('wraps 4xx ApiError without body', async () => {
    const result = await runTool(async () => {
      throw new ApiError('404 Not Found', 404, '');
    });
    assert.equal(result.isError, true);
    const first = result.content[0];
    assert.ok(first && first.type === 'text');
    assert.equal(first.text, '404 Not Found');
  });

  it('wraps 429 as isError (retries exhausted)', async () => {
    const result = await runTool(async () => {
      throw new ApiError('429 Too Many Requests', 429, 'throttled');
    });
    assert.equal(result.isError, true);
  });

  it('rethrows 5xx ApiError', async () => {
    await assert.rejects(
      runTool(async () => {
        throw new ApiError('500 Internal Server Error', 500, 'boom');
      }),
      (err: unknown) => err instanceof ApiError && err.status === 500,
    );
  });

  it('rethrows non-ApiError exceptions', async () => {
    await assert.rejects(
      runTool(async () => {
        throw new TypeError('unexpected');
      }),
      TypeError,
    );
  });
});
