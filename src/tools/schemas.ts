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
      'Max rows to return (backend default 5000). Keep modest to avoid token-blowing large response bodies.',
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

export const TOON_PRIMER =
  'Responses are TOON-encoded (toonformat.dev) — a token-efficient JSON dialect ' +
  'mixing YAML-style indentation with CSV-style tables. Example:\n' +
  '\n' +
  '  name: Caddis Co\n' +
  '  timezone: America/Denver\n' +
  '  equipment[3]{id,name,tags,current_status.status,current_status.reason_id}:\n' +
  '    1,Mill A,"[\\"cnc\\",\\"critical\\"]",running,null\n' +
  '    2,"Press, Big",null,down,3\n' +
  '    3,Lathe C,null,null,null\n' +
  '\n' +
  '- Object fields: `key: value`; nested objects indent their children.\n' +
  '- Uniform arrays of objects: `field[N]{cols}:` followed by N indented ' +
  'comma-separated rows in column order.\n' +
  '- Nested objects inside table rows are recursively flattened to dotted ' +
  'columns (e.g. `current_status.status`, `input_setup.cycle.logic`); a null ' +
  'parent yields `null` across all its dotted columns (see row 3 above).\n' +
  '- Primitive arrays at object level: `field[N]: a,b,c` inline.\n' +
  '- Arrays inside table cells are JSON-stringified into a single cell value ' +
  '(`JSON.parse()` to recover); empty arrays render as `null` (see rows 1–3 ' +
  '`tags` column).\n' +
  '- Strings with commas/colons/quotes/leading whitespace are double-quoted ' +
  '(escapes: `\\\\`, `\\"`); other strings, numbers, booleans, and `null` are bare.';

export const toonDesc = (description: string): string => `${description}\n\n${TOON_PRIMER}`;

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
