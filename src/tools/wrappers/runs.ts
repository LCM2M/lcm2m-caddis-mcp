import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { encodePathSegment, idParam, isoDate, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerRunTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_runs',
    {
      title: 'List production runs',
      description:
        'List production runs for the company. Optionally filter by equipment and/or a date range ' +
        '(runs whose active interval intersects [start, end)).',
      inputSchema: {
        equipment_id: idParam.optional().describe('Filter to runs for a specific equipment ID'),
        start: isoDate.optional().describe('ISO 8601 lower bound (optional)'),
        end: isoDate.optional().describe('ISO 8601 upper bound (optional)'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ equipment_id, start, end }) =>
      runTool(async () => {
        const { body } = await client.vmcp('/runs', {
          query: { equipment_id, start, end },
        });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_run',
    {
      title: 'Get one run',
      description: 'Fetch a single production run by ID, including its equipment.',
      inputSchema: { runId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ runId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/runs/${encodePathSegment(runId)}`);
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_run_cycles',
    {
      title: 'Production cycles for a run',
      description:
        'All production cycles associated with a specific run. Use this instead of ' +
        'caddis_get_equipment_cycles when the scope is a known run.',
      inputSchema: { runId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ runId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/runs/${encodePathSegment(runId)}/cycles`);
        return body;
      }),
  );
}
