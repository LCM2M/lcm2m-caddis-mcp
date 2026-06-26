import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { idParam, readOnlyAnnotations, runTool, toonDesc } from '../schemas.js';

export function registerCatalogTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_manufacturers',
    {
      title: 'List equipment manufacturers',
      description: toonDesc(
        'List equipment manufacturers defined for the company, sorted by name. ' +
          'Use to decode the manufacturer of a piece of equipment or to look up a ' +
          'manufacturer ID for caddis_list_models.',
      ),
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vm2m('/manufacturers');
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_list_models',
    {
      title: 'List equipment models',
      description: toonDesc(
        'List equipment models defined for the company, sorted by model number. ' +
          'Optionally filter to a single manufacturer via manufacturerId.',
      ),
      inputSchema: {
        manufacturerId: idParam.optional().describe('Filter to models for a specific manufacturer'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ manufacturerId }) =>
      runTool(async () => {
        const { body } = await client.vm2m('/models', { query: { manufacturerId } });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_list_categories',
    {
      title: 'List equipment categories',
      description: toonDesc(
        'List equipment categories defined for the company, sorted by name. ' +
          'Use to decode the category of a piece of equipment.',
      ),
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vm2m('/categories');
        return body;
      }),
  );
}
