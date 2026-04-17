import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerAlarmTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_alarms',
    {
      title: 'List alarms',
      description:
        'List enabled alarms for the company. Optionally filter by equipment IDs or by whether ' +
        'the alarm type is preventative maintenance (pm).',
      inputSchema: {
        equipIds: z
          .array(idParam)
          .optional()
          .describe('Filter to alarms for the given equipment IDs'),
        pm: z
          .boolean()
          .optional()
          .describe('If true, only return preventative-maintenance alarms; if false, only non-PM'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ equipIds, pm }) =>
      runTool(async () => {
        const { body } = await client.vmcp('/alarms', { query: { equipIds, pm } });
        return body;
      }),
  );
}
