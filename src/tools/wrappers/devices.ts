import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { encodePathSegment, idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerDeviceTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
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

  registerTool(
    server,
    registry,
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
