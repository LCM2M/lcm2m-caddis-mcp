import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { readOnlyAnnotations, runTool } from '../schemas.js';

export function registerCompanyTools(server: McpServer, client: CaddisApiClient): void {
  server.registerTool(
    'caddis_get_company',
    {
      title: 'Get company details',
      description:
        'Fetch the active company (name, timezone, point-of-contact, and other top-level settings). ' +
        'Useful as a first call to confirm which company the session is scoped to.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vmcp('/company');
        return body;
      }),
  );
}
