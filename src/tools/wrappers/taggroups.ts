import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { encodePathSegment, idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerTagGroupTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_tag_groups',
    {
      title: 'List tag groups',
      description: 'List all cycle tag groups for the company.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vmcp('/taggroups');
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_tag_group',
    {
      title: 'Get one tag group',
      description: 'Fetch a single tag group by ID.',
      inputSchema: { tagGroupId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ tagGroupId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/taggroups/${encodePathSegment(tagGroupId)}`);
        return body;
      }),
  );
}
