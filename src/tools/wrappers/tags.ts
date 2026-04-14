import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CaddisApiClient } from '../../client.js';
import { encodePathSegment, idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerTagTools(server: McpServer, client: CaddisApiClient): void {
  server.registerTool(
    'caddis_list_tags',
    {
      title: 'List cycle tags',
      description:
        'List cycle tags for the company. Optionally filter by active state or by tag group.',
      inputSchema: {
        active: z
          .boolean()
          .optional()
          .describe('If true, only active tags; if false, only inactive'),
        tagGroupId: idParam.optional().describe('Filter to tags in a specific tag group'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ active, tagGroupId }) =>
      runTool(async () => {
        const { body } = await client.vmcp('/tags', { query: { active, tagGroupId } });
        return body;
      }),
  );

  server.registerTool(
    'caddis_get_tag',
    {
      title: 'Get one cycle tag',
      description: 'Fetch a single cycle tag by ID.',
      inputSchema: { tagId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ tagId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/tags/${encodePathSegment(tagId)}`);
        return body;
      }),
  );
}
