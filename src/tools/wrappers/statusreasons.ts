import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { readOnlyAnnotations, runTool } from '../schemas.js';

export function registerStatusReasonTools(server: McpServer, client: CaddisApiClient): void {
  server.registerTool(
    'caddis_list_status_reasons',
    {
      title: 'List status reasons',
      description:
        'List active status reasons available for classifying downtime. Use in combination with ' +
        'caddis_get_equipment_statuslogs to decode reason IDs in the log stream.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vmcp('/statusreasons');
        return body;
      }),
  );
}
