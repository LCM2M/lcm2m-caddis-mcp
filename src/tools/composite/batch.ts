import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AuthMissingError, CompanySelectionRequiredError } from '../../client.js';
import type { Config } from '../../config.js';
import { createLimiter, registerTool, type ToolHandlerRegistry } from '../registry.js';
import { readOnlyAnnotations } from '../schemas.js';

const MAX_BATCH_SIZE = 20;

const batchRequestSchema = z.object({
  tool: z.string().describe('Name of a caddis_* tool to invoke'),
  args: z
    .record(z.unknown())
    .optional()
    .describe('Arguments for the tool; omit or pass {} for tools with no inputs'),
});

const batchInputSchema = {
  requests: z
    .array(batchRequestSchema)
    .min(1)
    .max(MAX_BATCH_SIZE)
    .describe(
      `Up to ${MAX_BATCH_SIZE} tool invocations to run in parallel. ` +
        'Each is dispatched to the same handler the tool would run individually, so existing ' +
        '429 retry, jitter, and login-dedup behavior applies per request.',
    ),
};

export function registerBatchTool(
  server: McpServer,
  registry: ToolHandlerRegistry,
  config: Config,
): void {
  const limiter = createLimiter(config.batchConcurrency);

  registerTool(
    server,
    registry,
    'caddis_batch',
    {
      title: 'Run multiple caddis_* tools in parallel',
      description: buildDescription(registry, config.batchConcurrency),
      inputSchema: batchInputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ requests }) => runBatch(requests, registry, limiter),
  );
}

type BatchRequest = z.infer<typeof batchRequestSchema>;
type LimiterFn = ReturnType<typeof createLimiter>;

async function runBatch(
  requests: BatchRequest[],
  registry: ToolHandlerRegistry,
  limiter: LimiterFn,
): Promise<CallToolResult> {
  const blocks = await Promise.all(
    requests.map((req, i) => limiter(() => dispatchOne(req, i, registry))),
  );
  return { content: blocks };
}

async function dispatchOne(
  req: BatchRequest,
  index: number,
  registry: ToolHandlerRegistry,
): Promise<{ type: 'text'; text: string }> {
  const entry = registry.get(req.tool);
  if (!entry) return block(index, req.tool, 'error', `unknown tool: ${req.tool}`);
  if (req.tool === 'caddis_batch') {
    return block(index, req.tool, 'error', 'caddis_batch cannot be nested inside itself');
  }

  const parsed = entry.inputSchema.safeParse(req.args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((p) => `${p.path.join('.') || '(root)'}: ${p.message}`)
      .join('; ');
    return block(index, req.tool, 'error', `validation: ${issues}`);
  }

  try {
    const result = await entry.handler(parsed.data);
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return block(index, req.tool, result.isError ? 'error' : 'ok', text);
  } catch (err) {
    // Auth / company-selection errors affect every entry identically — let them propagate
    // so the batch surfaces a single top-level error instead of N duplicated per-entry errors.
    if (err instanceof AuthMissingError || err instanceof CompanySelectionRequiredError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return block(index, req.tool, 'error', msg);
  }
}

function block(
  index: number,
  tool: string,
  state: 'ok' | 'error',
  body: string,
): { type: 'text'; text: string } {
  return { type: 'text', text: `#${index} ${tool} ${state}\n${body}` };
}

function buildDescription(registry: ToolHandlerRegistry, concurrency: number): string {
  const names = registry
    .names()
    .filter((n) => n !== 'caddis_batch')
    .sort();
  return (
    'Run multiple caddis_* tools in a single call, fanning out in parallel. Each request in ' +
    '`requests` is dispatched to the same handler the tool would run individually, so 429 ' +
    `retry/jitter and login-dedup behavior is preserved. Up to ${MAX_BATCH_SIZE} requests per ` +
    `call; concurrency is capped at ${concurrency} in-flight. Response contains one text block ` +
    'per request, in input order, each prefixed with `#<index> <tool> <ok|error>`. One failed ' +
    'request does not sink the batch.\n\n' +
    `Available tools: ${names.join(', ')}`
  );
}
