import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { encodePathSegment, idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerDeviceTools(server: McpServer, client: CaddisApiClient): void {
  server.registerTool(
    'caddis_list_devices',
    {
      title: 'List devices',
      description:
        'List all physical Caddis devices registered to the company, with their assigned equipment.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vmcp('/devices');
        return body;
      }),
  );

  server.registerTool(
    'caddis_get_device',
    {
      title: 'Get one device',
      description: 'Fetch a single Caddis device by ID, including its attached equipment.',
      inputSchema: { deviceId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ deviceId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/devices/${encodePathSegment(deviceId)}`);
        return body;
      }),
  );
}
