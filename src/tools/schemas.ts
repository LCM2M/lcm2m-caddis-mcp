import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApiError } from '../client.js';

export const idParam = z
  .union([z.string(), z.number()])
  .describe('Numeric identifier (accepts either string or number form)');

export const isoDate = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 datetime with timezone offset, e.g. 2024-01-01T00:00:00Z');

export const orderEnum = z.enum(['ASC', 'DESC']);

// Cycles / statuslogs / telemetry: start required, rest optional
export const timeWindowRequiredStart = {
  start: isoDate.describe('ISO 8601 window start (required)'),
  end: isoDate.optional().describe('ISO 8601 window end (defaults to now)'),
  order: orderEnum.optional().describe("Sort order, 'ASC' or 'DESC' (default DESC)"),
  limit: z
    .number()
    .int()
    .positive()
    .max(50_000)
    .optional()
    .describe(
      'Max rows to return (backend default 5000). Keep modest to avoid token-blowing large CSV bodies.',
    ),
};

// Shifthistory / excessivedowntimes: both endpoints require a closed window
export const timeWindowRequired = {
  start: isoDate.describe('ISO 8601 window start (required)'),
  end: isoDate.describe('ISO 8601 window end (required)'),
};

export const readOnlyAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const encodePathSegment = (v: string | number): string => encodeURIComponent(String(v));

/**
 * Runs a tool handler, converting expected 4xx errors into MCP `isError` results
 * (preserving the server's body so the LLM can see what went wrong and retry).
 * 5xx and network errors rethrow so the SDK reports a hard failure.
 */
export async function runTool(fn: () => Promise<string>): Promise<CallToolResult> {
  try {
    const text = await fn();
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      const detail = err.body ? `\n\n${err.body}` : '';
      return {
        isError: true,
        content: [{ type: 'text', text: `${err.message}${detail}` }],
      };
    }
    throw err;
  }
}
